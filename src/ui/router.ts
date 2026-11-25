/** Hash-based routing: GitHub Pages has no SPA fallback, so every route lives after the '#'. */

export const CASE_TABS = ['verdict', 'earnings', 'beneish', 'cash', 'governance'] as const;
export type CaseTab = (typeof CASE_TABS)[number];

/** Placeholder case id used when no company has been loaded yet. */
export const NO_CASE = '-';

export type Route =
  | { name: 'home' }
  | { name: 'case'; id: string; tab: CaseTab }
  | { name: 'portfolio' }
  | { name: 'validation' }
  | { name: 'privacy' }
  | { name: 'help' }
  | { name: 'notfound'; path: string };

const isCaseTab = (s: string): s is CaseTab => (CASE_TABS as readonly string[]).includes(s);

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+|\/+$/g, '');
  if (path === '') return { name: 'home' };
  const parts = path.split('/').map(decode);
  const [head, a, b] = parts;
  const notfound: Route = { name: 'notfound', path };
  if (parts.includes(null)) return notfound;
  if (head === 'case' && parts.length <= 3) {
    const tab = b ?? 'verdict';
    return isCaseTab(tab) ? { name: 'case', id: a || NO_CASE, tab } : notfound;
  }
  if (parts.length !== 1) return notfound;
  if (head === 'portfolio' || head === 'validation' || head === 'privacy' || head === 'help') return { name: head };
  return notfound;
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'case':
      return `#/case/${encodeURIComponent(r.id)}/${r.tab}`;
    case 'notfound':
      return `#/${r.path}`;
    default:
      return `#/${r.name}`;
  }
}
