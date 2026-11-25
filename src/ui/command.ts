/** Bloomberg-style command line: "INFY <EQUITY> CLADES <GO>", "PORT <GO>", "HELP". Pure parsing only. */
import type { CaseTab, Route } from './router';

export type CommandResult = { ok: true; route: Route } | { ok: false; error: string };

/** Single-word commands. A ticker that collides with one can still be reached as "<TICKER> VERDICT". */
const RESERVED: Record<string, Route> = {
  HOME: { name: 'home' },
  LOAD: { name: 'home' },
  UPLOAD: { name: 'home' },
  PORT: { name: 'portfolio' },
  PORTFOLIO: { name: 'portfolio' },
  VAL: { name: 'validation' },
  VALIDATION: { name: 'validation' },
  PRIV: { name: 'privacy' },
  PRIVACY: { name: 'privacy' },
  HELP: { name: 'help' },
};

const FUNCTIONS: Record<string, CaseTab> = {
  VERDICT: 'verdict',
  EARN: 'earnings',
  EARNINGS: 'earnings',
  BEN: 'beneish',
  BENEISH: 'beneish',
  CASH: 'cash',
  GOV: 'governance',
  GOVERNANCE: 'governance',
};

/** Decorative Bloomberg keys that carry no meaning here. */
const NOISE = new Set(['<EQUITY>', 'EQUITY', '<GO>', 'GO', 'CLADES']);
const TICKER = /^[A-Z0-9][A-Z0-9&.-]{0,19}$/;

export const COMMAND_HINT = 'Try: INFY <EQUITY> CLADES <GO>, PORT, VAL, PRIV or HELP';

export function parseCommand(input: string): CommandResult {
  const tokens = input
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t !== '' && !NOISE.has(t));
  const [first, fn, ...extra] = tokens;
  if (first === undefined) return { ok: false, error: `Empty command. ${COMMAND_HINT}` };
  if (fn === undefined) {
    const reserved = RESERVED[first];
    if (reserved) return { ok: true, route: reserved };
  }
  if (!TICKER.test(first)) return { ok: false, error: `"${first}" is not a valid ticker. ${COMMAND_HINT}` };
  if (extra.length > 0) return { ok: false, error: `Too many words after ${first}. ${COMMAND_HINT}` };
  const tab = fn === undefined ? 'verdict' : FUNCTIONS[fn];
  if (tab === undefined) {
    return { ok: false, error: `Unknown function "${fn}". Use VERDICT, EARN, BENEISH, CASH or GOV.` };
  }
  return { ok: true, route: { name: 'case', id: first, tab } };
}
