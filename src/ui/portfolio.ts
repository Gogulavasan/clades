/** Screen 2: portfolio monitor over every company scanned in this browser. */
import { LEGS } from '../rules/config';
import type { Tier } from '../scoring/score';
import { STATUSES, ledgerStats, type CaseRecord } from '../storage/store';
import { countBars } from './charts';
import { html, panel, type Raw } from './dom';
import { formatRoute } from './router';
import { day, store } from './state';

const TIER_CLASS: Record<Tier, string> = { clean: 't-clean', watch: 't-watch', suspicious: 't-susp', not_assessable: 't-na' };
const TIER_SHORT: Record<Tier, string> = { clean: 'CLEAN', watch: 'WATCH', suspicious: 'SUSP', not_assessable: 'N/A' };
const BIN = 10;
const OUTCOMES = [['open', 'OPEN'], ['problem', 'PROBLEM CONFIRMED'], ['no_problem', 'NO PROBLEM (false alarm)']] as const;

const href = (id: string): string => formatRoute({ name: 'case', id, tab: 'verdict' });
const bySeverity = (a: CaseRecord, b: CaseRecord): number => (b.caseFile.verdict.score ?? -1) - (a.caseFile.verdict.score ?? -1);
const sampleTag = (r: CaseRecord): Raw | null => (r.caseFile.sample ? html` <span class="tag lv-red">SAMPLE</span>` : null);

/** Quarantine rows as CSV. Cells that could be read as spreadsheet formulas are neutralised. */
export function quarantineCsv(rows: CaseRecord[]): string {
  const cell = (v: string | number | null): string => {
    const s = String(v ?? '');
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['Company', 'Ticker', 'Sample', 'Sector', 'Score', 'Tier', 'Pressure', 'Opportunity', 'Rationalisation', 'Models flagging', 'Status', 'Flag date', 'Notes'];
  const lines = rows.map((r) => {
    const v = r.caseFile.verdict;
    return [r.caseFile.company.name, r.id, r.caseFile.sample ? 'SYNTHETIC SAMPLE' : '', r.caseFile.company.sector, v.score, v.label,
      ...LEGS.map((l) => v.triangle?.[l].level ?? 'N/A'), `${v.modelsFlagging}/${v.modelsComputable}`, r.status, day(r.flagDate), r.notes].map(cell).join(',');
  });
  return [head.join(','), ...lines].join('\n');
}

export const quarantined = (): CaseRecord[] => store.list().filter((r) => r.flagDate !== null).sort(bySeverity);

export function portfolioView(): Raw {
  const all = store.list().sort(bySeverity);
  const count = (t: Tier): number => all.filter((r) => r.caseFile.verdict.tier === t).length;
  const samples = all.filter((r) => r.caseFile.sample).length;
  const strip: ReadonlyArray<readonly [string, number, string]> = [
    ['Scanned', all.length, ''], ['Suspicious', count('suspicious'), 'lv-red'], ['Watch', count('watch'), 'lv-amber'], ['Clean', count('clean'), 'lv-green'], ['Not assessable', count('not_assessable'), 'lv-muted'],
  ];
  const scored = all.filter((r) => r.caseFile.verdict.score !== null);
  const bins = Array.from({ length: BIN }, (_, i): readonly [string, number] => {
    const lo = i * BIN;
    const hi = i === BIN - 1 ? 100 : lo + BIN - 1;
    return [`${lo}-${hi}`, scored.filter((r) => { const s = r.caseFile.verdict.score ?? 0; return s >= lo && s <= hi; }).length];
  });
  const flaggedNow = all.filter((r) => ['watch', 'suspicious'].includes(r.caseFile.verdict.tier));
  const sectors = [...new Set(flaggedNow.map((r) => r.caseFile.company.sector))].map((s): readonly [string, number] => [s, flaggedNow.filter((r) => r.caseFile.company.sector === s).length]).sort((a, b) => b[1] - a[1]);
  const q = quarantined();
  const stats = ledgerStats(store.db.ledger);
  const rescans = all.filter((r) => r.history.length >= 2);

  return html`${samples > 0
      ? html`<p class="banner sample" role="note"><span class="tag lv-red">SAMPLE</span> ${samples} of ${all.length} companies below are SYNTHETIC demo data, not real companies.
          <button type="button" data-act="samples-clear">REMOVE SAMPLE SET</button></p>`
      : null}
    ${store.persistError ? html`<p class="banner"><span class="tag lv-amber">STORAGE</span> ${store.persistError}</p>` : null}
    <dl class="strip" aria-label="Scan summary">${strip.map(([k, v, cls]) => html`<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`)}</dl>
    <div class="grid">
      ${panel(1, 'Company heatmap · score printed on each tile', all.length
        ? html`<div class="tiles">${all.map((r) => html`<a class="tile ${TIER_CLASS[r.caseFile.verdict.tier]}" href="${href(r.id)}" title="${r.caseFile.company.name}">
            <span class="tile-n">${r.id}</span><span class="tile-s">${r.caseFile.verdict.score ?? '-'}</span><span class="tile-t">${TIER_SHORT[r.caseFile.verdict.tier]}${r.caseFile.status === 'partial' ? ' · PARTIAL' : ''}${r.caseFile.sample ? ' · SAMPLE' : ''}</span></a>`)}</div>`
        : html`<p class="muted">No companies scanned yet. Load a report from <a href="#/">HOME</a>.</p>`, 8)}
      ${panel(2, 'Score distribution', countBars(bins, 'No scored companies.'), 4)}
      ${panel(3, 'Watch + suspicious by sector', countBars(sectors, 'No company is at Watch or Suspicious.'), 4)}
      ${panel(4, 'Quarantine', q.length
        ? html`<div class="scroll"><table class="tbl">
              <thead><tr><th scope="col">Company</th><th scope="col">Sector</th><th scope="col">Score</th><th scope="col">P / O / R</th><th scope="col">Models</th><th scope="col">Status</th><th scope="col">Flag date</th><th scope="col">Notes</th></tr></thead>
              <tbody>${q.map((r) => {
                const v = r.caseFile.verdict;
                return html`<tr>
                  <td><a href="${href(r.id)}">${r.caseFile.company.name}</a>${sampleTag(r)}</td><td>${r.caseFile.company.sector}</td>
                  <td><span class="${v.tier === 'suspicious' ? 'lv-red' : v.tier === 'watch' ? 'lv-amber' : 'lv-green'}">${v.score ?? '-'} ${v.label}</span></td>
                  <td>${LEGS.map((l) => v.triangle?.[l].level ?? 'N/A').join(' / ')}</td><td>${v.modelsFlagging}/${v.modelsComputable}</td>
                  <td><select data-act="status" data-id="${r.id}" aria-label="Status of ${r.caseFile.company.name}">${STATUSES.map((s) => html`<option ${s === r.status ? html`selected` : null}>${s}</option>`)}</select></td>
                  <td>${day(r.flagDate)}</td>
                  <td><input type="text" data-act="notes" data-id="${r.id}" id="note-${r.id}" value="${r.notes}" aria-label="Notes on ${r.caseFile.company.name}" /></td>
                </tr>`;
              })}</tbody>
            </table></div>
            <p><button type="button" data-act="q-csv">EXPORT QUARANTINE CSV</button> <span class="muted">Companies enter when they first score Watch or Suspicious and stay until deleted, so a CLEARED status is kept.</span></p>`
        : html`<p class="muted">Nothing in quarantine.</p>`, 8)}
      ${panel(5, 'Prediction ledger', html`<p>Logged ${stats.total} · open ${stats.open} · problem confirmed ${stats.hits} · <strong>false alarms ${stats.falseAlarms}</strong> · hit rate ${stats.hitRate === null ? 'n/a (no outcomes marked yet)' : `${(stats.hitRate * 100).toFixed(0)}% of ${stats.hits + stats.falseAlarms} resolved`}</p>
        ${store.db.ledger.length
          ? html`<div class="scroll"><table class="tbl"><thead><tr><th scope="col">Company</th><th scope="col">Year</th><th scope="col">Flagged</th><th scope="col">Score</th><th scope="col">Outcome (you mark this later)</th></tr></thead>
              <tbody>${store.db.ledger.map((l) => html`<tr><td>${l.name}</td><td>${l.year}</td><td>${day(l.date)}</td><td>${l.score ?? '-'} ${TIER_SHORT[l.tier]}</td>
                <td><select data-act="outcome" data-id="${l.id}" aria-label="Outcome for ${l.name} ${l.year}">${OUTCOMES.map(([v, t]) => html`<option value="${v}" ${v === l.outcome ? html`selected` : null}>${t}</option>`)}</select> ${day(l.outcomeDate)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">Every Watch or Suspicious result on a real upload is logged here once per company-year. Sample companies are never logged. A handful of entries cannot support a meaningful hit rate.</p>`}`, 6)}
      ${panel(6, 'Re-scan changes since last filing', rescans.length
        ? html`<table class="tbl"><thead><tr><th scope="col">Company</th><th scope="col">Previous</th><th scope="col">Latest</th><th scope="col">Change</th></tr></thead>
            <tbody>${rescans.map((r) => {
              const [prev, cur] = r.history.slice(-2);
              const d = (cur?.score ?? 0) - (prev?.score ?? 0);
              return html`<tr><td><a href="${href(r.id)}">${r.caseFile.company.name}</a>${sampleTag(r)}</td><td>${prev?.score ?? '-'} (${prev?.year}, ${day(prev?.date ?? null)})</td><td>${cur?.score ?? '-'} (${cur?.year}, ${day(cur?.date ?? null)})</td>
                <td>${d > 0 ? html`<span class="lv-red">WORSENED +${d}</span>` : d < 0 ? html`<span class="lv-green">IMPROVED ${d}</span>` : html`<span class="muted">UNCHANGED</span>`}</td></tr>`;
            })}</tbody></table>`
        : html`<p class="muted">Scan the same ticker again (for example with the next year's report) to see what worsened or improved.</p>`, 6)}
      ${panel(7, 'Backup · your data lives only in this browser', html`<p>
          <button type="button" data-act="export-json">EXPORT JSON BACKUP</button>
          <label class="btn">IMPORT JSON BACKUP<input type="file" accept=".json,application/json" data-act="import-json" class="sr" /></label>
          ${samples === 0 ? html`<button type="button" data-act="samples-load">LOAD SAMPLE SET</button>` : null}
        </p><p class="muted">Import replaces everything stored here. Families (clustering flagged companies by shared patterns) is planned for V2.</p>`)}
    </div>`;
}
