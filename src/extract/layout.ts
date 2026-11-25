/**
 * Page layout: positioned text items -> lines. Pure, so it is unit-tested without pdf.js.
 *
 * Three views of a page are produced because real annual reports need all three:
 *   lines   every item on the same baseline joined left to right (right for a full-width table)
 *   halves  the same, separately for the left and right half of a LANDSCAPE page. Many reports are
 *           exported as two-page spreads, with the balance sheet on the left and the P&L on the right.
 *   text    reading order for prose: the page is cut at empty vertical gutters and read column by column,
 *           so a quoted sentence is not stitched together from two different columns.
 */

export interface TextItem {
  str: string;
  /** Left edge and baseline, in points from the page's bottom-left corner. */
  x: number;
  y: number;
  /** Width in points. */
  w: number;
}

export interface PdfPage {
  page: number;
  lines: string[];
  halves?: [string[], string[]];
  text?: string[];
}

const SAME_LINE_TOLERANCE = 2.5;
const LANDSCAPE_RATIO = 1.15;
const BIN = 3;
const MIN_GUTTER = 8;
const GUTTER_ZONE: readonly [number, number] = [0.12, 0.88];
/** A gutter may be crossed by a few full-width headings and still count as a gutter. */
const GUTTER_MAX_CROSSING = 0.04;
const MIN_ROWS_FOR_COLUMNS = 12;

function rows(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last?.[0] && Math.abs(last[0].y - it.y) <= SAME_LINE_TOLERANCE) last.push(it);
    else out.push([it]);
  }
  return out;
}

/**
 * Some fonts export a drop capital as its own glyph run, giving "t otal Assets" or "F inancial S tatements".
 * A lone letter followed by a lower-case word is rejoined. "a", "A" and "I" are real words and are left alone.
 */
export const repairSplitWords = (line: string): string => line.replace(/(^|[\s(])([b-hj-zB-HJ-Z]) (?=[a-z]{2})/g, '$1$2');

const toLines = (items: TextItem[]): string[] =>
  rows(items).map((r) =>
    repairSplitWords(
      r
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(' '),
    ),
  );

/** x positions of empty vertical gutters that separate text columns. */
export function findGutters(items: TextItem[], width: number): number[] {
  const lineRows = rows(items);
  if (lineRows.length < MIN_ROWS_FOR_COLUMNS || width <= 0) return [];
  const bins = Math.ceil(width / BIN);
  const cover = new Array<number>(bins).fill(0);
  for (const r of lineRows) {
    const seen = new Set<number>();
    for (const it of r) for (let b = Math.max(0, Math.floor(it.x / BIN)); b <= Math.min(bins - 1, Math.floor((it.x + it.w) / BIN)); b++) seen.add(b);
    for (const b of seen) cover[b] = (cover[b] ?? 0) + 1;
  }
  const limit = Math.max(1, GUTTER_MAX_CROSSING * lineRows.length);
  const gutters: number[] = [];
  let start = -1;
  for (let b = 0; b <= bins; b++) {
    const empty = b < bins && (cover[b] ?? 0) <= limit;
    if (empty && start < 0) start = b;
    if (!empty && start >= 0) {
      const [lo, hi] = [start * BIN, b * BIN];
      const mid = (lo + hi) / 2;
      // A gutter has text on both sides; the blank area beside a ragged right margin does not.
      const textLeft = cover.slice(0, start).some((c) => c > limit);
      const textRight = cover.slice(b).some((c) => c > limit);
      if (hi - lo >= MIN_GUTTER && mid > GUTTER_ZONE[0] * width && mid < GUTTER_ZONE[1] * width && textLeft && textRight) gutters.push(mid);
      start = -1;
    }
  }
  return gutters;
}

export function buildPage(page: number, items: TextItem[], width: number, height: number): PdfPage {
  const out: PdfPage = { page, lines: toLines(items) };
  if (width > height * LANDSCAPE_RATIO) {
    const mid = width / 2;
    out.halves = [toLines(items.filter((i) => i.x < mid)), toLines(items.filter((i) => i.x >= mid))];
  }
  const cuts = [0, ...findGutters(items, width), Infinity];
  if (cuts.length > 2) out.text = cuts.slice(0, -1).flatMap((lo, i) => toLines(items.filter((it) => it.x >= lo && it.x < (cuts[i + 1] ?? Infinity))));
  return out;
}
