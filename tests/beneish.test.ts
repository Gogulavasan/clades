import { describe, expect, it } from 'vitest';
import { beneish, beneishRatios, mScore, ratioLight, type BeneishYear } from '../src/models/beneish';
import { altmanZ, benford, piotroski, sloan, type Get } from '../src/models/others';
import { RULES } from '../src/rules/config';

/**
 * Hand-calculated example (every expected value below was worked out on paper, not by the code).
 *                 prior    current
 * sales           1000     1300
 * COGS             600      806
 * receivables      100      182
 * current assets   400      520
 * PP&E             300      330
 * total assets    1000     1250
 * depreciation      30       30
 * SG&A             100      117
 * current liabs    200      250
 * long-term debt   200      300
 * net income        80      110
 * CFO               90       60
 * cash              50       70
 */
const P: BeneishYear = { sales: 1000, cogs: 600, receivables: 100, currentAssets: 400, ppe: 300, totalAssets: 1000, depreciation: 30, sga: 100, currentLiabilities: 200, longTermDebt: 200, netIncome: 80, cfo: 90, cash: 50 };
const T: BeneishYear = { sales: 1300, cogs: 806, receivables: 182, currentAssets: 520, ppe: 330, totalAssets: 1250, depreciation: 30, sga: 117, currentLiabilities: 250, longTermDebt: 300, netIncome: 110, cfo: 60, cash: 70 };
const DP = 6;

describe('Beneish ratios against a hand-calculated example', () => {
  const r = beneishRatios(T, P);
  it('DSRI = (182/1300) / (100/1000) = 0.14 / 0.10 = 1.4', () => expect(r.DSRI).toBeCloseTo(1.4, DP));
  it('GMI = 0.40 / (494/1300 = 0.38) = 1.052632', () => expect(r.GMI).toBeCloseTo(1.052632, DP));
  it('AQI = (1 - 850/1250 = 0.32) / (1 - 700/1000 = 0.30) = 1.066667', () => expect(r.AQI).toBeCloseTo(1.066667, DP));
  it('SGI = 1300 / 1000 = 1.3', () => expect(r.SGI).toBeCloseTo(1.3, DP));
  it('DEPI = (30/330 = 0.090909) / (30/360 = 0.083333) = 1.090909', () => expect(r.DEPI).toBeCloseTo(1.090909, DP));
  it('SGAI = (117/1300 = 0.09) / (100/1000 = 0.10) = 0.9', () => expect(r.SGAI).toBeCloseTo(0.9, DP));
  it('TATA = (110 - 60) / 1250 = 0.04', () => expect(r.TATA).toBeCloseTo(0.04, DP));
  it('LVGI = (550/1250 = 0.44) / (400/1000 = 0.40) = 1.1', () => expect(r.LVGI).toBeCloseTo(1.1, DP));

  it('M = -4.84 + 1.288 + 0.555789 + 0.430933 + 1.1596 + 0.125455 - 0.1548 + 0.18716 - 0.3597 = -1.607563', () => {
    expect(mScore(r, RULES.beneish)).toBeCloseTo(-1.607563, DP);
  });

  it('balance-sheet TATA = (120 - 20 - 50 - 30) / 1250 = 0.016', () => {
    expect(beneishRatios(T, P, 'balancesheet').TATA).toBeCloseTo(0.016, DP);
  });

  it('uses the published coefficients and thresholds', () => {
    expect(RULES.beneish.intercept).toBe(-4.84);
    expect(RULES.beneish.coefficients).toEqual({ DSRI: 0.92, GMI: 0.528, AQI: 0.404, SGI: 0.892, DEPI: 0.115, SGAI: -0.172, TATA: 4.679, LVGI: -0.327 });
    expect(RULES.beneish.thresholds).toEqual({ flag: -1.78, conservative: -2.22 });
  });
});

describe('Beneish traffic lights and two-key verdict', () => {
  it('lights: green at or below the non-manipulator mean, red at or above the manipulator mean', () => {
    expect(ratioLight('DSRI', 1.031, RULES.beneish)).toBe('green');
    expect(ratioLight('DSRI', 1.2, RULES.beneish)).toBe('amber');
    expect(ratioLight('DSRI', 1.465, RULES.beneish)).toBe('red');
    expect(ratioLight('SGAI', 5, RULES.beneish)).toBe('info'); // weak discriminator: never traffic-lighted
    expect(ratioLight('TATA', null, RULES.beneish)).toBe('missing');
  });

  it('the worked example is NOT CLEAN: M above -1.78 even though only 2 ratios are red', () => {
    const b = beneish(T, P, RULES.beneish, { strict: false, tata: 'cashflow' });
    expect([b.red, b.amber, b.green]).toEqual([2, 5, 0]); // DEPI, TATA red; SGAI info
    expect(b.verdict).toBe('NOT CLEAN');
  });

  it('a low M-score with more than N red ratios is still NOT CLEAN (second key)', () => {
    // Shrinking sales pull M down, while DSRI, AQI and DEPI are all red.
    const t: BeneishYear = { ...T, sales: 600, cogs: 360, receivables: 90, ppe: 230, currentAssets: 400, netIncome: 40, cfo: 120, sga: 60, currentLiabilities: 250, longTermDebt: 250, depreciation: 15 };
    const b = beneish(t, P, RULES.beneish, { strict: false, tata: 'cashflow' });
    expect(b.m).not.toBeNull();
    expect(b.m ?? 0).toBeLessThan(-1.78);
    expect(b.red).toBeGreaterThan(RULES.beneish.maxRedForClean);
    expect(b.verdict).toBe('NOT CLEAN');
  });

  it('identical years are CLEAN by default but strict mode requires every ratio green', () => {
    const b = beneish(P, P, RULES.beneish, { strict: false, tata: 'cashflow' });
    expect(b.m).toBeCloseTo(-4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 + 4.679 * -0.01 - 0.327, DP);
    expect(b.verdict).toBe('CLEAN');
    const amberOnly: BeneishYear = { ...P, sales: 1200, cogs: 720, receivables: 120, sga: 120, cfo: 100 }; // SGI 1.2 = amber
    expect(beneish(amberOnly, P, RULES.beneish, { strict: false, tata: 'cashflow' }).verdict).toBe('CLEAN');
    expect(beneish(amberOnly, P, RULES.beneish, { strict: true, tata: 'cashflow' }).verdict).toBe('NOT CLEAN');
  });
});

describe('Beneish edge cases never invent a number', () => {
  it('zero revenue: sales-based ratios are missing and no M-score is produced', () => {
    const r = beneishRatios({ ...T, sales: 0 }, P);
    expect(r.DSRI).toBeNull();
    expect(r.GMI).toBeNull();
    expect(r.SGAI).toBeNull();
    expect(mScore(r, RULES.beneish)).toBeNull();
    expect(beneishRatios(T, { ...P, sales: 0 }).SGI).toBeNull();
  });

  it('negative gross margin: GMI is not meaningful', () => {
    expect(beneishRatios({ ...T, cogs: 1400 }, P).GMI).toBeNull();
  });

  it('a missing input makes only its own ratio missing and the verdict PARTIAL', () => {
    const b = beneish({ ...T, sga: null }, P, RULES.beneish, { strict: false, tata: 'cashflow' });
    expect(b.ratios.SGAI).toBeNull();
    expect(b.ratios.DSRI).toBeCloseTo(1.4, DP);
    expect(b.m).toBeNull();
    expect(b.verdict).toBe('PARTIAL');
  });

  it('negative equity does not break the ratios (equity is not an input)', () => {
    const r = beneishRatios({ ...T, currentLiabilities: 900, longTermDebt: 600 }, P);
    expect(r.LVGI).toBeCloseTo(1500 / 1250 / 0.4, DP);
  });
});

describe('other models', () => {
  const data: Record<string, number[]> = {
    // [current, prior, two years ago]
    netIncome: [110, 80, 60], cfo: [60, 90, 70], totalAssets: [1250, 1000, 900], currentAssets: [520, 400, 380], currentLiabilities: [250, 200, 190],
    reserves: [300, 220, 160], pbt: [150, 110, 80], interest: [20, 18, 15], equity: [500, 420, 360], revenue: [1300, 1000, 900], cogs: [806, 600, 550],
    longTermDebt: [300, 200, 200], shareCapital: [200, 200, 200],
  };
  const g: Get = (f, lag = 0) => data[f]?.[lag] ?? null;

  it('Sloan = (110 - 60) / ((1250 + 1000) / 2) = 0.044444', () => expect(sloan(g)).toBeCloseTo(0.044444, DP));

  it("Altman Z'' = 3.25 + 6.56(0.216) + 3.26(0.24) + 6.72(0.136) + 1.05(0.666667) = 7.06328", () => {
    const a = altmanZ(g, RULES.models.altman);
    expect(a.x[0]).toBeCloseTo(0.216, DP);
    expect(a.z).toBeCloseTo(7.06328, 5);
  });

  it("Altman Z'' is missing when equity exceeds assets or inputs are absent", () => {
    expect(altmanZ((f, l) => (f === 'reserves' ? null : g(f, l)), RULES.models.altman).z).toBeNull();
  });

  it('Piotroski counts the nine tests by hand: 6 pass', () => {
    // ROA>0 pass; CFO>0 pass; ROA 110/1000=0.110 vs 80/900=0.089 pass; CFO>NI fail; leverage 0.24 vs 0.20 fail;
    // current ratio 2.08 vs 2.00 pass; no new shares pass; gross margin 0.38 vs 0.40 fail; turnover 1.30 vs 1.11 pass.
    const p = piotroski(g);
    expect(p.available).toBe(9);
    expect(p.f).toBe(6);
  });

  it('Piotroski is not reported when a test cannot run', () => {
    const p = piotroski((f, l = 0) => (l >= 2 ? null : g(f, l)));
    expect(p.f).toBeNull();
    expect(p.available).toBeLessThan(9);
  });

  it('Benford: too few numbers gives no statistic; a Benford-shaped sample scores low', () => {
    expect(benford([1, 2, 3], 100).chi2).toBeNull();
    const shaped = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9].flatMap((d) => [d, d * 10, d * 100, d * 1000, d * 1.01]);
    const b = benford(shaped, 100);
    expect(b.n).toBe(100);
    expect(b.chi2 ?? 99).toBeLessThan(15.51);
    expect(benford(Array.from({ length: 120 }, () => 9), 100).chi2 ?? 0).toBeGreaterThan(20.09);
  });
});
