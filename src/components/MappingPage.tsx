import React, { useState, useEffect } from 'react';
import { ArrowRight, ArrowLeft, Settings } from 'lucide-react';
import { Dataset, FieldMapping, ReconcileSettings } from '../types';

interface MappingPageProps {
  datasets: Dataset[];
  onBack: () => void;
  onNext: (
    datasetA: Dataset,
    datasetB: Dataset,
    mappingsA: FieldMapping,
    mappingsB: FieldMapping,
    settings: ReconcileSettings
  ) => void;
}

const REQUIRED_FIELDS = [
  { key: 'amount', label: 'Amount (Combined)', required: false },
  { key: 'debit', label: 'Debit Amount', required: false },
  { key: 'credit', label: 'Credit Amount', required: false },
  { key: 'date', label: 'Date', required: false },
  { key: 'reference', label: 'Reference Number', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'residencyId', label: 'Residency ID', required: false },
  { key: 'patientFileNumber', label: 'Patient File Number', required: false },
];

export function MappingPage({ datasets, onBack, onNext }: MappingPageProps) {
  const [selectedA, setSelectedA] = useState<string>(datasets[0]?.id || '');
  const [selectedB, setSelectedB] = useState<string>(datasets[1]?.id || '');

  const [mappingsA, setMappingsA] = useState<FieldMapping>({});
  const [mappingsB, setMappingsB] = useState<FieldMapping>({});

  const [settings, setSettings] = useState<ReconcileSettings>({
    dateToleranceDays: 0,
    fuzzyThreshold: 0.3,
    matchOneToMany: true,
  });

  // Auto-detect columns based on common names
  const autoDetect = (headers: string[]) => {
    const mapping: FieldMapping = {};
    headers.forEach(h => {
      const lower = h.toLowerCase();
      if (lower.includes('debit')) {
        if (!mapping.debit) mapping.debit = h;
      } else if (lower.includes('credit')) {
        if (!mapping.credit) mapping.credit = h;
      } else if (lower.includes('amount') || lower.includes('total') || lower.includes('value')) {
        if (!mapping.amount) mapping.amount = h;
      } else if (lower.includes('date') || lower.includes('time')) {
        if (!mapping.date) mapping.date = h;
      } else if (lower.includes('ref') || lower.includes('invoice') || lower.includes('receipt')) {
        if (!mapping.reference) mapping.reference = h;
      } else if (lower.includes('desc') || lower.includes('details') || lower.includes('particulars')) {
        if (!mapping.description) mapping.description = h;
      } else if (lower.includes('residency') || lower.includes('resident')) {
        if (!mapping.residencyId) mapping.residencyId = h;
      } else if (lower.includes('patient') || lower.includes('file')) {
        if (!mapping.patientFileNumber) mapping.patientFileNumber = h;
      }
    });
    return mapping;
  };

  useEffect(() => {
    const dsA = datasets.find(d => d.id === selectedA);
    if (dsA) setMappingsA(autoDetect(dsA.headers));
  }, [selectedA, datasets]);

  useEffect(() => {
    const dsB = datasets.find(d => d.id === selectedB);
    if (dsB) setMappingsB(autoDetect(dsB.headers));
  }, [selectedB, datasets]);

  const handleNext = () => {
    const dsA = datasets.find(d => d.id === selectedA);
    const dsB = datasets.find(d => d.id === selectedB);
    if (!dsA || !dsB) return;

    const isValidA = mappingsA.amount || (mappingsA.debit && mappingsA.credit);
    const isValidB = mappingsB.amount || (mappingsB.debit && mappingsB.credit);

    if (!isValidA || !isValidB) {
      alert('Please map either Amount (Combined) OR both Debit and Credit for both datasets.');
      return;
    }

    onNext(dsA, dsB, mappingsA, mappingsB, settings);
  };

  const renderMappingTable = (
    dataset: Dataset | undefined,
    mappings: FieldMapping,
    setMappings: React.Dispatch<React.SetStateAction<FieldMapping>>,
    title: string
  ) => {
    if (!dataset) return null;

    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="text-xl font-semibold text-slate-800 mb-4">{title}</h3>
        <p className="text-sm text-slate-500 mb-6">File: {dataset.name}</p>
        
        <div className="space-y-4">
          {REQUIRED_FIELDS.map(field => (
            <div key={field.key} className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 w-1/3">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              <select
                value={mappings[field.key as keyof FieldMapping] || ''}
                onChange={(e) => setMappings(prev => ({ ...prev, [field.key]: e.target.value }))}
                className="w-2/3 p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">-- Select Column --</option>
                {dataset.headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Map Columns</h1>
          <p className="text-slate-600 mt-2">Select which files to compare and map their columns.</p>
        </div>
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Upload</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Dataset A (e.g., Ledger)</label>
          <select
            value={selectedA}
            onChange={(e) => setSelectedA(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          >
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Dataset B (e.g., Bank Statement)</label>
          <select
            value={selectedB}
            onChange={(e) => setSelectedB(e.target.value)}
            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
          >
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {renderMappingTable(datasets.find(d => d.id === selectedA), mappingsA, setMappingsA, 'Dataset A Mapping')}
        {renderMappingTable(datasets.find(d => d.id === selectedB), mappingsB, setMappingsB, 'Dataset B Mapping')}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8">
        <div className="flex items-center space-x-2 mb-6">
          <Settings className="w-6 h-6 text-slate-700" />
          <h3 className="text-xl font-semibold text-slate-800">Matching Settings</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Date Tolerance (Days)</label>
            <input
              type="number"
              min="0"
              value={settings.dateToleranceDays}
              onChange={(e) => setSettings(prev => ({ ...prev, dateToleranceDays: parseInt(e.target.value) || 0 }))}
              className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Fuzzy Match Threshold (0-1)</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={settings.fuzzyThreshold}
              onChange={(e) => setSettings(prev => ({ ...prev, fuzzyThreshold: parseFloat(e.target.value) || 0 }))}
              className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-500 mt-1">Lower is stricter (0 = exact match)</p>
          </div>
          <div className="flex items-center h-full pt-6">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.matchOneToMany}
                onChange={(e) => setSettings(prev => ({ ...prev, matchOneToMany: e.target.checked }))}
                className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-slate-700">Enable One-to-Many Matching</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={
            !(mappingsA.amount || (mappingsA.debit && mappingsA.credit)) || 
            !(mappingsB.amount || (mappingsB.debit && mappingsB.credit)) || 
            selectedA === selectedB
          }
          className="flex items-center space-x-2 bg-indigo-600 text-white px-8 py-4 rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-md"
        >
          <span>Run Reconciliation</span>
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
