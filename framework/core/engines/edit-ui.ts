/*
 * Edit UI engine (edit-ui@1, spec/EDIT-UI.md): inline-edit anything, active only while Ctrl is held.
 *
 * Brett, Nov 17 2026: "I need a way to inline edit anything. We need an Edit UI. When Edit UI is on, it only works
 * when I'm also holding down Control."
 *
 * Two pure pieces:
 *   - the gate, a state machine over four modes (off / armed / held / editing) driven by `reduceEditUi(state, event)`:
 *     Edit UI off = Ctrl does nothing; Ctrl released = the mode ends and an open edit is cancelled, never saved; a
 *     long-press (phone) stands in for Ctrl + click and keeps its editor open until commit / cancel;
 *   - the owner, `resolveOwner(target, ctx)`: where one edit saves (a look token, an asset property, the hide-any-asset
 *     list, a data source) or `read-only` with the reason. The runtime hands the context in; nothing here touches it.
 *
 * The undo stack is engines/edit-ui-undo.ts; the runtime glue is runtime.ts (`rt.editUi`) with the owner adapters in
 * core/edit-ui-owners.ts. Names and limits come from edit-ui-rules.mjs (one set for the TS engine, the build engine,
 * the console server and the CLI). Fixture: spec/fixtures/edit-ui.json. Kotlin twin deferred (PORTING.md).
 */
import {
  EDIT_UI_COLUMN_PROPS, EDIT_UI_HIDE_BUILD, EDIT_UI_HIDE_PROPS, EDIT_UI_LOOK_PERMISSION, EDIT_UI_OP_FRAME, EDIT_UI_PROPS, EDIT_UI_STATE_FRAME, EDIT_UI_TARGET_KINDS, EDIT_UI_TEXT_MAX, EDIT_UI_TOKEN_PROPS,
  type EditUiGate, type EditUiMode, type EditUiOwnerKind, type EditUiReason, type EditUiTargetKind,
} from './edit-ui-rules.mjs';
import { CONTROL_TOKEN_SLOTS, tokenSettingsKey } from './control-tokens.mjs';
import { INSTANCE_TOKENS_KEY } from './component-tokens.mjs';
import { CHROME_TYPES } from './chrome-settings-rules.mjs';

/* ---------------------------------------------------------------- targets */

/** What one edit is about (edit-ui-target@1). Open: a kind may carry more fields than it needs today. */
export interface EditUiTarget {
  kind: EditUiTargetKind;
  /** text: the element's console-control address when it has one */
  id?: string;
  assetType?: string;
  assetId?: string;
  /** a component instance (a tab group id, a toolbar id) when the asset is drawn more than once */
  instance?: string;
  /** a dotted path inside the asset data or the token map */
  path?: string;
  source?: string;
  record?: string;
  field?: string;
  grid?: string;
  column?: string;
  prop?: string;
  /** token: the control@1 token target (tokens.theme, tokens.style, …) */
  slot?: string;
}

/** A value an inline edit carries: one scalar. Objects are edited field by field. */
export type EditUiValue = string | number | boolean | null;

const ID_MAX = 200;
const PATH_MAX = 300;
const isStr = (v: unknown, max = ID_MAX): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is this a value an edit may carry? */
export function isEditUiValue(v: unknown): v is EditUiValue {
  return v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= EDIT_UI_TEXT_MAX);
}

export type TargetCheck = { ok: true; target: EditUiTarget } | { ok: false; reason: 'bad-target'; detail: string };

/**
 * Check a raw target and return it trimmed to its known fields. Never throws: a bad one comes back with `bad-target`
 * and what is wrong, so the UI, the API and voice can all say it.
 */
export function validateTarget(raw: unknown): TargetCheck {
  const bad = (detail: string): TargetCheck => ({ ok: false, reason: 'bad-target', detail });
  if (!isObj(raw)) return bad('a target is an object');
  const kind = raw.kind;
  if (!EDIT_UI_TARGET_KINDS.includes(kind as EditUiTargetKind)) return bad(`unknown target kind "${String(kind)}" (${EDIT_UI_TARGET_KINDS.join(', ')})`);
  const t: EditUiTarget = { kind: kind as EditUiTargetKind };
  for (const f of ['id', 'assetType', 'assetId', 'instance', 'source', 'record', 'field', 'grid', 'column', 'prop', 'slot'] as const) {
    const v = raw[f];
    if (v === undefined) continue;
    if (!isStr(v)) return bad(`${f} is a short non-empty string`);
    t[f] = v;
  }
  if (raw.path !== undefined) {
    if (!isStr(raw.path, PATH_MAX)) return bad('path is a dotted path');
    t.path = raw.path;
  }
  const need = (...fs: (keyof EditUiTarget)[]) => fs.find((f) => !t[f]);
  switch (t.kind) {
    case 'text': {
      if (t.source) { const m = need('record', 'field'); if (m) return bad(`a text target with a source needs ${m}`); }
      else if (t.assetType) { const m = need('assetId', 'path'); if (m) return bad(`a text target on an asset needs ${m}`); }
      else if (!t.id) return bad('a text target needs an id, an asset or a source');
      break;
    }
    case 'cell': { const m = need('source', 'record', 'field'); if (m) return bad(`a cell target needs ${m}`); break; }
    case 'column': {
      const m = need('grid', 'column', 'prop'); if (m) return bad(`a column target needs ${m}`);
      if (!EDIT_UI_COLUMN_PROPS.includes(t.prop as never)) return bad(`a column prop is one of ${EDIT_UI_COLUMN_PROPS.join(', ')}`);
      break;
    }
    case 'property': {
      const m = need('assetType', 'assetId', 'prop'); if (m) return bad(`a property target needs ${m}`);
      if (!EDIT_UI_PROPS.includes(t.prop as never)) return bad(`a property prop is one of ${EDIT_UI_PROPS.join(', ')}`);
      break;
    }
    case 'token': {
      const m = need('slot', 'path'); if (m) return bad(`a token target needs ${m}`);
      if (!(t.slot! in CONTROL_TOKEN_SLOTS)) return bad(`unknown token slot "${t.slot}" (${Object.keys(CONTROL_TOKEN_SLOTS).join(', ')})`);
      break;
    }
  }
  return { ok: true, target: t };
}

/** One stable text for a target (the undo list, logs, the `editui.set` address). */
export function targetKey(t: EditUiTarget): string {
  switch (t.kind) {
    case 'text': return t.source ? `text:${t.source}/${t.record}.${t.field}` : t.assetType ? `text:${t.assetType}/${t.assetId}#${t.path}` : `text:${t.id}`;
    case 'cell': return `cell:${t.source}/${t.record}.${t.field}`;
    case 'column': return `column:${t.grid}/${t.column}.${t.prop}`;
    case 'property': return `property:${t.assetType}/${t.instance ?? t.assetId}.${t.prop}`;
    case 'token': return `token:${t.slot}/${t.path}${t.assetId ? `@${t.assetId}` : ''}`;
  }
}

/* ---------------------------------------------------------------- owners */

/** Where an edit saves (edit-ui-owner): the kind, the key it writes under, and for read-only the reason. */
export interface EditUiOwner {
  kind: EditUiOwnerKind;
  /** the settings key, look path or data source the owner writes */
  key?: string;
  reason?: EditUiReason;
  detail?: string;
}

/** What the runtime knows when it resolves an owner. Every field is optional: absent = no objection. */
export interface OwnerContext {
  /** Does this asset exist in the registry? */
  hasAsset?: (type: string, id: string) => boolean;
  /** Registered data sources: id → may it be written, and if not why. */
  dataSources?: Record<string, { writable: boolean; reason?: EditUiReason; detail?: string; permission?: string }>;
  /** Owner adapters registered in this app (rt.editUi.registerOwner). Absent = all of them. */
  owners?: readonly string[];
  /** The look is locked (appearance lock / hub-skin only): no look owner writes. */
  locked?: boolean;
  /** The role's permission check. */
  can?: (permission: string) => boolean;
  /** Kinds the hide-any-asset contract accepts. Absent = the chrome kinds plus widget. */
  hideableKinds?: readonly string[];
}

const CHROME_KINDS: readonly string[] = CHROME_TYPES;
const DEFAULT_HIDEABLE: readonly string[] = [...CHROME_KINDS, 'widget'];
const LOOK_OWNERS: readonly EditUiOwnerKind[] = ['asset-token', 'asset-property', 'hidden-assets'];

const readOnly = (reason: EditUiReason, detail: string): EditUiOwner => ({ kind: 'read-only', reason, detail });

/** The chrome instance override key (chrome-settings@1) for a chrome kind, else the look-writer path for the asset. */
function assetPropertyKey(t: EditUiTarget): string {
  return CHROME_KINDS.includes(t.assetType!) ? `axf.chrome.${t.assetType}.${t.instance ?? t.assetId}` : `look:${t.assetType}/${t.assetId}`;
}

/** The owner a target would have if nothing objected. */
function candidateOwner(t: EditUiTarget, ctx: OwnerContext): EditUiOwner {
  switch (t.kind) {
    case 'token':
      return { kind: 'asset-token', key: tokenSettingsKey(t.slot!) ?? '' };
    case 'property': {
      if (EDIT_UI_TOKEN_PROPS.includes(t.prop as never)) return { kind: 'asset-token', key: `${INSTANCE_TOKENS_KEY}:${t.assetType}.${t.instance ?? t.assetId}` };
      if (EDIT_UI_HIDE_PROPS.includes(t.prop as never)) {
        const kinds = ctx.hideableKinds ?? DEFAULT_HIDEABLE;
        if (!kinds.includes(t.assetType!)) return readOnly('bad-target', `${t.assetType} cannot be hidden (${kinds.join(', ')})`);
        return { kind: 'hidden-assets', key: `${t.assetType}:${t.instance ?? t.assetId}` };
      }
      return { kind: 'asset-property', key: assetPropertyKey(t) };
    }
    case 'column':
      // A column lives in its grid instance (it is not chrome): label, width, order and hide are the grid's own column overrides.
      return { kind: 'asset-property', key: `axf.grid.${t.grid}.columns` };
    case 'cell':
      return dataOwner(t.source!, ctx);
    case 'text':
      if (t.assetType) return { kind: 'asset-property', key: assetPropertyKey(t) };
      if (t.source) return dataOwner(t.source, ctx);
      return readOnly('code-text', 'this text is written in code; nothing owns it');
  }
}

function dataOwner(source: string, ctx: OwnerContext): EditUiOwner {
  const s = ctx.dataSources?.[source];
  if (!s) return readOnly('unknown-source', `no data source "${source}" in this app`);
  if (!s.writable) return readOnly(s.reason ?? 'no-writer', s.detail ?? `"${source}" has no writer`);
  if (s.permission && ctx.can && !ctx.can(s.permission)) return readOnly('permission', `your role needs "${s.permission}" to change ${source}`);
  return { kind: 'data', key: source };
}

/**
 * Where this target saves. Precedence: a bad target; the owner the kind table gives; a lock or a missing permission on a
 * look owner; an asset that does not exist; an owner adapter this app has not registered.
 */
export function resolveOwner(raw: unknown, ctx: OwnerContext = {}): EditUiOwner {
  const v = validateTarget(raw);
  if (!v.ok) return readOnly(v.reason, v.detail);
  const t = v.target;
  const owner = candidateOwner(t, ctx);
  if (owner.kind === 'read-only') return owner;
  if (LOOK_OWNERS.includes(owner.kind)) {
    if (ctx.locked) return readOnly('locked', 'the look is locked: it comes from axHub');
    if (ctx.can && !ctx.can(EDIT_UI_LOOK_PERMISSION)) return readOnly('permission', `your role needs "${EDIT_UI_LOOK_PERMISSION}" to change the look`);
    if (t.assetType && t.assetId && ctx.hasAsset && !ctx.hasAsset(t.assetType, t.assetId)) return readOnly('unknown-asset', `no ${t.assetType} "${t.assetId}" here`);
  }
  if (ctx.owners && !ctx.owners.includes(owner.kind)) {
    const why = owner.kind === 'hidden-assets' ? `hiding lands with build ${EDIT_UI_HIDE_BUILD}` : `no ${owner.kind} owner in this app yet`;
    return readOnly('owner-unavailable', why);
  }
  return owner;
}

/* ---------------------------------------------------------------- gate */

/** The edit open right now. */
export interface OpenEdit {
  target: EditUiTarget;
  owner: EditUiOwner;
  before: EditUiValue;
  /** How it was gated: Ctrl (released = cancelled) or a long-press (stays until commit / cancel). */
  gate: EditUiGate;
}

export interface EditUiState {
  mode: EditUiMode;
  edit: OpenEdit | null;
}

/** One committed edit (edit-ui-op@1): what the runtime applies through the owner and records on the undo stack. */
export interface EditUiOp {
  $axf: typeof EDIT_UI_OP_FRAME;
  target: EditUiTarget;
  owner: EditUiOwner;
  before: EditUiValue;
  after: EditUiValue;
  gate: EditUiGate;
}

export type EditUiEvent =
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'ctrl-down' }
  | { type: 'ctrl-up' }
  | { type: 'window-blur' }
  | { type: 'long-press'; target: EditUiTarget; owner: EditUiOwner; before: EditUiValue }
  | { type: 'begin'; target: EditUiTarget; owner: EditUiOwner; before: EditUiValue }
  | { type: 'commit'; after: EditUiValue }
  | { type: 'cancel' };

export interface EditUiStep {
  state: EditUiState;
  /** a commit that changed something */
  op?: EditUiOp;
  /** the event did not happen, and why */
  refused?: { reason: EditUiReason; detail: string };
  /** an open edit was thrown away (Ctrl released, window blur, Esc, setting off) */
  cancelled?: boolean;
  /** a commit whose after equals before: nothing applied, nothing recorded */
  noop?: boolean;
}

export const EDIT_UI_INITIAL: EditUiState = { mode: 'off', edit: null };

/** The state the setting gives on load. */
export function editUiStateFrom(enabled: boolean): EditUiState {
  return { mode: enabled ? 'armed' : 'off', edit: null };
}

/** The mode after an open edit closes: back to held while Ctrl is still down, else armed. */
function afterEdit(s: EditUiState): EditUiState {
  return { mode: s.edit?.gate === 'ctrl' ? 'held' : 'armed', edit: null };
}

/** The gate, pure. Unknown events and events that do not apply leave the state as it was. */
export function reduceEditUi(s: EditUiState, e: EditUiEvent): EditUiStep {
  const same: EditUiStep = { state: s };
  switch (e.type) {
    case 'enable':
      return s.mode === 'off' ? { state: { mode: 'armed', edit: null } } : same;
    case 'disable':
      if (s.mode === 'off') return same;
      return { state: { mode: 'off', edit: null }, ...(s.edit ? { cancelled: true } : {}) };
    case 'ctrl-down':
      return s.mode === 'armed' ? { state: { mode: 'held', edit: null } } : same;
    case 'ctrl-up':
    case 'window-blur':
      if (s.mode === 'held') return { state: { mode: 'armed', edit: null } };
      // Ctrl released while editing: the mode ends and the open edit goes with it, never saved. A touch edit is not on Ctrl.
      if (s.mode === 'editing' && s.edit && (s.edit.gate === 'ctrl' || e.type === 'window-blur')) return { state: { mode: 'armed', edit: null }, cancelled: true };
      return same;
    case 'long-press':
      if (s.mode === 'off') return { ...same, refused: { reason: 'off', detail: 'Edit UI is off' } };
      if (s.mode === 'editing') return { ...same, refused: { reason: 'busy', detail: `already editing ${targetKey(s.edit!.target)}` } };
      return open(s, e.target, e.owner, e.before, 'touch');
    case 'begin':
      if (s.mode === 'off') return { ...same, refused: { reason: 'off', detail: 'Edit UI is off' } };
      if (s.mode === 'armed') return { ...same, refused: { reason: 'not-held', detail: 'hold Ctrl to edit' } };
      if (s.mode === 'editing') return { ...same, refused: { reason: 'busy', detail: `already editing ${targetKey(s.edit!.target)}` } };
      return open(s, e.target, e.owner, e.before, 'ctrl');
    case 'commit': {
      if (s.mode !== 'editing' || !s.edit) return { ...same, refused: { reason: 'not-held', detail: 'nothing is being edited' } };
      if (!isEditUiValue(e.after)) return { ...same, refused: { reason: 'bad-target', detail: `a value is a scalar of at most ${EDIT_UI_TEXT_MAX} characters` } };
      const next = afterEdit(s);
      if (e.after === s.edit.before) return { state: next, noop: true };
      return { state: next, op: { $axf: EDIT_UI_OP_FRAME, target: s.edit.target, owner: s.edit.owner, before: s.edit.before, after: e.after, gate: s.edit.gate } };
    }
    case 'cancel':
      return s.mode === 'editing' ? { state: afterEdit(s), cancelled: true } : same;
    default:
      return same;
  }
}

function open(s: EditUiState, target: EditUiTarget, owner: EditUiOwner, before: EditUiValue, gate: EditUiGate): EditUiStep {
  if (owner.kind === 'read-only') return { state: s, refused: { reason: owner.reason ?? 'bad-target', detail: owner.detail ?? 'read-only' } };
  if (!isEditUiValue(before)) return { state: s, refused: { reason: 'bad-target', detail: 'the value before is not a scalar' } };
  return { state: { mode: 'editing', edit: { target, owner, before, gate } } };
}

/** Is a key event the Ctrl gate? (Control on every platform; Meta is not Ctrl, so Cmd+click keeps its browser meaning.) */
export function isCtrlKey(key: string): boolean {
  return key === 'Control';
}

/* ---------------------------------------------------------------- state frame */

export interface EditUiUndoSummary { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number }

/** The state frame every transport returns for `editui.state` (edit-ui-state@1). */
export function editUiStateView(s: EditUiState, undo: EditUiUndoSummary): { $axf: typeof EDIT_UI_STATE_FRAME; enabled: boolean; mode: EditUiMode; gate: EditUiGate | null; edit: (OpenEdit & { key: string }) | null; undo: EditUiUndoSummary } {
  return {
    $axf: EDIT_UI_STATE_FRAME,
    enabled: s.mode !== 'off',
    mode: s.mode,
    gate: s.edit?.gate ?? null,
    edit: s.edit ? { ...s.edit, key: targetKey(s.edit.target) } : null,
    undo,
  };
}
