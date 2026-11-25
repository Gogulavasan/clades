/** The terminal chrome: badge, command line, F-key tabs, flag tape, status bar, keyboard handling. */
import { APP_NAME, DISCLAIMER, RULE_LIBRARY_VERSION, STORAGE_NOTE } from '../config';
import { parseCommand } from './command';
import { html } from './dom';
import { CASE_TABS, NO_CASE, formatRoute, parseRoute, type Route } from './router';
import { renderRoute } from './views';

type FKey = { key: number; label: string; target: 'tab' | 'portfolio' | 'export'; tabIndex?: number };

const FKEYS: readonly FKey[] = [
  ...CASE_TABS.map((t, i): FKey => ({ key: i + 1, label: t, target: 'tab', tabIndex: i })),
  { key: 6, label: 'portfolio', target: 'portfolio' },
  { key: 7, label: 'export pdf', target: 'export' },
];

export function mountShell(root: HTMLElement): void {
  let currentCase = NO_CASE;
  let route: Route = { name: 'home' };

  root.innerHTML = html`<a class="skip" href="#main">Skip to content</a>
    <header class="topbar">
      <a class="badge" href="#/" aria-label="${APP_NAME} home">${APP_NAME}</a>
      <form class="cmd" id="cmd-form" role="search" autocomplete="off">
        <label class="sr" for="cmd">Command line</label>
        <input id="cmd" type="text" spellcheck="false" placeholder="<TICKER> <EQUITY> CLADES <GO>" />
        <button type="submit">&lt;GO&gt;</button>
      </form>
      <span class="ctx" id="ctx"></span>
      <nav class="links" aria-label="Pages">
        <a href="#/validation">VALIDATION</a><a href="#/privacy">PRIVACY</a><a href="#/help">HELP</a>
      </nav>
    </header>
    <p class="cmd-msg" id="cmd-msg" role="status" aria-live="polite"></p>
    <nav class="fkeys" aria-label="Function keys">
      ${FKEYS.map(
        (f) =>
          html`<button type="button" data-fkey="${f.key}" aria-keyshortcuts="F${f.key} Alt+${f.key}">
            <span class="fk">F${f.key}</span> ${f.label}
          </button>`,
      )}
    </nav>
    <div class="tape" aria-label="Latest flags">
      <span class="tape-label">FLAG TAPE</span><span class="muted">NO FLAGS · no company has been scanned</span>
    </div>
    <main id="main" tabindex="-1"></main>
    <p class="disclaimer">${DISCLAIMER}</p>
    <footer class="statusbar">
      <span><span class="ok">●</span> ENGINE OK</span><span>RULE LIBRARY v${RULE_LIBRARY_VERSION}</span
      ><span>${STORAGE_NOTE}</span>
    </footer>`.value;

  const need = <T extends HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`CLADES shell: missing ${sel}`);
    return el;
  };
  const main = need<HTMLElement>('#main');
  const ctx = need<HTMLElement>('#ctx');
  const msg = need<HTMLElement>('#cmd-msg');
  const cmd = need<HTMLInputElement>('#cmd');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-fkey]')];

  const go = (r: Route): void => {
    const next = formatRoute(r);
    if (location.hash === next) render();
    else location.hash = next;
  };

  const say = (text: string): void => {
    msg.textContent = text;
  };

  function press(n: number): void {
    const f = FKEYS.find((k) => k.key === n);
    if (!f) return;
    const tab = f.tabIndex === undefined ? undefined : CASE_TABS[f.tabIndex];
    if (f.target === 'tab' && tab) go({ name: 'case', id: currentCase, tab });
    else if (f.target === 'portfolio') go({ name: 'portfolio' });
    else if (route.name === 'case' && route.id !== NO_CASE) window.print();
    else say('F7 EXPORT PDF: load a company first. There is no case file to export.');
  }

  function render(): void {
    route = parseRoute(location.hash);
    if (route.name === 'case') currentCase = route.id;
    const { title, body } = renderRoute(route);
    main.innerHTML = body.value;
    document.title = `${title} · ${APP_NAME}`;
    ctx.textContent = title.toUpperCase();
    say('');
    for (const b of buttons) {
      const f = FKEYS.find((k) => String(k.key) === b.dataset.fkey);
      const tab = f?.tabIndex === undefined ? undefined : CASE_TABS[f.tabIndex];
      const active = (route.name === 'case' && tab === route.tab) || (route.name === 'portfolio' && f?.target === 'portfolio');
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  for (const b of buttons) b.addEventListener('click', () => press(Number(b.dataset.fkey)));

  need<HTMLFormElement>('#cmd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = parseCommand(cmd.value);
    if (!res.ok) return say(res.error);
    cmd.value = '';
    go(res.route);
    main.focus();
  });

  window.addEventListener('keydown', (e) => {
    const fn = /^F([1-7])$/.exec(e.key);
    const alt = e.altKey && !e.ctrlKey && !e.metaKey ? /^Digit([1-7])$/.exec(e.code) : null;
    const n = fn && !e.altKey && !e.ctrlKey && !e.metaKey ? fn[1] : alt?.[1];
    if (n) {
      e.preventDefault();
      press(Number(n));
      return;
    }
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === '/' && !typing) {
      e.preventDefault();
      cmd.focus();
    } else if (e.key === 'Escape' && e.target === cmd) {
      cmd.blur();
    }
  });

  window.addEventListener('hashchange', render);
  render();
}
