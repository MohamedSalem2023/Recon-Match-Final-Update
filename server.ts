import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { reconcileData, getDynamicLabel } from './src/services/reconciliation.js';
import { generateExcelReport } from './src/services/exportService.js';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API Routes
app.post('/api/reconcile', (req, res) => {
  try {
    const { datasetA, datasetB, mappingsA, mappingsB, settings } = req.body;
    
    if (!datasetA || !datasetB || !mappingsA || !mappingsB) {
      return res.status(400).json({ error: 'Missing required data for reconciliation' });
    }

    const results = reconcileData(datasetA, datasetB, mappingsA, mappingsB, settings);
    res.json(results);
  } catch (error) {
    console.error('Reconciliation error:', error);
    res.status(500).json({ error: 'Failed to reconcile data' });
  }
});

app.post('/api/export', async (req, res) => {
  try {
    const { matches, adjustments, unmatchedA, unmatchedB, bankReconciliation, mappingsA, mappingsB } = req.body;

    const buffer = await generateExcelReport(
      matches,
      adjustments,
      unmatchedA,
      unmatchedB,
      bankReconciliation,
      mappingsA,
      mappingsB
    );
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reconciliation_results.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
