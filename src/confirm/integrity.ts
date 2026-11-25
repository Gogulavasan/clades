/** Integrity gate: do the statements add up? A blocking failure stops scoring until the user fixes the figures. */
import mappingConfig from '../../config/mapping.json';
import type { Company, FieldId, YearData } from '../standardise/schema';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'not_run';
export interface IntegrityCheck {
  id: string;
  label: string;
  year: string;
  status: CheckStatus;
  blocking: boolean;
  detail: string;
}
export interface IntegrityReport {
  checks: IntegrityCheck[];
  blocked: boolean;
  warnings: number;
}

type Term = readonly [FieldId, 1 | -1];
interface Spec {
  id: string;
  label: string;
  blocking: boolean;
  /** Sum of left terms should equal sum of right terms. */
  left: readonly Term[];
  /** Added to the left side when reported; ignored when absent. */
  optional?: readonly Term[];
  right: readonly Term[];
}

const SPECS: readonly Spec[] = [
  { id: 'BS_BALANCES', label: 'Balance sheet balances (assets = liabilities + equity)', blocking: true, left: [['totalAssets', 1]], right: [['totalLiabilitiesEquity', 1]] },
  {
    id: 'BS_LIAB_SUM', label: 'Liabilities side adds up', blocking: true,
    left: [['shareCapital', 1], ['reserves', 1], ['borrowings', 1], ['otherLiabilities', 1]], right: [['totalLiabilitiesEquity', 1]],
  },
  { id: 'BS_SPLIT_ASSETS', label: 'Non-current + current assets = total assets', blocking: true, left: [['nonCurrentAssets', 1], ['currentAssets', 1]], optional: [['assetsHeldForSale', 1]], right: [['totalAssets', 1]] },
  {
    id: 'BS_SPLIT_LIAB', label: 'Equity + non-current + current liabilities = total', blocking: true,
    left: [['equity', 1], ['nonCurrentLiabilities', 1], ['currentLiabilities', 1]], optional: [['liabilitiesHeldForSale', 1]], right: [['totalLiabilitiesEquity', 1]],
  },
  { id: 'BS_ASSET_SUM', label: 'Assets side adds up', blocking: true, left: [['ppe', 1], ['cwip', 1], ['investments', 1], ['otherAssets', 1]], right: [['totalAssets', 1]] },
  {
    id: 'PL_SUM', label: 'P&L adds up to profit before tax', blocking: true,
    left: [['revenue', 1], ['cogs', -1], ['employeeCost', -1], ['sga', -1], ['otherExpenses', -1], ['otherIncome', 1], ['depreciation', -1], ['interest', -1]],
    right: [['pbt', 1]],
  },
  { id: 'PL_TAX', label: 'Profit before tax less tax = net profit', blocking: false, left: [['pbt', 1], ['tax', -1]], right: [['netIncome', 1]] },
  { id: 'CF_SUM', label: 'Cash flow adds up (CFO + CFI + CFF = net cash flow)', blocking: true, left: [['cfo', 1], ['cfi', 1], ['cff', 1]], right: [['netCashFlow', 1]] },
];

const sum = (y: YearData, terms: readonly Term[]): number | null => {
  let total = 0;
  for (const [f, sign] of terms) {
    const fig = y[f];
    // A PROXY figure is a stand-in, so a check that needs it is not run rather than passed or failed on an estimate.
    if (!fig || fig.proxy) return null;
    total += sign * fig.value;
  }
  return total;
};

const r2 = (n: number): string => n.toFixed(2);

export function checkIntegrity(company: Company): IntegrityReport {
  const cfg = mappingConfig.integrity;
  const checks: IntegrityCheck[] = [];
  company.years.forEach((y, i) => {
    const assets = y.figures.totalAssets?.value;
    const tol = Math.max(cfg.toleranceAbs, cfg.tolerancePctOfAssets * Math.abs(assets ?? 0));
    for (const s of SPECS) {
      const base = sum(y.figures, s.left);
      const extra = (s.optional ?? []).reduce((a, [f, sign]) => a + sign * (y.figures[f]?.value ?? 0), 0);
      const l = base === null ? null : base + extra;
      const r = sum(y.figures, s.right);
      if (l === null || r === null) {
        checks.push({ id: s.id, label: s.label, year: y.label, status: 'not_run', blocking: s.blocking, detail: 'Not run: one or more lines are missing.' });
        continue;
      }
      const diff = l - r;
      const ok = Math.abs(diff) <= tol;
      checks.push({
        id: s.id, label: s.label, year: y.label, blocking: s.blocking,
        status: ok ? 'pass' : s.blocking ? 'fail' : 'warn',
        detail: ok ? `Difference ${r2(diff)} (tolerance ${r2(tol)})` : `Off by ${r2(diff)}: ${r2(l)} vs ${r2(r)} (tolerance ${r2(tol)})`,
      });
    }
    // Cash flow vs balance sheet: a warning only, because "cash & bank" often includes deposits the cash flow excludes.
    const prev = company.years[i - 1]?.figures;
    const ncf = y.figures.netCashFlow?.value;
    const c1 = y.figures.cash?.value;
    const c0 = prev?.cash?.value;
    const base = { id: 'CF_RECON', label: 'Net cash flow matches change in balance-sheet cash', year: y.label, blocking: false };
    if (ncf === undefined || c1 === undefined || c0 === undefined) checks.push({ ...base, status: 'not_run', detail: 'Not run: needs net cash flow and cash for this and the prior year.' });
    else {
      const diff = ncf - (c1 - c0);
      const ok = Math.abs(diff) <= tol;
      checks.push({ ...base, status: ok ? 'pass' : 'warn', detail: ok ? `Difference ${r2(diff)}` : `Off by ${r2(diff)}: net cash flow ${r2(ncf)} vs change in cash ${r2(c1 - c0)}` });
    }
  });
  return { checks, blocked: checks.some((c) => c.status === 'fail'), warnings: checks.filter((c) => c.status === 'warn').length };
}
