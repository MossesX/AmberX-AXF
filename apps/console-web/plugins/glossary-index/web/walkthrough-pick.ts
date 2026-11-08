/**
 * Walkthrough Generator: the picker's pure model (no React, no DOM, no network), so Node tests import it directly.
 */
import { filterEntries, type Entry } from './core.ts';

export const MAX_TERMS = 60;
export const PICKER_ROWS = 200;

export interface PickFilter { q: string; kind: string; category: string; selectedOnly: boolean }

/** The top-level categories (the first part of `A › B › C`), with counts, A to Z. */
export function topCategories(entries: Entry[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) { const top = e.category.split('›')[0]!.trim(); if (top) m.set(top, (m.get(top) ?? 0) + 1); }
  return [...m].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
}

/** What the picker lists: search + kind (the glossary's own filter), top category, and "selected only". */
export function pickerEntries(entries: Entry[], f: PickFilter, selected: string[]): Entry[] {
  const sel = new Set(selected);
  let out = filterEntries(entries, { q: f.q, kind: f.kind, drafts: true });
  if (f.category) out = out.filter((e) => e.category.split('›')[0]!.trim() === f.category);
  if (f.selectedOnly) out = out.filter((e) => sel.has(e.id));
  // generated walkthrough parts are not features to demonstrate
  return out.filter((e) => !['demonstration', 'book', 'clip', 'docs'].includes(e.kind));
}

export function toggleTerm(selected: string[], id: string, on: boolean, max = MAX_TERMS): string[] {
  if (on) return selected.includes(id) || selected.length >= max ? selected : [...selected, id];
  return selected.filter((x) => x !== id);
}

/** Add every listed id (in list order) up to the cap; answers the new selection and how many did not fit. */
export function selectAll(selected: string[], ids: string[], max = MAX_TERMS): { selected: string[]; skipped: number } {
  const out = [...selected];
  let skipped = 0;
  for (const id of ids) { if (out.includes(id)) continue; if (out.length >= max) { skipped++; continue; } out.push(id); }
  return { selected: out, skipped };
}

export function moveTerm(selected: string[], i: number, dir: -1 | 1): string[] {
  const j = i + dir;
  if (j < 0 || j >= selected.length) return selected;
  const out = [...selected];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

