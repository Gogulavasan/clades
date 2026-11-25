/** Every user action in the main area. Elements opt in with data-act="name". */
import { buildCaseFile, DEFAULT_OPTIONS } from '../casefile/build';
import { extractFromPages } from '../extract/pdf';
import { readWorkbook } from '../ingest/file';
import type { SourceTable } from '../ingest/grid';
import { parsePriceCsv } from '../ingest/price';
import { RULES } from '../rules/config';
import { parseNumber } from '../ingest/grid';
import { isFieldId } from '../standardise/schema';
import { UNIT_IDS, autoMap, defaultMeta, editKey, standardise, type UnitId } from '../standardise/standardise';
import { SAMPLE_PROFILES, gridToCsv, sampleGrid } from '../storage/sample';
import { STATUSES, type Outcome, type Status } from '../storage/store';
import { draftCompany } from './confirm';
import { quarantineCsv, quarantined } from './portfolio';
import { parseRoute } from './router';
import { download, loadSamples, nowIso, store, ui, type Draft } from './state';

type Handler = (el: HTMLElement) => void | Promise<void>;
const val = (el: HTMLElement): string => (el as HTMLInputElement).value;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const options = () => ({ ...DEFAULT_OPTIONS, proxies: store.db.settings.proxies, strict: store.db.settings.strict });

const MIN_FY = 1990;
const MAX_MANUAL_YEARS = 6;

/** A blank draft for typing figures by hand: the confirm screen is the entry form. */
function manualDraft(latestFy: number, years: number, name: string, note: string): Draft {
  const periods = Array.from({ length: years }, (_, i) => `FY${latestFy - years + 1 + i}`);
  const table: SourceTable = { fileName: 'Manual entry', sheetName: 'typed by user', layout: 'manual', company: name, periods, rows: [], notes: note ? [note] : [] };
  return { table, mapping: {}, meta: { ...defaultMeta(table), name }, edits: {} };
}

export const ACTIONS: Record<string, Handler> = {
  manual() {
    const fy = Number((document.getElementById('man-fy') as HTMLInputElement | null)?.value);
    const n = Number((document.getElementById('man-n') as HTMLSelectElement | null)?.value);
    if (!Number.isInteger(fy) || fy < MIN_FY || fy > new Date().getFullYear() + 1) return ui.say('Enter the latest financial year as four digits, for example 2025.');
    ui.draft = manualDraft(fy, Math.min(MAX_MANUAL_YEARS, Math.max(1, n || 2)), 'New company', '');
    ui.go({ name: 'confirm' });
  },
  async pdf(el) {
    const file = (el as HTMLInputElement).files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.pdf$/i, '');
    try {
      ui.say(`Reading ${file.name} in your browser…`);
      const { readPdf } = await import('../ingest/pdf');
      const pages = await readPdf(await file.arrayBuffer(), (done, total) => ui.say(`Reading ${file.name}: page ${done} of ${total}…`));
      const x = extractFromPages(pages, file.name);
      const fy = new Date().getFullYear();
      if (x.scanned || x.table.rows.length === 0) {
        // Nothing usable in the statements: fall back to the manual form, keeping any text that could be read.
        const why = x.scanned ? 'This PDF is scanned or has no readable text, and CLADES does not use OCR.' : 'No balance sheet, profit and loss or cash flow statement was recognised in this PDF.';
        ui.draft = { ...manualDraft(fy, 2, name, `${why} Manual entry was opened instead.`), ...(x.scanned ? {} : { textPages: x.pages, textHits: x.textHits }) };
        ui.say(`${why} Manual entry opened instead: type the figures from the report.`);
      } else {
        ui.draft = { table: x.table, mapping: autoMap(x.table), meta: { ...defaultMeta(x.table), name, basis: x.basis, unit: x.unit ?? 'crore' }, edits: {}, textPages: x.pages, textHits: x.textHits };
        ui.say('');
      }
      ui.go({ name: 'confirm' });
    } catch (e) {
      ui.draft = manualDraft(new Date().getFullYear(), 2, name, `The PDF could not be opened (${errText(e)}). Manual entry was opened instead.`);
      ui.go({ name: 'confirm' });
      ui.say(`Could not read ${file.name}: ${errText(e)}. Manual entry opened instead.`);
    }
  },
  async price(el) {
    const file = (el as HTMLInputElement).files?.[0];
    const id = el.dataset.id;
    if (!file || !id) return;
    const points = parsePriceCsv(await file.text());
    if (points.length < 2) return ui.say('No usable rows found. The price CSV needs a date column and a close column (volume optional).');
    store.setPrice(id, points);
    ui.rerender();
  },
  'price-clear'(el) {
    if (el.dataset.id) store.setPrice(el.dataset.id, null);
    ui.rerender();
  },

  async file(el) {
    const file = (el as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return ui.say('That file is larger than 25 MB. Export just the financial statements sheet and try again.');
    try {
      const table = await readWorkbook(await file.arrayBuffer(), file.name);
      if (table.periods.length === 0 || table.rows.length === 0) {
        return ui.say(`No financial table was recognised in ${file.name}. Expected a Screener.in "Data Sheet" or a table with line items down the side and years across the top.`);
      }
      ui.draft = { table, mapping: autoMap(table), meta: defaultMeta(table), edits: {} };
      ui.go({ name: 'confirm' });
    } catch (e) {
      ui.say(`Could not read ${file.name}: ${errText(e)}`);
    }
  },
  'sample-csv'() {
    const p = SAMPLE_PROFILES.find((x) => x.name.includes('DELTA')) ?? SAMPLE_PROFILES[0];
    if (p) download('clades-SYNTHETIC-sample.csv', gridToCsv(sampleGrid(p)), 'text/csv');
  },
  'samples-load'() {
    loadSamples();
    ui.rerender();
  },
  'samples-clear'() {
    store.clearSamples();
    ui.rerender();
  },
  meta(el) {
    const d = ui.draft;
    const k = el.dataset.k;
    if (!d || !k) return;
    const v = val(el);
    if (k === 'name') d.meta.name = v;
    else if (k === 'ticker') d.meta.ticker = v.toUpperCase().replace(/[^A-Z0-9&.-]/g, '');
    else if (k === 'sector') d.meta.sector = v;
    else if (k === 'basis' && (v === 'consolidated' || v === 'standalone' || v === 'unknown')) d.meta.basis = v;
    else if (k === 'unit' && (UNIT_IDS as string[]).includes(v)) d.meta.unit = v as UnitId;
    ui.rerender();
  },
  map(el) {
    const d = ui.draft;
    const row = Number(el.dataset.row);
    if (!d) return;
    const f = val(el);
    d.mapping[row] = isFieldId(f) ? { field: f, sign: d.mapping[row]?.sign ?? 1, confidence: 'medium', manual: true } : null;
    ui.rerender();
  },
  sign(el) {
    const m = ui.draft?.mapping[Number(el.dataset.row)];
    if (m) m.sign = val(el) === '-1' ? -1 : 1;
    ui.rerender();
  },
  edit(el) {
    const d = ui.draft;
    const { p, f } = el.dataset;
    if (!d || !p || !f || !isFieldId(f)) return;
    const key = editKey(p, f);
    const text = val(el).trim();
    if (text === '') {
      // Clearing a box removes the figure; if the source never had it there is nothing to override.
      const had = standardise(d.table, d.mapping, d.meta).years.find((y) => y.label === p)?.figures[f];
      if (had) d.edits[key] = null;
      else d.edits = Object.fromEntries(Object.entries(d.edits).filter(([k]) => k !== key));
    } else {
      const n = parseNumber(text);
      if (n === null) return ui.say(`"${text}" is not a number. The figure was left unchanged.`);
      d.edits[key] = n;
    }
    ui.rerender();
  },
  'edits-reset'() {
    if (ui.draft) ui.draft.edits = {};
    ui.rerender();
  },
  'draft-discard'() {
    ui.draft = null;
    ui.go({ name: 'home' });
  },
  setting(el) {
    const k = el.dataset.k;
    if (k === 'proxies' || k === 'strict') store.setSettings({ [k]: (el as HTMLInputElement).checked });
    ui.rerender();
  },
  run() {
    const d = ui.draft;
    if (!d) return;
    try {
      const company = draftCompany(d);
      const rec = store.upsert(buildCaseFile(company, options(), nowIso()), company);
      ui.draft = null;
      ui.go({ name: 'case', id: rec.id, tab: 'verdict' });
    } catch (e) {
      ui.say(errText(e));
    }
  },
  /** Re-score one stored company after toggling strict mode or proxies on its dashboard. */
  rescore(el) {
    const route = parseRoute(location.hash);
    const rec = route.name === 'case' ? store.db.cases[route.id] : undefined;
    const k = el.dataset.k ?? '';
    if (!rec) return;
    const settings = { ...rec.caseFile.settings };
    if (k === 'strict' || k === 'proxies') settings[k] = (el as HTMLInputElement).checked;
    else if (k === 'h:reset') delete settings.honest;
    else if (k.startsWith('h:')) {
      // Honest-profit sliders: percentages on the page, fractions in the case file.
      const base = rec.caseFile.honest?.params ?? RULES.honestProfit;
      const key = k.slice(2);
      if (!Object.hasOwn(base, key)) return;
      settings.honest = { ...base, [key]: Number(val(el)) / 100 };
    } else return;
    try {
      store.rescore(rec.id, buildCaseFile(rec.company, settings, rec.caseFile.generatedAt));
    } catch (e) {
      ui.say(errText(e));
    }
    ui.rerender();
  },
  status(el) {
    const v = val(el);
    if (el.dataset.id && (STATUSES as readonly string[]).includes(v)) store.update(el.dataset.id, { status: v as Status });
    ui.rerender();
  },
  notes(el) {
    if (el.dataset.id) store.update(el.dataset.id, { notes: val(el) });
  },
  outcome(el) {
    const v = val(el);
    if (el.dataset.id && (v === 'open' || v === 'problem' || v === 'no_problem')) store.setOutcome(el.dataset.id, v as Outcome, nowIso());
    ui.rerender();
  },
  'q-csv'() {
    download('clades-quarantine.csv', quarantineCsv(quarantined()), 'text/csv');
  },
  'export-json'() {
    download(`clades-backup-${nowIso().slice(0, 10)}.json`, store.exportJson(), 'application/json');
  },
  async 'import-json'(el) {
    const file = (el as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      store.importJson(await file.text());
      ui.say('');
    } catch (e) {
      ui.say(`Import failed, nothing was changed: ${errText(e)}`);
    }
    ui.rerender();
  },
  'case-json'(el) {
    const rec = el.dataset.id ? store.db.cases[el.dataset.id] : undefined;
    if (rec) download(`clades-case-${rec.id}.json`, JSON.stringify(rec.caseFile, null, 1), 'application/json');
  },
  'case-delete'(el) {
    const id = el.dataset.id;
    if (!id || !window.confirm(`Delete ${id} from this browser? This cannot be undone.`)) return;
    store.remove(id);
    ui.go({ name: 'portfolio' });
  },
};
