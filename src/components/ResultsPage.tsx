import React, { useState, useRef } from 'react';
import { Download, CheckCircle, XCircle, RefreshCw, Link, PlusCircle, MinusCircle, AlertCircle, FileText } from 'lucide-react';
import { ReconciliationResponse, MatchResult } from '../types';
import { getDynamicLabel, getDebitCredit } from '../services/reconciliation';
import { PdfExportTemplate } from './PdfExportTemplate';

interface ResultsPageProps {
  results: ReconciliationResponse;
  onRestart: () => void;
}

export function ResultsPage({ results: initialResults, onRestart }: ResultsPageProps) {
  const [results, setResults] = useState(initialResults);
  const [activeTab, setActiveTab] = useState<'summary' | 'matches' | 'unmatchedA' | 'unmatchedB' | 'manual'>('summary');
  const [selectedA, setSelectedA] = useState<number[]>([]);
  const [selectedB, setSelectedB] = useState<number[]>([]);

  const [editingAdjId, setEditingAdjId] = useState<string | null>(null);
  const [editDiffValue, setEditDiffValue] = useState<string>('');

  const recalculateBankReconciliation = (currentResults: ReconciliationResponse) => {
    const openingBalance = currentResults.bankReconciliation.openingBalance;
    const targetBalance = currentResults.bankReconciliation.targetBalance;
    
    // Additions = Unmatched B + Rejected Adjustments (Sheet 2 side)
    const totalAdditions = currentResults.unmatchedB.reduce((sum, b) => {
      const { debit, credit } = getDebitCredit(b, currentResults.mappingsB);
      return sum + debit + credit;
    }, 0) + currentResults.adjustments.filter(a => !a.approved).reduce((sum, a) => sum + a.amountB, 0);
    
    // Deductions = Unmatched A + Rejected Adjustments (Sheet 1 side)
    const totalDeductions = currentResults.unmatchedA.reduce((sum, a) => {
      const { debit, credit } = getDebitCredit(a, currentResults.mappingsA);
      return sum + debit + credit;
    }, 0) + currentResults.adjustments.filter(a => !a.approved).reduce((sum, a) => sum + a.amountA, 0);
    
    // Net Adjustments = Sum of approved differences
    const netAdjustments = currentResults.adjustments.filter(a => a.approved).reduce((sum, a) => sum + a.difference, 0);
    
    const adjustedBalance = openingBalance + totalAdditions - totalDeductions + netAdjustments;
    const difference = adjustedBalance - targetBalance;
    const isBalanced = Math.abs(difference) < 0.01;

    return {
      ...currentResults.bankReconciliation,
      totalAdditions,
      totalDeductions,
      netAdjustments,
      adjustedBalance,
      difference,
      isBalanced
    };
  };

  const toggleAdjustment = (id: string) => {
    setResults(prev => {
      const newAdjustments = prev.adjustments.map(adj => 
        adj.id === id ? { ...adj, approved: !adj.approved } : adj
      );
      const newResults = { ...prev, adjustments: newAdjustments };
      newResults.bankReconciliation = recalculateBankReconciliation(newResults);
      return newResults;
    });
  };

  const saveAdjustmentDiff = (id: string) => {
    const newDiff = parseFloat(editDiffValue);
    if (isNaN(newDiff)) {
      setEditingAdjId(null);
      return;
    }

    setResults(prev => {
      const newAdjustments = prev.adjustments.map(adj => 
        adj.id === id ? { ...adj, difference: newDiff, manualDifference: newDiff } : adj
      );
      const newResults = { ...prev, adjustments: newAdjustments };
      newResults.bankReconciliation = recalculateBankReconciliation(newResults);
      return newResults;
    });
    setEditingAdjId(null);
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pdfRef = useRef<HTMLDivElement>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [reportId] = useState(`REP-${Date.now().toString().slice(-6)}`);

  const handleExportPDF = async () => {
    if (!pdfRef.current) return;
    try {
      setIsExportingPdf(true);
      
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
              body { font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
            </style>
          </head>
          <body class="bg-white">
            ${pdfRef.current.outerHTML}
          </body>
        </html>
      `;

      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlContent }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `Reconciliation_Report_${reportId}_${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('Failed to generate PDF report.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      });
      
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'reconciliation_results.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(error);
      alert('Failed to export results.');
    }
  };

  const handleManualMatch = () => {
    if (selectedA.length === 0 && selectedB.length === 0) return;

    const recordsA = selectedA.map(i => results.unmatchedA[i]);
    const recordsB = selectedB.map(i => results.unmatchedB[i]);

    let debitMatchA = 0;
    let creditMatchA = 0;
    recordsA.forEach(r => {
      const { debit, credit } = getDebitCredit(r, results.mappingsA);
      debitMatchA += debit;
      creditMatchA += credit;
    });

    let debitMatchB = 0;
    let creditMatchB = 0;
    recordsB.forEach(r => {
      const { debit, credit } = getDebitCredit(r, results.mappingsB);
      debitMatchB += debit;
      creditMatchB += credit;
    });
    
    const newMatch: MatchResult = {
      id: `manual-${Date.now()}`,
      type: 'manual',
      recordsA,
      recordsB,
      debitMatchA,
      creditMatchA,
      totalAmountA: debitMatchA + creditMatchA,
      debitMatchB,
      creditMatchB,
      totalAmountB: debitMatchB + creditMatchB,
      difference: Math.abs((debitMatchA + creditMatchA) - (debitMatchB + creditMatchB)),
    };

    setResults(prev => ({
      ...prev,
      matches: [...prev.matches, newMatch],
      unmatchedA: prev.unmatchedA.filter((_, i) => !selectedA.includes(i)),
      unmatchedB: prev.unmatchedB.filter((_, i) => !selectedB.includes(i)),
      summary: {
        ...prev.summary,
        matchedA: prev.summary.matchedA + recordsA.length,
        matchedB: prev.summary.matchedB + recordsB.length,
        matchPercentageA: Math.round(((prev.summary.matchedA + recordsA.length) / prev.summary.totalA) * 100),
        matchPercentageB: Math.round(((prev.summary.matchedB + recordsB.length) / prev.summary.totalB) * 100),
      }
    }));

    setSelectedA([]);
    setSelectedB([]);
    setActiveTab('matches');
  };

  const { summary } = results;
  const rejectedAdjustmentsCount = results.adjustments.filter(a => !a.approved).length;
  const currentMatchedA = summary.matchedA - rejectedAdjustmentsCount;
  const currentMatchedB = summary.matchedB - rejectedAdjustmentsCount;
  const currentMatchPercentageA = summary.totalA > 0 ? ((currentMatchedA / summary.totalA) * 100).toFixed(1) : '0.0';
  const currentMatchPercentageB = summary.totalB > 0 ? ((currentMatchedB / summary.totalB) * 100).toFixed(1) : '0.0';

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Reconciliation Results</h1>
          <p className="text-slate-600 mt-2">Review your matched and unmatched transactions.</p>
        </div>
        <div className="flex space-x-4">
          <button
            onClick={onRestart}
            className="flex items-center space-x-2 px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Start Over</span>
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExportingPdf}
            className="flex items-center space-x-2 px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {isExportingPdf ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileText className="w-5 h-5" />
            )}
            <span>{isExportingPdf ? 'Generating PDF...' : 'Export PDF'}</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center space-x-2 px-6 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Download className="w-5 h-5" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Dashboard Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Total Matches</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{results.matches.length + results.adjustments.filter(a => a.approved).length}</p>
        </div>
        
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Dataset A Matched</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{currentMatchedA} / {summary.totalA}</p>
          <p className="text-sm text-emerald-600 font-medium mt-1">{currentMatchPercentageA}% Match Rate</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Dataset B Matched</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{currentMatchedB} / {summary.totalB}</p>
          <p className="text-sm text-emerald-600 font-medium mt-1">{currentMatchPercentageB}% Match Rate</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-rose-100 rounded-lg">
              <XCircle className="w-6 h-6 text-rose-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">Unmatched</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{results.unmatchedA.length + results.unmatchedB.length + (results.adjustments.filter(a => !a.approved).length * 2)}</p>
          <p className="text-sm text-rose-600 font-medium mt-1">Total Unmatched Records</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('summary')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'summary'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Bank Summary
          </button>
          <button
            onClick={() => setActiveTab('matches')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'matches'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Matches ({results.matches.length})
          </button>
          <button
            onClick={() => setActiveTab('unmatchedA')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'unmatchedA'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Unmatched Dataset A ({results.unmatchedA.length + results.adjustments.filter(a => !a.approved).length})
          </button>
          <button
            onClick={() => setActiveTab('unmatchedB')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'unmatchedB'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Unmatched Dataset B ({results.unmatchedB.length + results.adjustments.filter(a => !a.approved).length})
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'manual'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            Manual Match
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {activeTab === 'summary' && results.bankReconciliation && (
          <div className="p-8 max-w-4xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                <h2 className="text-xl font-bold text-slate-800">Bank Reconciliation Summary</h2>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Opening Balance */}
                <div className="flex justify-between items-center py-3 border-b border-slate-100">
                  <span className="text-lg font-medium text-slate-700">Opening Balance (Sheet 1)</span>
                  <span className="text-lg font-bold text-slate-900">{formatCurrency(results.bankReconciliation.openingBalance)}</span>
                </div>

                {/* Additions */}
                <div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-md font-medium text-emerald-700 flex items-center"><PlusCircle className="w-4 h-4 mr-2"/> Additions (Sheet 2 Unmatched)</span>
                    <span className="text-md font-bold text-emerald-700">{formatCurrency(results.bankReconciliation.totalAdditions)}</span>
                  </div>
                  <div className="pl-6 space-y-1 mt-2">
                    {results.unmatchedB.map((record, idx) => {
                      const { debit, credit } = getDebitCredit(record, results.mappingsB);
                      return (
                        <div key={`b-${idx}`} className="flex justify-between text-sm text-slate-600 border-b border-slate-50 pb-1">
                          <span className="truncate pr-4">{getDynamicLabel(record, results.mappingsB)}</span>
                          <span>{formatCurrency(debit + credit)}</span>
                        </div>
                      );
                    })}
                    {results.adjustments.filter(a => !a.approved).map((adj, idx) => (
                      <div key={`adj-b-${idx}`} className="flex justify-between text-sm text-slate-600 border-b border-slate-50 pb-1">
                        <span className="truncate pr-4">{adj.identifier} <span className="text-rose-500 text-xs">(Rejected Adj)</span></span>
                        <span>{formatCurrency(adj.amountB)}</span>
                      </div>
                    ))}
                    {results.unmatchedB.length === 0 && results.adjustments.filter(a => !a.approved).length === 0 && <div className="text-sm text-slate-400 italic">No additions</div>}
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-md font-medium text-rose-700 flex items-center"><MinusCircle className="w-4 h-4 mr-2"/> Deductions (Sheet 1 Unmatched)</span>
                    <span className="text-md font-bold text-rose-700">{formatCurrency(results.bankReconciliation.totalDeductions)}</span>
                  </div>
                  <div className="pl-6 space-y-1 mt-2">
                    {results.unmatchedA.map((record, idx) => {
                      const { debit, credit } = getDebitCredit(record, results.mappingsA);
                      return (
                        <div key={`a-${idx}`} className="flex justify-between text-sm text-slate-600 border-b border-slate-50 pb-1">
                          <span className="truncate pr-4">{getDynamicLabel(record, results.mappingsA)}</span>
                          <span>{formatCurrency(debit + credit)}</span>
                        </div>
                      );
                    })}
                    {results.adjustments.filter(a => !a.approved).map((adj, idx) => (
                      <div key={`adj-a-${idx}`} className="flex justify-between text-sm text-slate-600 border-b border-slate-50 pb-1">
                        <span className="truncate pr-4">{adj.identifier} <span className="text-rose-500 text-xs">(Rejected Adj)</span></span>
                        <span>{formatCurrency(adj.amountA)}</span>
                      </div>
                    ))}
                    {results.unmatchedA.length === 0 && results.adjustments.filter(a => !a.approved).length === 0 && <div className="text-sm text-slate-400 italic">No deductions</div>}
                  </div>
                </div>

                {/* Adjustments */}
                {results.adjustments && results.adjustments.length > 0 && (
                  <div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-md font-medium text-amber-700 flex items-center"><AlertCircle className="w-4 h-4 mr-2"/> Adjustments (Amount Differences)</span>
                      <span className="text-md font-bold text-amber-700">{formatCurrency(results.bankReconciliation.netAdjustments)}</span>
                    </div>
                    <div className="pl-6 space-y-2 mt-2">
                      {results.adjustments.map((adj) => (
                        <div key={adj.id} className={`flex items-center justify-between text-sm border-b border-slate-50 pb-2 ${!adj.approved ? 'opacity-50' : ''}`}>
                          <div className="flex-1">
                            <div className="font-medium text-slate-700">{adj.identifier}</div>
                            <div className="text-xs text-slate-500 flex space-x-4 mt-1">
                              <span>Sheet 1: {formatCurrency(adj.amountA)}</span>
                              <span>Sheet 2: {formatCurrency(adj.amountB)}</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4">
                            {editingAdjId === adj.id ? (
                              <div className="flex items-center space-x-2">
                                <input
                                  type="number"
                                  value={editDiffValue}
                                  onChange={(e) => setEditDiffValue(e.target.value)}
                                  className="w-24 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveAdjustmentDiff(adj.id);
                                    if (e.key === 'Escape') setEditingAdjId(null);
                                  }}
                                />
                                <button onClick={() => saveAdjustmentDiff(adj.id)} className="text-xs text-indigo-600 font-medium hover:text-indigo-800">Save</button>
                                <button onClick={() => setEditingAdjId(null)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                              </div>
                            ) : (
                              <div 
                                className={`font-medium cursor-pointer hover:underline ${adj.difference > 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                                onClick={() => {
                                  if (!adj.approved) return;
                                  setEditingAdjId(adj.id);
                                  setEditDiffValue(adj.difference.toString());
                                }}
                                title={adj.approved ? "Click to edit difference" : ""}
                              >
                                {adj.difference > 0 ? '+' : ''}{formatCurrency(adj.difference)}
                              </div>
                            )}
                            <button
                              onClick={() => toggleAdjustment(adj.id)}
                              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                adj.approved 
                                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {adj.approved ? 'Approved' : 'Rejected'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Adjusted Balance */}
                <div className="flex justify-between items-center py-3 border-t-2 border-slate-200 mt-4">
                  <span className="text-lg font-bold text-slate-800">Adjusted Balance</span>
                  <span className="text-lg font-bold text-slate-900">{formatCurrency(results.bankReconciliation.adjustedBalance)}</span>
                </div>

                {/* Target Balance */}
                <div className="flex justify-between items-center py-3 border-b border-slate-100">
                  <span className="text-lg font-medium text-slate-700">Target Balance (Sheet 2)</span>
                  <span className="text-lg font-bold text-slate-900">{formatCurrency(results.bankReconciliation.targetBalance)}</span>
                </div>

                {/* Difference & Status */}
                <div className={`flex justify-between items-center py-4 px-4 rounded-xl mt-6 ${results.bankReconciliation.isBalanced ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                  <div className="flex items-center space-x-3">
                    {results.bankReconciliation.isBalanced ? <CheckCircle className="w-6 h-6 text-emerald-600" /> : <AlertCircle className="w-6 h-6 text-rose-600" />}
                    <span className={`text-lg font-bold ${results.bankReconciliation.isBalanced ? 'text-emerald-800' : 'text-rose-800'}`}>
                      {results.bankReconciliation.isBalanced ? 'Balanced' : 'Difference'}
                    </span>
                  </div>
                  <span className={`text-xl font-bold ${results.bankReconciliation.isBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatCurrency(results.bankReconciliation.difference)}
                  </span>
                </div>

              </div>
            </div>
          </div>
        )}

        {activeTab === 'matches' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-sm font-semibold text-slate-600">Match Type</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Dataset A Records</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Dataset B Records</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 text-right">Debit Match</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 text-right">Credit Match</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 text-right">Total Match</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 text-right">Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {results.matches.map((match, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                        ${match.type === 'exact' ? 'bg-emerald-100 text-emerald-800' : 
                          match.type === 'combined' ? 'bg-blue-100 text-blue-800' : 
                          match.type === 'manual' ? 'bg-purple-100 text-purple-800' :
                          match.type === 'daily-aggregate' ? 'bg-teal-100 text-teal-800' :
                          'bg-amber-100 text-amber-800'}`}
                      >
                        {match.type}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <div className="max-h-24 overflow-y-auto space-y-2">
                        {match.recordsA.map((r, i) => (
                          <div key={i} className="flex flex-col">
                            <span className="font-medium text-slate-800">{getDynamicLabel(r, results.mappingsA)}</span>
                            <span className="text-xs text-slate-500 truncate max-w-xs" title={JSON.stringify(r)}>
                              {JSON.stringify(r)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <div className="max-h-24 overflow-y-auto space-y-2">
                        {match.recordsB.map((r, i) => (
                          <div key={i} className="flex flex-col">
                            <span className="font-medium text-slate-800">{getDynamicLabel(r, results.mappingsB)}</span>
                            <span className="text-xs text-slate-500 truncate max-w-xs" title={JSON.stringify(r)}>
                              {JSON.stringify(r)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-sm font-medium text-blue-600 text-right">
                      {match.debitMatchA.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-sm font-medium text-rose-600 text-right">
                      {match.creditMatchA.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-sm font-bold text-slate-900 text-right">
                      {match.totalAmountA.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`p-4 text-sm font-medium text-right ${match.difference > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {match.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {results.matches.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">No matches found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {(activeTab === 'unmatchedA' || activeTab === 'unmatchedB') && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-sm font-semibold text-slate-600">Identifier</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Record Data (JSON)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(activeTab === 'unmatchedA' ? results.unmatchedA : results.unmatchedB).map((record, idx) => (
                  <tr key={`unmatched-${idx}`} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm font-medium text-slate-800">
                      {getDynamicLabel(record, activeTab === 'unmatchedA' ? results.mappingsA : results.mappingsB)}
                    </td>
                    <td className="p-4 text-sm text-slate-600 font-mono">
                      {JSON.stringify(record, null, 2)}
                    </td>
                  </tr>
                ))}
                {results.adjustments.filter(a => !a.approved).map((adj, idx) => (
                  <tr key={`adj-${idx}`} className="hover:bg-rose-50 bg-rose-50/30 transition-colors">
                    <td className="p-4 text-sm font-medium text-rose-700">
                      {adj.identifier} <span className="text-xs">(Rejected Adj)</span>
                    </td>
                    <td className="p-4 text-sm text-slate-600 font-mono">
                      {JSON.stringify(activeTab === 'unmatchedA' ? adj.recordA : adj.recordB, null, 2)}
                    </td>
                  </tr>
                ))}
                {(activeTab === 'unmatchedA' ? results.unmatchedA : results.unmatchedB).length === 0 && results.adjustments.filter(a => !a.approved).length === 0 && (
                  <tr>
                    <td colSpan={2} className="p-8 text-center text-slate-500">No unmatched records.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-slate-800">Manual Match</h3>
              <button
                onClick={handleManualMatch}
                disabled={selectedA.length === 0 && selectedB.length === 0}
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Link className="w-4 h-4" />
                <span>Match Selected</span>
              </button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dataset A */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 p-3 border-b border-slate-200">
                  <h4 className="font-semibold text-slate-700">Unmatched Dataset A</h4>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {results.unmatchedA.map((record, idx) => (
                    <label key={idx} className="flex items-start p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedA.includes(idx)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedA(prev => [...prev, idx]);
                          else setSelectedA(prev => prev.filter(i => i !== idx));
                        }}
                        className="mt-1 mr-3 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-slate-800 font-medium mb-1">
                          {getDynamicLabel(record, results.mappingsA)}
                        </div>
                        <div className="text-xs text-slate-500 font-mono break-all">
                          {JSON.stringify(record)}
                        </div>
                      </div>
                    </label>
                  ))}
                  {results.unmatchedA.length === 0 && (
                    <div className="p-4 text-center text-slate-500 text-sm">No unmatched records.</div>
                  )}
                </div>
              </div>

              {/* Dataset B */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 p-3 border-b border-slate-200">
                  <h4 className="font-semibold text-slate-700">Unmatched Dataset B</h4>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {results.unmatchedB.map((record, idx) => (
                    <label key={idx} className="flex items-start p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedB.includes(idx)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedB(prev => [...prev, idx]);
                          else setSelectedB(prev => prev.filter(i => i !== idx));
                        }}
                        className="mt-1 mr-3 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-slate-800 font-medium mb-1">
                          {getDynamicLabel(record, results.mappingsB)}
                        </div>
                        <div className="text-xs text-slate-500 font-mono break-all">
                          {JSON.stringify(record)}
                        </div>
                      </div>
                    </label>
                  ))}
                  {results.unmatchedB.length === 0 && (
                    <div className="p-4 text-center text-slate-500 text-sm">No unmatched records.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden PDF Template */}
      <div className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none">
        <PdfExportTemplate 
          ref={pdfRef} 
          results={results} 
          reportId={reportId} 
          username="Admin User" 
        />
      </div>
    </div>
  );
}
