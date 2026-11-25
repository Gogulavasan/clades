/** Screen bodies. Build 1 ships the terminal shell: every panel is present but honestly empty. */
import { DISCLAIMER, RULE_LIBRARY_VERSION } from '../config';
import { COMMAND_HINT } from './command';
import { empty, html, panel, type Raw } from './dom';
import { NO_CASE, type CaseTab, type Route } from './router';

const NO_DATA = 'NO CASE LOADED';

type BuildState = 'DONE' | 'NEXT' | 'PLANNED';
const BUILD_STAGES: ReadonlyArray<readonly [string, BuildState]> = [
  ['Terminal shell, CI and Pages deploy', 'DONE'],
  ['Schema, Excel/CSV ingest, confirm screen', 'NEXT'],
  ['Beneish M-score with hand-checked tests', 'PLANNED'],
  ['Other rule batteries, Fraud Triangle, case file', 'PLANNED'],
  ['Company dashboard and portfolio monitor', 'PLANNED'],
  ['Manual entry and PDF extraction', 'PLANNED'],
  ['Honest-profit estimator and text rules', 'PLANNED'],
  ['Offline sector benchmarks and back-test', 'PLANNED'],
];

function home(): Raw {
  const routes: ReadonlyArray<readonly [string, string, string]> = [
    ['1', 'Excel / CSV', 'Screener.in-style export, with a column-mapping step'],
    ['2', 'Manual entry', 'Type the key line items for two or more years'],
    ['3', 'PDF annual report', 'Rule-based extraction; scanned PDFs fall back to manual entry'],
  ];
  return html`<div class="grid">
    ${panel(
      'A',
      'What CLADES does',
      html`<p class="lead">Do these accounts look <em>too</em> good?</p>
        <ol class="steps">
          <li>You load a company's financial report. It is read inside this browser tab and never uploaded.</li>
          <li>
            A fixed library of published forensic checks compares profit with cash, this year with last year, and the
            company with its sector.
          </li>
          <li>
            You get a score, the evidence behind every flag, the innocent explanation for each one, and what to check
            next.
          </li>
        </ol>
        <p class="muted">
          Scope: Indian listed non-financial companies (NSE/BSE, Ind AS). Banks, NBFCs and insurers are reported as
          "Not assessable" because these rules are not valid for them.
        </p>`,
      7,
    )}
    ${panel(
      'B',
      'Load a report',
      html`<ul class="rows">
          ${routes.map(
            ([n, name, note]) =>
              html`<li>
                <span class="k">${n} ${name}</span><span class="muted">${note}</span
                ><span class="tag tag-muted">NOT BUILT YET</span>
              </li>`,
          )}
        </ul>
        <p class="muted">Input routes arrive in the next builds. Nothing can be loaded in this build.</p>`,
      5,
    )}
    ${panel(
      'C',
      'Build status',
      html`<ol class="rows">
        ${BUILD_STAGES.map(
          ([label, state], i) =>
            html`<li>
              <span class="k">${i + 1} ${label}</span><span class="tag tag-${state.toLowerCase()}">${state}</span>
            </li>`,
        )}
      </ol>`,
      7,
    )}
    ${panel(
      'D',
      'Ground rules',
      html`<ul class="plain">
        <li>No figure is ever invented. A missing number stays missing and its metric is left out.</li>
        <li>Every number traces back to a source file, a page and a confidence level.</li>
        <li>${DISCLAIMER}</li>
      </ul>`,
      5,
    )}
  </div>`;
}

const PANELS: Record<number, { title: string; span: number; note: string }> = {
  1: { title: 'Verdict', span: 4, note: 'Tier, models agreeing, Fraud Triangle bars, reported vs stress-tested profit.' },
  2: { title: 'Price · volume vs flag date', span: 8, note: 'Needs an optional price CSV; otherwise revenue and PAT trend.' },
  3: { title: 'Beneish · 8 ratios vs benchmark (1.00)', span: 5, note: 'Eight ratios, colour and text coded, plus M-score vs threshold.' },
  4: { title: 'Profit vs cash · 5 years', span: 4, note: 'Paired columns: profit after tax against cash from operations.' },
  5: { title: 'Honest-profit bridge', span: 3, note: 'Waterfall from reported to stress-tested profit.' },
  6: { title: 'Evidence ledger · top flags', span: 8, note: 'Figure vs benchmark, source, and the innocent explanation.' },
  7: { title: 'Words vs numbers · India pack', span: 4, note: 'Quoted management claim against the contradicting figure.' },
  8: { title: 'Next steps', span: 6, note: 'Concrete things to check or ask.' },
  9: { title: 'Data quality', span: 6, note: 'Extraction confidence per statement and integrity checks.' },
};

const TAB_PANELS: Record<CaseTab, readonly number[]> = {
  verdict: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  earnings: [4, 5, 6, 9],
  beneish: [3, 6, 9],
  cash: [4, 2, 5],
  governance: [7, 6, 8],
};

function caseView(id: string, tab: CaseTab): Raw {
  const banner =
    id === NO_CASE
      ? html`<p class="banner" role="status">
          <span class="tag tag-muted">EMPTY</span> ${NO_DATA}. Load a report from <a href="#/">HOME</a> once ingest is
          built.
        </p>`
      : html`<p class="banner" role="status">
          <span class="tag tag-muted">NOT FOUND</span> No case file for <strong>${id}</strong> is stored in this
          browser. Nothing is fetched from the internet.
        </p>`;
  return html`${banner}
    <div class="grid">
      ${TAB_PANELS[tab].map((n) => {
        const p = PANELS[n];
        return p ? panel(n, p.title, empty(NO_DATA, p.note), tab === 'verdict' ? p.span : 6) : null;
      })}
    </div>`;
}

function portfolio(): Raw {
  const strip = ['Scanned', 'Suspicious', 'Watch', 'Clean', 'Not assessable'];
  const blocks: ReadonlyArray<readonly [string, number, string]> = [
    ['Company heatmap', 8, 'One tile per company, coloured by score with the score printed.'],
    ['Score distribution', 4, 'Histogram of scores across all tested companies.'],
    ['Watch + suspicious by sector', 4, 'Bars by sector.'],
    ['Quarantine', 8, 'Flagged companies with status, notes and CSV export.'],
    ['Prediction ledger', 6, 'Flags logged, outcomes marked later: hit rate and false alarms.'],
    ['Re-scan changes', 6, 'Worsened or improved since the last filing.'],
  ];
  return html`<dl class="strip" aria-label="Scan summary">
      ${strip.map((s) => html`<div><dt>${s}</dt><dd>0</dd></div>`)}
    </dl>
    <div class="grid">
      ${blocks.map(([title, span, note], i) => panel(i + 1, title, empty('NO COMPANIES SCANNED YET', note), span))}
    </div>`;
}

function privacy(): Raw {
  return html`<div class="grid">
    ${panel(
      'P',
      'Privacy',
      html`<div class="prose">
        <p><strong>Your data lives only in your browser.</strong></p>
        <ul class="plain">
          <li>CLADES is a static website. There is no server, no database, no account and no analytics.</li>
          <li>
            Files you load are read by code running in this tab. They are never uploaded, and the page's security policy
            blocks it from contacting any other website.
          </li>
          <li>
            Results you choose to keep (quarantine list, prediction ledger, settings) are saved in this browser's own
            storage on this device. Clearing site data removes them.
          </li>
          <li>Nobody else, including the author, can see what you load or what the engine finds.</li>
          <li>To move or back up your data, use Export / Import JSON (arrives with the portfolio build).</li>
        </ul>
        <p class="muted">
          The site is served by GitHub Pages, which, like any web host, can log the request for the page itself (for
          example your IP address). That request contains none of your files or results.
        </p>
      </div>`,
    )}
  </div>`;
}

function validation(): Raw {
  return html`<div class="grid">
    ${panel(
      'V',
      'Validation · back-test',
      html`<div class="prose">
        <p><span class="tag tag-muted">NO RESULTS YET</span> The back-test has not been run.</p>
        <p>
          This page will show how the rules performed on known Indian cases against a clean control group: years
          flagged early, hit rate, false-positive rate, precision and ROC/AUC, with thresholds fixed on an earlier
          period and tested on a later one.
        </p>
        <p class="muted">
          Until figures are entered by hand from original annual reports, this page stays empty. No performance number
          is shown that was not measured.
        </p>
      </div>`,
    )}
  </div>`;
}

function help(): Raw {
  const keys: ReadonlyArray<readonly [string, string]> = [
    ['F1 to F5', 'Verdict, Earnings, Beneish, Cash, Governance for the current company'],
    ['F6', 'Portfolio monitor'],
    ['F7', 'Export PDF (prints the current case)'],
    ['Alt+1 to Alt+7', 'Same as F1 to F7, for browsers that reserve function keys'],
    ['/', 'Jump to the command line'],
    ['Esc', 'Leave the command line'],
  ];
  const cmds: ReadonlyArray<readonly [string, string]> = [
    ['INFY <EQUITY> CLADES <GO>', 'Open a company. <EQUITY>, CLADES and <GO> are optional'],
    ['INFY BENEISH', 'Open a company on one tab: VERDICT, EARN, BENEISH, CASH, GOV'],
    ['PORT', 'Portfolio monitor'],
    ['VAL', 'Validation / back-test results'],
    ['PRIV', 'Privacy'],
    ['HOME', 'Load a report'],
  ];
  const table = (rows: ReadonlyArray<readonly [string, string]>, head: string): Raw =>
    html`<table class="tbl">
      <thead>
        <tr>
          <th scope="col">${head}</th>
          <th scope="col">Does</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([k, v]) => html`<tr><th scope="row" class="k">${k}</th><td>${v}</td></tr>`)}
      </tbody>
    </table>`;
  return html`<div class="grid">
    ${panel('H', 'Keys', table(keys, 'Key'), 6)} ${panel('C', 'Command line', table(cmds, 'Command'), 6)}
    ${panel('R', 'Rule library', html`<p>Version ${RULE_LIBRARY_VERSION}. No rules are loaded in this build.</p>`)}
  </div>`;
}

function notFound(path: string): Raw {
  return html`<div class="grid">
    ${panel('?', 'Unknown screen', html`<p>No screen at <strong>${path}</strong>. ${COMMAND_HINT}</p>`)}
  </div>`;
}

export function renderRoute(r: Route): { title: string; body: Raw } {
  switch (r.name) {
    case 'home':
      return { title: 'Home', body: home() };
    case 'case':
      return { title: `${r.id === NO_CASE ? 'No case' : r.id} · ${r.tab}`, body: caseView(r.id, r.tab) };
    case 'portfolio':
      return { title: 'Portfolio monitor', body: portfolio() };
    case 'privacy':
      return { title: 'Privacy', body: privacy() };
    case 'validation':
      return { title: 'Validation', body: validation() };
    case 'help':
      return { title: 'Help', body: help() };
    case 'notfound':
      return { title: 'Unknown screen', body: notFound(r.path) };
  }
}
