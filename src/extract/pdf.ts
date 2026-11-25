/**
 * Rule-based extraction from annual-report text. Pure functions over page text (one string per line),
 * so everything here is unit-tested without a PDF. No figure is inferred: a line is used only when it
 * shows a label followed by at least two numbers (current year, prior year).
 */
import lexicon from '../../config/lexicon.json';
import { parseNumber, parsePeriod, type SourceRow, type SourceTable } from '../ingest/grid';
import type { Basis, TextHit } from '../standardise/schema';
import type { UnitId } from '../standardise/standardise';
import type { PdfPage } from './layout';

export type { PdfPage } from './layout';

export type StatementKind = 'bs' | 'pl' | 'cf';

export interface PdfExtraction {
  table: SourceTable;
  textHits: TextHit[];
  pages: number;
  /** true when the PDF has almost no text layer (scanned images): nothing can be read. */
  scanned: boolean;
  found: Record<StatementKind, number | null>;
  basis: Basis;
  unit: UnitId | null;
  notes: string[];
}

const MIN_CHARS_PER_PAGE = 40;
const HEADING_LINES = 10;
const MIN_TABLE_LINES = 6;
const MAX_SENTENCE = 320;

const STATEMENTS: Record<StatementKind, { name: string; heading: RegExp; must: RegExp[]; end: RegExp }> = {
  bs: { name: 'Balance sheet', heading: /balance sheet/i, must: [/total assets/i, /equity/i], end: /total equity and liabilities|total liabilities and equity/i },
  pl: { name: 'Statement of profit and loss', heading: /statement of profit (and|&) loss|profit (and|&) loss (account|statement)/i, must: [/revenue from operations/i], end: /earnings per (equity )?share/i },
  cf: { name: 'Cash flow statement', heading: /statement of cash flows?|cash flows? statement/i, must: [/operating activities/i], end: /cash and cash equivalents at (the )?end/i },
};

const BS_SECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^non[- ]current assets\b/i, 'Non-current assets'],
  [/^current assets\b/i, 'Current assets'],
  [/^equity( and liabilities)?$/i, 'Equity'],
  [/^non[- ]current liabilities\b/i, 'Non-current liabilities'],
  [/^current liabilities\b/i, 'Current liabilities'],
];

const SUBTOTAL_SECTIONS = new Set(['Non-current assets', 'Current assets', 'Non-current liabilities', 'Current liabilities']);
const NUMERIC = /^\(?-?(\d[\d,]*\.?\d*|\.\d+)\)?$/;
const MAX_MARGIN_WORDS = 3;
const NIL = /^[-–—]$/;
const ROMAN = /^[IVX]{1,4}\s+(?=[A-Za-z])/;
/** A notes page can repeat statement words ("net cash from operating activities" in a discontinued-operations note). */
const NOTES_PAGE = /\bnotes? (forming part|to (the )?(consolidated |standalone )?(financial|statement))/i;
const OTHER_STATEMENT = /changes in equity/i;
/** The P&L and cash flow sit within a few pages of their balance sheet. */
const MAX_STATEMENT_GAP = 12;
const ENUMERATOR = /^(\(?[a-z]{1,3}\)|\(?[ivx]+\)|\d{1,2}[.)]|[A-Z][.)])\s+/;

/** Splits a statement line into its label and the trailing run of numbers. A lone dash means nil (zero). */
export function splitLine(line: string): { label: string; numbers: number[] } {
  const tokens = line.trim().split(/\s+/);
  const numbers: number[] = [];
  let end = tokens.length;
  // A section tab printed in the page margin ("... (2,377.18) (4,663.44) Financial Statements") can trail the figures:
  // up to three plain words after two or more numbers are dropped.
  for (let cut = 1; cut <= MAX_MARGIN_WORDS && cut < tokens.length - 2; cut++) {
    const tail = tokens.slice(-cut);
    const before = tokens.slice(-cut - 2, -cut);
    if (tail.every((t) => /^[A-Za-z]+$/.test(t)) && before.every((t) => NUMERIC.test(t) && /[.,(]/.test(t))) {
      end = tokens.length - cut;
      break;
    }
  }
  while (end > 0) {
    const t = tokens[end - 1] ?? '';
    if (NIL.test(t)) numbers.unshift(0);
    else if (NUMERIC.test(t)) numbers.unshift(parseNumber(t) ?? 0);
    else break;
    end--;
  }
  let label = tokens.slice(0, end).join(' ');
  for (let i = 0; i < 2; i++) label = label.replace(ENUMERATOR, '').replace(ROMAN, '');
  // "Less: Income tax paid", and note references left at the end of a caption ("... Expense 4.1, 4.2 and").
  label = label.replace(/^(less|add)\s*:\s*/i, '').replace(/(\s+(\d+(\.\d+)?,?|and|&))+$/i, '');
  return { label: label.replace(/[:.,\s]+$/, '').trim(), numbers };
}

/** One readable unit: a whole page, or one half of a two-page spread. */
interface View {
  page: number;
  lines: string[];
  side: '' | 'left' | 'right';
}
const headingOf = (p: View): string => p.lines.slice(0, HEADING_LINES).join(' ');

interface PageClass {
  kind: StatementKind;
  consolidated: boolean;
  standalone: boolean;
  /** Most lines carry more than three numbers: a multi-year summary table, not the primary statement. */
  wide: boolean;
}

function classify(p: View): PageClass | null {
  const head = headingOf(p);
  if (NOTES_PAGE.test(head)) return null;
  const body = p.lines.join(' ');
  // A statement is a table. Prose that merely mentions "balance sheet" (an auditor's report, say) is not.
  const counts = p.lines.map((l) => splitLine(l).numbers.length).filter((n) => n >= 2);
  if (counts.length < MIN_TABLE_LINES) return null;
  const wide = counts.filter((n) => n > 3).length > counts.length / 2;
  for (const kind of ['bs', 'pl', 'cf'] as const) {
    const s = STATEMENTS[kind];
    // The cash-flow heading test is loose, so a page already recognised as a balance sheet or P&L never reaches it.
    if (s.heading.test(head) && s.must.every((re) => re.test(body))) return { kind, consolidated: /consolidated/i.test(head), standalone: /standalone/i.test(head), wide };
  }
  return null;
}

/** The two period columns, as [current, prior] labels, read from a header such as "31 March 2025  31 March 2024". */
export function findPeriods(lines: string[]): [string, string] | null {
  for (const line of lines) {
    const years = [...line.matchAll(/(?:\b(?:31(?:st)?\s+march|march\s+31),?\s+(\d{4}))|\b(\d{4})\s*-\s*(\d{2})\b|\bFY\s*'?(\d{2,4})\b/gi)]
      .map((m) => (m[1] ? `Mar-${m[1]}` : m[2] && m[3] ? `${m[2]}-${m[3]}` : `FY${m[4]}`))
      .map((raw) => parsePeriod(raw))
      .filter((p) => p !== null);
    const a = years[0];
    const b = years.find((y) => y.label !== a?.label);
    if (a && b) return a.key > b.key ? [a.label, b.label] : [b.label, a.label];
  }
  return null;
}

export function findUnit(lines: string[]): UnitId | null {
  // The rupee sign often comes out of a PDF as a stray glyph ("in H Crores", "( ` in crore)"), so one may sit before the unit.
  const m = /(?:\bin|₹|`|\brs\.?|\binr)\s*(?:\S{1,2}\s+)?(?:in\s+)?(crores?|lakhs?|lacs?|millions?|thousands?)\b/i.exec(lines.join(' '));
  const w = m?.[1]?.toLowerCase() ?? '';
  return w.startsWith('crore') ? 'crore' : w.startsWith('la') ? 'lakh' : w.startsWith('million') ? 'million' : w.startsWith('thousand') ? 'thousand' : null;
}

const NEGATED = new RegExp(lexicon.negators, 'i');
/** Marks a sentence boundary that has no punctuation (after a heading line). */
const BREAK = '¶';
const SENTENCE_END = /¶|(?<=[.;])\s+(?=[A-Z(])/;
const MAX_HEADING = 80;
const isHeading = (line: string): boolean => {
  const t = line.trim();
  return t.length > 0 && t.length < MAX_HEADING && !/[.,;:]$/.test(t) && !/\b(and|or|of|the|to|in|a|an|for|with|by|on|is|are|was|were|that|which)$/i.test(t);
};

/** Runs the lexicon over every page. Each hit carries the quoted sentence and its page number. */
export function scanText(pages: PdfPage[]): TextHit[] {
  const defs = [
    ...lexicon.flags.map((f) => ({ id: f.id, kind: 'flag' as const, re: new RegExp(f.pattern, 'i') })),
    ...lexicon.claims.map((c) => ({ id: c.id, kind: 'claim' as const, re: new RegExp(c.pattern, 'i') })),
  ];
  const hits: TextHit[] = [];
  const count = new Map<string, number>();
  for (const p of pages) {
    // Headings carry no full stop, so a short line without closing punctuation also ends a sentence;
    // otherwise a page header would be glued onto the first quote.
    const text = (p.text ?? p.lines).map((l) => (isHeading(l) ? `${l.trim()}${BREAK}` : l)).join(' ').replace(/\s+/g, ' ');
    const sentences = text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      for (const d of defs) {
        if ((count.get(d.id) ?? 0) >= lexicon.maxQuotesPerRule) continue;
        const m = d.re.exec(sentence);
        if (!m) continue;
        // "has not defaulted in repayment": a negator shortly before the match means the opposite of a flag.
        if (d.kind === 'flag' && NEGATED.test(sentence.slice(0, m.index))) continue;
        count.set(d.id, (count.get(d.id) ?? 0) + 1);
        hits.push({ id: d.id, kind: d.kind, sentence: sentence.length > MAX_SENTENCE ? `${sentence.slice(0, MAX_SENTENCE)}…` : sentence, page: p.page });
      }
    }
  }
  return hits;
}

export function extractFromPages(pages: PdfPage[], fileName: string): PdfExtraction {
  const notes: string[] = [];
  const chars = pages.reduce((a, p) => a + p.lines.join('').length, 0);
  const emptyTable: SourceTable = { fileName, sheetName: 'PDF', layout: 'pdf', company: null, periods: [], rows: [], notes };
  const found: Record<StatementKind, number | null> = { bs: null, pl: null, cf: null };
  if (pages.length === 0 || chars / pages.length < MIN_CHARS_PER_PAGE) {
    notes.push('This PDF has no readable text layer (it is probably scanned images). CLADES does not use OCR, so nothing was extracted. Use manual entry instead.');
    return { table: emptyTable, textHits: [], pages: pages.length, scanned: true, found, basis: 'unknown', unit: null, notes };
  }

  // Locate each statement: prefer consolidated, otherwise the first page that qualifies.
  // A landscape page may be a two-page spread: if either half is a statement in its own right, read the halves separately.
  const views: View[] = pages.flatMap((p): View[] => {
    const whole: View = { page: p.page, lines: p.lines, side: '' };
    if (!p.halves) return [whole];
    const l: View = { page: p.page, lines: p.halves[0], side: 'left' };
    const r: View = { page: p.page, lines: p.halves[1], side: 'right' };
    return classify(l) || classify(r) ? [l, r] : [whole];
  });
  const classified = views.map((p) => ({ p, c: classify(p) }));
  const chosen: { kind: StatementKind; pages: View[]; consolidated: boolean; standalone: boolean }[] = [];
  let anchor = -1;
  for (const kind of ['bs', 'pl', 'cf'] as const) {
    const cands = classified.filter((x) => x.c?.kind === kind);
    const primary = cands.filter((x) => !x.c?.wide);
    const pool = primary.length ? primary : cands;
    // A report carries a standalone and a consolidated set, and only some headings say which. The balance sheet is
    // chosen first (consolidated preferred); the P&L and cash flow are then the ones that follow it most closely,
    // so the three statements always come from the same set.
    const near = anchor < 0 ? undefined : pool.find((x) => classified.indexOf(x) >= anchor && classified.indexOf(x) - anchor <= MAX_STATEMENT_GAP);
    const pick = near ?? pool.find((x) => x.c?.consolidated) ?? pool[0];
    if (!pick?.c) {
      notes.push(`${STATEMENTS[kind].name}: not found. Its lines stay missing; add them by hand below if you have them.`);
      continue;
    }
    if (kind === 'bs') anchor = classified.indexOf(pick);
    found[kind] = pick.p.page;
    if (pick.p.side) notes.push(`${STATEMENTS[kind].name}: read from the ${pick.p.side} half of page ${pick.p.page} (a two-page spread).`);
    const use = [pick.p];
    // A statement often runs onto the next page (or the other half of a spread): take it when this page has not
    // reached the statement's closing line and the continuation is not a different statement.
    if (!STATEMENTS[kind].end.test(pick.p.lines.join(' '))) {
      const after = pages.find((p) => p.page === pick.p.page + 1);
      const next: View | undefined =
        pick.p.side === 'left'
          ? classified[classified.indexOf(pick) + 1]?.p
          : after && { page: after.page, lines: pick.p.side === 'right' && after.halves ? after.halves[0] : after.lines, side: pick.p.side === 'right' && after.halves ? 'left' : '' };
      const nc = next ? classify(next) : null;
      if (next && (!nc || nc.kind === kind) && !OTHER_STATEMENT.test(headingOf(next))) use.push(next);
    }
    const same = near !== undefined && kind !== 'bs';
    const bs = chosen.find((c) => c.kind === 'bs');
    chosen.push({ kind, pages: use, consolidated: pick.c.consolidated || (same && Boolean(bs?.consolidated)), standalone: pick.c.standalone || (same && Boolean(bs?.standalone)) });
  }

  const allLines = chosen.flatMap((c) => c.pages.flatMap((p) => p.lines));
  const periods = findPeriods(allLines);
  if (!periods && chosen.length) notes.push('The year columns could not be read from the statement headers, so they are labelled "Prior" and "Current". Check which year is which.');
  const [cur, prior] = periods ?? ['Current', 'Prior'];
  const unit = findUnit(allLines);
  notes.push(unit ? `Unit read from the statements: ${unit}.` : 'The unit (crore, lakh, million) was not found in the statements. Crore is assumed: check it.');
  const basis: Basis = chosen.length === 0 ? 'unknown' : chosen.every((c) => c.consolidated) ? 'consolidated' : chosen.every((c) => c.standalone) ? 'standalone' : 'unknown';
  if (chosen.some((c) => c.consolidated) && !chosen.every((c) => c.consolidated)) notes.push('Consolidated and standalone statements appear to be mixed: check each figure.');

  const rows: SourceRow[] = [];
  const unlabelled = new Set<string>();
  const seen = new Set<string>();
  for (const c of chosen) {
    let ctx = '';
    for (const p of c.pages) {
      for (const line of p.lines) {
        const { label, numbers } = splitLine(line);
        // Some reports print a section subtotal as two bare numbers. It is read as that section's total and tagged LOW;
        // a later bare line in the same section replaces it, because the section total comes last.
        if (c.kind === 'bs' && !label && numbers.length === 2 && SUBTOTAL_SECTIONS.has(ctx)) {
          const name = `Total ${ctx.toLowerCase()}`;
          const old = rows.findIndex((r) => r.label === name && r.confidence === 'low');
          if (old >= 0) rows.splice(old, 1);
          rows.push({ index: 0, section: 'bs', label: name, values: [numbers[1] ?? null, numbers[0] ?? null], page: p.page, confidence: 'low' });
          unlabelled.add(name);
          continue;
        }
        if (!label || !/[a-z]{3}/i.test(label)) continue;
        // The same caption can recur lower down ("Profit for the year" again under "attributable to"): the first is the statement line.
        if (numbers.length >= 2 && seen.has(`${c.kind}|${ctx}|${label.toLowerCase()}`)) continue;
        if (numbers.length >= 2) seen.add(`${c.kind}|${ctx}|${label.toLowerCase()}`);
        if (c.kind === 'bs') {
          const sec = BS_SECTIONS.find(([re]) => re.test(label));
          if (sec && numbers.length < 2) {
            ctx = sec[1];
            continue;
          }
        }
        // Label + [note no.] + current + prior. Fewer than two numbers is ambiguous, so the line is not used.
        if (numbers.length < 2) continue;
        const [a, b] = numbers.slice(-2);
        rows.push({
          index: rows.length, section: c.kind, label: c.kind === 'bs' && ctx && !/^total\b/i.test(label) ? `${ctx}: ${label}` : label,
          values: [b ?? null, a ?? null], page: p.page,
          // More than three trailing numbers means extra columns we cannot identify with certainty.
          confidence: numbers.length > 3 ? 'low' : 'medium',
        });
      }
    }
  }
  rows.forEach((r, i) => (r.index = i));
  if (unlabelled.size) notes.push(`Printed without a label and read by position, tagged LOW: ${[...unlabelled].join(', ')}. Check them against the report.`);
  if (rows.length) notes.push('PDF extraction is rule-based and can misread columns. Every figure is tagged MED or LOW: compare them with the report before running the engine.');

  return {
    table: { fileName, sheetName: 'PDF', layout: 'pdf', company: null, periods: rows.length ? [prior, cur] : [], rows, notes },
    textHits: scanText(pages), pages: pages.length, scanned: false, found, basis, unit, notes,
  };
}
