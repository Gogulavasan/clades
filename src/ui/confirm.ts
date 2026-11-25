/** Confirm screen: review every extracted figure, fix the mapping, pass the integrity gate, then run the engine. */
import { checkIntegrity } from '../confirm/integrity';
import { FIELD_IDS, STATEMENT_NAMES, fieldLabel, fieldStatement, type Company, type Figure, type Statement } from '../standardise/schema';
import { FINANCIAL_SECTOR, SECTORS, UNIT_IDS, standardise } from '../standardise/standardise';
import { html, panel, type Raw } from './dom';
import { store, ui, type Draft } from './state';

export const draftCompany = (d: Draft): Company => ({
  ...standardise(d.table, d.mapping, d.meta, d.edits),
  ...(d.textPages === undefined ? {} : { textPages: d.textPages, textHits: d.textHits ?? [] }),
});

const figTag = (f: Figure | undefined): readonly [cls: string, label: string] =>
  !f ? ['c-miss', 'MISS'] : f.edited ? ['c-edit', 'EDIT'] : f.proxy ? ['c-proxy', 'PROXY'] : f.derived ? ['c-high', 'CALC'] : f.confidence === 'high' ? ['c-high', 'HIGH'] : f.confidence === 'medium' ? ['c-med', 'MED'] : ['c-low', 'LOW'];

const options = (values: readonly string[], current: string): Raw[] => values.map((v) => html`<option ${v === current ? html`selected` : null}>${v}</option>`);

export function confirmView(): Raw {
  const d = ui.draft;
  if (!d) return html`<div class="grid">${panel('C', 'Confirm', html`<p>No upload is waiting. Load a report from <a href="#/">HOME</a>.</p>`)}</div>`;
  const company = draftCompany(d);
  const rep = checkIntegrity(company);
  const problems = rep.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const n = (s: string): number => rep.checks.filter((c) => c.status === s).length;
  const financial = d.meta.sector === FINANCIAL_SECTOR;
  const existing = store.db.cases[company.ticker];
  const noYears = company.years.every((y) => Object.keys(y.figures).length === 0);
  const unmapped = d.table.rows.filter((r) => !d.mapping[r.index]).length;

  const meta = html`<div class="form">
      <label>Company name <input type="text" data-act="meta" data-k="name" id="m-name" value="${d.meta.name}" /></label>
      <label>Ticker <input type="text" data-act="meta" data-k="ticker" id="m-ticker" value="${d.meta.ticker}" /></label>
      <label>Sector <select data-act="meta" data-k="sector" id="m-sector">${options(SECTORS, d.meta.sector)}</select></label>
      <label>Statements are <select data-act="meta" data-k="basis" id="m-basis">${options(['consolidated', 'standalone', 'unknown'], d.meta.basis)}</select></label>
      <label>File figures are in <select data-act="meta" data-k="unit" id="m-unit">${options(UNIT_IDS, d.meta.unit)}</select></label>
    </div>
    <p class="muted">Source: ${d.table.fileName} › ${d.table.sheetName} (${d.table.layout} layout, ${d.table.periods.length} period(s), ${d.table.rows.length} rows, ${unmapped} not mapped). ${d.table.notes.join(' ')}</p>
    ${d.textPages === undefined ? null : html`<p><span class="tag lv-info">TEXT</span> ${d.textPages} page(s) of report text scanned: ${(d.textHits ?? []).filter((h) => h.kind === 'flag').length} governance sentence(s) and ${(d.textHits ?? []).filter((h) => h.kind === 'claim').length} management claim(s) matched the lexicon. They appear, quoted with page numbers, on the Governance tab.</p>`}
    ${d.table.layout === 'manual' ? html`<p><span class="tag lv-info">MANUAL</span> Type figures straight into the table below, in INR crore. Leave a box empty if you do not have the figure: it stays missing.</p>` : null}
    ${financial ? html`<p><span class="tag lv-muted">NOT ASSESSABLE</span> Sector is financial: the result will be "Not assessable with these rules". Change the sector if the name-based detection is wrong.</p>` : null}
    ${existing ? html`<p><span class="tag lv-info">RE-SCAN</span> ${company.ticker} is already stored${existing.caseFile.sample ? ' as a sample (it will be replaced)' : '; this scan will be compared with the previous one'}.</p>` : null}`;

  const gate = html`<p class="tier ${rep.blocked || noYears ? 'lv-red' : 'lv-green'}">${noYears ? 'NOTHING TO SCORE' : rep.blocked ? 'BLOCKED · statements do not add up' : 'PASS · scoring allowed'}</p>
    <p><span class="lv-green">${n('pass')} PASS</span> · <span class="lv-amber">${n('warn')} WARN</span> · <span class="lv-red">${n('fail')} FAIL</span> · <span class="muted">${n('not_run')} not run (a line is missing)</span></p>
    ${problems.length
      ? html`<ul class="plain">${problems.map((c) => html`<li><span class="tag ${c.status === 'fail' ? 'lv-red' : 'lv-amber'}">${c.status === 'fail' ? 'FAIL' : 'WARN'}</span> ${c.year} · ${c.label}. ${c.detail}</li>`)}</ul>`
      : null}
    ${rep.blocked ? html`<p>Scoring is blocked because a score built on statements that do not reconcile would be meaningless. Correct the figures below (or the mapping) until every FAIL clears.</p>` : null}
    <p>
      <label><input type="checkbox" data-act="setting" data-k="proxies" ${store.db.settings.proxies ? html`checked` : null} /> Use PROXY figures</label> &nbsp;
      <label><input type="checkbox" data-act="setting" data-k="strict" ${store.db.settings.strict ? html`checked` : null} /> Beneish strict mode</label>
    </p>
    <p>
      <button type="button" class="primary" data-act="run" ${rep.blocked || noYears ? html`disabled` : null}>RUN ENGINE &lt;GO&gt;</button>
      <button type="button" data-act="edits-reset" ${Object.keys(d.edits).length ? null : html`disabled`}>UNDO MY ${Object.keys(d.edits).length} EDIT(S)</button>
      <button type="button" data-act="draft-discard">DISCARD UPLOAD</button>
    </p>`;

  const statements = Object.keys(STATEMENT_NAMES) as Statement[];
  const figures = html`<p class="legend">
      Tags: <span class="c-high">HIGH</span> exact label match · <span class="c-med">MED</span> looser match or mapped by you · <span class="c-low">LOW</span> uncertain ·
      <span class="c-proxy">PROXY</span> stand-in for a line the source lacks · <span class="c-high">CALC</span> arithmetic on reported lines · <span class="c-edit">EDIT</span> typed by you · <span class="c-miss">MISS</span> missing (never estimated).
      All values in INR crore. Clear a box to mark a figure missing.
    </p>
    <div class="scroll"><table class="tbl figs">
      <thead><tr><th scope="col">Line item</th>${company.years.map((y) => html`<th scope="col">${y.label}</th>`)}</tr></thead>
      <tbody>
        ${statements.map((st) => html`<tr class="sect"><th scope="colgroup" colspan="${company.years.length + 1}">${STATEMENT_NAMES[st]}</th></tr>
          ${FIELD_IDS.filter((f) => fieldStatement(f) === st).map((f) => html`<tr>
            <th scope="row" class="k">${fieldLabel(f)}</th>
            ${company.years.map((y) => {
              const fig = y.figures[f];
              const [cls, label] = figTag(fig);
              return html`<td><input type="text" inputmode="decimal" class="fig ${cls}" id="e-${y.label}-${f}" data-act="edit" data-p="${y.label}" data-f="${f}"
                value="${fig ? fig.value.toFixed(2) : ''}" title="${fig ? (fig.proxy ?? fig.derived ?? fig.source) : 'Missing in the source'}" aria-label="${fieldLabel(f)} ${y.label}: ${label}" /><span class="ct ${cls}">${label}</span></td>`;
            })}
          </tr>`)}`)}
      </tbody>
    </table></div>`;

  const mapping = html`<details>
    <summary>Column mapping: ${d.table.rows.length - unmapped} of ${d.table.rows.length} source rows mapped (open to change)</summary>
    <p class="muted">Rows mapped to the same line item are added together; choose "subtract" to deduct a row. Unmapped rows are ignored, never guessed.</p>
    <div class="scroll"><table class="tbl">
      <thead><tr><th scope="col">Row</th><th scope="col">Source label</th><th scope="col">Maps to</th><th scope="col">Sign</th><th scope="col">Latest value (as in file)</th></tr></thead>
      <tbody>
        ${d.table.rows.map((r) => {
          const m = d.mapping[r.index];
          return html`<tr>
            <td>${r.index + 1}</td><td class="k">${r.label}</td>
            <td><select data-act="map" data-row="${r.index}" id="map-${r.index}" aria-label="Mapping for ${r.label}">
              <option value="">(ignore)</option>${FIELD_IDS.map((f) => html`<option value="${f}" ${m?.field === f ? html`selected` : null}>${fieldLabel(f)}</option>`)}</select></td>
            <td><select data-act="sign" data-row="${r.index}" id="sign-${r.index}" aria-label="Sign for ${r.label}" ${m ? null : html`disabled`}>
              <option value="1" ${m?.sign === -1 ? null : html`selected`}>add</option><option value="-1" ${m?.sign === -1 ? html`selected` : null}>subtract</option></select></td>
            <td class="muted">${r.values[r.values.length - 1] ?? 'blank'}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>
  </details>`;

  return html`<div class="grid">${panel(1, 'Confirm · company', meta, 7)}${panel(2, 'Integrity gate', gate, 5)}${panel(3, 'Extracted figures · correct anything that is wrong', figures)}${panel(4, 'Column mapping', mapping)}</div>`;
}
