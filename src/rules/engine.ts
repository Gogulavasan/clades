/** Evaluates every enabled rule in the JSON library against one company-year. */
import lexicon from '../../config/lexicon.json';
import { BENEISH_RATIOS, type BeneishRatio, type BeneishResult, type N, type TataMethod } from '../models/beneish';
import type { Get } from '../models/others';
import type { HonestParams } from '../scoring/honest';
import { fieldLabel, isFieldId, type Company, type Confidence } from '../standardise/schema';
import type { Benchmarks, Direction, Format, Leg, RulesConfig } from './config';
import { evaluate, type Env } from './formula';

export type Level = 'green' | 'amber' | 'red' | 'info' | 'missing' | 'na';

export interface EngineOptions {
  /** Use figures labelled PROXY. When false they are treated as missing. */
  proxies: boolean;
  /** Beneish strict mode: every traffic-lighted ratio must be green. */
  strict: boolean;
  tata: TataMethod;
  /** Honest-profit assumptions changed by the user; absent = config defaults. */
  honest?: HonestParams;
}

export interface RuleInput {
  field: string;
  label: string;
  year: string;
  value: number;
  source: string;
  confidence: Confidence;
  proxy: boolean;
}

export interface RuleResult {
  id: string;
  battery: string;
  title: string;
  leg: Leg;
  severity: string;
  level: Level;
  value: N;
  display: string;
  direction: Direction;
  amber: number;
  red: number;
  format: Format;
  weight: number;
  points: number;
  formula: string;
  inputs: RuleInput[];
  benchmark: { key: string; value: N; placeholder: boolean } | null;
  plain: string;
  innocent: string;
  nextStep: string;
  missing: string[];
  usesProxy: boolean;
  /** Text rules: the sentences that matched, each with its page. */
  quotes?: { sentence: string; page: number }[];
}

export function fmt(v: N, f: Format): string {
  if (v === null) return 'n/a';
  switch (f) {
    case 'pct': return `${(v * 100).toFixed(1)}%`;
    case 'ppt': return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
    case 'x': return `${v.toFixed(2)}x`;
    case 'days': return `${v >= 0 ? '+' : ''}${v.toFixed(0)} days`;
    case 'int': return v.toFixed(0);
    case 'pctpoints': return `${v.toFixed(1)}%`;
    default: return v.toFixed(2);
  }
}

/** Field reader for year `index`, honouring the proxy switch. */
export function makeGet(company: Company, opts: Pick<EngineOptions, 'proxies'>, index = company.years.length - 1): Get {
  return (field, lag = 0) => {
    if (!isFieldId(field)) return null;
    const fig = company.years[index - lag]?.figures[field];
    if (!fig || (fig.proxy && !opts.proxies)) return null;
    return fig.value;
  };
}

export function levelFor(v: number, direction: Direction, amber: number, red: number): Level {
  if (direction === 'higher') return v >= red ? 'red' : v >= amber ? 'amber' : 'green';
  return v <= red ? 'red' : v <= amber ? 'amber' : 'green';
}

const pointsFor = (level: Level, weight: number, amberFraction: number): number => (level === 'red' ? weight : level === 'amber' ? weight * amberFraction : 0);

/** Schema fields each Beneish ratio reads (current and prior year), for the evidence trail. */
const RATIO_FIELDS: Record<BeneishRatio, readonly string[]> = {
  DSRI: ['receivables', 'revenue'],
  GMI: ['revenue', 'cogs'],
  AQI: ['currentAssets', 'ppe', 'totalAssets'],
  SGI: ['revenue'],
  DEPI: ['depreciation', 'ppe'],
  SGAI: ['sga', 'revenue'],
  TATA: ['netIncome', 'cfo', 'totalAssets'],
  LVGI: ['currentLiabilities', 'longTermDebt', 'totalAssets'],
};

export function evaluateRules(
  company: Company,
  variables: Record<string, N>,
  beneish: BeneishResult | null,
  cfg: RulesConfig,
  bench: Benchmarks,
  opts: EngineOptions,
): RuleResult[] {
  const idx = company.years.length - 1;
  const get = makeGet(company, opts);
  const env: Env = {
    field: (name, lag) => (isFieldId(name) ? get(name, lag) : undefined),
    variable: (name) => (Object.hasOwn(variables, name) ? (variables[name] ?? null) : undefined),
    bench: (key) => bench.sectors[company.sector]?.[key] ?? bench.default[key] ?? null,
  };
  const input = (name: string, lag: number): RuleInput | null => {
    if (!isFieldId(name)) return null;
    const year = company.years[idx - lag];
    const fig = year?.figures[name];
    if (!year || !fig || (fig.proxy && !opts.proxies)) return null;
    return { field: name, label: fieldLabel(name), year: year.label, value: fig.value, source: fig.source, confidence: fig.confidence, proxy: Boolean(fig.proxy) };
  };
  const af = cfg.scoring.amberFraction;
  const out: RuleResult[] = [];

  for (const def of cfg.rules) {
    if (def.enabled === false) continue;
    let value: N = null;
    let missing: string[] = [];
    let inputs: RuleInput[] = [];
    let benchmark: RuleResult['benchmark'] = null;
    let level: Level = 'missing';
    try {
      const r = evaluate(def.formula, env);
      value = r.value;
      missing = r.trace.missing;
      inputs = r.trace.inputs.map((i) => input(i.name, i.lag)).filter((i): i is RuleInput => i !== null);
      const b = r.trace.bench[0] ?? (def.benchmark ? { key: def.benchmark, value: env.bench(def.benchmark) } : undefined);
      if (b) benchmark = { key: b.key, value: b.value, placeholder: bench.placeholder };
      level = value !== null ? levelFor(value, def.direction, def.amber, def.red) : r.trace.notApplicable ? 'na' : 'missing';
      // A rule with zero weight is informational: it is shown but never traffic-lighted or scored.
      if (def.weight === 0 && value !== null) level = 'info';
    } catch (e) {
      missing = [`Rule could not be evaluated: ${e instanceof Error ? e.message : String(e)}`];
    }
    out.push({
      id: def.id, battery: def.battery, title: def.title, leg: def.leg, severity: def.severity, level, value, display: fmt(value, def.format),
      direction: def.direction, amber: def.amber, red: def.red, format: def.format, weight: def.weight, points: pointsFor(level, def.weight, af),
      formula: def.formula, inputs, benchmark, plain: def.plain, innocent: def.innocent, nextStep: def.nextStep, missing,
      usesProxy: inputs.some((i) => i.proxy),
    });
  }

  if (beneish) {
    for (const k of BENEISH_RATIOS) {
      const ref = cfg.beneish.ratios[k];
      const value = beneish.ratios[k];
      const level: Level = beneish.lights[k];
      const inputs = RATIO_FIELDS[k].flatMap((f) => [input(f, 0), input(f, 1)]).filter((i): i is RuleInput => i !== null);
      out.push({
        id: `BEN_${k}`, battery: 'Beneish', title: `${k} · ${ref.name}`, leg: ref.leg, severity: 'medium', level, value,
        display: value === null ? 'n/a' : value.toFixed(3), direction: 'higher', amber: ref.nonManipulator, red: ref.manipulator, format: 'num',
        weight: level === 'info' ? 0 : cfg.beneish.ratioWeight, points: pointsFor(level, cfg.beneish.ratioWeight, af), formula: ref.formula, inputs,
        benchmark: null, plain: ref.plain, innocent: ref.innocent, nextStep: ref.nextStep,
        missing: value === null ? ['one or more inputs missing or not meaningful (zero or negative base)'] : [],
        usesProxy: inputs.some((i) => i.proxy),
      });
    }
  }
  return out;
}

/**
 * Battery F (governance and text). One rule per lexicon entry. Without report text every rule is NO DATA;
 * with text, a rule flags when at least one sentence matched and carries those sentences as quotes.
 */
export function textRules(company: Company, amberFraction: number): RuleResult[] {
  const read = company.textPages !== undefined;
  return lexicon.flags.map((f) => {
    const hits = (company.textHits ?? []).filter((h) => h.kind === 'flag' && h.id === f.id);
    const level: Level = !read ? 'missing' : f.weight === 0 ? 'info' : hits.length === 0 ? 'green' : f.level === 'red' ? 'red' : 'amber';
    return {
      id: f.id, battery: 'F Governance & text', title: f.title, leg: 'opportunity', severity: f.level === 'red' ? 'high' : 'medium', level,
      value: read ? hits.length : null, display: !read ? 'n/a' : hits.length ? `${hits.length} quote(s)` : 'no match',
      direction: 'higher', amber: 1, red: 1, format: 'int', weight: f.weight, points: pointsFor(level, f.weight, amberFraction),
      formula: `report text matches /${f.pattern}/i`, inputs: [], benchmark: null, plain: f.plain, innocent: f.innocent, nextStep: f.nextStep,
      missing: read ? [] : ['needs the annual report text (PDF route)'], usesProxy: false,
      quotes: hits.map((h) => ({ sentence: h.sentence, page: h.page })),
    };
  });
}
