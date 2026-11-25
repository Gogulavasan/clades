/**
 * SYNTHETIC demo companies. None of this is a real company or real data. Each profile is generated as a
 * Screener-style sheet from a fixed seed and then pushed through the real ingest and engine, so the demo
 * scores are genuine engine output on invented inputs.
 */
import { buildCaseFile, DEFAULT_OPTIONS, type CaseFile } from '../casefile/build';
import { parseGrid, type Grid } from '../ingest/grid';
import type { Company } from '../standardise/schema';
import { autoMap, defaultMeta, standardise } from '../standardise/standardise';

const SEED = 20261125;
const FIRST_FY = 2020;
const DAYS = 365;
const TAX_RATE = 0.25;

/** Deterministic PRNG (mulberry32) so the sample set is identical on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-year values: a single number is constant, [from, to] ramps linearly across the years. */
type Path = number | readonly [number, number];
const at = (p: Path, i: number, n: number): number => (typeof p === 'number' ? p : p[0] + ((p[1] - p[0]) * i) / Math.max(1, n - 1));

interface Profile {
  name: string;
  sector: string;
  years: number;
  revenue0: number;
  growth: Path;
  cogsPct: Path;
  employeePct: number;
  sgaPct: number;
  otherExpPct: number;
  otherIncomePct: Path;
  depRate: Path;
  dso: Path;
  inventoryDays: Path;
  payablesPct: number;
  ppePct0: number;
  capexPct: Path;
  cwipAddPct: Path;
  investAddPct: number;
  cashPct: Path;
  debtPct0: number;
  interestRate: number;
  payout: number;
  /** Size of random year-to-year wobble applied to the cost ratio. */
  noise: number;
}

const BASE: Omit<Profile, 'name' | 'sector'> = {
  years: 6, revenue0: 1000, growth: 0.09, cogsPct: 0.55, employeePct: 0.1, sgaPct: 0.08, otherExpPct: 0.07, otherIncomePct: 0.01, depRate: 0.1, dso: 40,
  inventoryDays: 60, payablesPct: 0.12, ppePct0: 0.4, capexPct: 0.06, cwipAddPct: 0, investAddPct: 0.01, cashPct: 0.08, debtPct0: 0.1, interestRate: 0.09, payout: 0.3, noise: 0.012,
};

export const SAMPLE_PROFILES: readonly Profile[] = [
  { ...BASE, name: 'SAMPLE ALPHA FOODS', sector: 'FMCG' },
  { ...BASE, name: 'SAMPLE BETA SOFTWARE', sector: 'IT services', growth: 0.12, cogsPct: 0.2, employeePct: 0.5, inventoryDays: 0, dso: 62, ppePct0: 0.15, capexPct: 0.03, debtPct0: 0, cashPct: 0.2, otherIncomePct: 0.015, payout: 0.5 },
  { ...BASE, name: 'SAMPLE GAMMA TEXTILES', sector: 'Textiles', growth: 0.11, cogsPct: [0.6, 0.63], dso: [55, 92], inventoryDays: [80, 100], debtPct0: 0.3, cashPct: 0.04 },
  { ...BASE, name: 'SAMPLE DELTA INFRA', sector: 'Construction & infrastructure', growth: [0.2, 0.42], cogsPct: [0.6, 0.55], dso: [70, 175], depRate: [0.1, 0.055], cwipAddPct: [0.04, 0.16], capexPct: 0.08, debtPct0: 0.35, cashPct: 0.05, payout: 0.15 },
  { ...BASE, name: 'SAMPLE EPSILON EXPORTS', sector: 'Chemicals', growth: 0.16, dso: [60, 110], cashPct: [0.15, 0.45], otherIncomePct: 0.002, debtPct0: 0.25, payout: 0.4 },
  { ...BASE, name: 'SAMPLE ZETA STEEL', sector: 'Metals & mining', growth: [0.08, -0.04], cogsPct: [0.62, 0.71], debtPct0: 0.7, ppePct0: 0.9, capexPct: 0.1, cashPct: 0.03, payout: 0.1, interestRate: 0.11 },
  { ...BASE, name: 'SAMPLE ETA FINANCE', sector: 'Financial (bank / NBFC / insurer)' },
  { ...BASE, name: 'SAMPLE THETA RETAIL', sector: 'Retail', years: 1 },
];

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Builds a Screener-style "Data Sheet" grid for one synthetic profile. Statements reconcile by construction. */
export function sampleGrid(p: Profile, rand: () => number = prng(SEED)): Grid {
  const n = p.years;
  const rows = new Map<string, number[]>();
  const put = (label: string, v: number): void => {
    rows.set(label, [...(rows.get(label) ?? []), r2(v)]);
  };
  let revenue = p.revenue0;
  let ppe = p.ppePct0 * revenue;
  let cwip = 0;
  let invest = 0.05 * revenue;
  let borrowings = p.debtPct0 * revenue;
  let cash = at(p.cashPct, 0, n) * revenue;
  let receivables = 0;
  let inventory = 0;
  let payables = 0;
  let reserves = 0;
  let shareCapital = 0;

  for (let i = 0; i < n; i++) {
    if (i > 0) revenue *= 1 + at(p.growth, i, n);
    const cogs = (at(p.cogsPct, i, n) + (rand() - 0.5) * 2 * p.noise) * revenue;
    const employee = p.employeePct * revenue;
    const sga = p.sgaPct * revenue;
    const otherExp = p.otherExpPct * revenue;
    const otherIncome = at(p.otherIncomePct, i, n) * revenue;
    const dep = at(p.depRate, i, n) * ppe;
    const interest = p.interestRate * borrowings;
    const pbt = revenue - cogs - employee - sga - otherExp + otherIncome - dep - interest;
    const tax = Math.max(0, TAX_RATE * pbt);
    const ni = pbt - tax;
    const dividends = p.payout * Math.max(0, ni);

    const rec1 = (at(p.dso, i, n) / DAYS) * revenue;
    const inv1 = (at(p.inventoryDays, i, n) / DAYS) * cogs;
    const pay1 = p.payablesPct * revenue;
    const capex = at(p.capexPct, i, n) * revenue;
    const cwipAdd = at(p.cwipAddPct, i, n) * revenue;
    const investAdd = p.investAddPct * revenue;
    let cfo: number, cfi: number, cff: number;
    if (i === 0) {
      // Opening year: no prior balance sheet. Equity is the balancing figure, set once.
      [receivables, inventory, payables] = [rec1, inv1, pay1];
      cfo = ni + dep;
      cfi = -(capex + investAdd);
      cff = -dividends;
      ppe += capex - dep;
      invest += investAdd;
      const equity = ppe + cwip + invest + receivables + inventory + cash - borrowings - payables;
      shareCapital = r2(0.1 * equity);
      reserves = equity - shareCapital;
    } else {
      cfo = ni + dep - (rec1 - receivables) - (inv1 - inventory) + (pay1 - payables);
      cfi = -(capex + cwipAdd + investAdd);
      // Borrow (or repay) whatever is needed to end the year at the target cash balance.
      const before = cash + cfo + cfi - dividends;
      const borrow = Math.max(at(p.cashPct, i, n) * revenue - before, -borrowings);
      cff = borrow - dividends;
      borrowings += borrow;
      cash += cfo + cfi + cff;
      ppe += capex - dep;
      cwip += cwipAdd;
      invest += investAdd;
      reserves += ni - dividends;
      [receivables, inventory, payables] = [rec1, inv1, pay1];
    }

    put('Sales', revenue); put('Raw Material Cost', cogs); put('Change in Inventory', 0); put('Power and Fuel', 0); put('Other Mfr. Exp', 0);
    put('Employee Cost', employee); put('Selling and admin', sga); put('Other Expenses', otherExp); put('Other Income', otherIncome);
    put('Depreciation', dep); put('Interest', interest); put('Profit before tax', pbt); put('Tax', tax); put('Net profit', ni); put('Dividend Amount', dividends);
    put('Equity Share Capital', shareCapital); put('Reserves', reserves); put('Borrowings', borrowings); put('Other Liabilities', payables);
    put('Total L', r2(shareCapital) + r2(reserves) + r2(borrowings) + r2(payables));
    put('Net Block', ppe); put('Capital Work in Progress', cwip); put('Investments', invest); put('Other Assets', r2(receivables) + r2(inventory) + r2(cash));
    put('Total A', r2(ppe) + r2(cwip) + r2(invest) + r2(receivables) + r2(inventory) + r2(cash));
    put('Receivables', receivables); put('Inventory', inventory); put('Cash & Bank', cash);
    put('Cash from Operating Activity', cfo); put('Cash from Investing Activity', cfi); put('Cash from Financing Activity', cff);
    put('Net Cash Flow', r2(cfo) + r2(cfi) + r2(cff));
  }

  const dates = Array.from({ length: n }, (_, i) => `Mar-${FIRST_FY + 6 - n + i}`);
  const row = (label: string, as = label): (string | number)[] => [as, ...(rows.get(label) ?? [])];
  const block = (labels: string[]): (string | number)[][] => labels.map((l) => row(l));
  return [
    ['COMPANY NAME', p.name],
    ['NOTE', 'SYNTHETIC SAMPLE DATA - NOT A REAL COMPANY'],
    [],
    ['PROFIT & LOSS'],
    ['Report Date', ...dates],
    ...block(['Sales', 'Raw Material Cost', 'Change in Inventory', 'Power and Fuel', 'Other Mfr. Exp', 'Employee Cost', 'Selling and admin', 'Other Expenses', 'Other Income', 'Depreciation', 'Interest', 'Profit before tax', 'Tax', 'Net profit', 'Dividend Amount']),
    [],
    ['BALANCE SHEET'],
    ['Report Date', ...dates],
    ...block(['Equity Share Capital', 'Reserves', 'Borrowings', 'Other Liabilities']),
    row('Total L', 'Total'),
    ...block(['Net Block', 'Capital Work in Progress', 'Investments', 'Other Assets']),
    row('Total A', 'Total'),
    ...block(['Receivables', 'Inventory', 'Cash & Bank']),
    [],
    ['CASH FLOW:'],
    ['Report Date', ...dates],
    ...block(['Cash from Operating Activity', 'Cash from Investing Activity', 'Cash from Financing Activity', 'Net Cash Flow']),
  ];
}

export const gridToCsv = (grid: Grid): string => grid.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c ?? ''))).join(',')).join('\n');

/** Runs every synthetic profile through ingest -> standardise -> engine. */
export function buildSamples(now: string): { caseFile: CaseFile; company: Company }[] {
  const rand = prng(SEED);
  return SAMPLE_PROFILES.map((p, i) => {
    const table = parseGrid(sampleGrid(p, rand), 'SYNTHETIC SAMPLE (generated in browser)', 'Data Sheet');
    const meta = { ...defaultMeta(table), sector: p.sector, ticker: `SMPL${i + 1}`, basis: 'consolidated' as const };
    const company: Company = { ...standardise(table, autoMap(table), meta), sample: true };
    return { caseFile: buildCaseFile(company, DEFAULT_OPTIONS, now), company };
  });
}
