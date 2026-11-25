/** Deterministic parser: a sheet (grid of cells) -> labelled rows with one value per reporting period. */

export type Cell = string | number | Date | null | undefined;
export type Grid = Cell[][];
export type Section = 'pl' | 'bs' | 'cf' | 'any';

export interface SourceRow {
  /** 0-based row in the source sheet. */
  index: number;
  section: Section;
  label: string;
  /** Aligned with SourceTable.periods. */
  values: (number | null)[];
}

export interface SourceTable {
  fileName: string;
  sheetName: string;
  layout: 'screener' | 'generic';
  company: string | null;
  periods: string[];
  rows: SourceRow[];
  notes: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const MIN_EXCEL_SERIAL = 30_000;
const MAX_EXCEL_SERIAL = 80_000;

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);
const okYear = (y: number): boolean => y >= MIN_YEAR && y <= MAX_YEAR;

/** A period header -> { label "FY2024", key for sorting }. null when the cell is not a period. */
export function parsePeriod(cell: Cell): { label: string; key: number } | null {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    // Spreadsheet dates land near midnight; a 12h nudge avoids timezone roll-back to the previous day.
    const d = new Date(cell.getTime() + MS_PER_DAY / 2);
    const y = d.getUTCFullYear();
    return okYear(y) ? { label: `FY${y}`, key: y * 12 + d.getUTCMonth() } : null;
  }
  if (typeof cell === 'number') {
    if (Number.isInteger(cell) && okYear(cell)) return { label: `FY${cell}`, key: cell * 12 + 2 };
    if (cell > MIN_EXCEL_SERIAL && cell < MAX_EXCEL_SERIAL) return parsePeriod(new Date(EXCEL_EPOCH_MS + cell * MS_PER_DAY));
    return null;
  }
  if (typeof cell !== 'string') return null;
  const s = cell.trim().toLowerCase();
  let m = /^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/.exec(s); // 2020-21
  if (m?.[1] && m[2]) {
    const y = m[2].length === 2 ? Math.floor(Number(m[1]) / 100) * 100 + Number(m[2]) : Number(m[2]);
    return okYear(y) ? { label: `FY${y}`, key: y * 12 + 2 } : null;
  }
  m = /^([a-z]{3})[a-z]*[\s\-']+(\d{2}|\d{4})$/.exec(s); // Mar-21, March 2021
  if (m?.[1] && m[2]) {
    const mon = MONTHS.indexOf(m[1]);
    const y = fullYear(Number(m[2]));
    return mon >= 0 && okYear(y) ? { label: `FY${y}`, key: y * 12 + mon } : null;
  }
  m = /^(?:fy|cy)?\s*'?(\d{2}|\d{4})$/.exec(s); // FY21, 2021
  if (m?.[1]) {
    const y = fullYear(Number(m[1]));
    return okYear(y) ? { label: `FY${y}`, key: y * 12 + 2 } : null;
  }
  return null;
}

/** Numbers only. Blank, dashes and text are missing (null), never zero. "(1,234.5)" is negative. */
export function parseNumber(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const s = cell.trim().replace(/[,₹\s]/g, '');
  const m = /^(\()?(-?\d*\.?\d+)\)?%?$/.exec(s);
  if (!m?.[2]) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? (m[1] ? -n : n) : null;
}

const text = (c: Cell): string => (typeof c === 'string' ? c.trim() : '');

const SCREENER_SECTIONS: ReadonlyArray<readonly [RegExp, Section | 'skip']> = [
  [/^profit\s*&\s*loss/i, 'pl'],
  [/^balance sheet/i, 'bs'],
  [/^cash flow/i, 'cf'],
  [/^(quarters|price|derived|meta)\b/i, 'skip'],
];

export function parseGrid(grid: Grid, fileName: string, sheetName: string): SourceTable {
  const isScreener = grid.some((r) => /^profit\s*&\s*loss/i.test(text(r[0])));
  const notes: string[] = [];
  // period label -> { key, values per row }
  const periods = new Map<string, number>();
  const raw: { index: number; section: Section; label: string; cells: Map<string, number | null> }[] = [];
  let company: string | null = null;
  let section: Section | 'skip' = isScreener ? 'skip' : 'any';
  let cols: (string | null)[] | null = null;

  const readHeader = (row: Cell[]): (string | null)[] | null => {
    const parsed = row.map((c, i) => (i === 0 ? null : parsePeriod(c)));
    const found = parsed.filter((p) => p !== null);
    if (found.length < (isScreener ? 1 : 2)) return null;
    for (const p of found) periods.set(p.label, p.key);
    return parsed.map((p) => p?.label ?? null);
  };

  grid.forEach((row, index) => {
    const label = text(row[0]);
    if (/^company name$/i.test(label)) company = text(row[1]) || null;
    if (isScreener) {
      const hit = SCREENER_SECTIONS.find(([re]) => re.test(label));
      if (hit) {
        section = hit[1];
        cols = null;
        return;
      }
      if (section === 'skip') return;
      if (/^report date$/i.test(label)) {
        cols = readHeader(row);
        return;
      }
    } else if (!cols) {
      cols = readHeader(row);
      if (!company && !cols && label && row.slice(1).every((c) => c === null || c === undefined || c === '')) company = label;
      return;
    }
    if (!cols || !label) return;
    const cells = new Map<string, number | null>();
    cols.forEach((p, i) => {
      if (p) cells.set(p, parseNumber(row[i]));
    });
    if ([...cells.values()].some((v) => v !== null)) raw.push({ index, section: section === 'skip' ? 'any' : section, label, cells });
  });

  // Keep only periods that carry at least one number, oldest first.
  const used = [...periods.entries()]
    .filter(([p]) => raw.some((r) => r.cells.get(p) !== null && r.cells.get(p) !== undefined))
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);
  if (used.length === 0) notes.push('No reporting periods with figures were found. Expected a header row of years or a Screener "Data Sheet".');
  if (isScreener) notes.push('Screener.in layout detected: figures are taken as INR crore unless you change the unit.');

  return {
    fileName,
    sheetName,
    layout: isScreener ? 'screener' : 'generic',
    company,
    periods: used,
    rows: raw.map((r) => ({ index: r.index, section: r.section, label: r.label, values: used.map((p) => r.cells.get(p) ?? null) })),
    notes,
  };
}
