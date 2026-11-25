/** Every user action in the main area. Elements opt in with data-act="name". */
import { buildCaseFile, DEFAULT_OPTIONS } from '../casefile/build';
import { readWorkbook } from '../ingest/file';
import { parseNumber } from '../ingest/grid';
import { isFieldId } from '../standardise/schema';
import { UNIT_IDS, autoMap, defaultMeta, editKey, standardise, type UnitId } from '../standardise/standardise';
import { SAMPLE_PROFILES, gridToCsv, sampleGrid } from '../storage/sample';
import { STATUSES, type Outcome, type Status } from '../storage/store';
import { draftCompany } from './confirm';
import { quarantineCsv, quarantined } from './portfolio';
import { download, loadSamples, nowIso, store, ui } from './state';

type Handler = (el: HTMLElement) => void | Promise<void>;
const val = (el: HTMLElement): string => (el as HTMLInputElement).value;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const options = () => ({ ...DEFAULT_OPTIONS, proxies: store.db.settings.proxies, strict: store.db.settings.strict });

export const ACTIONS: Record<string, Handler> = {
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
    const rec = Object.values(store.db.cases).find((r) => location.hash.includes(encodeURIComponent(r.id)));
    const k = el.dataset.k;
    if (!rec || (k !== 'strict' && k !== 'proxies')) return;
    try {
      const next = buildCaseFile(rec.company, { ...rec.caseFile.settings, [k]: (el as HTMLInputElement).checked }, rec.caseFile.generatedAt);
      store.rescore(rec.id, next);
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
