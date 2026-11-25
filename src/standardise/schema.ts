/** The fixed schema every input route is standardised into. All money values are INR crore. */

export type Statement = 'pl' | 'bs' | 'cf' | 'notes';
export const STATEMENT_NAMES: Record<Statement, string> = {
  pl: 'Profit & loss',
  bs: 'Balance sheet',
  cf: 'Cash flow',
  notes: 'Notes & disclosures',
};

/** [statement, label, kind]. kind 'pct' is a percentage and is never unit-scaled. */
export const FIELD_DEFS = {
  revenue: ['pl', 'Revenue from operations'],
  cogs: ['pl', 'Cost of goods sold'],
  employeeCost: ['pl', 'Employee cost'],
  sga: ['pl', 'Selling, general & admin'],
  otherExpenses: ['pl', 'Other expenses'],
  otherIncome: ['pl', 'Other income'],
  depreciation: ['pl', 'Depreciation & amortisation'],
  interest: ['pl', 'Interest expense'],
  pbt: ['pl', 'Profit before tax'],
  tax: ['pl', 'Tax expense'],
  netIncome: ['pl', 'Net profit (PAT)'],
  dividends: ['pl', 'Dividends'],
  shareCapital: ['bs', 'Share capital'],
  reserves: ['bs', 'Reserves'],
  equity: ['bs', 'Total equity (net worth)'],
  borrowings: ['bs', 'Total borrowings'],
  longTermDebt: ['bs', 'Long-term debt'],
  otherLiabilities: ['bs', 'Other liabilities'],
  currentLiabilities: ['bs', 'Current liabilities'],
  totalLiabilitiesEquity: ['bs', 'Total liabilities & equity'],
  ppe: ['bs', 'Property, plant & equipment (net)'],
  cwip: ['bs', 'Capital work-in-progress'],
  intangibles: ['bs', 'Intangible assets'],
  investments: ['bs', 'Investments'],
  otherAssets: ['bs', 'Other assets'],
  currentAssets: ['bs', 'Current assets'],
  receivables: ['bs', 'Trade receivables'],
  inventory: ['bs', 'Inventory'],
  cash: ['bs', 'Cash & bank'],
  totalAssets: ['bs', 'Total assets'],
  cfo: ['cf', 'Cash from operations (CFO)'],
  cfi: ['cf', 'Cash from investing'],
  cff: ['cf', 'Cash from financing'],
  netCashFlow: ['cf', 'Net cash flow'],
  capex: ['cf', 'Capital expenditure'],
  taxPaid: ['cf', 'Tax paid'],
  interestPaid: ['cf', 'Interest paid'],
  promoterPledgePct: ['notes', 'Promoter shares pledged (%)', 'pct'],
  relatedPartyLoans: ['notes', 'Loans & advances to related parties'],
  contingentLiabilities: ['notes', 'Contingent liabilities'],
} as const satisfies Record<string, readonly [Statement, string, 'pct'?]>;

export type FieldId = keyof typeof FIELD_DEFS;
export const FIELD_IDS = Object.keys(FIELD_DEFS) as FieldId[];
export const isFieldId = (s: string): s is FieldId => Object.hasOwn(FIELD_DEFS, s);
export const fieldLabel = (f: FieldId): string => FIELD_DEFS[f][1];
export const fieldStatement = (f: FieldId): Statement => FIELD_DEFS[f][0];
export const isPctField = (f: FieldId): boolean => (FIELD_DEFS[f] as readonly unknown[])[2] === 'pct';

export type Confidence = 'high' | 'medium' | 'low';

/** One extracted number. A missing figure is simply absent: nothing is ever filled in by guesswork. */
export interface Figure {
  value: number;
  confidence: Confidence;
  /** Where it came from: file, sheet or page, row. */
  source: string;
  /** Set when this figure stands in for a line the source does not report. */
  proxy?: string;
  /** Set when computed by plain arithmetic from other reported figures. */
  derived?: string;
  edited?: boolean;
}

export type YearData = Partial<Record<FieldId, Figure>>;
export type Basis = 'consolidated' | 'standalone' | 'unknown';

export interface Company {
  name: string;
  ticker: string;
  sector: string;
  basis: Basis;
  sourceFile: string;
  /** Oldest first. */
  years: { label: string; figures: YearData }[];
  sample?: boolean;
}
