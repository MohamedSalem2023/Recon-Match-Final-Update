import ExcelJS from 'exceljs';
import { getDynamicLabel, getDebitCredit } from './reconciliation.js';

export async function generateExcelReport(
  matches: any[],
  adjustments: any[],
  unmatchedA: any[],
  unmatchedB: any[],
  bankReconciliation: any,
  mappingsA: any,
  mappingsB: any
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reconciliation System';

  // 1. Reconciliation Summary
  if (bankReconciliation) {
    const ws = workbook.addWorksheet('Reconciliation Summary', {
      views: [{ state: 'frozen', ySplit: 2 }]
    });

    // Columns
    ws.columns = [
      { header: '', key: 'col1', width: 5 },
      { header: 'Description', key: 'desc', width: 50 },
      { header: 'Amount', key: 'amount', width: 25 },
    ];

    // Add Company Name / Title
    ws.mergeCells('B1:C1');
    const titleCell = ws.getCell('B1');
    titleCell.value = 'Bank Reconciliation Summary';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 30;

    ws.addRow([]); // Empty row

    // Helper for currency format
    const currencyFormat = '"$"#,##0.00;[Red]\\-"$"#,##0.00';

    // Opening Balance
    const rowOB = ws.addRow(['', 'Opening Balance (Sheet 1)', bankReconciliation.openingBalance]);
    rowOB.getCell(2).font = { bold: true };
    rowOB.getCell(3).font = { bold: true };
    rowOB.getCell(3).numFmt = currencyFormat;
    rowOB.getCell(3).alignment = { horizontal: 'right' };

    ws.addRow([]);

    // Additions
    const rowAddTitle = ws.addRow(['', 'Additions (Sheet 2 Unmatched)', bankReconciliation.totalAdditions]);
    rowAddTitle.getCell(2).font = { bold: true, color: { argb: 'FF059669' } }; // Emerald 600
    rowAddTitle.getCell(3).font = { bold: true, color: { argb: 'FF059669' } };
    rowAddTitle.getCell(3).numFmt = currencyFormat;
    rowAddTitle.getCell(3).alignment = { horizontal: 'right' };
    rowAddTitle.getCell(3).border = { bottom: { style: 'medium' } };

    const additionsList = [
      ...(unmatchedB || []).map((b: any) => {
        const { debit, credit } = getDebitCredit(b, mappingsB);
        return {
          label: getDynamicLabel(b, mappingsB),
          amount: debit + credit
        };
      }),
      ...(adjustments || []).filter((a: any) => !a.approved).map((adj: any) => ({
        label: `${adj.identifier} (Rejected Adj)`,
        amount: adj.amountB
      }))
    ];

    additionsList.forEach(item => {
      const row = ws.addRow(['', `   - ${item.label}`, item.amount]);
      row.getCell(2).font = { color: { argb: 'FF059669' } };
      row.getCell(3).font = { color: { argb: 'FF059669' } };
      row.getCell(3).numFmt = currencyFormat;
      row.getCell(3).alignment = { horizontal: 'right' };
    });

    ws.addRow([]);

    // Deductions
    const rowDedTitle = ws.addRow(['', 'Deductions (Sheet 1 Unmatched)', bankReconciliation.totalDeductions]);
    rowDedTitle.getCell(2).font = { bold: true, color: { argb: 'FFE11D48' } }; // Rose 600
    rowDedTitle.getCell(3).font = { bold: true, color: { argb: 'FFE11D48' } };
    rowDedTitle.getCell(3).numFmt = currencyFormat;
    rowDedTitle.getCell(3).alignment = { horizontal: 'right' };
    rowDedTitle.getCell(3).border = { bottom: { style: 'medium' } };

    const deductionsList = [
      ...(unmatchedA || []).map((a: any) => {
        const { debit, credit } = getDebitCredit(a, mappingsA);
        return {
          label: getDynamicLabel(a, mappingsA),
          amount: debit + credit
        };
      }),
      ...(adjustments || []).filter((a: any) => !a.approved).map((adj: any) => ({
        label: `${adj.identifier} (Rejected Adj)`,
        amount: adj.amountA
      }))
    ];

    deductionsList.forEach(item => {
      const row = ws.addRow(['', `   - ${item.label}`, item.amount]);
      row.getCell(2).font = { color: { argb: 'FFE11D48' } };
      row.getCell(3).font = { color: { argb: 'FFE11D48' } };
      row.getCell(3).numFmt = currencyFormat;
      row.getCell(3).alignment = { horizontal: 'right' };
    });

    ws.addRow([]);

    // Adjustments
    const approvedAdjustments = (adjustments || []).filter((a: any) => a.approved);
    if (approvedAdjustments.length > 0) {
      const rowAdjTitle = ws.addRow(['', 'Adjustments (Amount Differences)', bankReconciliation.netAdjustments]);
      rowAdjTitle.getCell(2).font = { bold: true, color: { argb: 'FFD97706' } }; // Amber 600
      rowAdjTitle.getCell(3).font = { bold: true, color: { argb: 'FFD97706' } };
      rowAdjTitle.getCell(3).numFmt = currencyFormat;
      rowAdjTitle.getCell(3).alignment = { horizontal: 'right' };
      rowAdjTitle.getCell(3).border = { bottom: { style: 'medium' } };

      approvedAdjustments.forEach((adj: any) => {
        const row = ws.addRow(['', `   - ${adj.identifier}   S1: ${adj.amountA} | S2: ${adj.amountB} | Diff: ${adj.difference}`, adj.difference]);
        row.getCell(2).font = { color: { argb: 'FFD97706' } };
        row.getCell(3).font = { color: { argb: 'FFD97706' } };
        row.getCell(3).numFmt = currencyFormat;
        row.getCell(3).alignment = { horizontal: 'right' };
      });

      ws.addRow([]);
    }

    // Adjusted Balance
    const rowAdjBal = ws.addRow(['', 'Adjusted Balance', bankReconciliation.adjustedBalance]);
    rowAdjBal.getCell(2).font = { bold: true };
    rowAdjBal.getCell(3).font = { bold: true };
    rowAdjBal.getCell(3).numFmt = currencyFormat;
    rowAdjBal.getCell(3).alignment = { horizontal: 'right' };
    rowAdjBal.getCell(2).border = { top: { style: 'thin' } };
    rowAdjBal.getCell(3).border = { top: { style: 'thin' } };

    ws.addRow([]);

    // Target Balance
    const rowTarget = ws.addRow(['', 'Target Balance (Sheet 2)', bankReconciliation.targetBalance]);
    rowTarget.getCell(2).font = { bold: true };
    rowTarget.getCell(3).font = { bold: true };
    rowTarget.getCell(3).numFmt = currencyFormat;
    rowTarget.getCell(3).alignment = { horizontal: 'right' };

    ws.addRow([]);

    // Status
    const isBalanced = bankReconciliation.isBalanced;
    const statusText = isBalanced ? 'Status: Balanced \u2705' : 'Status: Not Balanced \u274C';
    const rowStatus = ws.addRow(['', statusText, bankReconciliation.difference]);
    
    rowStatus.getCell(2).font = { bold: true, color: { argb: isBalanced ? 'FF065F46' : 'FF9F1239' } };
    rowStatus.getCell(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isBalanced ? 'FFD1FAE5' : 'FFFFE4E6' }
    };
    
    rowStatus.getCell(3).font = { bold: true, color: { argb: isBalanced ? 'FF065F46' : 'FF9F1239' } };
    rowStatus.getCell(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isBalanced ? 'FFD1FAE5' : 'FFFFE4E6' }
    };
    rowStatus.getCell(3).numFmt = currencyFormat;
    rowStatus.getCell(3).alignment = { horizontal: 'right' };
  }

  // 2. Detailed Matches
  const wsMatches = workbook.addWorksheet('Detailed Matches', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  wsMatches.columns = [
    { header: 'Match ID', key: 'id', width: 15 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Debit Match', key: 'debitMatch', width: 20 },
    { header: 'Credit Match', key: 'creditMatch', width: 20 },
    { header: 'Total Match', key: 'totalMatch', width: 20 },
    { header: 'Difference', key: 'diff', width: 20 },
    { header: 'Records A (JSON)', key: 'recA', width: 50 },
    { header: 'Records B (JSON)', key: 'recB', width: 50 },
  ];
  
  // Style header
  wsMatches.getRow(1).font = { bold: true };

  (matches || []).forEach((m: any) => {
    wsMatches.addRow({
      id: m.id,
      type: m.type,
      debitMatch: m.debitMatchA,
      creditMatch: m.creditMatchA,
      totalMatch: m.totalAmountA,
      diff: m.difference,
      recA: JSON.stringify(m.recordsA),
      recB: JSON.stringify(m.recordsB),
    });
  });

  // 3. Unmatched Items
  const wsUnmatched = workbook.addWorksheet('Unmatched Items', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  wsUnmatched.columns = [
    { header: 'Dataset', key: 'dataset', width: 15 },
    { header: 'Identifier', key: 'identifier', width: 30 },
    { header: 'Record Data (JSON)', key: 'data', width: 80 },
  ];
  
  // Style header
  wsUnmatched.getRow(1).font = { bold: true };

  const unmatchedAData = [
    ...(unmatchedA || []).map((a: any) => ({
      dataset: 'Sheet 1',
      identifier: getDynamicLabel(a, mappingsA),
      data: JSON.stringify(a)
    })),
    ...(adjustments || []).filter((a: any) => !a.approved).map((adj: any) => ({
      dataset: 'Sheet 1',
      identifier: `${adj.identifier} (Rejected Adj)`,
      data: JSON.stringify(adj.recordA)
    }))
  ];

  const unmatchedBData = [
    ...(unmatchedB || []).map((b: any) => ({
      dataset: 'Sheet 2',
      identifier: getDynamicLabel(b, mappingsB),
      data: JSON.stringify(b)
    })),
    ...(adjustments || []).filter((a: any) => !a.approved).map((adj: any) => ({
      dataset: 'Sheet 2',
      identifier: `${adj.identifier} (Rejected Adj)`,
      data: JSON.stringify(adj.recordB)
    }))
  ];

  [...unmatchedAData, ...unmatchedBData].forEach(item => {
    wsUnmatched.addRow(item);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
