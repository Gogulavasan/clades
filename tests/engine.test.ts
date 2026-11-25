import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildCaseFile, DEFAULT_OPTIONS } from '../src/casefile/build';
import { checkIntegrity } from '../src/confirm/integrity';
import { readWorkbook } from '../src/ingest/file';
import { parseGrid, parseNumber, parsePeriod, type Grid } from '../src/ingest/grid';
import { RULES, type RulesConfig } from '../src/rules/config';
import { levelFor } from '../src/rules/engine';
import { evaluate, parseFormula, type Env } from '../src/rules/formula';
import { scoreRules } from '../src/scoring/score';
import { FINANCIAL_SECTOR, autoMap, defaultMeta, editKey, looksFinancial, standardise } from '../src/standardise/standardise';
import { SAMPLE_PROFILES, buildSamples, gridToCsv, sampleGrid } from '../src/storage/sample';
import { Store, ledgerStats, type KeyValue } from '../src/storage/store';

const NOW = '2026-11-25T00:00:00.000Z';
const profile = (name: string) => {
  const p = SAMPLE_PROFILES.find((x) => x.name.includes(name));
  if (!p) throw new Error(`no sample profile ${name}`);
  return p;
};
const companyFrom = (grid: Grid, edits: Record<string, number | null> = {}, sector?: string) => {
  const table = parseGrid(grid, 'test.xlsx', 'Data Sheet');
  const meta = defaultMeta(table);
  return standardise(table, autoMap(table), sector ? { ...meta, sector } : meta, edits);
};

describe('formula language', () => {
  const data: Record<string, number[]> = { revenue: [120, 100, 80], cfo: [10, 20, 30], netIncome: [20, 20, 20], cash: [5] };
  const env: Env = {
    field: (n, lag) => (n in data ? (data[n]?.[lag] ?? null) : n === 'equity' ? null : undefined),
    variable: (n) => (n === 'MSCORE' ? -2 : undefined),
    bench: (k) => (k === 'roe' ? 0.14 : null),
  };
  const val = (f: string) => evaluate(f, env).value;

  it('does arithmetic with normal precedence', () => {
    expect(val('1 + 2 * 3')).toBe(7);
    expect(val('(1 + 2) * 3')).toBe(9);
    expect(val('-revenue / 2 + 10')).toBe(-50);
    expect(val('revenue > 100')).toBe(1);
  });

  it('supports lag, growth, avg, min, max, abs, sum and sd', () => {
    expect(val('lag(revenue, 1)')).toBe(100);
    expect(val('growth(revenue)')).toBeCloseTo(0.2, 10);
    expect(val('avg(revenue, lag(revenue, 2))')).toBe(100);
    expect(val('min(cfo, lag(cfo, 1)) + max(cfo, lag(cfo, 2)) + abs(0 - 4)')).toBe(44);
    expect(val('sum(cfo, 3, 5) / sum(netIncome, 3, 5)')).toBe(1);
    expect(val('sd(revenue, 3, 5)')).toBe(20);
  });

  it('returns missing, never a guess, when data is absent', () => {
    const r = evaluate('revenue / equity', env);
    expect(r.value).toBeNull();
    expect(r.trace.missing).toEqual(['equity']);
    expect(val('lag(revenue, 3)')).toBeNull();
    expect(val('sum(cash, 3, 5)')).toBeNull();
    expect(val('revenue / (cfo - 10)')).toBeNull(); // division by zero
    expect(val('bench("unknown")')).toBeNull();
  });

  it('when() marks a rule not applicable rather than missing', () => {
    const r = evaluate('when(revenue > 500, cfo)', env);
    expect(r.value).toBeNull();
    expect(r.trace.notApplicable).toBe(true);
    expect(val('when(revenue > 50, cfo)')).toBe(10);
  });

  it('records the inputs it read and the benchmark it used', () => {
    const r = evaluate('growth(revenue) - bench("roe") + MSCORE', env);
    expect(r.value).toBeCloseTo(0.2 - 0.14 - 2, 10);
    expect(r.trace.inputs.map((i) => `${i.name}@${i.lag}`)).toEqual(['revenue@0', 'revenue@1', 'MSCORE@0']);
    expect(r.trace.bench).toEqual([{ key: 'roe', value: 0.14 }]);
  });

  it('rejects bad syntax and unknown names loudly', () => {
    expect(() => parseFormula('1 +')).toThrow();
    expect(() => parseFormula('revenue $ 2')).toThrow();
    expect(() => evaluate('nonsense + 1', env)).toThrow(/unknown name/);
    expect(() => evaluate('explode(1)', env)).toThrow(/unknown function/);
  });

  it('every formula in the rule library parses', () => {
    for (const r of RULES.rules) expect(() => parseFormula(r.formula), r.id).not.toThrow();
    expect(new Set(RULES.rules.map((r) => r.id)).size).toBe(RULES.rules.length);
  });
});

describe('ingest', () => {
  it('parses period headers in the common formats', () => {
    expect(parsePeriod('Mar-21')?.label).toBe('FY2021');
    expect(parsePeriod('March 2021')?.label).toBe('FY2021');
    expect(parsePeriod('2020-21')?.label).toBe('FY2021');
    expect(parsePeriod('FY24')?.label).toBe('FY2024');
    expect(parsePeriod(2019)?.label).toBe('FY2019');
    expect(parsePeriod(new Date(Date.UTC(2023, 2, 31)))?.label).toBe('FY2023');
    expect(parsePeriod(45382)?.label).toBe('FY2024'); // Excel serial for 31 Mar 2024
    expect(parsePeriod('Sales')).toBeNull();
    expect(parsePeriod(123.4)).toBeNull();
  });

  it('parses numbers and treats blanks as missing, never zero', () => {
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('(250)')).toBe(-250);
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber(0)).toBe(0);
  });

  it('reads a Screener-style sheet: sections, both Totals, COGS components, proxies', () => {
    const c = companyFrom(sampleGrid(profile('ALPHA')));
    expect(c.name).toBe('SAMPLE ALPHA FOODS');
    expect(c.years.map((y) => y.label)).toEqual(['FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
    const y = c.years[5]?.figures;
    expect(y?.revenue?.confidence).toBe('high');
    expect(y?.totalAssets?.value).toBeCloseTo(y?.totalLiabilitiesEquity?.value ?? 0, 0);
    expect(y?.equity?.derived).toBeTruthy();
    expect(y?.currentAssets?.proxy).toBeTruthy();
    expect(y?.currentAssets?.confidence).toBe('low');
    expect(y?.capex).toBeUndefined(); // not in a Screener export: stays missing
    expect(y?.revenue?.source).toMatch(/test\.xlsx › Data Sheet › row \d+ "Sales"/);
  });

  it('skips the Quarters section of a Screener sheet', () => {
    const grid = sampleGrid(profile('ALPHA'));
    grid.push([], ['Quarters'], ['Report Date', 'Jun-25', 'Sep-25'], ['Sales', 1, 2]);
    const table = parseGrid(grid, 'f', 's');
    expect(table.periods).toHaveLength(6);
    expect(table.rows.filter((r) => r.label === 'Sales')).toHaveLength(1);
  });

  it('reads a generic CSV-style table and applies the unit', () => {
    const table = parseGrid([['Acme Widgets'], ['Particulars', '2023-24', '2024-25'], ['Revenue from operations', '1,00,000', '1,20,000'], ['Profit after tax', 5000, null], ['Mystery row', 1, 2]], 'a.csv', 'Sheet1');
    expect(table.layout).toBe('generic');
    expect(table.company).toBe('Acme Widgets');
    const mapping = autoMap(table);
    expect(mapping[4]).toBeNull(); // unknown labels are left unmapped, not guessed
    const c = standardise(table, mapping, { ...defaultMeta(table), unit: 'lakh' });
    expect(c.years[1]?.figures.revenue?.value).toBeCloseTo(1200, 6);
    expect(c.years[0]?.figures.netIncome?.value).toBeCloseTo(50, 6);
    expect(c.years[1]?.figures.netIncome).toBeUndefined();
  });

  it('a blank component makes the summed field missing for that year', () => {
    const grid = sampleGrid(profile('ALPHA'));
    const row = grid.find((r) => r[0] === 'Power and Fuel');
    if (row) row[6] = null;
    const c = companyFrom(grid);
    expect(c.years[5]?.figures.cogs).toBeUndefined();
    expect(c.years[4]?.figures.cogs).toBeDefined();
  });

  it('user edits override extracted figures and are labelled', () => {
    const c = companyFrom(sampleGrid(profile('ALPHA')), { [editKey('FY2025', 'capex')]: 77, [editKey('FY2025', 'inventory')]: null });
    expect(c.years[5]?.figures.capex).toMatchObject({ value: 77, edited: true });
    expect(c.years[5]?.figures.inventory).toBeUndefined();
  });

  it('round-trips a real .xlsx file through SheetJS', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['notes']]), 'Readme');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sampleGrid(profile('GAMMA'))), 'Data Sheet');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const table = await readWorkbook(buf, 'gamma.xlsx');
    expect(table.sheetName).toBe('Data Sheet');
    expect(table.layout).toBe('screener');
    expect(table.periods).toHaveLength(6);
  });

  it('exports the sample as CSV', () => {
    expect(gridToCsv([['a,b', 1], ['c"d', null]])).toBe('"a,b",1\n"c""d",');
  });

  it('detects financial companies by name', () => {
    expect(looksFinancial('HDFC Bank Ltd')).toBe(true);
    expect(looksFinancial('Bajaj Finance')).toBe(true);
    expect(looksFinancial('Tata Steel')).toBe(false);
  });
});

describe('integrity gate', () => {
  it('passes the synthetic statements', () => {
    const rep = checkIntegrity(companyFrom(sampleGrid(profile('DELTA'))));
    expect(rep.blocked).toBe(false);
    expect(rep.checks.filter((c) => c.status === 'pass').length).toBeGreaterThan(20);
  });

  it('blocks scoring when the balance sheet does not balance, and says where', () => {
    const c = companyFrom(sampleGrid(profile('ALPHA')), { [editKey('FY2024', 'totalAssets')]: 5 });
    const rep = checkIntegrity(c);
    expect(rep.blocked).toBe(true);
    const fail = rep.checks.find((x) => x.status === 'fail');
    expect(fail).toMatchObject({ id: 'BS_BALANCES', year: 'FY2024' });
    expect(() => buildCaseFile(c, DEFAULT_OPTIONS, NOW)).toThrow(/Integrity gate/);
  });

  it('does not run a check whose lines are missing', () => {
    const c = companyFrom(sampleGrid(profile('ALPHA')), { [editKey('FY2025', 'pbt')]: null });
    const pl = checkIntegrity(c).checks.find((x) => x.id === 'PL_SUM' && x.year === 'FY2025');
    expect(pl?.status).toBe('not_run');
  });
});

describe('scoring', () => {
  it('maps thresholds to levels in both directions', () => {
    expect(levelFor(0.5, 'lower', 0.8, 0.5)).toBe('red');
    expect(levelFor(0.7, 'lower', 0.8, 0.5)).toBe('amber');
    expect(levelFor(0.9, 'lower', 0.8, 0.5)).toBe('green');
    expect(levelFor(0.1, 'higher', 0.1, 0.25)).toBe('amber');
  });

  it('gives no score when nothing is assessable', () => {
    expect(scoreRules([], 0, RULES).tier).toBe('not_assessable');
  });

  it('applies combination rules and respects config-only changes', () => {
    const c = companyFrom(sampleGrid(profile('DELTA')));
    const base = buildCaseFile(c, DEFAULT_OPTIONS, NOW);
    const noCombos: RulesConfig = { ...RULES, scoring: { ...RULES.scoring, combos: [] } };
    const plain = buildCaseFile(c, DEFAULT_OPTIONS, NOW, noCombos);
    expect(plain.verdict.combos).toHaveLength(0);
    expect(base.verdict.score ?? 0).toBeGreaterThanOrEqual(plain.verdict.score ?? 0);
    // Disabling a rule in config removes it without code changes.
    const fewer: RulesConfig = { ...RULES, rules: RULES.rules.map((r) => (r.id === 'A2_CFO_PAT' ? { ...r, enabled: false } : r)) };
    expect(buildCaseFile(c, DEFAULT_OPTIONS, NOW, fewer).rules.some((r) => r.id === 'A2_CFO_PAT')).toBe(false);
  });
});

describe('case file', () => {
  const samples = buildSamples(NOW);
  const get = (name: string) => {
    const s = samples.find((x) => x.caseFile.company.name.includes(name));
    if (!s) throw new Error(name);
    return s.caseFile;
  };

  it('is deterministic: the same input gives the same case file', () => {
    expect(JSON.stringify(buildSamples(NOW))).toBe(JSON.stringify(samples));
  });

  it('marks every sample as synthetic', () => {
    for (const s of samples) {
      expect(s.caseFile.sample).toBe(true);
      expect(s.caseFile.company.name).toMatch(/^SAMPLE /);
    }
  });

  it('the demo set spans the tiers', () => {
    expect(get('ALPHA').verdict.tier).toBe('clean');
    expect(get('DELTA').verdict.tier).toBe('suspicious');
    expect(samples.some((s) => s.caseFile.verdict.tier === 'watch')).toBe(true);
  });

  it('financial companies are not assessable, with the reason', () => {
    const cf = get('ETA FINANCE');
    expect(cf.status).toBe('not_assessable');
    expect(cf.verdict.score).toBeNull();
    expect(cf.statusReason).toMatch(/Banks, NBFCs and insurers/);
    expect(cf.rules).toHaveLength(0);
    expect(companyFrom(sampleGrid(profile('ALPHA')), {}, FINANCIAL_SECTOR).sector).toBe(FINANCIAL_SECTOR);
  });

  it('one year of data gives a Partial result with low confidence and no Beneish', () => {
    const cf = get('THETA');
    expect(cf.status).toBe('partial');
    expect(cf.beneish).toBeNull();
    expect(cf.verdict.confidence.level).toBe('LOW');
    expect(cf.rules.find((r) => r.id === 'A2_CFO_PAT')?.level).not.toBe('missing'); // single-year checks still run
    expect(cf.rules.find((r) => r.id === 'B1_REC_VS_SALES')?.level).toBe('missing');
  });

  it('carries source, year and confidence for every rule input', () => {
    const cf = get('DELTA');
    const r = cf.rules.find((x) => x.id === 'A2_CFO_PAT');
    expect(r?.level).toBe('red');
    expect(r?.inputs.map((i) => i.field).sort()).toEqual(['cfo', 'netIncome']);
    for (const i of r?.inputs ?? []) expect(i.source).toMatch(/row \d+/);
    expect(r?.innocent.length).toBeGreaterThan(10);
  });

  it('turning proxies off makes proxy-based ratios missing instead of estimated', () => {
    const s = samples.find((x) => x.caseFile.company.name.includes('DELTA'));
    if (!s) throw new Error('DELTA');
    const strict = buildCaseFile(s.company, { ...DEFAULT_OPTIONS, proxies: false }, NOW);
    expect(strict.beneish?.ratios.AQI).toBeNull();
    expect(strict.beneish?.ratios.LVGI).toBeNull();
    expect(strict.beneish?.ratios.DSRI).not.toBeNull();
    expect(strict.beneish?.m).toBeNull();
    expect(strict.status).toBe('partial');
    // Less usable data must never read as more confidence.
    expect(strict.verdict.confidence.score).toBeLessThanOrEqual(s.caseFile.verdict.confidence.score);
    expect(strict.rules.some((r) => r.usesProxy)).toBe(false);
  });

  it('labels placeholder benchmarks and never says "fraud" in generated text', () => {
    const cf = get('DELTA');
    expect(cf.benchmarks.placeholder).toBe(true);
    expect(cf.rules.find((r) => r.id === 'B3_GROWTH_VS_SECTOR')?.benchmark?.placeholder).toBe(true);
    const text = [cf.verdict.summary, ...cf.nextSteps, ...cf.rules.flatMap((r) => [r.plain, r.innocent, r.nextStep]), ...cf.verdict.combos.map((c) => c.text)].join(' ');
    expect(text.toLowerCase()).not.toContain('fraud');
  });

  it('handles negative equity and zero revenue without producing numbers from nothing', () => {
    const grid = sampleGrid(profile('ALPHA'));
    const c = companyFrom(grid, { [editKey('FY2025', 'revenue')]: 0, [editKey('FY2025', 'pbt')]: null, [editKey('FY2025', 'equity')]: -50 });
    const cf = buildCaseFile(c, DEFAULT_OPTIONS, NOW);
    expect(cf.beneish?.ratios.DSRI).toBeNull();
    expect(cf.beneish?.m).toBeNull();
    expect(cf.rules.find((r) => r.id === 'I3_RELATED_LOANS')?.level).toBe('na');
    for (const r of cf.rules) if (r.value !== null) expect(Number.isFinite(r.value), r.id).toBe(true);
  });
});

describe('storage', () => {
  const memory = (): KeyValue & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const samples = buildSamples(NOW);
  const delta = samples.find((s) => s.caseFile.verdict.tier === 'suspicious');
  if (!delta) throw new Error('no suspicious sample');
  const real = { caseFile: { ...delta.caseFile, sample: false, id: 'REAL1' }, company: delta.company };

  it('persists, reloads and round-trips through export/import', () => {
    const kv = memory();
    const a = new Store(kv);
    a.upsert(real.caseFile, real.company);
    a.update('REAL1', { status: 'UNDER REVIEW', notes: 'check ageing note' });
    const b = new Store(kv);
    expect(b.db.cases.REAL1).toMatchObject({ status: 'UNDER REVIEW', notes: 'check ageing note' });
    const c = new Store(memory());
    c.importJson(a.exportJson());
    expect(c.db).toEqual(a.db);
    expect(() => c.importJson('{"version":2}')).toThrow(/Not a CLADES backup/);
    expect(() => c.importJson('not json')).toThrow(/not valid JSON/);
  });

  it('logs a prediction once per company-year, never for samples, and keeps re-scan history', () => {
    const s = new Store(memory());
    s.upsert(delta.caseFile, delta.company);
    expect(s.db.ledger).toHaveLength(0);
    s.upsert(real.caseFile, real.company);
    s.upsert({ ...real.caseFile, generatedAt: '2026-12-01T00:00:00.000Z' }, real.company);
    expect(s.db.ledger).toHaveLength(1);
    expect(s.db.cases.REAL1?.history).toHaveLength(2);
    expect(s.db.cases.REAL1?.flagDate).toBe(NOW);
  });

  it('reports hit rate and false alarms together', () => {
    const s = new Store(memory());
    s.upsert(real.caseFile, real.company);
    s.upsert({ ...real.caseFile, id: 'REAL2' }, real.company);
    s.upsert({ ...real.caseFile, id: 'REAL3' }, real.company);
    expect(ledgerStats(s.db.ledger)).toMatchObject({ total: 3, open: 3, hitRate: null });
    s.setOutcome('REAL1:FY2025', 'problem', NOW);
    s.setOutcome('REAL2:FY2025', 'no_problem', NOW);
    expect(ledgerStats(s.db.ledger)).toEqual({ total: 3, open: 1, hits: 1, falseAlarms: 1, hitRate: 0.5 });
  });

  it('clears samples only, and survives unreadable or missing storage', () => {
    const s = new Store(memory());
    for (const x of samples) s.upsert(x.caseFile, x.company);
    s.upsert(real.caseFile, real.company);
    s.clearSamples();
    expect(s.list().map((r) => r.id)).toEqual(['REAL1']);
    expect(s.db.settings.samplesDismissed).toBe(true);
    const bad = memory();
    bad.data.set('clades.v1', '{broken');
    expect(new Store(bad).persistError).toMatch(/could not be read/);
    const none = new Store(null);
    none.save();
    expect(none.persistError).toMatch(/unavailable/);
  });
});
