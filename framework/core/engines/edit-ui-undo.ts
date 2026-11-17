/*
 * Edit UI undo stack (edit-ui@1, spec/EDIT-UI.md → Undo).
 *
 * Every committed edit is one record (edit-ui-undo@1: target, owner, before, after). Undo hands back the entry whose
 * `before` the runtime re-applies through the same owner; redo hands back `after`. A commit after an undo drops the
 * redo tail. A cancel (Esc, Ctrl released, window blur, setting off) and a no-op commit never reach this stack: only
 * `reduceEditUi` ops do. Pure; the stack is per app and per session, never saved. Kotlin twin deferred (PORTING.md).
 */
import { EDIT_UI_UNDO_FRAME, EDIT_UI_UNDO_MAX, type EditUiReason } from './edit-ui-rules.mjs';
import type { EditUiOp, EditUiOwner, EditUiTarget, EditUiUndoSummary, EditUiValue } from './edit-ui';

/** One record on the stack (edit-ui-undo@1). */
export interface EditUiUndoEntry {
  $axf: typeof EDIT_UI_UNDO_FRAME;
  id: string;
  at: string;
  by?: string;
  target: EditUiTarget;
  owner: EditUiOwner;
  before: EditUiValue;
  after: EditUiValue;
}

export interface EditUiUndoStack {
  entries: EditUiUndoEntry[];
  /** entries[0..cursor) are done; entries[cursor..] were undone and can be redone */
  cursor: number;
  /** the next entry number (ids never repeat within a session, even after entries fall off) */
  seq: number;
}

/** What the runtime applies after an undo or a redo: this value, through this owner, on this target. */
export interface EditUiReapply {
  entry: EditUiUndoEntry;
  target: EditUiTarget;
  owner: EditUiOwner;
  value: EditUiValue;
  /** the value the target shows before this re-apply (the other side of the entry) */
  from: EditUiValue;
}

export type EditUiUndoStep =
  | { stack: EditUiUndoStack; apply: EditUiReapply }
  | { stack: EditUiUndoStack; refused: { reason: EditUiReason; detail: string } };

export const emptyUndo = (): EditUiUndoStack => ({ entries: [], cursor: 0, seq: 1 });

export const canUndo = (s: EditUiUndoStack): boolean => s.cursor > 0;
export const canRedo = (s: EditUiUndoStack): boolean => s.cursor < s.entries.length;
export const undoDepth = (s: EditUiUndoStack): number => s.cursor;
export const redoDepth = (s: EditUiUndoStack): number => s.entries.length - s.cursor;

/** The numbers the state frame carries (edit-ui-state@1 → undo). */
export function undoSummary(s: EditUiUndoStack): EditUiUndoSummary {
  return { canUndo: canUndo(s), canRedo: canRedo(s), depth: undoDepth(s), redoDepth: redoDepth(s) };
}

/** A commit that changes nothing is never recorded. */
export const isNoOp = (op: Pick<EditUiOp, 'before' | 'after'>): boolean => op.before === op.after;

/**
 * Record a committed edit. Drops the redo tail, caps the stack at `max` (older entries fall off the bottom). A no-op
 * op is returned unrecorded (`entry: null`) so a caller never needs to check first.
 */
export function pushEdit(s: EditUiUndoStack, op: EditUiOp, at: string, by?: string, max = EDIT_UI_UNDO_MAX): { stack: EditUiUndoStack; entry: EditUiUndoEntry | null } {
  if (isNoOp(op)) return { stack: s, entry: null };
  const entry: EditUiUndoEntry = { $axf: EDIT_UI_UNDO_FRAME, id: `e-${String(s.seq).padStart(4, '0')}`, at, ...(by ? { by } : {}), target: op.target, owner: op.owner, before: op.before, after: op.after };
  let entries = [...s.entries.slice(0, s.cursor), entry];
  if (entries.length > max) entries = entries.slice(entries.length - max);
  return { stack: { entries, cursor: entries.length, seq: s.seq + 1 }, entry };
}

/** Step back one edit: the runtime re-applies `apply.value` (the entry's before) through the entry's owner. */
export function undo(s: EditUiUndoStack): EditUiUndoStep {
  if (!canUndo(s)) return { stack: s, refused: { reason: 'nothing-to-undo', detail: 'nothing to undo' } };
  const entry = s.entries[s.cursor - 1]!;
  return { stack: { ...s, cursor: s.cursor - 1 }, apply: { entry, target: entry.target, owner: entry.owner, value: entry.before, from: entry.after } };
}

/** Step forward one edit: the runtime re-applies `apply.value` (the entry's after) through the entry's owner. */
export function redo(s: EditUiUndoStack): EditUiUndoStep {
  if (!canRedo(s)) return { stack: s, refused: { reason: 'nothing-to-redo', detail: 'nothing to redo' } };
  const entry = s.entries[s.cursor]!;
  return { stack: { ...s, cursor: s.cursor + 1 }, apply: { entry, target: entry.target, owner: entry.owner, value: entry.after, from: entry.before } };
}

/**
 * A re-apply failed (the owner refused, the asset is gone): put the cursor back where it was so the stack still matches
 * what is on screen. `dir` is the step that failed.
 */
export function revertStep(s: EditUiUndoStack, dir: 'undo' | 'redo'): EditUiUndoStack {
  return dir === 'undo' ? { ...s, cursor: Math.min(s.entries.length, s.cursor + 1) } : { ...s, cursor: Math.max(0, s.cursor - 1) };
}

/** Everything done so far, newest first (the undo list the UI and `editui.state` can show). */
export function undoHistory(s: EditUiUndoStack): EditUiUndoEntry[] {
  return s.entries.slice(0, s.cursor).reverse();
}

/** Forget everything (the app reloads, the user signs out). */
export const clearUndo = (s: EditUiUndoStack): EditUiUndoStack => ({ entries: [], cursor: 0, seq: s.seq });
