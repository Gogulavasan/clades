/** Screen 1: the company report. Everything here is rendered from the case file. */
import { byImportance, flagged, type CaseFile } from '../casefile/build';
import { BENEISH_RATIOS } from '../models/beneish';
import { RULES } from '../rules/config';
import { fmt, type RuleResult } from '../rules/engine';
import type { CaseRecord } from '../storage/store';
import { beneishChart, n0, pairedColumns, priceChart, scoreBar, tag, trendLines, waterfall } from './charts';
import { empty, html, panel, type Raw } from './dom';
import type { CaseTab } from './router';
import { day } from './state';

const TOP_FLAGS = 6;
const TIER_CLASS: Record<string, string> = { clean: 'lv-green', watch: 'lv-amber', suspicious: 'lv-red', not_assessable: 'lv-muted' };

const shortSource = (r: RuleResult): string => {
  const first = r.inputs[0];
  if (!first) return r.battery;
  const row = /row \d+ "[^"]*"/.exec(first.source)?.[0] ?? first.source;
  return r.inputs.length > 1 ? `${row} +${r.inputs.length - 1} more` : row;
};

const threshold = (r: RuleResult): string =>
  r.battery.startsWith('F ') ? 'any matching sentence' : r.id.startsWith('BEN_') ? `amber above ${r.amber}, red from ${r.red}` : `amber ${r.direction === 'higher' ? '≥' : '≤'} ${fmt(r.amber, r.format)}, red ${r.direction === 'higher' ? '≥' : '≤'} ${fmt(r.red, r.format)}`;

const benchNote = (r: RuleResult): Raw | null =>
  r.benchmark ? html` <span class="muted">vs sector ${r.benchmark.value === null ? 'n/a' : (r.benchmark.value * (r.benchmark.key === 'cfoToPat' ? 1 : 100)).toFixed(r.benchmark.key === 'cfoToPat' ? 2 : 0)}${r.benchmark.key === 'cfoToPat' ? 'x' : '%'}${r.benchmark.placeholder ? ' (placeholder benchmark)' : ''}</span>` : null;

/** One rule as an expandable evidence card: value, thresholds, formula, every input with its source. */
function ruleCard(r: RuleResult): Raw {
  return html`<details class="rule">
    <summary>${tag(r.level)} <span class="rule-t">${r.title}</span> <span class="rule-v">${r.display}</span>${r.usesProxy ? html` <span class="tag lv-info">PROXY</span>` : null}</summary>
    <div class="rule-b">
      <p>${r.plain}${benchNote(r)}</p>
      <p><span class="k">Innocent explanation:</span> ${r.innocent}</p>
      ${r.nextStep ? html`<p><span class="k">Worth checking:</span> ${r.nextStep}</p>` : null}
      ${r.quotes?.length ? html`<ul class="plain quotes">${r.quotes.map((q) => html`<li>“${q.sentence}” <span class="lv-amber">page ${q.page}</span></li>`)}</ul>` : null}
      <p class="muted">Formula: <code>${r.formula}</code> · ${threshold(r)} · weight ${r.weight} · ${r.leg} · ${r.battery}</p>
      ${r.missing.length ? html`<p class="muted">Not computed because: ${r.missing.join('; ')}. Nothing was estimated.</p>` : null}
      ${r.level === 'na' ? html`<p class="muted">Not applicable to this company-year (the rule's condition is not met).</p>` : null}
      ${r.inputs.length
        ? html`<table class="tbl">
            <thead><tr><th scope="col">Input</th><th scope="col">Year</th><th scope="col">Value</th><th scope="col">Confidence</th><th scope="col">Source</th></tr></thead>
            <tbody>
              ${r.inputs.map((i) => html`<tr><td>${i.label}</td><td>${i.year}</td><td>${i.value.toFixed(2)}</td><td>${i.proxy ? 'PROXY' : i.confidence.toUpperCase()}</td><td class="muted">${i.source}</td></tr>`)}
            </tbody>
          </table>`
        : null}
    </div>
  </details>`;
}

const ruleList = (rules: RuleResult[], none: string): Raw =>
  rules.length ? html`<div class="rules">${[...rules].sort(byImportance).map(ruleCard)}</div>` : html`<p class="muted">${none}</p>`;

function verdictPanel(cf: CaseFile): Raw {
  const v = cf.verdict;
  const t = v.triangle;
  return html`<p class="tier ${TIER_CLASS[v.tier] ?? ''}">${v.label}${v.unconfirmed ? ' · UNCONFIRMED' : ''}${cf.status === 'partial' ? ' · PARTIAL' : ''}</p>
    <p>Score <strong class="big">${v.score ?? '-'}</strong> / 100 <span class="muted">(clean below ${RULES.scoring.tiers.watchFrom}, suspicious from ${RULES.scoring.tiers.suspiciousFrom})</span></p>
    <p>Models flagging: <strong>${v.modelsFlagging} of ${v.modelsComputable}</strong> computable <span class="muted">${v.models.filter((m) => m.flagged).map((m) => m.name).join(', ') || 'none'}</span></p>
    <p class="k sub">FRAUD TRIANGLE</p>
    ${t ? html`${scoreBar('PRESSURE', t.pressure.score, t.pressure.level)}${scoreBar('OPPORTUNITY', t.opportunity.score, t.opportunity.level)}${scoreBar('RATIONALISE', t.rationalisation.score, t.rationalisation.level)}` : null}
    ${t?.opportunity.score === null ? html`<p class="muted">Opportunity N/A: governance facts are not in this input.</p>` : null}
    <p class="k sub">REPORTED → STRESS-TESTED PROFIT</p>
    <p class="big">₹${n0(cf.honest?.reported ?? null)} cr <span class="muted">→</span> <span class="lv-info">₹${n0(cf.honest?.stressed ?? null)} cr</span></p>
    <p class="muted">A stress test under adjustable assumptions (panel 5), not an estimate of true profit.</p>
    <p class="summary">${v.summary}</p>`;
}

function beneishLine(cf: CaseFile): Raw {
  const b = cf.beneish;
  if (!b) return html`<p class="muted">Beneish needs two consecutive years of data.</p>`;
  const th = RULES.beneish.thresholds;
  return html`<p>
    M-SCORE <strong class="${b.m === null ? 'lv-muted' : b.m >= th.flag ? 'lv-red' : b.m >= th.conservative ? 'lv-amber' : 'lv-green'}">${b.m === null ? 'n/a' : b.m.toFixed(2)}</strong>
    vs threshold ${th.flag} → <strong>${b.verdict}</strong> · ${b.red} red, ${b.amber} amber, ${b.green} green${b.strict ? ' · STRICT MODE' : ''}
  </p>`;
}

function evidencePanel(cf: CaseFile): Raw {
  const top = cf.rules.filter(flagged).sort(byImportance).slice(0, TOP_FLAGS);
  if (top.length === 0) return html`<p><span class="tag lv-green">PASS</span> No check is at amber or red. See the tabs for every check that ran.</p>`;
  return html`<div class="scroll"><table class="tbl">
    <thead><tr><th scope="col">#</th><th scope="col">Finding</th><th scope="col">Figure vs threshold</th><th scope="col">Source</th><th scope="col">Innocent explanation to check</th></tr></thead>
    <tbody>
      ${top.map((r, i) => html`<tr>
        <td>${i + 1}</td>
        <td>${tag(r.level)} <span class="k">${r.title}</span></td>
        <td><span class="${r.level === 'red' ? 'lv-red' : 'lv-amber'}">${r.display}</span> <span class="muted">${threshold(r)}</span>${benchNote(r)}</td>
        <td class="muted">${shortSource(r)}${r.usesProxy ? ' (PROXY)' : ''}</td>
        <td>${r.innocent}</td>
      </tr>`)}
    </tbody>
  </table></div>`;
}

function indiaPanel(cf: CaseFile): Raw {
  const pack = cf.rules.filter((r) => r.battery === 'India pack');
  return html`<p class="k sub">WORDS VS NUMBERS</p>
    ${cf.textPages === null
      ? html`<p class="muted">Needs the annual report text. Load the PDF route to quote management's claims against the figures.</p>`
      : cf.wordsVsNumbers.length
        ? cf.wordsVsNumbers.map((w) => html`<p class="muted">MGMT SAYS <span class="lv-amber">(page ${w.page})</span></p><p class="quote">“${w.claim}”</p><p class="muted">NUMBERS SAY</p><p class="lv-red">${w.rule}: ${w.figure} ${w.level === 'red' ? 'FLAG' : 'WATCH'}</p>`)
        : html`<p class="muted">${cf.textPages} page(s) scanned. No upbeat management claim (cash, balance sheet, margins, collections) was contradicted by a flagged figure.</p>`}
    <p class="k sub">INDIA PACK</p>
    <table class="tbl"><tbody>
      ${pack.map((r) => html`<tr><td class="k">${r.title}</td><td>${r.display}</td><td>${tag(r.level)}</td></tr>`)}
    </tbody></table>
    <p class="muted">NO DATA rows need facts the spreadsheet does not carry. Add them on the confirm screen.</p>`;
}

function qualityPanel(cf: CaseFile): Raw {
  const dq = cf.dataQuality;
  const c = dq.integrity.checks;
  const count = (s: string): number => c.filter((x) => x.status === s).length;
  return html`<p>Confidence <strong>${cf.verdict.confidence.level}</strong> (${cf.verdict.confidence.score}/100) · ${cf.company.years.length} year(s) · ${cf.company.basis}</p>
    <ul class="plain">${cf.verdict.confidence.reasons.map((r) => html`<li>${r}</li>`)}</ul>
    <table class="tbl">
      <thead><tr><th scope="col">Statement (${cf.company.latestYear})</th><th scope="col">Lines found</th><th scope="col">High</th><th scope="col">Med</th><th scope="col">Low</th><th scope="col">Proxy</th><th scope="col">Extraction</th></tr></thead>
      <tbody>${dq.statements.map((s) => html`<tr><td class="k">${s.name}</td><td>${s.present} / ${s.total}</td><td>${s.high}</td><td>${s.medium}</td><td>${s.low}</td><td>${s.proxy}</td><td>${s.level}</td></tr>`)}</tbody>
    </table>
    <p>Integrity checks: <span class="lv-green">${count('pass')} PASS</span> · <span class="lv-amber">${count('warn')} WARN</span> · <span class="lv-red">${count('fail')} FAIL</span> · <span class="muted">${count('not_run')} not run (lines missing)</span></p>
    ${c.filter((x) => x.status === 'warn').slice(0, 4).map((x) => html`<p class="muted">WARN ${x.year}: ${x.label}. ${x.detail}</p>`)}
    <ul class="plain muted">${[cf.company.accountingNote, ...dq.notes, ...dq.proxies.map((p) => `PROXY: ${p}`)].map((n) => html`<li>${n}</li>`)}</ul>
    <p class="muted">Sector benchmarks: ${cf.benchmarks.placeholder ? 'PLACEHOLDER' : `as of ${cf.benchmarks.asOf ?? 'n/a'}`}. ${cf.benchmarks.source}</p>`;
}

function beneishTable(cf: CaseFile): Raw {
  const b = cf.beneish;
  if (!b) return empty('NO DATA', 'Beneish needs two consecutive years.');
  const cfg = RULES.beneish;
  return html`<div class="scroll"><table class="tbl">
      <thead><tr><th scope="col">Ratio</th><th scope="col">Value</th><th scope="col">Non-manip. mean</th><th scope="col">Manip. mean</th><th scope="col">Light</th><th scope="col">Weight in M</th><th scope="col">Contribution</th></tr></thead>
      <tbody>
        ${BENEISH_RATIOS.map((k) => {
          const v = b.ratios[k];
          return html`<tr><td class="k">${k} <span class="muted">${cfg.ratios[k].name}</span></td><td>${v === null ? 'n/a' : v.toFixed(3)}</td><td>${cfg.ratios[k].nonManipulator}</td><td>${cfg.ratios[k].manipulator}</td>
            <td>${tag(b.lights[k])}</td><td>${cfg.coefficients[k]}</td><td>${v === null ? 'n/a' : (cfg.coefficients[k] * v).toFixed(3)}</td></tr>`;
        })}
        <tr><td class="k">Intercept</td><td></td><td></td><td></td><td></td><td></td><td>${cfg.intercept}</td></tr>
        <tr><td class="k"><strong>M-score</strong></td><td></td><td></td><td></td><td></td><td></td><td><strong>${b.m === null ? 'n/a' : b.m.toFixed(3)}</strong></td></tr>
      </tbody>
    </table></div>
    <ul class="plain">${b.reasons.map((r) => html`<li>${r}</li>`)}</ul>
    <p class="muted">
      Two-key rule: CLEAN needs the M-score below ${cfg.thresholds.flag} AND no more than ${cfg.maxRedForClean} red ratios. Strict mode needs every traffic-lighted ratio green.
      SGAI is shown as INFO: its two reference means are almost equal (${cfg.ratios.SGAI.nonManipulator} vs ${cfg.ratios.SGAI.manipulator}) and its weight is negative, so it has weak discriminating power.
      Reference means are from Beneish (1999), a US sample: verify against the paper and recalibrate on Indian data. TATA method: ${b.tataMethod}.
    </p>`;
}

const settingsBar = (cf: CaseFile): Raw => html`<p class="banner">
  <label><input type="checkbox" data-act="rescore" data-k="strict" ${cf.settings.strict ? html`checked` : null} /> Beneish strict mode</label> &nbsp;
  <label><input type="checkbox" data-act="rescore" data-k="proxies" ${cf.settings.proxies ? html`checked` : null} /> Use PROXY figures</label>
  <span class="muted"> · changing these re-scores this company</span>
</p>`;

export function caseView(rec: CaseRecord, tab: CaseTab): Raw {
  const cf = rec.caseFile;
  const head = html`${cf.sample ? html`<p class="banner sample" role="note"><span class="tag lv-red">SAMPLE</span> Synthetic demo company. Not a real company, not real data.</p>` : null}
    <p class="banner">
      <strong>${cf.company.name}</strong> · ${cf.company.sector} · ${cf.company.latestYear} · ${cf.company.unit} · scanned ${day(cf.generatedAt)} · quarantine status ${rec.status}
      &nbsp; <button type="button" data-act="case-json" data-id="${rec.id}">CASE FILE JSON</button> <button type="button" data-act="case-delete" data-id="${rec.id}">DELETE</button>
    </p>`;
  if (cf.status === 'not_assessable') {
    return html`${head}<div class="grid">${panel(1, 'Verdict', html`<p class="tier lv-muted">NOT ASSESSABLE WITH THESE RULES</p><p>${cf.statusReason}</p><p class="muted">No score is produced and this company is not placed in quarantine.</p>`)}</div>`;
  }
  const s = cf.series;
  const patCash = pairedColumns(s.years, s.netIncome, s.cfo, ['PAT', 'CFO']);
  const inBattery = (...prefixes: string[]): RuleResult[] => cf.rules.filter((r) => prefixes.some((p) => r.battery.startsWith(p)));
  const p = {
    verdict: panel(1, 'Verdict', verdictPanel(cf), 4),
    trend: trendPanel(rec),
    beneish: panel(3, 'Beneish · 8 ratios vs non-manipulator mean (1.00)', html`${beneishChart(cf)}${beneishLine(cf)}`, 5),
    cash: panel(4, 'Profit vs cash · 5 years (₹ cr)', patCash, 4),
    bridge: panel(5, 'Honest-profit bridge', bridgePanel(cf, false), 3),
    evidence: panel(6, 'Evidence ledger · top flags', evidencePanel(cf), 8),
    india: panel(7, 'Words vs numbers · India pack', indiaPanel(cf), 4),
    next: panel(8, 'Next steps', cf.nextSteps.length ? html`<ol class="steps">${cf.nextSteps.map((n) => html`<li>${n}</li>`)}</ol>` : html`<p class="muted">Nothing specific to chase. Re-scan when the next annual report is out.</p>`, 6),
    quality: panel(9, 'Data quality', qualityPanel(cf), 6),
  };
  const combos = cf.verdict.combos.length ? panel('+', 'Combination rules triggered', html`<ul class="plain">${cf.verdict.combos.map((c) => html`<li>${c.text} <span class="muted">(${c.effect})</span></li>`)}</ul><p class="muted">Base score from the three legs: ${cf.verdict.baseScore}.</p>`) : null;
  const body: Record<CaseTab, Raw> = {
    verdict: html`${p.verdict}${p.trend}${p.beneish}${p.cash}${p.bridge}${p.evidence}${p.india}${p.next}${p.quality}${combos}`,
    earnings: html`${panel(4, 'Profit vs cash · 5 years (₹ cr)', patCash, 5)}
      ${panel('A', 'Earnings quality', ruleList(inBattery('A '), 'No earnings-quality rules.'), 7)}
      ${panel('B', 'Revenue quality', ruleList(inBattery('B '), 'No revenue rules.'), 6)}
      ${panel('E', 'Too good to be true · cost and asset games', ruleList(inBattery('E ', 'C '), 'No rules.'), 6)}
      ${panel(5, 'Honest-profit bridge · adjust the assumptions', bridgePanel(cf, true))}`,
    beneish: html`${settingsBar(cf)}<div class="grid">${panel(3, 'Beneish · 8 ratios vs non-manipulator mean (1.00)', html`${beneishChart(cf)}${beneishLine(cf)}`, 5)}
      ${panel('M', 'M-score working', beneishTable(cf), 7)}
      ${panel('R', 'Each ratio: formula, inputs and sources', ruleList(inBattery('Beneish'), 'Beneish needs two consecutive years.'))}</div>`,
    cash: html`${panel(4, 'Profit vs cash · 5 years (₹ cr)', patCash, 5)}
      ${panel('D', 'Balance sheet logic', ruleList(inBattery('D '), 'No rules.'), 7)}
      ${panel('G', 'Cross-statement consistency', ruleList(inBattery('G '), 'No rules.'), 6)}
      ${panel('P', 'Distress and quality models', html`<table class="tbl"><thead><tr><th scope="col">Model</th><th scope="col">Looks for</th><th scope="col">Value</th><th scope="col">Rule</th><th scope="col">Result</th></tr></thead>
        <tbody>${cf.verdict.models.map((m) => html`<tr><td class="k">${m.name}</td><td>${m.measures}</td><td>${m.display}</td><td class="muted">${m.rule}</td><td>${m.flagged === null ? html`<span class="tag lv-muted">NO DATA</span>` : m.flagged ? html`<span class="tag lv-red">FLAG</span>` : html`<span class="tag lv-green">PASS</span>`}</td></tr>`)}</tbody></table>
        ${cf.piotroski ? html`<p class="muted">Piotroski tests: ${cf.piotroski.tests.map((t) => `${t.name} ${t.pass === null ? 'n/a' : t.pass ? 'PASS' : 'FAIL'}`).join(' · ')}</p>` : null}
        ${ruleList(inBattery('Distress', 'Quality'), '')}`, 6)}`,
    governance: html`${panel('O', 'Opportunity leg · governance facts', html`${ruleList(cf.rules.filter((r) => r.leg === 'opportunity'), 'No opportunity rules.')}
        <p class="muted">The governance and text checks read the annual report PDF with a fixed keyword lexicon (config/lexicon.json). Open any check to see the quoted sentence and its page. "No match" means no listed phrase was found in the pages read; it is not a clean bill of health. Not yet covered: auditor tenure and size, receivables ageing from the notes.</p>`, 7)}
      ${p.india}${p.next}`,
  };
  return html`${head}${tab === 'beneish' ? body.beneish : html`<div class="grid">${body[tab]}</div>`}`;
}

const PCT = 100;
const MAX_TAX_PCT = 40;

/** Panel 5: waterfall from reported to stress-tested profit; with sliders when `sliders` is true. */
function bridgePanel(cf: CaseFile, sliders: boolean): Raw {
  const h = cf.honest;
  if (!h || h.reported === null) return empty('NO DATA', 'Needs the net profit for the latest year.');
  const head = html`${waterfall(h)}
    <p>Reported ₹${n0(h.reported)} cr → stress-tested <strong class="lv-info">₹${n0(h.stressed)} cr</strong></p>`;
  if (!sliders) return html`${head}<p class="muted">Each step and its assumption can be adjusted on F2 EARNINGS.</p>`;
  return html`${head}
    <div class="sliders">
      ${h.items.map((i) => html`<label for="h-${i.id}">
        <span><span class="k">${i.label}</span>: <strong>${Math.round(i.pct * PCT)}%</strong> of ₹${i.base === null ? 'n/a' : n0(i.base)} cr → <span class="lv-red">−₹${n0(i.afterTax)} cr</span> after tax</span>
        <input type="range" min="0" max="100" step="5" value="${Math.round(i.pct * PCT)}" id="h-${i.id}" data-act="rescore" data-k="h:${i.id}" />
        <span class="muted">${i.explain}${i.base === null ? ' NOT COMPUTED: an input is missing, so no adjustment is made.' : ''}</span>
      </label>`)}
      <label for="h-taxRate">
        <span><span class="k">Tax shield</span>: <strong>${Math.round(h.params.taxRate * PCT)}%</strong></span>
        <input type="range" min="0" max="${MAX_TAX_PCT}" step="1" value="${Math.round(h.params.taxRate * PCT)}" id="h-taxRate" data-act="rescore" data-k="h:taxRate" />
        <span class="muted">Each adjustment lowers taxable profit, so its after-tax effect is smaller.</span>
      </label>
    </div>
    <p class="muted">The defaults are deliberately harsh round numbers, not estimates. The bridge answers "how much of this profit depends on soft items?", not "what is the true profit?".
      <button type="button" data-act="rescore" data-k="h:reset">RESET TO DEFAULTS</button></p>`;
}

/** Panel 2: price and volume when the user has loaded a price CSV; otherwise the revenue and PAT trend, saying so. */
function trendPanel(rec: CaseRecord): Raw {
  const s = rec.caseFile.series;
  if (rec.price?.length) {
    return panel(2, 'Price · volume vs flag date', html`${priceChart(rec.price, rec.flagDate)}
      <p class="muted">${rec.price.length} price points from your CSV. The marker is the date this company first scored Watch or Suspicious in this browser (${day(rec.flagDate)}), not the date of any event.
        <button type="button" data-act="price-clear" data-id="${rec.id}">REMOVE PRICE DATA</button></p>`, 8);
  }
  return panel(2, 'Revenue & PAT trend (no price CSV loaded)', html`${trendLines(s.years, [['Revenue', s.revenue, '#2ee66b'], ['PAT', s.netIncome, '#ffb000']])}
    <p class="muted">Each line is scaled to its own range. For price and volume with a "flag raised" marker, load a price CSV with columns date, close, volume:
      <label class="btn">LOAD PRICE CSV<input type="file" class="sr" accept=".csv,text/csv" data-act="price" data-id="${rec.id}" /></label></p>`, 8);
}
