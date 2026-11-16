/*
 * Pending changes (step s12): the window edits a draft, never the saved overrides. Every edit hot-renders at once
 * (the server's preview plan for the draft: CSS on --fx-* tokens, applied in the one override stylesheet), so the
 * console shows the change live. Closing the window without Apply throws the draft away and puts the saved look back.
 * Apply first shows the exit summary (element, property / token, old -> new); confirming saves it as one change-log
 * entry (ui-change@1), which the change log can undo on its own.
 *
 * The draft is the same ui-overrides@1 document REST `POST preview {pending}` / `POST apply {pending}`, the MCP tools
 * `ui-manager_preview` / `ui-manager_apply` and `ui-manager.mjs preview|apply --pending f` take.
 *
 * Last save wins per key: Apply re-reads the saved document and writes only what this draft changed onto it, so a
 * save made meanwhile by another editor, the API or voice is never reverted.
 */
import {
  diffOverrides, normalizeOverrides, withOverride, withoutOverride,
  type Overrides, type Prop, type Scalar,
} from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { applyCss, refreshLive } from './apply';
import { fetchJson } from './useElements';

export interface SummaryLine { element: string; elementLabel: string; prop: string; propLabel: string; from: string; to: string }
export interface DraftState {
  /** the saved document the draft started from (null = no draft) */
  start: Overrides | null;
  draft: Overrides | null;
  /** element -> prop -> true for every pending key */
  pending: Record<string, Record<string, true>>;
  summary: SummaryLine[];
  errors: string[];
  /** Apply pressed: the exit summary is showing */
  confirming: boolean;
  busy: boolean;
}

const EMPTY: DraftState = { start: null, draft: null, pending: {}, summary: [], errors: [], confirming: false, busy: false };
let state: DraftState = EMPTY;
const listeners = new Set<() => void>();
const emit = (p: Partial<DraftState>) => { state = { ...state, ...p }; listeners.forEach((f) => f()); };
export const getDraft = () => state;
export const subscribeDraft = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const pendingCount = () => state.summary.length;
const post = <T>(path: string, body: unknown) => fetchJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function pendingOf(start: Overrides, draft: Overrides): DraftState['pending'] {
  const out: DraftState['pending'] = {};
  for (const c of diffOverrides(start, draft)) (out[c.element] ??= {})[c.prop] = true;
  return out;
}

/** Re-render the draft live and refresh the summary (what Apply would save). */
async function render(start: Overrides, draft: Overrides): Promise<void> {
  const pending = pendingOf(start, draft);
  if (!Object.keys(pending).length) { emit({ ...EMPTY }); await refreshLive(); return; }
  emit({ start, draft, pending });
  const plan = await post<{ css?: string; summary?: SummaryLine[]; errors?: string[]; error?: string }>('preview', { pending: draft }).catch(() => ({ error: 'The UI Manager server part is not answering.' } as { error: string; css?: string; summary?: SummaryLine[]; errors?: string[] }));
  if (state.draft !== draft) return; // a newer edit already rendered
  if (plan.error) { emit({ errors: [plan.error] }); return; }
  applyCss(plan.css ?? '');
  emit({ summary: plan.summary ?? [], errors: plan.errors ?? [] });
}

async function base(): Promise<{ start: Overrides; draft: Overrides }> {
  if (state.start && state.draft) return { start: state.start, draft: state.draft };
  const saved = normalizeOverrides(await fetchJson<Overrides>('overrides'));
  return { start: saved, draft: normalizeOverrides(saved) };
}

/** Change one property in the draft (validated against its predetermined choices). */
export async function editDraft(element: string, prop: Prop, value: Scalar): Promise<{ error?: string }> {
  const b = await base();
  const r = withOverride(b.draft, element, prop, value);
  if ('error' in r) return { error: r.error };
  await render(b.start, r.doc);
  return {};
}

/** Reset in the draft: one property, an element (no prop), or everything (no element). */
export async function resetDraft(element = '', prop = ''): Promise<void> {
  const b = await base();
  await render(b.start, withoutOverride(b.draft, element, prop));
}

/** Drop one pending key: the property goes back to what is saved. */
export async function dropPending(element: string, prop: string): Promise<void> {
  const b = await base();
  const was = b.start.elements[element]?.[prop];
  const doc = was === undefined ? withoutOverride(b.draft, element, prop) : normalizeOverrides({ ...b.draft, elements: { ...b.draft.elements, [element]: { ...(b.draft.elements[element] ?? {}), [prop]: was } } });
  await render(b.start, doc);
}

/** Throw the draft away and put the saved look back (closing without Apply, or Discard). */
export async function discardDraft(): Promise<void> {
  if (!state.draft) return;
  emit({ ...EMPTY });
  await refreshLive();
}

export const askApply = () => { if (state.summary.length) emit({ confirming: true }); };
export const cancelApply = () => emit({ confirming: false });

/** Save the draft as one change-log entry, rebased on what is saved now (last save wins per key). */
export async function applyDraft(by = 'window'): Promise<{ error?: string; entry?: { id: string } }> {
  if (!state.start || !state.draft) return { error: 'Nothing to apply.' };
  emit({ busy: true });
  const now = normalizeOverrides(await fetchJson<Overrides>('overrides'));
  let doc = now;
  for (const c of diffOverrides(state.start, state.draft)) {
    doc = c.to === undefined ? withoutOverride(doc, c.element, c.prop) : normalizeOverrides({ ...doc, elements: { ...doc.elements, [c.element]: { ...(doc.elements[c.element] ?? {}), [c.prop]: c.to } } });
  }
  const r = await post<{ error?: string; entry?: { id: string } }>('apply', { pending: doc, by, reason: `UI Manager: ${state.summary.length} change(s)` });
  if (r.error) { emit({ busy: false, errors: [r.error] }); return r; }
  emit({ ...EMPTY });
  await refreshLive();
  return r;
}

/** A row as the draft shows it: its pending value, and whether it is pending. */
export function draftValue(element: string, prop: string, saved: Scalar, base: Scalar): { value: Scalar; pending: boolean; overridden: boolean | null } {
  if (!state.pending[element]?.[prop]) return { value: saved, pending: false, overridden: null };
  const v = state.draft?.elements[element]?.[prop];
  return v === undefined ? { value: base, pending: true, overridden: false } : { value: v, pending: true, overridden: true };
}
