/** Tiny auto-escaping HTML templating. Every interpolated value is escaped unless it is itself a Raw. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export class Raw {
  constructor(readonly value: string) {}
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? '');
  });
  return new Raw(out);
}

/** A numbered dashboard panel with an amber title bar. `span` is its width on the 12-column grid. */
export const panel = (n: number | string, title: string, body: Raw, span = 12): Raw =>
  html`<section class="panel s${span}" aria-labelledby="p-${n}">
    <h2 class="ptitle" id="p-${n}"><span class="pnum">${n}</span> ${title}</h2>
    <div class="pbody">${body}</div>
  </section>`;

export const empty = (headline: string, detail: string): Raw =>
  html`<p class="empty"><strong>${headline}</strong><br /><span class="muted">${detail}</span></p>`;
