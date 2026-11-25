/** Runs the pipeline for one company and returns the single case-file object every screen renders from. */
import { checkIntegrity, type IntegrityReport } from '../confirm/integrity';
import { beneish, type BeneishResult, type BeneishYear, type N } from '../models/beneish';
import { altmanZ, benford, piotroski, sloan, type Get, type PiotroskiResult } from '../models/others';
import { BENCHMARKS, RULES, type Benchmarks, type Leg, type RulesConfig } from '../rules/config';
import lexicon from '../../config/lexicon.json';
import { evaluateRules, makeGet, textRules, type EngineOptions, type RuleResult } from '../rules/engine';
import { honestProfit, type HonestResult } from '../scoring/honest';
import { scoreRules, TIER_LABEL, type LegScore, type Tier } from '../scoring/score';
import { FIELD_IDS, STATEMENT_NAMES, fieldStatement, type Company, type Statement } from '../standardise/schema';
import { FINANCIAL_SECTOR } from '../standardise/standardise';

export interface ModelResult {
  id: 'beneish' | 'sloan' | 'altman' | 'piotroski';
  name: string;
  measures: string;
  value: N;
  display: string;
  /** null = could not be computed. */
  flagged: boolean | null;
  rule: string;
}

export interface CaseFile {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  ruleLibraryVersion: string;
  sample: boolean;
  company: { name: string; ticker: string; sector: string; basis: string; unit: string; sourceFile: string; years: string[]; latestYear: string; accountingNote: string };
  status: 'assessed' | 'partial' | 'not_assessable';
  statusReason: string;
  settings: EngineOptions;
  verdict: {
    tier: Tier;
    label: string;
    score: number | null;
    baseScore: number | null;
    unconfirmed: boolean;
    confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; score: number; reasons: string[] };
    triangle: Record<Leg, LegScore> | null;
    combos: { id: string; text: string; effect: string }[];
    models: ModelResult[];
    modelsFlagging: number;
    modelsComputable: number;
    summary: string;
  };
  beneish: BeneishResult | null;
  piotroski: PiotroskiResult | null;
  benford: { n: number; chi2: N } | null;
  honest: HonestResult | null;
  /** Upbeat management statements quoted against a flagged figure that contradicts them. */
  wordsVsNumbers: { claim: string; page: number; topic: string; rule: string; figure: string; level: string }[];
  /** Pages of annual-report text scanned; null when no text was available (spreadsheet or manual route). */
  textPages: number | null;
  rules: RuleResult[];
  series: { years: string[]; revenue: N[]; netIncome: N[]; cfo: N[] };
  figures: Company['years'];
  dataQuality: {
    integrity: IntegrityReport;
    statements: { statement: Statement; name: string; present: number; total: number; high: number; medium: number; low: number; proxy: number; level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' }[];
    proxies: string[];
    notes: string[];
  };
  benchmarks: { placeholder: boolean; asOf: string | null; source: string };
  nextSteps: string[];
}

export const DEFAULT_OPTIONS: EngineOptions = { proxies: true, strict: false, tata: RULES.beneish.tataMethod };

const MAX_NEXT_STEPS = 6;
const TOP_FLAGS_IN_SUMMARY = 3;
const IND_AS_FIRST_FY = 2017;
const IND_AS_SETTLED_FY = 2018;

const beneishYear = (g: Get, lag: number): BeneishYear => ({
  sales: g('revenue', lag), cogs: g('cogs', lag), receivables: g('receivables', lag), currentAssets: g('currentAssets', lag), ppe: g('ppe', lag),
  totalAssets: g('totalAssets', lag), depreciation: g('depreciation', lag), sga: g('sga', lag), currentLiabilities: g('currentLiabilities', lag),
  longTermDebt: g('longTermDebt', lag), netIncome: g('netIncome', lag), cfo: g('cfo', lag), cash: g('cash', lag),
});

function accountingNote(years: string[]): string {
  const fy = years.map((y) => Number(/\d{4}/.exec(y)?.[0])).filter((n) => Number.isFinite(n));
  const first = fy[0];
  const last = fy[fy.length - 1];
  if (first === undefined || last === undefined) return 'Accounting standard not determined: period labels are not recognisable years.';
  if (last < IND_AS_FIRST_FY) return 'These years pre-date Ind AS (older Indian GAAP). Comparisons with Ind AS-era references are weaker.';
  if (first < IND_AS_SETTLED_FY) return `Ind AS presumed for recent years, but the window (${years[0]} to ${years[years.length - 1]}) spans the Ind AS transition (FY2017-FY2018): year-on-year ratios across the switch are less reliable. Not verified from the file.`;
  return 'Ind AS presumed (mandatory for listed companies from FY2017-FY2018). Not verified from the file.';
}

export const flagged = (r: RuleResult): boolean => r.level === 'red' || r.level === 'amber';
export const byImportance = (a: RuleResult, b: RuleResult): number => b.points - a.points || b.weight - a.weight;

function emptyCase(company: Company, opts: EngineOptions, now: string, cfg: RulesConfig, bench: Benchmarks, integrity: IntegrityReport, reason: string): CaseFile {
  const years = company.years.map((y) => y.label);
  return {
    schemaVersion: 1, id: company.ticker, generatedAt: now, ruleLibraryVersion: cfg.version, sample: Boolean(company.sample),
    company: { name: company.name, ticker: company.ticker, sector: company.sector, basis: company.basis, unit: 'INR crore', sourceFile: company.sourceFile, years, latestYear: years[years.length - 1] ?? 'n/a', accountingNote: accountingNote(years) },
    status: 'not_assessable', statusReason: reason, settings: opts,
    verdict: {
      tier: 'not_assessable', label: TIER_LABEL.not_assessable, score: null, baseScore: null, unconfirmed: false,
      confidence: { level: 'LOW', score: 0, reasons: [reason] }, triangle: null, combos: [], models: [], modelsFlagging: 0, modelsComputable: 0,
      summary: `${company.name}: not assessable with these rules. ${reason}`,
    },
    beneish: null, piotroski: null, benford: null, honest: null, wordsVsNumbers: [], textPages: company.textPages ?? null, rules: [],
    series: { years, revenue: company.years.map((y) => y.figures.revenue?.value ?? null), netIncome: company.years.map((y) => y.figures.netIncome?.value ?? null), cfo: company.years.map((y) => y.figures.cfo?.value ?? null) },
    figures: company.years,
    dataQuality: { integrity, statements: [], proxies: [], notes: [] },
    benchmarks: { placeholder: bench.placeholder, asOf: bench.asOf, source: bench.source },
    nextSteps: [],
  };
}

export function buildCaseFile(company: Company, opts: EngineOptions, now: string, cfg: RulesConfig = RULES, bench: Benchmarks = BENCHMARKS): CaseFile {
  const integrity = checkIntegrity(company);
  if (integrity.blocked) throw new Error('Integrity gate failed: the statements do not add up. Scoring is blocked until the figures are corrected.');
  if (company.sector === FINANCIAL_SECTOR) {
    return emptyCase(company, opts, now, cfg, bench, integrity,
      'Banks, NBFCs and insurers are excluded: the Beneish ratios and most of these checks assume sales, inventory and receivables, which mean something different for a lender or insurer (Beneish himself excluded financial firms).');
  }
  if (company.years.length === 0) return emptyCase(company, opts, now, cfg, bench, integrity, 'No reporting period with figures was found.');

  const g = makeGet(company, opts);
  const nYears = company.years.length;
  const latest = company.years[nYears - 1];
  const ben = nYears >= 2 ? beneish(beneishYear(g, 0), beneishYear(g, 1), cfg.beneish, { strict: opts.strict, tata: opts.tata }) : null;
  const sl = sloan(g);
  const alt = altmanZ(g, cfg.models.altman);
  const pio = nYears >= 2 ? piotroski(g) : null;
  const reported = company.years.flatMap((y) => FIELD_IDS.filter((f) => fieldStatement(f) !== 'notes').map((f) => y.figures[f]).filter((x) => x && !x.proxy && !x.derived).map((x) => x?.value ?? 0));
  const bf = benford(reported, cfg.models.benford.minCount);

  const rules = evaluateRules(company, { MSCORE: ben?.m ?? null, SLOAN: sl, ALTMAN_Z: alt.z, PIOTROSKI_F: pio?.f ?? null, BENFORD_CHI2: bf.chi2 }, ben, cfg, bench, opts);
  rules.push(...textRules(company, cfg.scoring.amberFraction));
  const wordsVsNumbers = (company.textHits ?? []).filter((h) => h.kind === 'claim').flatMap((h) => {
    const claim = lexicon.claims.find((c) => c.id === h.id);
    const rule = rules.find((r) => r.id === claim?.contradictedBy);
    return claim && rule && flagged(rule) ? [{ claim: h.sentence, page: h.page, topic: claim.label, rule: rule.title, figure: rule.display, level: rule.level }] : [];
  });

  const m = cfg.models;
  const models: ModelResult[] = [
    { id: 'beneish', name: 'Beneish M-score', measures: 'earnings manipulation pattern', value: ben?.m ?? null, display: ben?.m == null ? 'n/a' : ben.m.toFixed(2), flagged: ben?.m == null ? null : ben.m >= cfg.beneish.thresholds.flag, rule: `flags at or above ${cfg.beneish.thresholds.flag}` },
    { id: 'sloan', name: 'Sloan accruals', measures: 'profit not backed by cash', value: sl, display: sl === null ? 'n/a' : `${(sl * 100).toFixed(1)}%`, flagged: sl === null ? null : sl > m.sloan.flagAbove, rule: `flags above ${(m.sloan.flagAbove * 100).toFixed(0)}% of average assets` },
    { id: 'altman', name: "Altman Z''", measures: 'financial distress', value: alt.z, display: alt.z === null ? 'n/a' : alt.z.toFixed(2), flagged: alt.z === null ? null : alt.z < m.altman.distressBelow, rule: `flags below ${m.altman.distressBelow}` },
    { id: 'piotroski', name: 'Piotroski F-score', measures: 'weak fundamentals', value: pio?.f ?? null, display: pio?.f == null ? 'n/a' : `${pio.f} / 9`, flagged: pio?.f == null ? null : pio.f <= m.piotroski.weakAtOrBelow, rule: `flags at ${m.piotroski.weakAtOrBelow} or below` },
  ];
  const modelsFlagging = models.filter((x) => x.flagged === true).length;
  const modelsComputable = models.filter((x) => x.flagged !== null).length;
  const sc = scoreRules(rules, modelsFlagging, cfg);

  // Data quality -> confidence.
  const statements = (Object.keys(STATEMENT_NAMES) as Statement[]).map((statement) => {
    const ids = FIELD_IDS.filter((f) => fieldStatement(f) === statement);
    const figs = ids.map((f) => latest?.figures[f]).filter((x) => x !== undefined);
    const count = (c: string): number => figs.filter((x) => !x.proxy && x.confidence === c).length;
    const proxy = figs.filter((x) => x.proxy).length;
    const [high, medium, low] = [count('high'), count('medium'), count('low')];
    const level = figs.length === 0 ? 'NONE' : low + proxy > 0 ? 'LOW' : medium > 0 ? 'MEDIUM' : 'HIGH';
    return { statement, name: STATEMENT_NAMES[statement], present: figs.length, total: ids.length, high, medium, low, proxy, level } as const;
  });
  const proxies = [...new Set(company.years.flatMap((y) => Object.values(y.figures).map((f) => f.proxy).filter((p): p is string => Boolean(p))))];
  const proxiesInUse = opts.proxies && rules.some((r) => r.usesProxy);
  const lowFigs = rules.some((r) => r.inputs.some((i) => i.confidence === 'low' && !i.proxy));
  const c = cfg.scoring.confidence;
  const pen = (k: string): number => c[k] ?? 0;
  const reasons: string[] = [];
  let conf = pen('start');
  const deduct = (key: string, why: string): void => {
    conf -= pen(key);
    reasons.push(`-${pen(key)}: ${why}`);
  };
  if (nYears === 1) deduct('singleYear', 'only one year of data, so no year-on-year check (including Beneish) can run.');
  else if (nYears === 2) deduct('twoYears', 'only two years of data; multi-year checks cannot run.');
  if (nYears >= 2 && ben?.m == null) deduct('mScoreMissing', 'the Beneish M-score could not be computed because at least one of its eight ratios is missing.');
  if (proxiesInUse) deduct('proxiesUsed', 'some checks rely on PROXY figures because the source does not report the exact line.');
  if (lowFigs) deduct('lowConfidenceFigures', 'some inputs were extracted with low confidence.');
  if (integrity.warnings > 0) deduct('integrityWarnings', `${integrity.warnings} integrity warning(s): statements do not fully reconcile.`);
  if (sc.coverage < pen('lowCoverageBelow')) deduct('lowCoverage', `only ${(sc.coverage * 100).toFixed(0)}% of the rule library (by weight) could be assessed.`);
  if (sc.triangle.opportunity.score === null) deduct('opportunityNotAssessed', 'the Opportunity leg (governance, related parties, pledging) could not be assessed from this input.');
  if (bench.placeholder && rules.some((r) => r.benchmark && r.level !== 'missing')) deduct('placeholderBenchmark', 'sector comparisons use a placeholder benchmark, not measured data.');
  conf = Math.max(0, conf);
  const level = conf >= pen('highFrom') ? 'HIGH' : conf >= pen('mediumFrom') ? 'MEDIUM' : 'LOW';
  if (reasons.length === 0) reasons.push('Three or more years, no proxies, statements reconcile.');

  const partial = nYears < 2 || ben?.m == null;
  const top = rules.filter(flagged).sort(byImportance);
  const names = top.slice(0, TOP_FLAGS_IN_SUMMARY).map((r) => r.title.toLowerCase()).join('; ');
  const nScored = rules.filter((r) => r.weight > 0 && (flagged(r) || r.level === 'green')).length;
  const year = latest?.label ?? 'n/a';
  const summary =
    sc.tier === 'not_assessable' ? `${company.name}: too little data to score ${year}.`
    : sc.tier === 'clean' ? `${company.name}: no strong pattern found in ${year}. ${top.length} of ${nScored} assessed checks are at amber or red. A clean screen is not a guarantee.`
    : sc.tier === 'watch' ? `${company.name}: some patterns worth checking in ${year}: ${names}. Each has ordinary explanations, listed beside it.`
    : `${company.name}: several patterns that historically appeared before restatements are present together in ${year}: ${names}. This is a reason to look closer, not a conclusion.`;

  const nextSteps = [...new Set(top.map((r) => r.nextStep).filter(Boolean))].slice(0, MAX_NEXT_STEPS);
  if (proxiesInUse) nextSteps.push('Replace PROXY figures with the exact lines from the annual report (current assets, current liabilities, long-term debt) and re-run.');
  if (sc.triangle.opportunity.score === null) nextSteps.push('Load the annual report PDF (its text is scanned for auditor and governance language) or add governance facts on the confirm screen, so the Opportunity leg can be scored.');

  const notes = [
    'Restatements cannot be detected from this source: each year is as the data provider currently reports it, which may already include restated comparatives (a look-ahead risk).',
    ...(company.basis === 'unknown' ? ['Consolidated vs standalone was not stated by the source. Confirm which one this file contains.'] : []),
    ...(partial ? [nYears < 2 ? 'Partial result: with one year of data only single-year checks ran.' : 'Partial result: the Beneish M-score could not be computed because at least one ratio is missing.'] : []),
  ];

  const years = company.years.map((y) => y.label);
  return {
    schemaVersion: 1, id: company.ticker, generatedAt: now, ruleLibraryVersion: cfg.version, sample: Boolean(company.sample),
    company: { name: company.name, ticker: company.ticker, sector: company.sector, basis: company.basis, unit: 'INR crore', sourceFile: company.sourceFile, years, latestYear: year, accountingNote: accountingNote(years) },
    status: sc.tier === 'not_assessable' ? 'not_assessable' : partial ? 'partial' : 'assessed',
    statusReason: partial ? (notes[notes.length - 1] ?? '') : '',
    settings: opts,
    verdict: {
      tier: sc.tier, label: TIER_LABEL[sc.tier], score: sc.score, baseScore: sc.baseScore, unconfirmed: sc.tier === 'suspicious' && level === 'LOW',
      confidence: { level, score: conf, reasons }, triangle: sc.triangle, combos: sc.combos, models, modelsFlagging, modelsComputable, summary,
    },
    beneish: ben, piotroski: pio, benford: { n: bf.n, chi2: bf.chi2 }, honest: honestProfit(g, opts.honest ?? cfg.honestProfit), wordsVsNumbers, textPages: company.textPages ?? null, rules,
    series: { years, revenue: years.map((_, i) => makeGet(company, opts, i)('revenue')), netIncome: years.map((_, i) => makeGet(company, opts, i)('netIncome')), cfo: years.map((_, i) => makeGet(company, opts, i)('cfo')) },
    figures: company.years,
    dataQuality: { integrity, statements, proxies, notes },
    benchmarks: { placeholder: bench.placeholder, asOf: bench.asOf, source: bench.source },
    nextSteps,
  };
}
