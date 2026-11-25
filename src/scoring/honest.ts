/**
 * Honest-profit estimator: reported profit vs a stress-tested profit under transparent, adjustable assumptions.
 * This is a "what if the soft parts were wrong" exercise, not an estimate of true profit.
 */
import { div, type N } from '../models/beneish';
import type { Get } from '../models/others';

export interface HonestParams {
  /** Share of the receivables build-up (above last year's days-sales level) written off. */
  receivablesProvisionPct: number;
  /** Share of the growth in "soft" assets (neither current nor PP&E; the AQI numerator) treated as expense. */
  capitalisedReversalPct: number;
  /** 1 = charge depreciation at last year's rate (DEPI back to 1.0); 0 = leave as reported. */
  depreciationNormalisationPct: number;
  /** Share of other income removed. */
  otherIncomeHaircutPct: number;
  /** Tax shield applied to every adjustment. */
  taxRate: number;
}

export interface HonestItem {
  id: keyof Omit<HonestParams, 'taxRate'>;
  short: string;
  label: string;
  /** Pre-tax amount the assumption applies to; null when it cannot be computed. */
  base: N;
  pct: number;
  afterTax: number;
  explain: string;
}

export interface HonestResult {
  reported: N;
  stressed: N;
  items: HonestItem[];
  params: HonestParams;
}

const sub = (a: N, b: N): N => (a === null || b === null ? null : a - b);
const add = (a: N, b: N): N => (a === null || b === null ? null : a + b);
const mul = (a: N, b: N): N => (a === null || b === null ? null : a * b);
const floor0 = (a: N): N => (a === null ? null : Math.max(0, a));

export function honestProfit(g: Get, params: HonestParams): HonestResult {
  // 1. Receivables above what last year's receivables-to-sales level would imply.
  const recvBase = floor0(sub(g('receivables'), mul(div(g('receivables', 1), g('revenue', 1)), g('revenue'))));
  // 2. Soft assets above last year's share of total assets (what pushes AQI above 1.0).
  const soft = (lag: number): N => sub(sub(g('totalAssets', lag), g('currentAssets', lag)), g('ppe', lag));
  const softBase = floor0(sub(soft(0), mul(div(soft(1), g('totalAssets', 1)), g('totalAssets'))));
  // 3. Depreciation shortfall versus charging at last year's rate (what pushes DEPI above 1.0).
  const lastRate = div(g('depreciation', 1), add(g('depreciation', 1), g('ppe', 1)));
  const depBase = floor0(sub(mul(lastRate, add(g('depreciation'), g('ppe'))), g('depreciation')));
  // 4. Other income.
  const oiBase = floor0(g('otherIncome'));

  const item = (id: HonestItem['id'], short: string, label: string, base: N, explain: string): HonestItem => {
    const pct = params[id];
    return { id, short, label, base, pct, afterTax: base === null ? 0 : base * pct * (1 - params.taxRate), explain };
  };
  const items = [
    item('receivablesProvisionPct', 'RECV', 'Receivables provision', recvBase, 'Receivables above the level implied by last year\'s receivables-to-sales ratio, partly written off in case they are never collected.'),
    item('capitalisedReversalPct', 'CAPEX', 'Excess capitalised costs', softBase, 'Growth in assets that are neither current nor plant (the part that pushes AQI above 1.0), partly treated as costs that should have been expensed. This bucket also holds genuine investments and goodwill.'),
    item('depreciationNormalisationPct', 'DEPN', 'Depreciation normalisation', depBase, 'Extra depreciation if assets were written down at last year\'s rate (brings DEPI back to 1.0).'),
    item('otherIncomeHaircutPct', 'OTHER', 'Other income haircut', oiBase, 'Part of other income removed, because it does not come from the core business and may not recur.'),
  ];
  const reported = g('netIncome');
  return { reported, stressed: reported === null ? null : reported - items.reduce((a, i) => a + i.afterTax, 0), items, params };
}
