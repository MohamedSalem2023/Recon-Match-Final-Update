import React, { useState } from 'react';
import { UploadPage } from './components/UploadPage';
import { MappingPage } from './components/MappingPage';
import { ResultsPage } from './components/ResultsPage';
import { Dataset, FieldMapping, ReconcileSettings, ReconciliationResponse } from './types';
import { Activity } from 'lucide-react';

export default function App() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [results, setResults] = useState<ReconciliationResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUploadNext = (uploadedDatasets: Dataset[]) => {
    setDatasets(uploadedDatasets);
    setStep(2);
  };

  const handleMappingNext = async (
    datasetA: Dataset,
    datasetB: Dataset,
    mappingsA: FieldMapping,
    mappingsB: FieldMapping,
    settings: ReconcileSettings
  ) => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetA: datasetA.data,
          datasetB: datasetB.data,
          mappingsA,
          mappingsB,
          settings,
        }),
      });

      if (!response.ok) throw new Error('Reconciliation failed');

      const data = await response.json();
      setResults(data);
      setStep(3);
    } catch (error) {
      console.error(error);
      alert('Failed to run reconciliation.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestart = () => {
    setStep(1);
    setDatasets([]);
    setResults(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900">ReconMatch</span>
          </div>
          <div className="flex items-center space-x-2 text-sm font-medium text-slate-500">
            <span className={step === 1 ? 'text-indigo-600' : ''}>1. Upload</span>
            <span>&rarr;</span>
            <span className={step === 2 ? 'text-indigo-600' : ''}>2. Map</span>
            <span>&rarr;</span>
            <span className={step === 3 ? 'text-indigo-600' : ''}>3. Results</span>
          </div>
        </div>
      </header>

      <main className="py-12">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-6"></div>
            <h2 className="text-2xl font-semibold text-slate-800">Processing Data...</h2>
            <p className="text-slate-500 mt-2">Running matching algorithms on your datasets.</p>
          </div>
        ) : (
          <>
            {step === 1 && <UploadPage onNext={handleUploadNext} />}
            {step === 2 && (
              <MappingPage
                datasets={datasets}
                onBack={() => setStep(1)}
                onNext={handleMappingNext}
              />
            )}
            {step === 3 && results && (
              <ResultsPage results={results} onRestart={handleRestart} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
