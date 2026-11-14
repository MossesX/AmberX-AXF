/**
 * Picker registry (picker@1, spec/PICKER.md § 2 "API"): every mounted picker registers a handle under its id (console-control
 * address `button:picker-<id>`), so the console API (REST), MCP, the CLI and voice reach the same picker the user sees: read its
 * model and state, open it, search, choose by value or spoken name, toggle, clear, close. One set of handlers for all
 * four doors; the picker-dialog plugin's bridge calls these and nothing else.
 *
 * Exposed on `window.__axfPickers` too, so the plugin's web library, Playwright tests and the console-control bridge can
 * call it without importing React.
 */
import { choosePicker, matchSpoken, setQuery, setValue, uniquePickerId, type PickerModel, type PickerState } from '../core/engines/picker';

export interface PickerHandle {
  /** The picker id (address `button:picker-<id>`). */
  id: string;
  model(): PickerModel;
  state(): PickerState;
  open(): void;
  close(): void;
  /** Replace the value (cleaned by the engine). */
  apply(value: string[]): void;
  /** Set the engine state while open (search). */
  setState(s: PickerState): void;
  /** The trigger element (for deep links: scroll to it, focus it). */
  element(): HTMLElement | null;
}

export interface PickerSnapshot { id: string; target: string; open: boolean; label: string; multiple: boolean; value: string[]; labels: string[]; options: { value: string; label: string; group?: string; disabled?: boolean }[]; query: string; active: number }
export interface PickerResult { ok: boolean; error?: string; picker?: PickerSnapshot; ambiguous?: string[] }

const handles = new Map<string, PickerHandle>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/**
 * The console-control@1 address of a picker: `button:picker-<id>` (a valid kind today: press opens it, state reads its
 * text). spec/PICKER.md names a `picker:` kind; adding it to the console-control contract is deferred, and every
 * function here accepts `picker:<id>`, `button:picker-<id>` and the bare id alike.
 */
export const pickerTarget = (id: string) => `button:picker-${id}`;
const bare = (target: string) => target.trim().replace(/^.*\//, '').replace(/^picker:/, '').replace(/^button:picker-/, '');

/** Register a handle; returns its unique id and the unregister function. */
export function registerPicker(wanted: string, make: (id: string) => PickerHandle): { id: string; unregister: () => void } {
  const id = uniquePickerId(wanted, handles.keys());
  const h = make(id);
  handles.set(id, h);
  emit();
  return { id, unregister: () => { if (handles.get(id) === h) { handles.delete(id); emit(); } } };
}

export const pickerChanged = emit;
export function onPickers(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function snapshot(h: PickerHandle): PickerSnapshot {
  const m = h.model();
  const s = h.state();
  const labelOf = new Map(m.options.map((o) => [o.value, o.label]));
  return {
    id: h.id, target: pickerTarget(h.id), open: s.open, label: m.label, multiple: m.multiple, value: m.value,
    labels: m.value.map((v) => labelOf.get(v) ?? v),
    options: m.options.map((o) => ({ value: o.value, label: o.label, ...(o.group ? { group: o.group } : {}), ...(o.disabled ? { disabled: true } : {}) })),
    query: s.query, active: s.active,
  };
}

export const listPickers = (): PickerSnapshot[] => [...handles.values()].map(snapshot);
export const openPickerId = (): string | null => [...handles.values()].find((h) => h.state().open)?.id ?? null;

/** The handle for a target, or the open one when no target is given. */
function find(target?: string | null): PickerHandle | null {
  if (target) return handles.get(bare(target)) ?? null;
  const id = openPickerId();
  return id ? handles.get(id)! : null;
}
const miss = (target?: string | null): PickerResult => ({ ok: false, error: target ? `No picker "${bare(target)}" on this screen (open pickers' ids: ${[...handles.keys()].join(', ') || 'none'}).` : 'No picker is open.' });
const done = (h: PickerHandle): PickerResult => ({ ok: true, picker: snapshot(h) });

export function pickerState(target?: string | null): PickerResult { const h = find(target); return h ? done(h) : miss(target); }

export function pickerOpen(target: string): PickerResult {
  const h = find(target);
  if (!h) return miss(target);
  for (const o of handles.values()) if (o !== h && o.state().open) o.close();
  h.element()?.scrollIntoView({ block: 'nearest' });
  h.open();
  return done(h);
}

export function pickerClose(target?: string | null): PickerResult { const h = find(target); if (!h) return miss(target); h.close(); return done(h); }

export function pickerSearch(target: string | null, text: string): PickerResult {
  const h = find(target);
  if (!h) return miss(target);
  if (!h.state().open) h.open();
  h.setState(setQuery(h.model(), h.state(), text));
  return done(h);
}

/** Choose by value, else by spoken name / position (matchSpoken). Single mode closes the picker, like a tap. */
export function pickerChoose(target: string | null, nameOrValue: string): PickerResult {
  const h = find(target);
  if (!h) return miss(target);
  const m = h.model();
  const exact = m.options.find((o) => o.value === nameOrValue && !o.disabled);
  const match = exact ? { option: exact, ambiguous: [] as string[] } : matchSpoken(m, nameOrValue, h.state());
  if (!match.option) {
    const amb = 'ambiguous' in match ? match.ambiguous : [];
    return { ok: false, error: amb.length ? `“${nameOrValue}” matches ${amb.join(', ')}.` : `No option “${nameOrValue}” in ${m.label || h.id}.`, ambiguous: amb, picker: snapshot(h) };
  }
  const c = choosePicker(m, match.option.value);
  if (c.changed) h.apply(c.model.value);
  if (!m.multiple && h.state().open) h.close();
  return done(h);
}

export function pickerSet(target: string, value: string[] | string): PickerResult {
  const h = find(target);
  if (!h) return miss(target);
  const c = setValue(h.model(), value);
  if (c.changed) h.apply(c.model.value);
  return done(h);
}

export const pickerClear = (target: string | null): PickerResult => { const h = find(target); if (!h) return miss(target); h.apply([]); return done(h); };

/** What `window.__axfPickers` exposes. */
export const pickerApi = { list: listPickers, state: pickerState, open: pickerOpen, close: pickerClose, search: pickerSearch, choose: pickerChoose, set: pickerSet, clear: pickerClear, openId: openPickerId, subscribe: onPickers };
if (typeof window !== 'undefined') (window as unknown as { __axfPickers?: typeof pickerApi }).__axfPickers = pickerApi;
