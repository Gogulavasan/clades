/** Browser-only persistence (localStorage): scanned cases, quarantine status, prediction ledger, settings. */
import type { CaseFile } from '../casefile/build';
import type { Tier } from '../scoring/score';
import type { PricePoint } from '../ingest/price';
import type { Company } from '../standardise/schema';

export const STATUSES = ['NEW', 'UNDER REVIEW', 'CLEARED', 'CONCERN CONFIRMED'] as const;
export type Status = (typeof STATUSES)[number];
export type Outcome = 'open' | 'problem' | 'no_problem';

export interface CaseRecord {
  id: string;
  caseFile: CaseFile;
  /** Standardised input, kept so the case can be re-scored when settings or rules change. */
  company: Company;
  status: Status;
  notes: string;
  /** Date this company first scored Watch or Suspicious; null if never flagged. */
  flagDate: string | null;
  history: { date: string; year: string; score: number | null; tier: Tier }[];
  /** Optional price history loaded by the user for the price/volume panel. */
  price?: PricePoint[];
}

export interface LedgerEntry {
  id: string;
  caseId: string;
  name: string;
  year: string;
  date: string;
  tier: Tier;
  score: number | null;
  outcome: Outcome;
  outcomeDate: string | null;
}

export interface Settings {
  proxies: boolean;
  strict: boolean;
  /** true once the user has removed the sample set, so it is not re-seeded. */
  samplesDismissed: boolean;
}

export interface Db {
  version: 1;
  cases: Record<string, CaseRecord>;
  ledger: LedgerEntry[];
  settings: Settings;
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'clades.v1';
const emptyDb = (): Db => ({ version: 1, cases: {}, ledger: [], settings: { proxies: true, strict: false, samplesDismissed: false } });
const isFlagged = (t: Tier): boolean => t === 'watch' || t === 'suspicious';

function validate(raw: unknown): Db {
  const d = raw as Partial<Db> | null;
  if (!d || d.version !== 1 || typeof d.cases !== 'object' || d.cases === null || !Array.isArray(d.ledger)) throw new Error('Not a CLADES backup (version 1).');
  for (const [id, rec] of Object.entries(d.cases)) {
    if (!rec || rec.id !== id || rec.caseFile?.schemaVersion !== 1 || !Array.isArray(rec.history)) throw new Error(`Backup entry "${id}" is malformed.`);
  }
  return { ...emptyDb(), ...d, settings: { ...emptyDb().settings, ...d.settings } } as Db;
}

export class Store {
  db: Db;
  /** Set when the browser refuses to persist (private mode or quota): data then lasts for this tab only. */
  persistError: string | null = null;

  constructor(private readonly kv: KeyValue | null) {
    this.db = emptyDb();
    try {
      const text = kv?.getItem(KEY);
      if (text) this.db = validate(JSON.parse(text));
    } catch (e) {
      this.persistError = `Stored data could not be read and was ignored: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  save(): void {
    try {
      this.kv?.setItem(KEY, JSON.stringify(this.db));
      this.persistError = this.kv ? null : 'Browser storage is unavailable: results last only until this tab is closed.';
    } catch {
      this.persistError = 'Browser storage is full or blocked: results last only until this tab is closed.';
    }
  }

  list(): CaseRecord[] {
    return Object.values(this.db.cases);
  }

  /** Saves a scan. Re-scanning the same ticker keeps status and notes and appends to its history. */
  upsert(caseFile: CaseFile, company: Company): CaseRecord {
    const prev = this.db.cases[caseFile.id];
    const { tier, score } = caseFile.verdict;
    const date = caseFile.generatedAt;
    const year = caseFile.company.latestYear;
    const rec: CaseRecord = {
      id: caseFile.id, caseFile, company,
      status: prev && Boolean(prev.caseFile.sample) === caseFile.sample ? prev.status : 'NEW',
      notes: prev?.notes ?? '',
      flagDate: prev?.flagDate ?? (isFlagged(tier) ? date : null),
      history: [...(prev && Boolean(prev.caseFile.sample) === caseFile.sample ? prev.history : []), { date, year, score, tier }],
      ...(prev?.price ? { price: prev.price } : {}),
    };
    this.db.cases[rec.id] = rec;
    // A flag on a real company is logged as a prediction, once per company-year, to be judged later.
    if (isFlagged(tier) && !caseFile.sample && !this.db.ledger.some((l) => l.caseId === rec.id && l.year === year)) {
      this.db.ledger.push({ id: `${rec.id}:${year}`, caseId: rec.id, name: caseFile.company.name, year, date, tier, score, outcome: 'open', outcomeDate: null });
    }
    this.save();
    return rec;
  }

  /** Replaces the case file after a settings change, without adding a history entry. */
  rescore(id: string, caseFile: CaseFile): void {
    const rec = this.db.cases[id];
    if (!rec) return;
    rec.caseFile = caseFile;
    this.save();
  }

  setPrice(id: string, price: PricePoint[] | null): void {
    const rec = this.db.cases[id];
    if (!rec) return;
    if (price) rec.price = price;
    else delete rec.price;
    this.save();
  }

  update(id: string, patch: Partial<Pick<CaseRecord, 'status' | 'notes'>>): void {
    const rec = this.db.cases[id];
    if (!rec) return;
    Object.assign(rec, patch);
    this.save();
  }

  setOutcome(ledgerId: string, outcome: Outcome, date: string): void {
    const entry = this.db.ledger.find((l) => l.id === ledgerId);
    if (!entry) return;
    entry.outcome = outcome;
    entry.outcomeDate = outcome === 'open' ? null : date;
    this.save();
  }

  remove(id: string): void {
    this.db.cases = Object.fromEntries(Object.entries(this.db.cases).filter(([k]) => k !== id));
    this.save();
  }

  clearSamples(): void {
    this.db.cases = Object.fromEntries(Object.entries(this.db.cases).filter(([, r]) => !r.caseFile.sample));
    this.db.settings.samplesDismissed = true;
    this.save();
  }

  setSettings(patch: Partial<Settings>): void {
    Object.assign(this.db.settings, patch);
    this.save();
  }

  exportJson(): string {
    return JSON.stringify(this.db, null, 1);
  }

  /** Replaces everything with the backup. Throws with a readable message if the file is not a valid backup. */
  importJson(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The file is not valid JSON.');
    }
    this.db = validate(parsed);
    this.save();
  }
}

/** Ledger statistics. Hit rate and false alarms are both shown; open entries count toward neither. */
export function ledgerStats(ledger: readonly LedgerEntry[]): { total: number; open: number; hits: number; falseAlarms: number; hitRate: number | null } {
  const hits = ledger.filter((l) => l.outcome === 'problem').length;
  const falseAlarms = ledger.filter((l) => l.outcome === 'no_problem').length;
  const resolved = hits + falseAlarms;
  return { total: ledger.length, open: ledger.length - resolved, hits, falseAlarms, hitRate: resolved ? hits / resolved : null };
}
