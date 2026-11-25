/** Sloan accruals, Altman Z'' (emerging markets), Piotroski F and a Benford first-digit test. */
import { div, type N } from './beneish';

/** Reads a schema field `lag` years before the year being assessed; null when missing. */
export type Get = (field: string, lag?: number) => N;

const sub = (a: N, b: N): N => (a === null || b === null ? null : a - b);
const add = (a: N, b: N): N => (a === null || b === null ? null : a + b);
const avg = (a: N, b: N): N => (a === null || b === null ? null : (a + b) / 2);

/** Sloan (1996) style accruals ratio: (net income - CFO) / average total assets. */
export const sloan = (g: Get): N => div(sub(g('netIncome'), g('cfo')), avg(g('totalAssets'), g('totalAssets', 1)));

export interface AltmanConfig {
  intercept: number;
  x1: number;
  x2: number;
  x3: number;
  x4: number;
}

/**
 * Altman Z'' for emerging markets: 3.25 + 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
 * X1 working capital / total assets, X2 retained earnings (reserves) / total assets,
 * X3 EBIT / total assets, X4 book equity / total liabilities.
 */
export function altmanZ(g: Get, c: AltmanConfig): { z: N; x: [N, N, N, N] } {
  const ta = g('totalAssets');
  const x1 = div(sub(g('currentAssets'), g('currentLiabilities')), ta);
  const x2 = div(g('reserves'), ta);
  const x3 = div(add(g('pbt'), g('interest')), ta);
  const liabilities = sub(ta, g('equity'));
  const x4 = div(g('equity'), liabilities !== null && liabilities > 0 ? liabilities : null);
  const z = x1 === null || x2 === null || x3 === null || x4 === null ? null : c.intercept + c.x1 * x1 + c.x2 * x2 + c.x3 * x3 + c.x4 * x4;
  return { z, x: [x1, x2, x3, x4] };
}

export interface PiotroskiResult {
  /** null unless all nine tests could be run. */
  f: N;
  passed: number;
  available: number;
  tests: { name: string; pass: boolean | null }[];
}

const gt = (a: N, b: N): boolean | null => (a === null || b === null ? null : a > b);

/** Piotroski (2000) nine binary tests. ROA and turnover use opening total assets. */
export function piotroski(g: Get): PiotroskiResult {
  const roa = (l: number): N => div(g('netIncome', l), g('totalAssets', l + 1));
  const lev = (l: number): N => div(g('longTermDebt', l), g('totalAssets', l));
  const cr = (l: number): N => div(g('currentAssets', l), g('currentLiabilities', l));
  const gm = (l: number): N => div(sub(g('revenue', l), g('cogs', l)), g('revenue', l));
  const turn = (l: number): N => div(g('revenue', l), g('totalAssets', l + 1));
  const l0 = lev(0);
  const l1 = lev(1);
  const sc0 = g('shareCapital');
  const sc1 = g('shareCapital', 1);
  const tests: PiotroskiResult['tests'] = [
    { name: 'Return on assets positive', pass: gt(roa(0), 0) },
    { name: 'Operating cash flow positive', pass: gt(g('cfo'), 0) },
    { name: 'Return on assets improved', pass: gt(roa(0), roa(1)) },
    { name: 'Cash flow exceeds net profit', pass: gt(g('cfo'), g('netIncome')) },
    { name: 'Leverage fell (or no debt)', pass: l0 === null || l1 === null ? null : l0 < l1 || (l0 === 0 && l1 === 0) },
    { name: 'Current ratio improved', pass: gt(cr(0), cr(1)) },
    { name: 'No increase in share capital', pass: sc0 === null || sc1 === null ? null : sc0 <= sc1 },
    { name: 'Gross margin improved', pass: gt(gm(0), gm(1)) },
    { name: 'Asset turnover improved', pass: gt(turn(0), turn(1)) },
  ];
  const available = tests.filter((t) => t.pass !== null).length;
  const passed = tests.filter((t) => t.pass === true).length;
  return { f: available === tests.length ? passed : null, passed, available, tests };
}

const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));

/** Chi-square of first significant digits against Benford's law (8 degrees of freedom). */
export function benford(values: readonly number[], minCount: number): { chi2: N; n: number; observed: number[] } {
  const observed = new Array<number>(BENFORD.length).fill(0);
  let n = 0;
  for (const v of values) {
    const a = Math.abs(v);
    if (!Number.isFinite(a) || a === 0) continue;
    const d = Number(a.toExponential(6)[0]);
    const slot = observed[d - 1];
    if (slot === undefined) continue;
    observed[d - 1] = slot + 1;
    n++;
  }
  if (n < minCount) return { chi2: null, n, observed };
  const chi2 = BENFORD.reduce((acc, p, i) => acc + ((observed[i] ?? 0) - n * p) ** 2 / (n * p), 0);
  return { chi2, n, observed };
}
