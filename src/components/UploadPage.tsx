import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X, ArrowRight } from 'lucide-react';
import * as xlsx from 'xlsx';
import { Dataset } from '../types';

interface UploadPageProps {
  onNext: (datasets: Dataset[]) => void;
}

export function UploadPage({ onNext }: UploadPageProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f: File) => f.name.endsWith('.xlsx') || f.name.endsWith('.csv') || f.name.endsWith('.xls')
    ) as File[];
    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const processFile = async (file: File): Promise<Dataset> => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = xlsx.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    const headers = data.length > 0 ? Object.keys(data[0] as object) : [];
    
    return {
      id: Math.random().toString(36).substring(7),
      name: file.name,
      headers,
      data,
    };
  };

  const handleUpload = async () => {
    if (files.length < 2) {
      alert('Please upload at least 2 files to reconcile.');
      return;
    }

    setIsUploading(true);

    try {
      const parsedFiles = await Promise.all(files.map(processFile));
      onNext(parsedFiles);
    } catch (error) {
      console.error(error);
      alert('Failed to process files.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Financial Reconciliation</h1>
        <p className="text-lg text-slate-600">Upload your Excel or CSV files to start matching transactions.</p>
      </div>

      <div 
        className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          multiple 
          accept=".xlsx,.xls,.csv" 
          className="hidden" 
          ref={fileInputRef}
          onChange={handleFileSelect}
        />
        <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <Upload className="w-8 h-8 text-indigo-600" />
        </div>
        <h3 className="text-xl font-semibold text-slate-800 mb-2">Drag & Drop files here</h3>
        <p className="text-slate-500">or click to browse your computer</p>
        <p className="text-sm text-slate-400 mt-2">Supports .xlsx, .xls, .csv</p>
      </div>

      {files.length > 0 && (
        <div className="mt-8">
          <h4 className="text-lg font-semibold text-slate-800 mb-4">Selected Files ({files.length})</h4>
          <div className="space-y-3">
            {files.map((file, index) => (
              <div key={index} className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center space-x-3">
                  <FileSpreadsheet className="w-6 h-6 text-emerald-500" />
                  <div>
                    <p className="font-medium text-slate-800">{file.name}</p>
                    <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={isUploading || files.length < 2}
              className="flex items-center space-x-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isUploading ? 'Processing...' : 'Continue to Mapping'}</span>
              {!isUploading && <ArrowRight className="w-5 h-5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
