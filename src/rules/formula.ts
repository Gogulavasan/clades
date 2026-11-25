/**
 * A small, safe formula language so rules in config/rules.json are computed exactly as written (no eval).
 *
 *   fields      revenue, cfo, totalAssets ...        value for the year being assessed
 *   variables   MSCORE, SLOAN, ALTMAN_Z ...          model outputs
 *   lag(x, n)   x evaluated n years earlier          growth(x) = x / lag(x, 1) - 1 (prior must be > 0)
 *   avg, min, max, abs                               sum(x, minYears, maxYears), sd(x, minYears, maxYears)
 *   when(cond, x)  x if cond is true, otherwise "not applicable"      bench("key")  sector benchmark
 *   + - * /  and comparisons > < >= <=
 *
 * Anything missing makes the whole result missing (null). Nothing is ever substituted.
 */

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'call'; f: string; a: Node[] };

interface Tok {
  k: 'num' | 'id' | 'str' | 'op';
  v: string;
}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|"([^"]*)"|(>=|<=|[-+*/(),<>]))/y;
const COMPARE = new Set(['>', '<', '>=', '<=']);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  while (src.slice(pos).trim() !== '') {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Formula syntax error at position ${pos}: ${src}`);
    if (m[1] !== undefined) out.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'str', v: m[3] });
    else out.push({ k: 'op', v: m[4] ?? '' });
    pos = TOKEN.lastIndex;
  }
  return out;
}

const cache = new Map<string, Node>();

export function parseFormula(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = lex(src);
  let i = 0;
  const isOp = (v: string): boolean => toks[i]?.k === 'op' && toks[i]?.v === v;
  const expect = (v: string): void => {
    if (!isOp(v)) throw new Error(`Formula: expected "${v}" in: ${src}`);
    i++;
  };
  const binary = (next: () => Node, ops: Set<string>): Node => {
    let l = next();
    for (let t = toks[i]; t?.k === 'op' && ops.has(t.v); t = toks[i]) {
      i++;
      l = { t: 'bin', op: t.v, l, r: next() };
    }
    return l;
  };
  const primary = (): Node => {
    const t = toks[i++];
    if (!t) throw new Error(`Formula ended unexpectedly: ${src}`);
    if (t.k === 'num') return { t: 'num', v: Number(t.v) };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      if (!isOp('(')) return { t: 'id', v: t.v };
      i++;
      const a: Node[] = [];
      if (!isOp(')')) {
        do a.push(compare());
        while (isOp(',') && ++i);
      }
      expect(')');
      return { t: 'call', f: t.v, a };
    }
    if (t.v === '(') {
      const e = compare();
      expect(')');
      return e;
    }
    throw new Error(`Formula: unexpected "${t.v}" in: ${src}`);
  };
  const unary = (): Node => {
    if (isOp('-')) {
      i++;
      return { t: 'neg', e: unary() };
    }
    return primary();
  };
  const mul = (): Node => binary(unary, new Set(['*', '/']));
  const add = (): Node => binary(mul, new Set(['+', '-']));
  function compare(): Node {
    return binary(add, COMPARE);
  }
  const node = compare();
  if (i < toks.length) throw new Error(`Formula: unexpected "${toks[i]?.v}" in: ${src}`);
  cache.set(src, node);
  return node;
}

export interface Env {
  /** undefined = not a schema field; null = field exists but the figure is missing for that year. */
  field(name: string, lag: number): number | null | undefined;
  variable(name: string): number | null | undefined;
  bench(key: string): number | null;
}

export interface Trace {
  missing: string[];
  inputs: { name: string; lag: number; value: number }[];
  bench: { key: string; value: number | null }[];
  /** A when() condition was false: the rule does not apply to this company-year. */
  notApplicable: boolean;
}

export const newTrace = (): Trace => ({ missing: [], inputs: [], bench: [], notApplicable: false });

const numArg = (n: Node | undefined, fn: string): number => {
  if (n?.t !== 'num') throw new Error(`Formula: ${fn}() needs a literal number`);
  return n.v;
};

function ev(n: Node, env: Env, lag: number, tr: Trace): number | null {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'str':
      throw new Error('Formula: a string is only valid inside bench("...")');
    case 'neg': {
      const v = ev(n.e, env, lag, tr);
      return v === null ? null : -v;
    }
    case 'id': {
      const f = env.field(n.v, lag);
      const v = f !== undefined ? f : lag === 0 ? env.variable(n.v) : null;
      if (v === undefined) throw new Error(`Formula: unknown name "${n.v}"`);
      const tag = lag ? `${n.v}[t-${lag}]` : n.v;
      if (v === null) {
        if (!tr.missing.includes(tag)) tr.missing.push(tag);
        return null;
      }
      if (!tr.inputs.some((x) => x.name === n.v && x.lag === lag)) tr.inputs.push({ name: n.v, lag, value: v });
      return v;
    }
    case 'bin': {
      const l = ev(n.l, env, lag, tr);
      const r = ev(n.r, env, lag, tr);
      if (l === null || r === null) return null;
      switch (n.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) {
            tr.missing.push('division by zero');
            return null;
          }
          return l / r;
        case '>': return Number(l > r);
        case '<': return Number(l < r);
        case '>=': return Number(l >= r);
        default: return Number(l <= r);
      }
    }
    case 'call':
      return call(n, env, lag, tr);
  }
}

function series(n: Node & { t: 'call' }, env: Env, lag: number, tr: Trace): number[] | null {
  const min = numArg(n.a[1], n.f);
  const max = numArg(n.a[2], n.f);
  const x = n.a[0];
  if (!x) throw new Error(`Formula: ${n.f}() needs an expression`);
  const vals: number[] = [];
  for (let k = 0; k < max; k++) {
    const scratch = newTrace();
    const v = ev(x, env, lag + k, scratch);
    if (v === null) break;
    vals.push(v);
    for (const inp of scratch.inputs) if (!tr.inputs.some((y) => y.name === inp.name && y.lag === inp.lag)) tr.inputs.push(inp);
  }
  if (vals.length < min) {
    tr.missing.push(`fewer than ${min} consecutive years of data`);
    return null;
  }
  return vals;
}

function call(n: Node & { t: 'call' }, env: Env, lag: number, tr: Trace): number | null {
  const arg = (k: number): Node => {
    const a = n.a[k];
    if (!a) throw new Error(`Formula: ${n.f}() is missing argument ${k + 1}`);
    return a;
  };
  switch (n.f) {
    case 'lag':
      return ev(arg(0), env, lag + numArg(n.a[1], 'lag'), tr);
    case 'growth': {
      const cur = ev(arg(0), env, lag, tr);
      const prev = ev(arg(0), env, lag + 1, tr);
      if (cur === null || prev === null) return null;
      if (prev <= 0) {
        tr.missing.push('growth undefined: prior-year value is not positive');
        return null;
      }
      return cur / prev - 1;
    }
    case 'when': {
      const c = ev(arg(0), env, lag, tr);
      if (c === null) return null;
      if (c === 0) {
        tr.notApplicable = true;
        return null;
      }
      return ev(arg(1), env, lag, tr);
    }
    case 'bench': {
      const key = n.a[0];
      if (key?.t !== 'str') throw new Error('Formula: bench() needs a quoted key');
      const value = env.bench(key.v);
      tr.bench.push({ key: key.v, value });
      if (value === null) tr.missing.push(`benchmark "${key.v}"`);
      return value;
    }
    case 'sum': {
      const v = series(n, env, lag, tr);
      return v ? v.reduce((a, b) => a + b, 0) : null;
    }
    case 'sd': {
      const v = series(n, env, lag, tr);
      if (!v || v.length < 2) return null;
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
    }
    case 'abs':
    case 'avg':
    case 'min':
    case 'max': {
      if (n.a.length === 0) throw new Error(`Formula: ${n.f}() needs arguments`);
      const vals = n.a.map((a) => ev(a, env, lag, tr));
      const nums = vals.filter((v): v is number => v !== null);
      if (nums.length !== vals.length) return null;
      if (n.f === 'abs') return Math.abs(nums[0] ?? 0);
      if (n.f === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
      return n.f === 'min' ? Math.min(...nums) : Math.max(...nums);
    }
    default:
      throw new Error(`Formula: unknown function "${n.f}"`);
  }
}

export function evaluate(src: string, env: Env): { value: number | null; trace: Trace } {
  const trace = newTrace();
  const value = ev(parseFormula(src), env, 0, trace);
  return { value: value !== null && Number.isFinite(value) ? value : null, trace };
}
