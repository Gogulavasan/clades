import { describe, expect, it } from 'vitest';
import { buildCaseFile, DEFAULT_OPTIONS } from '../src/casefile/build';
import { checkIntegrity } from '../src/confirm/integrity';
import { extractFromPages, findPeriods, findUnit, scanText, splitLine, type PdfPage } from '../src/extract/pdf';
import { parseDate, parsePriceCsv } from '../src/ingest/price';
import { RULES } from '../src/rules/config';
import { makeGet } from '../src/rules/engine';
import { honestProfit } from '../src/scoring/honest';
import type { Company } from '../src/standardise/schema';
import { autoMap, defaultMeta, standardise } from '../src/standardise/standardise';
import report from './fixtures/synthetic-report.json';

const NOW = '2026-11-25T00:00:00.000Z';
const PAGES: PdfPage[] = report.pages.map((lines, i) => ({ page: i + 1, lines }));

/** The synthetic report run through the whole PDF route, as the app does it. */
function fromPdf(pages = PAGES): { company: Company; x: ReturnType<typeof extractFromPages> } {
  const x = extractFromPages(pages, 'synthetic.pdf');
  const meta = { ...defaultMeta(x.table), name: 'Sample Synthetic', ticker: 'SYNPDF', basis: x.basis, unit: x.unit ?? ('crore' as const) };
  return { x, company: { ...standardise(x.table, autoMap(x.table), meta), textPages: x.pages, textHits: x.textHits } };
}

describe('PDF line parsing', () => {
  it('splits label, note number and the two year columns', () => {
    expect(splitLine('(b) Trade receivables 7 640.00 380.00')).toEqual({ label: 'Trade receivables', numbers: [7, 640, 380] });
    expect(splitLine('Changes in inventories of finished goods (40.00) (16.00)')).toEqual({ label: 'Changes in inventories of finished goods', numbers: [-40, -16] });
    expect(splitLine('Total current assets 1,045.00 740.00').numbers).toEqual([1045, 740]);
    expect(splitLine('Capital work-in-progress 12.5 -').numbers).toEqual([12.5, 0]); // a dash is the report saying nil
    expect(splitLine('Net cash generated from / (used in) operating activities (66.00) 88.00').label).toBe('Net cash generated from / (used in) operating activities');
  });

  it('does not treat header dates or prose as figures', () => {
    expect(splitLine('Particulars Note 31 March 2025 31 March 2024').numbers).toEqual([2024]); // one trailing number: ignored by the extractor
    expect(splitLine('Non-current assets').numbers).toEqual([]);
  });

  it('reads the period columns and the unit from the statement headers', () => {
    expect(findPeriods(['Balance Sheet as at 31 March 2025', 'Particulars Note 31 March 2025 31 March 2024'])).toEqual(['FY2025', 'FY2024']);
    expect(findPeriods(['Particulars 2023-24 2024-25'])).toEqual(['FY2025', 'FY2024']);
    expect(findPeriods(['As at March 31, 2024 March 31, 2023'])).toEqual(['FY2024', 'FY2023']);
    expect(findPeriods(['no dates here'])).toBeNull();
    expect(findUnit(['(All amounts in Rs. crore, unless otherwise stated)'])).toBe('crore');
    expect(findUnit(['(₹ in lakhs)'])).toBe('lakh');
    expect(findUnit(['INR in millions'])).toBe('million');
    expect(findUnit(['nothing'])).toBeNull();
  });
});

describe('PDF statement extraction (synthetic report)', () => {
  const { x, company } = fromPdf();
  const cur = company.years[1]?.figures;
  const prior = company.years[0]?.figures;

  it('locates the three statements and their pages', () => {
    expect(x.scanned).toBe(false);
    expect(x.found).toEqual({ bs: 3, pl: 4, cf: 5 });
    expect(x.basis).toBe('consolidated');
    expect(x.unit).toBe('crore');
    expect(company.years.map((y) => y.label)).toEqual(['FY2024', 'FY2025']);
  });

  it('captures current and prior year with page and medium confidence', () => {
    expect(cur?.revenue).toMatchObject({ value: 2100, confidence: 'medium' });
    expect(prior?.revenue?.value).toBe(1600);
    expect(cur?.receivables?.source).toBe('synthetic.pdf › page 3 "Current assets: Trade receivables"');
    expect(cur?.cfo?.value).toBe(-66);
    expect(cur?.capex?.value).toBe(269); // an outflow printed in brackets becomes a positive capex figure
    expect(cur?.dividends?.value).toBe(30);
    expect(cur?.taxPaid?.value).toBe(40);
  });

  it('uses balance-sheet sections to tell long-term from short-term borrowings', () => {
    expect(cur?.longTermDebt).toMatchObject({ value: 450 });
    expect(cur?.longTermDebt?.proxy).toBeUndefined();
    expect(cur?.shortTermDebt?.value).toBe(330);
    expect(cur?.borrowings).toMatchObject({ value: 780, derived: 'Long-term + short-term borrowings' });
    expect(cur?.currentAssets?.proxy).toBeUndefined(); // reported directly, unlike a Screener export
  });

  it('adds cost components and never double-counts a line repeated in another statement', () => {
    expect(cur?.cogs?.value).toBe(1220); // 1,260 materials + (40) change in inventories
    expect(cur?.pbt?.value).toBe(174); // "Profit before tax" also opens the cash flow statement
    expect(cur?.sga?.proxy).toMatch(/Other expenses/);
  });

  it('passes the integrity gate on the split balance sheet', () => {
    const rep = checkIntegrity(company);
    expect(rep.blocked).toBe(false);
    for (const id of ['BS_BALANCES', 'BS_SPLIT_ASSETS', 'BS_SPLIT_LIAB', 'PL_TAX']) expect(rep.checks.find((c) => c.id === id && c.year === 'FY2025')?.status, id).toBe('pass');
    // The P&L sum needs SG&A, which here is only a PROXY: the check is not run rather than passed on an estimate.
    expect(rep.checks.find((c) => c.id === 'PL_SUM' && c.year === 'FY2025')?.status).toBe('not_run');
  });

  it('produces the hand-calculated Beneish ratios', () => {
    const cf = buildCaseFile(company, DEFAULT_OPTIONS, NOW);
    expect(cf.beneish?.ratios.DSRI).toBeCloseTo(640 / 2100 / (380 / 1600), 6); // 1.2832
    expect(cf.beneish?.ratios.AQI).toBeCloseTo((1 - 1565 / 1930) / (1 - 1220 / 1400), 6); // 1.4709
    expect(cf.beneish?.ratios.TATA).toBeCloseTo(196 / 1930, 6);
    expect(cf.beneish?.m).toBeCloseTo(-1.374, 2);
  });

  it('a scanned PDF (no text layer) extracts nothing and says so', () => {
    const scan = extractFromPages([{ page: 1, lines: [] }, { page: 2, lines: ['3'] }], 'scan.pdf');
    expect(scan.scanned).toBe(true);
    expect(scan.table.rows).toHaveLength(0);
    expect(scan.notes.join(' ')).toMatch(/no readable text layer.*manual entry/i);
  });

  it('reports a statement it cannot find instead of guessing', () => {
    const noCf = fromPdf(PAGES.slice(0, 4));
    expect(noCf.x.found.cf).toBeNull();
    expect(noCf.x.notes.join(' ')).toMatch(/Cash flow statement: not found/);
    expect(noCf.company.years[1]?.figures.cfo).toBeUndefined();
    expect(buildCaseFile(noCf.company, DEFAULT_OPTIONS, NOW).beneish?.ratios.TATA).toBeNull();
  });

  it('prefers the primary statement over a multi-year summary table', () => {
    const summary: PdfPage = {
      page: 1,
      lines: ['Ten-year highlights - Balance Sheet', ...Array.from({ length: 8 }, (_, i) => `Total assets and equity line ${String.fromCharCode(97 + i)} 10 20 30 40 50`)],
    };
    expect(extractFromPages([summary, ...PAGES.map((p) => ({ ...p, page: p.page + 1 }))], 'x.pdf').found.bs).toBe(4);
  });
});

describe('text rules (governance lexicon)', () => {
  const { company } = fromPdf();
  const cf = buildCaseFile(company, DEFAULT_OPTIONS, NOW);
  const rule = (id: string) => cf.rules.find((r) => r.id === id);

  it('quotes the sentence and page for every text flag', () => {
    expect(rule('F3_EMPHASIS')).toMatchObject({ level: 'amber', display: '1 quote(s)' });
    expect(rule('F3_EMPHASIS')?.quotes?.[0]).toMatchObject({ page: 2 });
    expect(rule('F3_EMPHASIS')?.quotes?.[0]?.sentence).toMatch(/^Emphasis of Matter: We draw attention to Note 38/);
    expect(rule('F4_AUDITOR_CHANGE')?.quotes?.[0]).toMatchObject({ page: 1 });
    expect(rule('F6_RELATED_LOANS')?.level).toBe('amber');
    expect(rule('F7_PLEDGE')?.level).toBe('amber');
  });

  it('skips negated boilerplate such as "has not defaulted"', () => {
    expect(rule('F5_DEFAULT')).toMatchObject({ level: 'green', display: 'no match' });
    expect(scanText([{ page: 9, lines: ['The Company has defaulted in repayment of loans to a bank.'] }]).map((h) => h.id)).toEqual(['F5_DEFAULT']);
    expect(rule('F1_AUDIT_MODIFIED')?.level).toBe('green'); // "Our opinion is not modified" is not a qualified opinion
    expect(scanText([{ page: 1, lines: ['Basis for Qualified Opinion', 'We were unable to verify inventory.'] }]).some((h) => h.id === 'F1_AUDIT_MODIFIED')).toBe(true);
  });

  it('scores the Opportunity leg once text is available, and shows information-only rules as INFO', () => {
    expect(cf.verdict.triangle?.opportunity.score).not.toBeNull();
    expect(rule('F9_KAM_REVENUE')).toMatchObject({ level: 'info', display: '1 quote(s)' });
    expect(rule('F9_KAM_REVENUE')?.points).toBe(0);
  });

  it('pairs a management claim with the figure that contradicts it', () => {
    expect(cf.wordsVsNumbers).toHaveLength(1);
    expect(cf.wordsVsNumbers[0]).toMatchObject({ topic: 'cash generation', page: 1, level: 'red' });
    expect(cf.wordsVsNumbers[0]?.claim).toBe('The Company delivered strong cash generation during the year and continued to invest in capacity.'); // page header not glued on
    expect(cf.wordsVsNumbers[0]?.figure).toBe('-0.51x');
  });

  it('without report text every text rule is NO DATA, never a pass', () => {
    const noText = buildCaseFile({ ...company, textPages: undefined, textHits: undefined }, DEFAULT_OPTIONS, NOW);
    for (const r of noText.rules.filter((x) => x.battery.startsWith('F '))) expect(r.level).toBe('missing');
    expect(noText.wordsVsNumbers).toHaveLength(0);
    expect(noText.textPages).toBeNull();
  });
});

describe('honest-profit estimator', () => {
  const { company } = fromPdf();
  const g = makeGet(company, { proxies: true });

  it('matches the hand calculation with default assumptions', () => {
    const h = honestProfit(g, RULES.honestProfit);
    const by = Object.fromEntries(h.items.map((i) => [i.short, i]));
    // Receivables: 640 - (380/1600) x 2100 = 141.25; x 50% x (1 - 25%) = 52.96875
    expect(by.RECV?.base).toBeCloseTo(141.25, 6);
    expect(by.RECV?.afterTax).toBeCloseTo(52.96875, 6);
    // Soft assets: 365 - (180/1400) x 1930 = 116.857143; x 50% x 75% = 43.821429
    expect(by.CAPEX?.base).toBeCloseTo(116.857143, 5);
    expect(by.CAPEX?.afterTax).toBeCloseTo(43.821429, 5);
    // Depreciation at last year's rate: (48/528) x 564 - 44 = 7.272727; x 100% x 75% = 5.454545
    expect(by.DEPN?.afterTax).toBeCloseTo(5.454545, 5);
    // Other income: 12 x 25% x 75% = 2.25
    expect(by.OTHER?.afterTax).toBeCloseTo(2.25, 6);
    expect(h.reported).toBe(130);
    expect(h.stressed).toBeCloseTo(25.505276, 5) // 130 - 52.96875 - 43.821429 - 5.454545 - 2.25;
  });

  it('every assumption is adjustable; zero assumptions leave reported profit untouched', () => {
    const zero = honestProfit(g, { receivablesProvisionPct: 0, capitalisedReversalPct: 0, depreciationNormalisationPct: 0, otherIncomeHaircutPct: 0, taxRate: 0.25 });
    expect(zero.stressed).toBe(130);
    const cf = buildCaseFile(company, { ...DEFAULT_OPTIONS, honest: { ...RULES.honestProfit, otherIncomeHaircutPct: 1, taxRate: 0 } }, NOW);
    expect(cf.honest?.items.find((i) => i.short === 'OTHER')?.afterTax).toBe(12);
    expect(cf.settings.honest?.taxRate).toBe(0);
  });

  it('a missing input makes that step zero and marks it, rather than estimating', () => {
    const oneYear: Company = { ...company, years: company.years.slice(1) };
    const h = honestProfit(makeGet(oneYear, { proxies: true }), RULES.honestProfit);
    expect(h.items.find((i) => i.short === 'RECV')).toMatchObject({ base: null, afterTax: 0 });
    expect(h.stressed).toBeCloseTo(130 - 2.25, 6); // only the other-income haircut can be computed
  });

  it('never adds profit back: favourable movements are floored at zero', () => {
    const better: Company = JSON.parse(JSON.stringify(company)) as Company;
    const y = better.years[1]?.figures;
    if (y?.receivables) y.receivables.value = 100;
    expect(honestProfit(makeGet(better, { proxies: true }), RULES.honestProfit).items[0]?.base).toBe(0);
  });
});

describe('manual entry', () => {
  it('builds a company purely from typed figures, with nothing pre-filled', () => {
    const table = { fileName: 'Manual entry', sheetName: 'typed by user', layout: 'manual' as const, company: 'Typed Co', periods: ['FY2024', 'FY2025'], rows: [], notes: [] };
    const blank = standardise(table, {}, defaultMeta(table));
    expect(blank.years.map((y) => Object.keys(y.figures).length)).toEqual([0, 0]);
    const c = standardise(table, {}, defaultMeta(table), { 'FY2024|revenue': 1000, 'FY2025|revenue': 1300, 'FY2025|netIncome': 110, 'FY2025|cfo': 60 });
    expect(c.years[1]?.figures.revenue).toMatchObject({ value: 1300, edited: true, source: 'Entered by user on the confirm screen' });
    const cf = buildCaseFile(c, DEFAULT_OPTIONS, NOW);
    expect(cf.beneish?.ratios.SGI).toBeCloseTo(1.3, 6);
    expect(cf.beneish?.m).toBeNull(); // seven ratios are missing: no M-score is made up
    expect(cf.rules.find((r) => r.id === 'A2_CFO_PAT')?.display).toBe('0.55x');
  });
});

describe('price CSV', () => {
  it('parses the common date formats, day first', () => {
    expect(parseDate('2024-03-28')).toBe('2024-03-28');
    expect(parseDate('28-03-2024')).toBe('2024-03-28');
    expect(parseDate('28/3/2024')).toBe('2024-03-28');
    expect(parseDate('28-Mar-2024')).toBe('2024-03-28');
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate('2024-13-01')).toBeNull();
  });

  it('reads date, close, volume by header name, sorts by date and drops bad rows', () => {
    const csv = 'Date,Open,Close,Volume\n02-Jan-2024,10,"1,012.5","3,00,000"\n01-Jan-2024,9,1000,250000\nbad,1,2,3\n03-Jan-2024,11,,5';
    expect(parsePriceCsv(csv)).toEqual([{ d: '2024-01-01', c: 1000, v: 250000 }, { d: '2024-01-02', c: 1012.5, v: 300000 }]);
    expect(parsePriceCsv('2024-01-01,5\n2024-01-02,6')).toEqual([{ d: '2024-01-01', c: 5, v: null }, { d: '2024-01-02', c: 6, v: null }]);
  });

  it('thins long histories but keeps the first and last day', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `${new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10)},${100 + i},1`).join('\n');
    const pts = parsePriceCsv(rows, 100);
    expect(pts).toHaveLength(100);
    expect(pts[0]?.c).toBe(100);
    expect(pts[99]?.c).toBe(1099);
  });
});
