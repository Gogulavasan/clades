/** Optional price history for the price/volume panel: a CSV with date, close and (optionally) volume columns. */

export interface PricePoint {
  /** ISO date, YYYY-MM-DD. */
  d: string;
  c: number;
  v: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number): string => String(n).padStart(2, '0');

/** Accepts 2024-03-28, 28-03-2024, 28/03/2024 and 28-Mar-2024 (day first, as Indian exchanges print it). */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})/.exec(t))) [d, mo, y] = [Number(m[1]), MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1, Number(m[3])];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const splitCsv = (line: string): string[] => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
const num = (s: string | undefined): number | null => {
  const n = Number((s ?? '').replace(/[,₹\s]/g, ''));
  return s !== undefined && s.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Parses, sorts by date and thins to at most `maxPoints` rows. Rows without a valid date and close are dropped. */
export function parsePriceCsv(text: string, maxPoints = 400): PricePoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = splitCsv(lines[0] ?? '').map((h) => h.toLowerCase());
  const find = (...names: string[]): number => head.findIndex((h) => names.some((n) => h.includes(n)));
  const hasHeader = find('date') >= 0;
  const [di, ci, vi] = hasHeader ? [find('date'), find('close', 'price'), find('volume', 'qty', 'quantity')] : [0, 1, 2];
  const points: PricePoint[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = splitCsv(line);
    const d = parseDate(cells[di] ?? '');
    const c = num(cells[ci]);
    if (d && c !== null && c > 0) points.push({ d, c, v: vi >= 0 ? num(cells[vi]) : null });
  }
  points.sort((a, b) => a.d.localeCompare(b.d));
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * step)]).filter((p): p is PricePoint => p !== undefined);
}
