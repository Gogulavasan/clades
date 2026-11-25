/** Column mapping + unit normalisation: SourceTable -> Company in the fixed schema. Nothing is inferred. */
import mappingConfig from '../../config/mapping.json';
import type { SourceTable } from '../ingest/grid';
import { fieldStatement, isFieldId, isPctField, type Basis, type Company, type Confidence, type FieldId, type Figure, type YearData } from './schema';

export interface MapEntry {
  field: FieldId;
  sign: 1 | -1;
  confidence: Confidence;
  /** true when the user, not the alias table, chose this mapping. */
  manual?: boolean;
}
/** Source row index -> mapping (null/absent = ignored). */
export type Mapping = Record<number, MapEntry | null>;

export type UnitId = keyof typeof mappingConfig.units;
export const UNIT_IDS = Object.keys(mappingConfig.units) as UnitId[];
export const SECTORS: readonly string[] = mappingConfig.sectors;
export const FINANCIAL_SECTOR: string = mappingConfig.financialSector;
export const DEFAULT_SECTOR = 'Other / unclassified';

export interface Meta {
  name: string;
  ticker: string;
  sector: string;
  basis: Basis;
  unit: UnitId;
}

const ALIASES = mappingConfig.aliases.map((a) => ({
  re: new RegExp(a.pattern, 'i'),
  field: a.field,
  sign: ('sign' in a && a.sign === -1 ? -1 : 1) as 1 | -1,
  confidence: ('confidence' in a ? a.confidence : 'high') as Confidence,
}));

export function autoMap(table: SourceTable): Mapping {
  const mapping: Mapping = {};
  let bsTotals = 0;
  for (const row of table.rows) {
    const label = row.label.trim();
    // Screener prints "Total" twice in the balance sheet: liabilities side first, then assets side.
    if (table.layout === 'screener' && row.section === 'bs' && /^total$/i.test(label)) {
      mapping[row.index] = { field: bsTotals++ === 0 ? 'totalLiabilitiesEquity' : 'totalAssets', sign: 1, confidence: 'high' };
      continue;
    }
    // PDF rows carry their balance-sheet section as a prefix ("Current liabilities: Borrowings"); try the full label first.
    const bare = label.replace(/^[^:]+:\s*/, '');
    const hit = ALIASES.find((a) => a.re.test(label)) ?? ALIASES.find((a) => a.re.test(bare));
    // A line belongs to its own statement: "Profit before tax" repeated at the top of a cash flow statement must not be added to the P&L figure.
    const fits = hit && isFieldId(hit.field) && (row.section === 'any' || fieldStatement(hit.field) === row.section || fieldStatement(hit.field) === 'notes' || (hit.field === 'dividends' && row.section === 'cf'));
    mapping[row.index] = hit && fits && isFieldId(hit.field) ? { field: hit.field, sign: hit.sign, confidence: hit.confidence } : null;
  }
  return mapping;
}

export const looksFinancial = (name: string): boolean => new RegExp(mappingConfig.financialNamePattern, 'i').test(name);

export function defaultMeta(table: SourceTable): Meta {
  const name = table.company ?? table.fileName.replace(/\.[^.]+$/, '');
  return {
    name,
    ticker: makeTicker(name),
    sector: looksFinancial(name) ? FINANCIAL_SECTOR : DEFAULT_SECTOR,
    basis: /consolidated/i.test(table.fileName) ? 'consolidated' : /standalone/i.test(table.fileName) ? 'standalone' : 'unknown',
    unit: 'crore',
  };
}

const TICKER_MAX = 12;
export const makeTicker = (name: string): string =>
  name
    .toUpperCase()
    .replace(/\b(LIMITED|LTD|PVT|PRIVATE|INDIA|THE)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TICKER_MAX) || 'UNNAMED';

const WORST: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
const worse = (a: Confidence, b: Confidence): Confidence => (WORST[a] <= WORST[b] ? a : b);

export const editKey = (period: string, field: FieldId): string => `${period}|${field}`;

/**
 * Builds the standardised company. Rows mapped to the same field are added (with sign). If any component
 * of a field is blank for a year, that field is MISSING for that year rather than partly summed.
 */
export function standardise(table: SourceTable, mapping: Mapping, meta: Meta, edits: Record<string, number | null> = {}): Company {
  const scale = mappingConfig.units[meta.unit];
  const years = table.periods.map((label, p) => {
    const figures: YearData = {};
    const broken = new Set<FieldId>();
    for (const row of table.rows) {
      const m = mapping[row.index];
      if (!m) continue;
      const v = row.values[p] ?? null;
      if (v === null) {
        broken.add(m.field);
        continue;
      }
      const value = m.sign * v * (isPctField(m.field) ? 1 : scale);
      const where = row.page ? `page ${row.page}` : `row ${row.index + 1}`;
      const src = row.page ? `${table.fileName} › ${where} "${row.label}"` : `${table.fileName} › ${table.sheetName} › ${where} "${row.label}"`;
      const prev = figures[m.field];
      const conf: Confidence = m.manual ? 'medium' : worse(m.confidence, row.confidence ?? 'high');
      figures[m.field] = prev
        ? { value: prev.value + value, confidence: worse(prev.confidence, conf), source: `${prev.source}; ${m.sign < 0 ? 'minus ' : ''}${where} "${row.label}"` }
        : { value, confidence: conf, source: src };
    }
    for (const f of broken) Reflect.deleteProperty(figures, f);

    // Plain arithmetic on reported lines (not an estimate).
    const sc = figures.shareCapital;
    const rs = figures.reserves;
    if (!figures.equity && sc && rs) {
      figures.equity = { value: sc.value + rs.value, confidence: worse(sc.confidence, rs.confidence), source: 'Share capital + Reserves', derived: 'Share capital + Reserves' };
    }
    const lt = figures.longTermDebt;
    const st = figures.shortTermDebt;
    if (!figures.borrowings && lt && st) {
      figures.borrowings = { value: lt.value + st.value, confidence: worse(lt.confidence, st.confidence), source: 'Long-term + short-term borrowings', derived: 'Long-term + short-term borrowings' };
    }
    // Labelled stand-ins for lines the source does not report. The engine can be told to ignore them.
    for (const px of mappingConfig.proxies) {
      if (!isFieldId(px.field) || !isFieldId(px.from)) continue;
      const from = figures[px.from];
      if (!figures[px.field] && from) figures[px.field] = { value: from.value, confidence: 'low', source: from.source, proxy: px.note };
    }
    // User corrections always win.
    for (const [key, v] of Object.entries(edits)) {
      const [period, field] = key.split('|');
      if (period !== label || !field || !isFieldId(field)) continue;
      if (v === null) Reflect.deleteProperty(figures, field);
      else figures[field] = { value: v, confidence: 'high', source: 'Entered by user on the confirm screen', edited: true } satisfies Figure;
    }
    return { label, figures };
  });
  return { name: meta.name.trim() || 'Unnamed company', ticker: meta.ticker.trim().toUpperCase() || 'UNNAMED', sector: meta.sector, basis: meta.basis, sourceFile: table.fileName, years };
}
