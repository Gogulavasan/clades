/** Shared UI state: the browser store, the upload being confirmed, and hooks the shell fills in. */
import { buildCaseFile } from '../casefile/build';
import type { SourceTable } from '../ingest/grid';
import { RULES } from '../rules/config';
import type { TextHit } from '../standardise/schema';
import type { Mapping, Meta } from '../standardise/standardise';
import { buildSamples } from '../storage/sample';
import { Store, type KeyValue } from '../storage/store';
import type { Route } from './router';

/** An uploaded file waiting on the confirm screen. Lives in memory only. */
export interface Draft {
  table: SourceTable;
  mapping: Mapping;
  meta: Meta;
  /** Corrections typed by the user, in INR crore. Key: "period|field". null = remove the figure. */
  edits: Record<string, number | null>;
  /** PDF route only: pages of text read and the lexicon matches found in them. */
  textPages?: number;
  textHits?: TextHit[];
}

function browserStorage(): KeyValue | null {
  try {
    const ls = globalThis.localStorage;
    ls.setItem('clades.probe', '1');
    ls.removeItem('clades.probe');
    return ls;
  } catch {
    return null;
  }
}

export const store = new Store(browserStorage());

export const ui = {
  draft: null as Draft | null,
  rerender: (): void => undefined,
  go: ((): void => undefined) as (route: Route) => void,
  /** Shows a message under the command line. */
  say: ((): void => undefined) as (text: string) => void,
};

export const nowIso = (): string => new Date().toISOString();
export const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '-');

export function loadSamples(): void {
  for (const s of buildSamples(nowIso())) store.upsert(s.caseFile, s.company);
  store.setSettings({ samplesDismissed: false });
}

/** After an app update, re-score everything stored from its saved inputs so old case files match the current rule library. */
export function migrate(): void {
  for (const rec of store.list()) {
    if (rec.caseFile.ruleLibraryVersion === RULES.version) continue;
    try {
      store.rescore(rec.id, buildCaseFile(rec.company, rec.caseFile.settings, rec.caseFile.generatedAt));
    } catch {
      store.remove(rec.id);
    }
  }
}

/** First visit: seed the clearly labelled synthetic demo set. */
export function seedIfEmpty(): void {
  if (store.list().length === 0 && !store.db.settings.samplesDismissed) loadSamples();
}

export function download(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
