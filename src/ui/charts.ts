/** Hand-built SVG charts. No animation. Every chart carries its numbers as text, never colour alone. */
import type { CaseFile } from '../casefile/build';
import { BENEISH_RATIOS, type Light, type N } from '../models/beneish';
import { RULES } from '../rules/config';
import type { Level } from '../rules/engine';
import type { PricePoint } from '../ingest/price';
import type { HonestResult } from '../scoring/honest';
import { html, type Raw } from './dom';

export const LEVELS: Record<Level, readonly [cls: string, label: string]> = {
  red: ['lv-red', 'FLAG'],
  amber: ['lv-amber', 'WATCH'],
  green: ['lv-green', 'PASS'],
  info: ['lv-info', 'INFO'],
  missing: ['lv-muted', 'NO DATA'],
  na: ['lv-muted', 'N/A'],
};
export const tag = (level: Level): Raw => html`<span class="tag ${LEVELS[level][0]}">${LEVELS[level][1]}</span>`;

const COLOUR: Record<Light, string> = { red: '#ff4d4d', amber: '#ffb000', green: '#2ee66b', info: '#4cc3ff', missing: '#555' };
const AMBER = '#ffb000';
const CYAN = '#4cc3ff';
const f1 = (n: number): string => n.toFixed(1);
export const n0 = (v: N): string => (v === null ? 'n/a' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const isNum = (v: N): v is number => v !== null;

const noData = (what: string): Raw => html`<p class="empty"><strong>NO DATA</strong><br /><span class="muted">${what}</span></p>`;

/** Paired columns (e.g. PAT vs CFO) for the last `keep` years, with a zero line for negatives. */
export function pairedColumns(years: string[], a: N[], b: N[], names: readonly [string, string], keep = 5): Raw {
  const from = Math.max(0, years.length - keep);
  const [ys, as, bs] = [years.slice(from), a.slice(from), b.slice(from)];
  const vals = [...as, ...bs].filter(isNum);
  if (vals.length === 0) return noData(`${names[0]} and ${names[1]} are not available.`);
  const [W, H, top, bottom] = [420, 190, 16, 22];
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const y = (v: number): number => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
  const gw = W / ys.length;
  const bw = gw * 0.3;
  const bar = (v: N, x: number, fill: string): Raw | null =>
    v === null
      ? html`<text x="${f1(x + bw / 2)}" y="${f1(y(0) - 3)}" class="cv">n/a</text>`
      : html`<rect x="${f1(x)}" y="${f1(Math.min(y(v), y(0)))}" width="${f1(bw)}" height="${f1(Math.max(1, Math.abs(y(v) - y(0))))}" fill="${fill}" />
          <text x="${f1(x + bw / 2)}" y="${f1(v >= 0 ? y(v) - 3 : y(v) + 10)}" class="cv">${n0(v)}</text>`;
  const summary = ys.map((yr, i) => `${yr}: ${names[0]} ${n0(as[i] ?? null)}, ${names[1]} ${n0(bs[i] ?? null)}`).join('; ');
  return html`<p class="legend"><span style="color:${AMBER}">■</span> ${names[0]} &nbsp; <span style="color:${CYAN}">■</span> ${names[1]} <span class="muted">(INR crore)</span></p>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${summary}">
      ${ys.map((yr, i) => {
        const x = i * gw + gw * 0.17;
        return html`${bar(as[i] ?? null, x, AMBER)}${bar(bs[i] ?? null, x + bw + 3, CYAN)}<text x="${f1(i * gw + gw / 2)}" y="${H - 6}" class="cl">${yr}</text>`;
      })}
      <line x1="0" x2="${W}" y1="${f1(y(0))}" y2="${f1(y(0))}" stroke="#777" />
    </svg>`;
}

/** Two lines, each scaled to its own range, so the shape of revenue and profit can be compared. */
export function trendLines(years: string[], series: ReadonlyArray<readonly [name: string, values: N[], colour: string]>): Raw {
  const [W, H, top, bottom, right] = [560, 190, 18, 24, 118];
  if (years.length < 2) return noData('A trend needs at least two years.');
  const x = (i: number): number => 28 + (i / (years.length - 1)) * (W - right - 28);
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${series.map(([n, v]) => `${n}: ${v.map(n0).join(', ')}`).join('. ')}">
    ${years.map((yr, i) => html`<text x="${f1(x(i))}" y="${H - 6}" class="cl">${yr}</text><line x1="${f1(x(i))}" x2="${f1(x(i))}" y1="${top}" y2="${H - bottom}" stroke="#151000" />`)}
    ${series.map(([name, values, colour], s) => {
      const nums = values.filter(isNum);
      if (nums.length < 2) return null;
      const max = Math.max(...nums);
      const min = Math.min(0, ...nums);
      const y = (v: number): number => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
      const pts = values.map((v, i) => (v === null ? null : `${f1(x(i))},${f1(y(v))}`)).filter(Boolean).join(' ');
      const last = nums[nums.length - 1] ?? 0;
      return html`<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="2" />
        <text x="${W - right + 8}" y="${f1(Math.min(H - bottom, Math.max(top + 8, y(last) + 4 + s * 14)))}" fill="${colour}" class="ce">${name} ${n0(last)}</text>`;
    })}
  </svg>`;
}

const CAP = 2.5;
const LIGHT_TEXT: Record<Light, string> = { red: 'RED', amber: 'AMB', green: 'GRN', info: 'INFO', missing: 'N/A' };

/**
 * Eight Beneish columns. Height = ratio divided by its non-manipulator mean, so the dashed 1.00 line is
 * "typical of non-manipulators" for every ratio, including TATA which is not an index. Printed numbers are the raw ratios.
 */
export function beneishChart(cf: CaseFile): Raw {
  const b = cf.beneish;
  if (!b) return noData('Beneish needs two consecutive years.');
  const [W, H, top, base] = [520, 215, 14, 150];
  const gw = W / BENEISH_RATIOS.length;
  const unit = (base - top) / CAP;
  const summary = BENEISH_RATIOS.map((k) => `${k} ${b.ratios[k]?.toFixed(2) ?? 'n/a'} ${LIGHT_TEXT[b.lights[k]]}`).join(', ');
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Beneish ratios: ${summary}">
    ${BENEISH_RATIOS.map((k, i) => {
      const v = b.ratios[k];
      const rel = v === null ? 0 : Math.min(CAP, Math.max(0.02, v / RULES.beneish.ratios[k].nonManipulator));
      const cx = i * gw + gw / 2;
      return html`<rect x="${f1(cx - gw * 0.3)}" y="${f1(base - rel * unit)}" width="${f1(gw * 0.6)}" height="${f1(rel * unit)}" fill="${COLOUR[b.lights[k]]}" />
        ${v !== null && v / RULES.beneish.ratios[k].nonManipulator > CAP ? html`<text x="${f1(cx)}" y="${top - 3}" class="cv">▲ off scale</text>` : null}
        <text x="${f1(cx)}" y="${base + 16}" class="cb">${k}</text>
        <text x="${f1(cx)}" y="${base + 31}" class="cl">${v === null ? 'n/a' : v.toFixed(2)}</text>
        <text x="${f1(cx)}" y="${base + 45}" class="cl" style="fill:${COLOUR[b.lights[k]]}">${LIGHT_TEXT[b.lights[k]]}</text>`;
    })}
    <line x1="0" x2="${W}" y1="${f1(base - unit)}" y2="${f1(base - unit)}" stroke="#ddd" stroke-dasharray="5 4" />
    <text x="2" y="${f1(base - unit - 3)}" class="ce" fill="#ddd">1.00</text>
  </svg>`;
}

/** Horizontal 0-100 bar with its level printed beside it. */
export const scoreBar = (label: string, score: number | null, level: string): Raw => {
  const cls = level === 'HIGH' ? 'lv-red' : level === 'MED' ? 'lv-amber' : level === 'LOW' ? 'lv-green' : 'lv-muted';
  return html`<div class="sbar">
    <span class="sbar-l">${label}</span>
    <span class="sbar-t" role="img" aria-label="${label} ${score ?? 'not assessed'} out of 100, ${level}"><span class="sbar-f ${cls}" style="width:${score ?? 0}%"></span></span>
    <span class="sbar-v ${cls}">${score ?? '-'} ${level}</span>
  </div>`;
};

/** Simple horizontal count bars (sector breakdown, histogram). */
export function countBars(rows: ReadonlyArray<readonly [label: string, count: number]>, emptyText: string): Raw {
  const max = Math.max(0, ...rows.map(([, c]) => c));
  if (max === 0) return html`<p class="muted">${emptyText}</p>`;
  return html`<div class="cbars">
    ${rows.map(([label, c]) => html`<div class="cbar"><span class="cbar-l">${label}</span><span class="cbar-t"><span class="cbar-f" style="width:${(c / max) * 100}%"></span></span><span class="cbar-v">${c}</span></div>`)}
  </div>`;
}

const RED = '#ff4d4d';

/** Waterfall: reported profit, one falling step per adjustment, stress-tested profit. */
export function waterfall(h: HonestResult): Raw {
  if (h.reported === null || h.stressed === null) return noData('Net profit is not available.');
  let run = h.reported;
  const steps: { name: string; from: number; to: number; fill: string; label: string }[] = [{ name: 'REPORT', from: 0, to: h.reported, fill: AMBER, label: n0(h.reported) }];
  for (const i of h.items) {
    steps.push({ name: i.short, from: run, to: run - i.afterTax, fill: RED, label: i.base === null ? 'n/a' : `-${n0(i.afterTax)}` });
    run -= i.afterTax;
  }
  steps.push({ name: 'STRESS', from: 0, to: h.stressed, fill: CYAN, label: n0(h.stressed) });
  const [W, H, top, bottom] = [360, 200, 18, 22];
  const vals = steps.flatMap((s) => [s.from, s.to]);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const y = (v: number): number => top + ((max - v) / (max - min || 1)) * (H - top - bottom);
  const gw = W / steps.length;
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Honest-profit bridge: ${steps.map((s) => `${s.name} ${s.label}`).join(', ')}">
    ${steps.map((s, i) => {
      const yTop = Math.min(y(s.from), y(s.to));
      return html`<rect x="${f1(i * gw + gw * 0.15)}" y="${f1(yTop)}" width="${f1(gw * 0.7)}" height="${f1(Math.max(1.5, Math.abs(y(s.from) - y(s.to))))}" fill="${s.fill}" />
        <text x="${f1(i * gw + gw / 2)}" y="${f1(Math.max(10, yTop - 4))}" class="cv">${s.label}</text>
        <text x="${f1(i * gw + gw / 2)}" y="${H - 6}" class="cl">${s.name}</text>`;
    })}
    <line x1="0" x2="${W}" y1="${f1(y(0))}" y2="${f1(y(0))}" stroke="#777" />
  </svg>`;
}

/** Closing price (line) and volume (bars) with a dashed "flag raised" marker. */
export function priceChart(points: PricePoint[], flagDate: string | null): Raw {
  if (points.length < 2) return noData('The price CSV needs at least two rows.');
  const [W, H, top, priceBottom, volTop, volBottom] = [560, 215, 16, 130, 142, 190];
  const closes = points.map((p) => p.c);
  const [lo, hi] = [Math.min(...closes), Math.max(...closes)];
  const vmax = Math.max(1, ...points.map((p) => p.v ?? 0));
  const x = (i: number): number => 6 + (i / (points.length - 1)) * (W - 12);
  const y = (c: number): number => top + ((hi - c) / (hi - lo || 1)) * (priceBottom - top);
  const first = points[0];
  const last = points[points.length - 1];
  const flagDay = flagDate?.slice(0, 10) ?? null;
  const at = flagDay === null ? -1 : points.findIndex((p) => p.d >= flagDay);
  const outside = flagDay !== null && at === -1;
  const fi = outside ? points.length - 1 : at;
  const fp = points[fi];
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Closing price from ${first?.d} (${first?.c}) to ${last?.d} (${last?.c}), low ${lo}, high ${hi}">
    ${points.map((p, i) => (p.v === null ? null : html`<rect x="${f1(x(i) - 1)}" y="${f1(volBottom - (p.v / vmax) * (volBottom - volTop))}" width="2" height="${f1(Math.max(0.5, (p.v / vmax) * (volBottom - volTop)))}" fill="#1f6fa3" />`))}
    <polyline points="${points.map((p, i) => `${f1(x(i))},${f1(y(p.c))}`).join(' ')}" fill="none" stroke="#2ee66b" stroke-width="2" />
    ${fp
      ? html`<line x1="${f1(x(fi))}" x2="${f1(x(fi))}" y1="${top}" y2="${volBottom}" stroke="${RED}" stroke-dasharray="5 4" />
          <circle cx="${f1(x(fi))}" cy="${f1(y(fp.c))}" r="4" fill="${RED}" />
          <text x="${f1(Math.min(W - 4, x(fi) - 6))}" y="${top - 4}" text-anchor="end" fill="${RED}">FLAG RAISED${outside ? ' (after last price date)' : ''}</text>`
      : null}
    <text x="6" y="${H - 6}" fill="#9a9a9a">${first?.d} · ${first?.c}</text>
    <text x="${W - 6}" y="${H - 6}" text-anchor="end" fill="#9a9a9a">${last?.d} · ${last?.c}</text>
    <text x="6" y="${top + 8}" fill="#9a9a9a">high ${hi} · low ${lo}</text>
  </svg>`;
}
