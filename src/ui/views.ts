/** Screen bodies. Build 1 ships the terminal shell: every panel is present but honestly empty. */
import validationJson from '../../config/validation.json';
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
  ['Manual entry and PDF extraction', 'DONE'],
  ['Honest-profit estimator and text rules', 'DONE'],
  ['Offline benchmark builder and back-test (awaiting real data)', 'DONE'],
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
        <p><label class="btn">2 · CHOOSE PDF ANNUAL REPORT<input type="file" class="sr" data-act="pdf" accept=".pdf,application/pdf" /></label>
          <a href="${import.meta.env.BASE_URL}sample-SYNTHETIC-annual-report.pdf" download>synthetic sample PDF</a></p>
        <p class="muted">Rule-based: finds the balance sheet, P&amp;L and cash flow, reads current and prior year, and scans the text for auditor and governance language. No OCR: a scanned PDF falls back to manual entry.</p>
        <p class="inline"><span>3 · MANUAL ENTRY: latest FY</span>
          <label class="sr" for="man-fy">Latest financial year</label><input type="text" inputmode="numeric" id="man-fy" value="${new Date().getFullYear()}" />
          <label for="man-n">years</label><select id="man-n"><option>2</option><option selected>3</option><option>4</option><option>5</option></select>
          <button type="button" data-act="manual">START</button></p>`,
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
        <li>Every number traces back to a source file, a row or page, and a confidence level.</li>
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

interface ValidationSet {
  name: string;
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  hitRate: number | null;
  falsePositiveRate: number | null;
  precision: number | null;
  auc: number | null;
}
interface Validation {
  status: string;
  generatedAt?: string | null;
  note?: string;
  source?: string;
  sample?: { caseCompanies: number; controlCompanies: number; companyYears: number; positives: number; negatives: number };
  split?: { trainUpToFy: number; publishedThreshold: number; tunedThreshold: number | null };
  sets?: ValidationSet[];
  earlyWarning?: { company: string; eventFy: number; firstFlagFy: number | null; yearsEarly: number | null }[];
  baseRates?: { prevalence: number; precision: number | null }[];
  caveats?: string[];
}
const VALIDATION = validationJson as unknown as Validation;
const pct = (x: number | null | undefined): string => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(0)}%`);

function validation(): Raw {
  const v = VALIDATION;
  if (v.status !== 'ok' || !v.sets || !v.sample) {
    return html`<div class="grid">
      ${panel(
        'V',
        'Validation · back-test',
        html`<div class="prose">
          <p><span class="tag tag-muted">NO RESULTS YET</span> The back-test has not been run on real data.</p>
          <p>${v.note ?? ''}</p>
          <p>
            The tooling is in the repository: <code>notebooks/cases_template.csv</code> lists the known Indian cases with empty figure columns,
            <code>scripts/backtest.py</code> computes the Beneish M-score per company-year and reports years flagged early, hit rate,
            false-positive rate on a clean control group, precision and ROC/AUC, with the threshold fixed on an earlier period and tested on a later one.
            <code>notebooks/backtest.ipynb</code> walks through it.
          </p>
          <p class="muted">
            Figures must be typed in by hand from original annual reports. Until that is done this page stays empty: no performance number is shown that was not measured,
            and the tier cut-offs (30 and 70) and rule weights remain judgment.
          </p>
        </div>`,
      )}
    </div>`;
  }
  return html`<div class="grid">
    ${panel(
      'V',
      'Validation · Beneish M-score back-test',
      html`<p>Run ${(v.generatedAt ?? '').slice(0, 10)} · source: ${v.source ?? 'n/a'}</p>
        <dl class="metrics">
          <div><dt>Case companies</dt><dd>${v.sample.caseCompanies}</dd></div>
          <div><dt>Control companies</dt><dd>${v.sample.controlCompanies}</dd></div>
          <div><dt>Company-years</dt><dd>${v.sample.companyYears}</dd></div>
          <div><dt>Positives / negatives</dt><dd>${v.sample.positives} / ${v.sample.negatives}</dd></div>
        </dl>
        <div class="scroll"><table class="tbl">
          <thead><tr><th scope="col">Set</th><th scope="col">n</th><th scope="col">Hit rate</th><th scope="col">False-positive rate</th><th scope="col">Precision</th><th scope="col">ROC AUC</th><th scope="col">TP / FP / FN / TN</th></tr></thead>
          <tbody>${v.sets.map((s) => html`<tr><td class="k">${s.name}</td><td>${s.n}</td><td>${pct(s.hitRate)}</td><td>${pct(s.falsePositiveRate)}</td><td>${pct(s.precision)}</td><td>${s.auc === null ? 'n/a' : s.auc.toFixed(2)}</td><td>${s.tp} / ${s.fp} / ${s.fn} / ${s.tn}</td></tr>`)}</tbody>
        </table></div>
        <p class="muted">Threshold fixed on FY ≤ ${v.split?.trainUpToFy} and tested on later years. Published threshold ${v.split?.publishedThreshold}; tuned on the earlier period ${v.split?.tunedThreshold ?? 'n/a'}.</p>`,
      8,
    )}
    ${panel(
      'B',
      'Base rates · what a flag is worth',
      html`<table class="tbl"><thead><tr><th scope="col">If this share of companies really has a problem</th><th scope="col">Then a flag is right about</th></tr></thead>
          <tbody>${(v.baseRates ?? []).map((b) => html`<tr><td>${pct(b.prevalence)}</td><td>${pct(b.precision)}</td></tr>`)}</tbody></table>
        <p class="muted">Precision in the back-test is inflated because the sample was built with roughly equal cases and controls. In the real market problems are rare, so most flags are false alarms even with a good hit rate.</p>`,
      4,
    )}
    ${panel(
      'E',
      'Years flagged early',
      html`<table class="tbl"><thead><tr><th scope="col">Company</th><th scope="col">Event FY</th><th scope="col">First flagged FY</th><th scope="col">Years early</th></tr></thead>
        <tbody>${(v.earlyWarning ?? []).map((e) => html`<tr><td class="k">${e.company}</td><td>${e.eventFy}</td><td>${e.firstFlagFy ?? 'never flagged'}</td><td>${e.yearsEarly ?? '-'}</td></tr>`)}</tbody></table>`,
      6,
    )}
    ${panel('C', 'Caveats', html`<ul class="plain">${(v.caveats ?? []).map((c) => html`<li>${c}</li>`)}</ul>`, 6)}
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
