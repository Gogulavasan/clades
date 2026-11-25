/**
 * Regression tests for layouts found in a real annual report: two-page spreads, multi-column prose,
 * roman-numeral section headings, unlabelled subtotals, and a standalone set printed before the consolidated one.
 * All content here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { checkIntegrity } from '../src/confirm/integrity';
import { buildPage, findGutters, type PdfPage, type TextItem } from '../src/extract/layout';
import { extractFromPages, scanText, splitLine } from '../src/extract/pdf';
import { parseGrid } from '../src/ingest/grid';
import { autoMap, defaultMeta, standardise } from '../src/standardise/standardise';
import report from './fixtures/synthetic-report.json';

const CHAR = 5;
const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, w: str.length * CHAR });
const [BS, PL, CF] = [report.pages[2] ?? [], report.pages[3] ?? [], report.pages[4] ?? []];

/** The synthetic balance sheet restyled the way the real report prints it. */
const styledBs = BS.map((l) =>
  l
    .replace(/^Non-current assets$/, 'I NON-CURRENT ASSETS')
    .replace(/^Current assets$/, 'II CURRENT ASSETS')
    .replace(/^Non-current liabilities$/, 'I NON-CURRENT LIABILITIES')
    .replace(/^Current liabilities$/, 'II CURRENT LIABILITIES')
    .replace(/^Equity$/, 'EQUITY')
    .replace(/^Total (non-current assets|current assets|non-current liabilities|current liabilities) /, ''),
);
const zip = (a: string[], b: string[]): string[] => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => `${a[i] ?? ''} ${b[i] ?? ''}`.trim());
const spread = (page: number, left: string[], right: string[]): PdfPage => ({ page, lines: zip(left, right), halves: [left, right] });

describe('page layout', () => {
  const twoColumns: TextItem[] = [];
  for (let i = 0; i < 20; i++) {
    twoColumns.push(item(`left column line ${i} runs on`, 40, 700 - i * 12));
    twoColumns.push(item(`right column line ${i} runs on`, 320, 700 - i * 12));
  }

  it('finds the gutter between two text columns and reads column by column', () => {
    const gutters = findGutters(twoColumns, 600);
    expect(gutters).toHaveLength(1);
    expect(gutters[0]).toBeGreaterThan(180);
    expect(gutters[0]).toBeLessThan(320);
    const p = buildPage(1, twoColumns, 600, 800);
    expect(p.lines[0]).toBe('left column line 0 runs on right column line 0 runs on'); // row-wise: columns glued together
    expect(p.text?.[0]).toBe('left column line 0 runs on');
    expect(p.text?.[19]).toBe('left column line 19 runs on');
    expect(p.text?.[20]).toBe('right column line 0 runs on'); // the right column is read after the left one
    expect(p.halves).toBeUndefined(); // portrait page: never split
  });

  it('tolerates a full-width heading crossing the gutter', () => {
    const withHeading = [...twoColumns, item('A HEADING THAT SPANS THE WHOLE WIDTH OF THE PAGE FROM MARGIN TO MARGIN AND BEYOND THE GUTTER', 40, 760)];
    expect(findGutters(withHeading, 600)).toHaveLength(1);
  });

  it('does not invent columns on a single-column page or a short page', () => {
    const single = Array.from({ length: 20 }, (_, i) => item('one single wide column of prose that fills the entire measure of the page here', 40, 700 - i * 12));
    expect(findGutters(single, 600)).toEqual([]);
    expect(buildPage(1, single, 600, 800).text).toBeUndefined();
    expect(findGutters(twoColumns.slice(0, 6), 600)).toEqual([]);
  });

  it('offers both halves of a landscape page', () => {
    const p = buildPage(7, [item('Balance Sheet', 40, 500), item('Total assets 10 20', 40, 480), item('Statement of Profit and Loss', 640, 500), item('Revenue 5 6', 640, 480)], 1190, 842);
    expect(p.halves?.[0]).toEqual(['Balance Sheet', 'Total assets 10 20']);
    expect(p.halves?.[1]).toEqual(['Statement of Profit and Loss', 'Revenue 5 6']);
    expect(p.lines[0]).toBe('Balance Sheet Statement of Profit and Loss');
  });

  it('quotes a sentence from one column only', () => {
    const page: PdfPage = { page: 3, lines: ['The auditor has issued a Strong cash flows were', 'qualified opinion on these. reported by management.'], text: ['The auditor has issued a', 'qualified opinion on these.', 'Strong cash flows were', 'reported by management.'] };
    const hits = scanText([page]);
    expect(hits.find((h) => h.id === 'F1_AUDIT_MODIFIED')?.sentence).toBe('The auditor has issued a qualified opinion on these.');
  });
});

describe('real-report layouts (synthetic content)', () => {
  // Standalone statements come first and their cash flow heading does not say which set it belongs to.
  const standaloneCf = CF.map((l) => l.replace('Consolidated Statement of Cash Flows', 'Statement of Cash Flow').replace('(66.00) 88.00', '(999.00) (888.00)'));
  const standaloneBs = BS.map((l) => l.replace('Consolidated Balance Sheet', 'Balance Sheet').replace('1,930.00 1,400.00', '9,999.00 8,888.00'));
  const consolidatedCf = CF.map((l) => l.replace('Consolidated Statement of Cash Flows', 'Statement of Cash Flow'));
  const notes = [
    'SAMPLE SYNTHETIC LIMITED', 'Notes forming part of the Consolidated Financial Statements', 'Discontinued operations: statement of cash flows',
    'Net cash generated from operating activities 1.00 2.00', 'Net cash used in investing activities 3.00 4.00', 'Net cash generated from financing activities 5.00 6.00',
    'Revenue from operations 7.00 8.00', 'Total income 7.00 8.00', 'Total expenses 9.00 9.00', 'Loss before tax 2.00 1.00',
  ];
  const pages: PdfPage[] = [
    spread(1, standaloneBs, PL.map((l) => l.replace('Consolidated Statement', 'Statement'))),
    spread(2, ['Statement of Changes in Equity', 'Balance at the beginning 1 2'], standaloneCf),
    spread(3, ['Independent Auditor’s Report', 'To the Members'], ['Opinion', 'We have audited the statements.']),
    spread(4, styledBs, PL),
    spread(5, ['Consolidated Statement of Changes in Equity', 'Profit for the year 130.00 97.00 130.00 97.00'], consolidatedCf.slice(0, 13)),
    spread(6, ['SAMPLE SYNTHETIC LIMITED', 'Statement of Cash Flow (Contd.)', ...consolidatedCf.slice(13)], notes),
  ];
  const x = extractFromPages(pages, 'spread.pdf');
  const company = standardise(x.table, autoMap(x.table), { ...defaultMeta(x.table), unit: 'crore', basis: x.basis });
  const cur = company.years[1]?.figures;

  it('reads each half of a spread as its own statement and says so', () => {
    expect(x.found).toEqual({ bs: 4, pl: 4, cf: 5 });
    expect(x.notes.join(' ')).toMatch(/Balance sheet: read from the left half of page 4/);
    expect(cur?.revenue?.value).toBe(2100);
    expect(cur?.receivables?.value).toBe(640); // not glued to the P&L line printed beside it
  });

  it('keeps the three statements in one set: the cash flow that follows the chosen balance sheet', () => {
    expect(x.basis).toBe('consolidated');
    expect(cur?.totalAssets?.value).toBe(1930); // consolidated, not the standalone 9,999 printed earlier
    expect(cur?.cfo?.value).toBe(-66); // not the standalone (999) on page 2, nor the 1.00 in the notes on page 6
    expect(cur?.cff?.value).toBe(320); // continued on the left half of the next page
    expect(cur?.netCashFlow?.value).toBe(-15);
  });

  it('never double-counts a caption repeated in another statement beside it', () => {
    expect(cur?.netIncome?.value).toBe(130); // "Profit for the year" also appears in the changes-in-equity half
    expect(cur?.pbt?.value).toBe(174);
  });

  it('recognises roman-numeral section headings', () => {
    expect(splitLine('I NON-CURRENT ASSETS')).toEqual({ label: 'NON-CURRENT ASSETS', numbers: [] });
    expect(splitLine('III Assets classified as held for sale 18.58 14.52').label).toBe('Assets classified as held for sale');
    expect(cur?.longTermDebt?.value).toBe(450);
    expect(cur?.shortTermDebt?.value).toBe(330);
  });

  it('reads an unlabelled subtotal by position, tags it LOW and reports it', () => {
    expect(cur?.currentAssets).toMatchObject({ value: 1045, confidence: 'low' });
    expect(cur?.nonCurrentLiabilities).toMatchObject({ value: 450, confidence: 'low' });
    expect(x.notes.join(' ')).toMatch(/Printed without a label and read by position, tagged LOW: .*Total current assets/);
    const rep = checkIntegrity(company);
    expect(rep.blocked).toBe(false);
    expect(rep.checks.find((c) => c.id === 'BS_SPLIT_ASSETS' && c.year === 'FY2025')?.status).toBe('pass');
  });

  it('a wrong positional subtotal is caught by the integrity gate', () => {
    const broken = pages.map((p) => (p.page === 4 ? spread(4, styledBs.map((l) => (l === '1,045.00 740.00' ? '545.00 740.00' : l)), PL) : p));
    const bx = extractFromPages(broken, 'x.pdf');
    const rep = checkIntegrity(standardise(bx.table, autoMap(bx.table), { ...defaultMeta(bx.table), unit: 'crore' }));
    expect(rep.blocked).toBe(true);
    expect(rep.checks.find((c) => c.status === 'fail')?.id).toBe('BS_SPLIT_ASSETS');
  });
});

describe('labels seen in real reports', () => {
  const map = (labels: string[], layout: 'pdf' | 'generic' = 'pdf') => {
    const table = { fileName: 'f', sheetName: 's', layout, company: null, periods: ['FY2024', 'FY2025'], rows: labels.map((label, index) => ({ index, section: 'cf' as const, label, values: [1, 2] })), notes: [] };
    return Object.values(autoMap(table)).map((m) => (m ? `${m.sign < 0 ? '-' : ''}${m.field}` : null));
  };

  it('maps cash-flow captions precisely', () => {
    expect(map(['Direct Taxes Paid (net)', 'Taxes paid on Sale of Non Current Investments', 'Income taxes paid'])).toEqual(['-taxPaid', null, '-taxPaid']);
    expect(map(['Capital Expenditure on Property, Plant & Equipment, Intangible Assets', 'Purchase of property, plant and equipment'])).toEqual(['-capex', '-capex']);
    expect(map(['Net increase / (decrease) in Cash and Cash Equivalents (A+B+C+D)', 'Net Cash generated from / (used in) Operating Activities (A)'])).toEqual(['netCashFlow', 'cfo']);
  });

  it('maps profit-and-loss captions precisely', () => {
    const pl = (labels: string[]) => {
      const table = { fileName: 'f', sheetName: 's', layout: 'pdf' as const, company: null, periods: ['FY2025'], rows: labels.map((label, index) => ({ index, section: 'pl' as const, label, values: [1] })), notes: [] };
      return Object.values(autoMap(table)).map((m) => m?.field ?? null);
    };
    expect(pl(['Profit before exceptional items and tax', 'Profit before tax from Continuing Operations', 'Profit before tax'])).toEqual([null, 'pbt', 'pbt']);
    expect(pl(['Depreciation, Amortisation & Impairment Expense', 'Operating and Other Expenses', 'Purchases of Stock-in-Trade'])).toEqual(['depreciation', 'otherExpenses', 'cogs']);
  });

  it('treats a bare "Total" as a balance-sheet total only in a Screener sheet', () => {
    const bare = { fileName: 'f', sheetName: 's', layout: 'pdf' as const, company: null, periods: ['FY2025'], rows: [{ index: 0, section: 'bs' as const, label: 'Total', values: [5] }], notes: [] };
    expect(autoMap(bare)[0]).toBeNull();
    const screener = parseGrid([['PROFIT & LOSS'], ['BALANCE SHEET'], ['Report Date', 'Mar-25'], ['Total', 10], ['Total', 10]], 'f', 's');
    expect(Object.values(autoMap(screener)).map((m) => m?.field)).toEqual(['totalLiabilitiesEquity', 'totalAssets']);
  });

  it('flags a promoter pledge but not a subsidiary pledging project shares to its lender', () => {
    const ids = (s: string) => scanText([{ page: 1, lines: [s] }]).map((h) => h.id);
    expect(ids('Term loans are secured by pledge of shares to the extent of 51% of the paid up equity of the project company.')).toEqual([]);
    expect(ids('During the year the promoters have pledged 12% of their holding.')).toEqual(['F7_PLEDGE']);
    expect(ids('45 percent of the shares held by the promoters have been pledged with lenders.')).toEqual(['F7_PLEDGE']);
  });
});
