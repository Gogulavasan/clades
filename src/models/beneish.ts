/**
 * Beneish M-score. Beneish, M. D. (1999), "The Detection of Earnings Manipulation",
 * Financial Analysts Journal 55(5). Pure functions over plain numbers so each ratio is unit-testable by hand.
 */

export const BENEISH_RATIOS = ['DSRI', 'GMI', 'AQI', 'SGI', 'DEPI', 'SGAI', 'TATA', 'LVGI'] as const;
export type BeneishRatio = (typeof BENEISH_RATIOS)[number];
export type N = number | null;

export interface BeneishYear {
  sales: N;
  cogs: N;
  receivables: N;
  currentAssets: N;
  ppe: N;
  totalAssets: N;
  depreciation: N;
  sga: N;
  currentLiabilities: N;
  longTermDebt: N;
  netIncome: N;
  cfo: N;
  cash: N;
}

export type TataMethod = 'cashflow' | 'balancesheet';
export type Light = 'green' | 'amber' | 'red' | 'info' | 'missing';

export interface BeneishConfig {
  intercept: number;
  coefficients: Record<BeneishRatio, number>;
  thresholds: { flag: number; conservative: number };
  maxRedForClean: number;
  ratios: Record<BeneishRatio, { nonManipulator: number; manipulator: number; direction: string }>;
}

/** Division that refuses to invent a number: null in, zero denominator or non-finite result -> null. */
export const div = (a: N, b: N): N => {
  if (a === null || b === null || b === 0) return null;
  const q = a / b;
  return Number.isFinite(q) ? q : null;
};
const sub = (a: N, b: N): N => (a === null || b === null ? null : a - b);
const add = (a: N, b: N): N => (a === null || b === null ? null : a + b);

const grossMargin = (y: BeneishYear): N => div(sub(y.sales, y.cogs), y.sales);
const positive = (v: N): N => (v !== null && v > 0 ? v : null);
const softAssetShare = (y: BeneishYear): N => sub(1, div(add(y.currentAssets, y.ppe), y.totalAssets));
const depRate = (y: BeneishYear): N => div(y.depreciation, add(y.depreciation, y.ppe));
const leverage = (y: BeneishYear): N => div(add(y.currentLiabilities, y.longTermDebt), y.totalAssets);

export function beneishRatios(t: BeneishYear, p: BeneishYear, tata: TataMethod = 'cashflow'): Record<BeneishRatio, N> {
  const accruals =
    tata === 'cashflow'
      ? sub(t.netIncome, t.cfo)
      : // Simplified balance-sheet version: omits current maturities of long-term debt and income tax payable.
        sub(sub(sub(sub(t.currentAssets, p.currentAssets), sub(t.cash, p.cash)), sub(t.currentLiabilities, p.currentLiabilities)), t.depreciation);
  return {
    DSRI: div(div(t.receivables, positive(t.sales)), div(p.receivables, positive(p.sales))),
    // A gross-margin index is only meaningful when both margins are positive.
    GMI: div(positive(grossMargin(p)), positive(grossMargin(t))),
    AQI: div(softAssetShare(t), softAssetShare(p)),
    SGI: div(t.sales, positive(p.sales)),
    DEPI: div(depRate(p), depRate(t)),
    SGAI: div(div(t.sga, positive(t.sales)), div(p.sga, positive(p.sales))),
    TATA: div(accruals, t.totalAssets),
    LVGI: div(leverage(t), leverage(p)),
  };
}

/** M-score; null unless all eight ratios exist (a missing ratio is never assumed to be 1). */
export function mScore(r: Record<BeneishRatio, N>, cfg: Pick<BeneishConfig, 'intercept' | 'coefficients'>): N {
  let m = cfg.intercept;
  for (const k of BENEISH_RATIOS) {
    const v = r[k];
    if (v === null) return null;
    m += cfg.coefficients[k] * v;
  }
  return m;
}

/** Green at or below the non-manipulator mean, red at or above the manipulator mean, amber between. */
export function ratioLight(k: BeneishRatio, v: N, cfg: Pick<BeneishConfig, 'ratios'>): Light {
  const ref = cfg.ratios[k];
  if (v === null) return 'missing';
  if (ref.direction !== 'higher') return 'info';
  return v >= ref.manipulator ? 'red' : v > ref.nonManipulator ? 'amber' : 'green';
}

export interface BeneishResult {
  ratios: Record<BeneishRatio, N>;
  lights: Record<BeneishRatio, Light>;
  m: N;
  red: number;
  amber: number;
  green: number;
  /** Two-key verdict. */
  verdict: 'CLEAN' | 'NOT CLEAN' | 'PARTIAL';
  reasons: string[];
  strict: boolean;
  tataMethod: TataMethod;
}

export function beneish(t: BeneishYear, p: BeneishYear, cfg: BeneishConfig, opts: { strict: boolean; tata: TataMethod }): BeneishResult {
  const ratios = beneishRatios(t, p, opts.tata);
  const lights = Object.fromEntries(BENEISH_RATIOS.map((k) => [k, ratioLight(k, ratios[k], cfg)])) as Record<BeneishRatio, Light>;
  const count = (l: Light): number => BENEISH_RATIOS.filter((k) => lights[k] === l).length;
  const m = mScore(ratios, cfg);
  const red = count('red');
  const reasons: string[] = [];
  let verdict: BeneishResult['verdict'];
  if (m === null) {
    verdict = 'PARTIAL';
    const gone = BENEISH_RATIOS.filter((k) => ratios[k] === null);
    reasons.push(`M-score not computed: ${gone.join(', ')} could not be calculated. A missing ratio is never assumed.`);
  } else {
    if (m >= cfg.thresholds.flag) reasons.push(`M-score ${m.toFixed(2)} is at or above the ${cfg.thresholds.flag} threshold.`);
    if (opts.strict) {
      const notGreen = BENEISH_RATIOS.filter((k) => lights[k] === 'red' || lights[k] === 'amber');
      if (notGreen.length) reasons.push(`Strict mode: ${notGreen.join(', ')} not green.`);
    } else if (red > cfg.maxRedForClean) reasons.push(`${red} ratios are red (more than the ${cfg.maxRedForClean} allowed).`);
    verdict = reasons.length ? 'NOT CLEAN' : 'CLEAN';
    if (verdict === 'CLEAN') reasons.push(`M-score ${m.toFixed(2)} is below ${cfg.thresholds.flag} and ${opts.strict ? 'every traffic-lighted ratio is green' : `no more than ${cfg.maxRedForClean} ratios are red`}.`);
  }
  return { ratios, lights, m, red, amber: count('amber'), green: count('green'), verdict, reasons, strict: opts.strict, tataMethod: opts.tata };
}
