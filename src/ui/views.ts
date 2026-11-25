/** Screen bodies. Build 1 ships the terminal shell: every panel is present but honestly empty. */
import { DISCLAIMER, RULE_LIBRARY_VERSION } from '../config';
import { COMMAND_HINT } from './command';
import { empty, html, panel, type Raw } from './dom';
import { confirmView } from './confirm';
import { caseView } from './dashboard';
import { portfolioView } from './portfolio';
import { NO_CASE, type Route } from './router';
import { store } from './state';

type BuildState = 'DONE' | 'NEXT' | 'PLANNED';
const BUILD_STAGES: ReadonlyArray<readonly [string, BuildState]> = [
  ['Terminal shell, CI and Pages deploy', 'DONE'],
  ['Schema, Excel/CSV ingest, confirm screen', 'DONE'],
  ['Beneish M-score with hand-checked tests', 'DONE'],
  ['Other rule batteries, Fraud Triangle, case file', 'DONE'],
  ['Company dashboard and portfolio monitor', 'DONE'],
  ['Manual entry and PDF extraction', 'NEXT'],
  ['Honest-profit estimator and text rules', 'PLANNED'],
  ['Offline sector benchmarks and back-test', 'PLANNED'],
];

function home(): Raw {
  const samples = store.list().filter((r) => r.caseFile.sample).length;
  return html`<div class="grid">
    ${panel(
      'A',
      'What CLADES does',
      html`<p class="lead">Do these accounts look <em>too</em> good?</p>
        <ol class="steps">
          <li>You load a company's financial report. It is read inside this browser tab and never uploaded.</li>
          <li>A fixed library of published forensic checks compares profit with cash, this year with last year, and the company with its sector.</li>
          <li>You get a score, the evidence behind every flag, the innocent explanation for each one, and what to check next.</li>
        </ol>
        <p class="muted">Scope: Indian listed non-financial companies (NSE/BSE, Ind AS). Banks, NBFCs and insurers are reported as "Not assessable" because these rules are not valid for them.</p>`,
      7,
    )}
    ${panel(
      'B',
      'Load a report',
      html`<p><label class="btn primary">1 · CHOOSE EXCEL / CSV FILE<input type="file" class="sr" data-act="file" accept=".xlsx,.xls,.csv" /></label></p>
        <p class="muted">A Screener.in "Export to Excel" file works as it is. Any sheet with line items down the side and years across the top also works. You review every figure before anything is scored.</p>
        <p><button type="button" data-act="sample-csv">DOWNLOAD A SYNTHETIC SAMPLE CSV</button> <span class="muted">to try the upload yourself</span></p>
        <ul class="rows">
          <li><span class="k">2 Manual entry</span><span class="muted">Type the key line items for two or more years</span><span class="tag tag-muted">BUILD 6</span></li>
          <li><span class="k">3 PDF annual report</span><span class="muted">Rule-based extraction; scanned PDFs fall back to manual entry</span><span class="tag tag-muted">BUILD 6</span></li>
        </ul>`,
      5,
    )}
    ${panel(
      'C',
      'Sample set and portfolio',
      html`<p>${store.list().length} company record(s) stored in this browser, of which ${samples} are <strong>synthetic samples</strong> (invented companies, clearly labelled SAMPLE).</p>
        <p><a class="btn" href="#/portfolio">OPEN PORTFOLIO MONITOR (F6)</a>
          ${samples ? html`<button type="button" data-act="samples-clear">REMOVE SAMPLE SET</button>` : html`<button type="button" data-act="samples-load">LOAD SAMPLE SET</button>`}</p>
        <ol class="rows">
          ${BUILD_STAGES.map(([label, state], i) => html`<li><span class="k">${i + 1} ${label}</span><span class="tag tag-${state.toLowerCase()}">${state}</span></li>`)}
        </ol>`,
      7,
    )}
    ${panel(
      'D',
      'Ground rules',
      html`<ul class="plain">
        <li>No figure is ever invented. A missing number stays missing and its metric is left out.</li>
        <li>Every number traces back to a source file, a row and a confidence level.</li>
        <li>Figures the source does not report exactly are labelled PROXY and can be switched off.</li>
        <li>Thresholds and weights are judgment, not yet back-tested on Indian data. Sector benchmarks are placeholders.</li>
        <li>${DISCLAIMER}</li>
      </ul>`,
      5,
    )}
  </div>`;
}

function emptyCase(id: string): Raw {
  return html`<p class="banner" role="status">
      <span class="tag tag-muted">${id === NO_CASE ? 'EMPTY' : 'NOT FOUND'}</span>
      ${id === NO_CASE ? html`No company selected.` : html`No case file for <strong>${id}</strong> is stored in this browser. Nothing is fetched from the internet.`}
      Load a report from <a href="#/">HOME</a> or pick a company in the <a href="#/portfolio">PORTFOLIO</a>.
    </p>
    <div class="grid">${panel(1, 'Verdict', empty('NO CASE LOADED', 'Tier, models agreeing, Fraud Triangle bars and the evidence appear here once a company is scanned.'))}</div>`;
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
          <li>To move or back up your data, use Export / Import JSON on the Portfolio screen.</li>
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
    ${panel('R', 'Rule library', html`<p>Version ${RULE_LIBRARY_VERSION}. Every rule, threshold, weight and explanation is in config/rules.json. Open any check on a company dashboard to see its formula and inputs.</p>`)}
  </div>`;
}

function notFound(path: string): Raw {
  return html`<div class="grid">
    ${panel('?', 'Unknown screen', html`<p>No screen at <strong>${path}</strong>. ${COMMAND_HINT}</p>`)}
  </div>`;
}

export interface View {
  title: string;
  body: Raw;
  /** Shown next to the command line. */
  context?: string;
  sample?: boolean;
}

export function renderRoute(r: Route): View {
  switch (r.name) {
    case 'home':
      return { title: 'Home', body: home() };
    case 'case': {
      const rec = store.db.cases[r.id];
      if (!rec) return { title: `${r.id === NO_CASE ? 'No case' : r.id} · ${r.tab}`, body: emptyCase(r.id) };
      const cf = rec.caseFile;
      return {
        title: `${r.id} · ${r.tab}`,
        body: caseView(rec, r.tab),
        context: `${cf.company.latestYear} · ${cf.company.basis} · Confidence ${cf.verdict.confidence.level} (${cf.company.years.length} yrs data)`,
        sample: cf.sample,
      };
    }
    case 'confirm':
      return { title: 'Confirm upload', body: confirmView() };
    case 'portfolio':
      return { title: 'Portfolio monitor', body: portfolioView(), sample: store.list().some((x) => x.caseFile.sample) };
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
