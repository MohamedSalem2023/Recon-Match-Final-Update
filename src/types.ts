export interface Dataset {
  id: string;
  name: string;
  headers: string[];
  data: any[];
}

export interface FieldMapping {
  date?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
  description?: string;
  residencyId?: string;
  patientFileNumber?: string;
}

export interface ReconcileSettings {
  dateToleranceDays: number;
  fuzzyThreshold: number;
  matchOneToMany: boolean;
  // Daily aggregation: one side records POS/commission entries as a single
  // daily total while the other side lists them individually.
  enableDailyAggregation: boolean;
  aggregationKeywords: string; // comma-separated, e.g. "POS, نقاط بيع, عمولة"
  aggregationSide: 'A' | 'B'; // which dataset contains the aggregated (single) entries
}

export interface MatchResult {
  id: string;
  type: 'exact' | 'combined' | 'fuzzy' | 'manual' | 'daily-aggregate';
  recordsA: any[];
  recordsB: any[];
  debitMatchA: number;
  creditMatchA: number;
  totalAmountA: number;
  debitMatchB: number;
  creditMatchB: number;
  totalAmountB: number;
  difference: number;
}

export interface Adjustment {
  id: string;
  identifier: string;
  recordA: any;
  recordB: any;
  debitA: number;
  creditA: number;
  amountA: number;
  debitB: number;
  creditB: number;
  amountB: number;
  difference: number;
  approved: boolean;
  manualDifference?: number;
}

export interface ReconciliationSummary {
  totalA: number;
  totalB: number;
  matchedA: number;
  matchedB: number;
  matchPercentageA: number;
  matchPercentageB: number;
}

export interface BankReconciliation {
  openingBalance: number;
  totalAdditions: number;
  totalDeductions: number;
  netAdjustments: number;
  adjustedBalance: number;
  targetBalance: number;
  difference: number;
  isBalanced: boolean;
}

export interface ReconciliationResponse {
  matches: MatchResult[];
  adjustments: Adjustment[];
  unmatchedA: any[];
  unmatchedB: any[];
  summary: ReconciliationSummary;
  bankReconciliation: BankReconciliation;
  mappingsA: FieldMapping;
  mappingsB: FieldMapping;
}
