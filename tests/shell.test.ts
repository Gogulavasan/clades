import { describe, expect, it } from 'vitest';
import { RULE_LIBRARY_VERSION } from '../src/config';
import { parseCommand } from '../src/ui/command';
import { esc, html } from '../src/ui/dom';
import { CASE_TABS, NO_CASE, formatRoute, parseRoute, type Route } from '../src/ui/router';
import { renderRoute } from '../src/ui/views';

describe('router', () => {
  it('treats an empty hash as home', () => {
    for (const h of ['', '#', '#/']) expect(parseRoute(h)).toEqual({ name: 'home' });
  });

  it('parses case routes and defaults the tab to verdict', () => {
    expect(parseRoute('#/case/INFY/beneish')).toEqual({ name: 'case', id: 'INFY', tab: 'beneish' });
    expect(parseRoute('#/case/INFY')).toEqual({ name: 'case', id: 'INFY', tab: 'verdict' });
    expect(parseRoute('#/case')).toEqual({ name: 'case', id: NO_CASE, tab: 'verdict' });
  });

  it('rejects unknown tabs, extra segments and malformed escapes', () => {
    expect(parseRoute('#/case/INFY/nope').name).toBe('notfound');
    expect(parseRoute('#/portfolio/extra').name).toBe('notfound');
    expect(parseRoute('#/case/%E0%A4%A').name).toBe('notfound');
    expect(parseRoute('#/whatever').name).toBe('notfound');
  });

  it('round-trips every route, including tickers that need encoding', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'portfolio' },
      { name: 'validation' },
      { name: 'privacy' },
      { name: 'help' },
      ...CASE_TABS.map((tab): Route => ({ name: 'case', id: 'M&M', tab })),
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});

describe('command line', () => {
  it('opens a company from the Bloomberg-style command', () => {
    const want = { ok: true, route: { name: 'case', id: 'INFY', tab: 'verdict' } };
    expect(parseCommand('INFY <EQUITY> CLADES <GO>')).toEqual(want);
    expect(parseCommand('  infy  ')).toEqual(want);
  });

  it('opens a company on a named tab', () => {
    expect(parseCommand('m&m equity beneish go')).toEqual({ ok: true, route: { name: 'case', id: 'M&M', tab: 'beneish' } });
  });

  it('routes reserved words', () => {
    expect(parseCommand('PORT <GO>')).toEqual({ ok: true, route: { name: 'portfolio' } });
    expect(parseCommand('priv')).toEqual({ ok: true, route: { name: 'privacy' } });
    expect(parseCommand('HELP')).toEqual({ ok: true, route: { name: 'help' } });
  });

  it('explains what went wrong instead of guessing', () => {
    for (const bad of ['', '<GO>', 'INFY NOPE', 'INFY CASH EXTRA', '<script>']) {
      const res = parseCommand(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(10);
    }
  });
});

describe('html templating', () => {
  it('escapes interpolated values but not nested templates', () => {
    const evil = '<img src=x onerror="alert(1)">';
    const out = html`<p>${evil}${html`<b>${'a&b'}</b>`}${[html`<i>1</i>`, 2]}${null}${false}</p>`.value;
    expect(out).toBe(`<p>${esc(evil)}<b>a&amp;b</b><i>1</i>2</p>`);
    expect(out).not.toContain('<img');
  });
});

describe('screens', () => {
  it('renders every route to non-empty markup', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'portfolio' },
      { name: 'validation' },
      { name: 'privacy' },
      { name: 'help' },
      { name: 'notfound', path: 'x' },
      ...CASE_TABS.map((tab): Route => ({ name: 'case', id: NO_CASE, tab })),
    ];
    for (const r of routes) expect(renderRoute(r).body.value.length).toBeGreaterThan(50);
  });

  it('shows all nine panels on the verdict tab', () => {
    const body = renderRoute({ name: 'case', id: NO_CASE, tab: 'verdict' }).body.value;
    for (let n = 1; n <= 9; n++) expect(body).toContain(`id="p-${n}"`);
  });

  it('never echoes an unknown ticker or path as live markup', () => {
    const evil = '<svg onload=alert(1)>';
    expect(renderRoute({ name: 'case', id: evil, tab: 'verdict' }).body.value).not.toContain(evil);
    expect(renderRoute({ name: 'notfound', path: evil }).body.value).not.toContain(evil);
  });

  it('avoids the word "fraud" except in the disclaimer and the Fraud Triangle framework name', () => {
    const page = renderRoute({ name: 'home' }).body.value.replace('not fraud', '').replaceAll('Fraud Triangle', '');
    expect(page.toLowerCase()).not.toContain('fraud');
  });

  it('exposes a semantic rule library version', () => {
    expect(RULE_LIBRARY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
