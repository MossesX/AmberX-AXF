/*
 * Edit UI runtime glue (edit-ui@1, spec/EDIT-UI.md): `rt.editUi`, the owner adapters registry and the default adapters.
 *
 * Brett, Nov 17 2026: "I need a way to inline edit anything. We need an Edit UI. When Edit UI is on, it only works
 * when I'm also holding down Control."
 *
 * The controller holds the gate (engines/edit-ui.ts) and the undo stack (engines/edit-ui-undo.ts) for one runtime,
 * turns the setting `axf.editUi.enabled` into enable / disable, and applies every committed edit through the owner
 * `resolveOwner` picked:
 *   - asset-token: control@1 token overrides (`axf.tokens.<slot>`, withTokenOverride), a component instance's family
 *     tokens (`axf.tokens.instances`, setInstanceToken) or a customizable slot's extra tokens (`axf.custom.<type>`);
 *   - asset-property: the chrome instance override `axf.chrome.<kind>.<instance>` (chrome-settings@1 fields) and a
 *     grid's column overrides `axf.grid.<grid>.columns`; a field of a non-chrome asset has no owner yet
 *     (`owner-unavailable`: the React phase adds the look-writer path);
 *   - data: a writer the app registered for a data source (`registerDataSource`).
 * The hidden-assets adapter is registered by build rebuild-fresh-main-hide-any-asset (its runtime step), not here:
 * until then a hide resolves to `owner-unavailable` with that build's name.
 *
 * Nothing here is React: the React layer (next phase) listens for Ctrl, long-presses and Esc and calls these methods;
 * the actions `editui.*` reach the same methods from console-control, REST, MCP, the CLI and voice.
 */
import type { AxfRuntime } from './runtime';
import type { AssetType } from './types';
import type { SettingValue } from './settings';
import {
  editUiStateFrom, editUiStateView, reduceEditUi, resolveOwner, targetKey, validateTarget,
  type EditUiEvent, type EditUiOp, type EditUiOwner, type EditUiState, type EditUiStep, type EditUiTarget, type EditUiValue, type OwnerContext,
} from './engines/edit-ui';
import { canRedo, canUndo, emptyUndo, pushEdit, redo, revertStep, undo, undoHistory, undoSummary, type EditUiUndoEntry, type EditUiUndoStack } from './engines/edit-ui-undo';
import { EDIT_UI_ACTIONS, EDIT_UI_ENABLED_KEY, EDIT_UI_SETTINGS_GROUP, type EditUiGate, type EditUiOwnerKind, type EditUiReason } from './engines/edit-ui-rules.mjs';
import { CONTROL_TOKEN_SLOTS, effectiveTokenOverrides, tokenValueIn, withTokenOverride, withoutTokenOverride } from './engines/control-tokens.mjs';
import { INSTANCE_TOKENS_KEY, instanceTokenValues, isComponentTokenFamily, setInstanceToken } from './engines/component-tokens.mjs';
import { CHROME_FIELDS, chromeFieldValue, normalizeInstanceOverride, type ChromeType } from './engines/chrome-settings-rules.mjs';
import { customTokensFor, customizable } from './engines/customize';

/** The answer of a write: done, or why not. */
export type EditUiWriteResult = { ok: true } | { ok: false; reason: EditUiReason; detail: string };

/** An owner adapter: how one owner kind reads and writes a target's value. */
export interface EditUiOwnerAdapter {
  /** The value the target shows now (undefined = the adapter cannot tell; the caller passes `before` itself). */
  read(target: EditUiTarget, owner: EditUiOwner): EditUiValue | undefined;
  /** Save a value. A promise is an optimistic write: the edit is recorded now and dropped if the promise says no. */
  write(target: EditUiTarget, owner: EditUiOwner, value: EditUiValue): EditUiWriteResult | Promise<EditUiWriteResult>;
}

/** A data-source writer an app registers so grid cells and record fields can be edited inline. */
export interface EditUiDataWriter {
  read?(record: string, field: string): EditUiValue | undefined;
  write(record: string, field: string, value: EditUiValue): boolean | Promise<boolean>;
  /** The UAC permission a write needs, if any. */
  permission?: string;
}

export type EditUiActionResult = { ok: true; entry?: EditUiUndoEntry | null; state: ReturnType<typeof editUiStateView> } | { ok: false; reason: EditUiReason; detail: string; state: ReturnType<typeof editUiStateView> };

/** The component-token family an asset type's instances draw with (size / colour edits on one instance). */
export const EDIT_UI_INSTANCE_FAMILIES: Record<string, string> = { 'tab-group': 'tabs', grid: 'grid', 'data-grid': 'grid', table: 'grid' };

/** The settings key of a grid's column overrides (edit-ui@1 column targets; the DataGrid reads it). */
export const GRID_COLUMNS_KEY = (grid: string) => `axf.grid.${grid}.columns`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refuse = (reason: EditUiReason, detail: string): EditUiWriteResult => ({ ok: false, reason, detail });

/** Walk a dotted path through an object. */
function at(data: unknown, path: string | undefined): EditUiValue | undefined {
  if (!path) return undefined;
  let cur: unknown = data;
  for (const p of path.split('.')) { if (!isObj(cur) && !Array.isArray(cur)) return undefined; cur = (cur as Record<string, unknown>)[p]; }
  return cur === null || typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean' ? cur : undefined;
}

export class EditUiController {
  private gate: EditUiState;
  private stack: EditUiUndoStack = emptyUndo();
  private readonly owners = new Map<string, EditUiOwnerAdapter>();
  private readonly sources = new Map<string, EditUiDataWriter>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  constructor(private readonly rt: AxfRuntime) {
    this.gate = editUiStateFrom(rt.settings.get(EDIT_UI_ENABLED_KEY) === true);
  }

  /** Add the settings group, follow the setting, register the default owners and the `editui.*` actions. Once. */
  init(): void {
    const s = this.rt.settings;
    s.addGroup({ ...EDIT_UI_SETTINGS_GROUP, module: 'axf.framework', settings: EDIT_UI_SETTINGS_GROUP.settings.map((x) => ({ ...x })) });
    s.onChange(EDIT_UI_ENABLED_KEY, (v) => this.dispatch({ type: v === true ? 'enable' : 'disable' }));
    this.registerOwner('asset-token', assetTokenAdapter(this.rt));
    this.registerOwner('asset-property', assetPropertyAdapter(this.rt));
    this.registerOwner('data', dataAdapter(this.sources));
    const meta = { module: 'axf.framework' };
    this.rt.actions.register('editui.on', () => this.setEnabled(true), { ...meta, label: 'Edit UI on' });
    this.rt.actions.register('editui.off', () => this.setEnabled(false), { ...meta, label: 'Edit UI off' });
    this.rt.actions.register('editui.toggle', () => this.setEnabled(!this.enabled()), { ...meta, label: 'Edit UI on / off' });
    this.rt.actions.register('editui.state', () => { this.rt.terminal.ok('edit-ui', JSON.stringify(this.state())); }, { ...meta, label: 'Edit UI state', searchable: false });
    this.rt.actions.register('editui.undo', () => { this.undo(); }, { ...meta, label: 'Undo the last inline edit' });
    this.rt.actions.register('editui.redo', () => { this.redo(); }, { ...meta, label: 'Redo the last undone inline edit' });
    this.rt.actions.register('editui.set', (args) => { this.setFromArgs(args); }, { ...meta, label: 'Edit one thing inline without the UI', params: true });
  }

  /* ---------------- state ---------------- */

  enabled(): boolean { return this.gate.mode !== 'off'; }

  /** The state frame (edit-ui-state@1) every transport returns. */
  state() { return editUiStateView(this.gate, undoSummary(this.stack)); }

  /** Turn Edit UI on or off (the setting; the gate follows through onChange). */
  setEnabled(on: boolean): void {
    if (on) this.rt.settings.set(EDIT_UI_ENABLED_KEY, true); else this.rt.settings.clear(EDIT_UI_ENABLED_KEY);
    // clear() fires no change for a key that was never set: make sure the gate agrees with the setting either way
    if (this.enabled() !== on) this.dispatch({ type: on ? 'enable' : 'disable' });
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { for (const l of this.listeners) l(); }

  /** Every edit done so far, newest first. */
  history(): EditUiUndoEntry[] { return undoHistory(this.stack); }

  /* ---------------- owners ---------------- */

  registerOwner(kind: EditUiOwnerKind | string, adapter: EditUiOwnerAdapter): () => void {
    this.owners.set(kind, adapter);
    this.notify();
    return () => { if (this.owners.get(kind) === adapter) { this.owners.delete(kind); this.notify(); } };
  }

  registerDataSource(id: string, writer: EditUiDataWriter): () => void {
    this.sources.set(id, writer);
    this.notify();
    return () => { if (this.sources.get(id) === writer) { this.sources.delete(id); this.notify(); } };
  }

  ownerKinds(): string[] { return [...this.owners.keys()]; }
  dataSources(): string[] { return [...this.sources.keys()]; }

  /** What the pure resolver needs to know about this app right now. */
  context(): OwnerContext {
    return {
      hasAsset: (type, id) => this.rt.registry.has(type as AssetType, id),
      dataSources: Object.fromEntries([...this.sources].map(([id, w]) => [id, { writable: true, ...(w.permission ? { permission: w.permission } : {}) }])),
      owners: this.ownerKinds(),
      locked: this.rt.appearanceLocked(),
      can: (p) => this.rt.can(p),
    };
  }

  /** Where a target saves, here and now. */
  resolve(target: unknown): EditUiOwner { return resolveOwner(target, this.context()); }

  /** The value a target shows now, through its owner (undefined when the owner cannot tell). */
  read(target: EditUiTarget, owner = this.resolve(target)): EditUiValue | undefined {
    return owner.kind === 'read-only' ? undefined : this.owners.get(owner.kind)?.read(target, owner);
  }

  /* ---------------- the gate ---------------- */

  private dispatch(e: EditUiEvent): EditUiStep {
    const r = reduceEditUi(this.gate, e);
    this.gate = r.state;
    this.seq++;
    this.notify();
    return r;
  }

  ctrlDown(): EditUiStep { return this.dispatch({ type: 'ctrl-down' }); }
  ctrlUp(): EditUiStep { return this.dispatch({ type: 'ctrl-up' }); }
  windowBlur(): EditUiStep { return this.dispatch({ type: 'window-blur' }); }

  /**
   * Open an inline edit on a target: resolves the owner, reads the value before (unless given), then `begin` (Ctrl held)
   * or `long-press` (touch). A refusal comes back with its reason and is shown as a toast.
   */
  beginEdit(raw: unknown, opts: { gate?: EditUiGate; before?: EditUiValue } = {}): EditUiStep {
    const v = validateTarget(raw);
    if (!v.ok) return this.refused(v.reason, v.detail);
    const owner = this.resolve(v.target);
    const before = opts.before !== undefined ? opts.before : this.read(v.target, owner) ?? null;
    const r = this.dispatch(opts.gate === 'touch' ? { type: 'long-press', target: v.target, owner, before } : { type: 'begin', target: v.target, owner, before });
    if (r.refused) this.rt.toast(r.refused.detail, 'warning', 'Edit UI');
    return r;
  }

  /** Commit the open edit with its new value: applied through the owner, recorded on the undo stack. */
  commit(after: EditUiValue): EditUiStep {
    const r = this.dispatch({ type: 'commit', after });
    if (r.refused) this.rt.toast(r.refused.detail, 'warning', 'Edit UI');
    if (r.op) this.applyOp(r.op);
    return r;
  }

  /** Throw the open edit away (Esc, click away). Never recorded. */
  cancel(): EditUiStep { return this.dispatch({ type: 'cancel' }); }

  /* ---------------- one-shot edits (the API path) ---------------- */

  /**
   * One edit without the UI (`editui.set`, REST, MCP, CLI, voice): resolves the owner, applies, records. The Ctrl gate
   * is for the pointer; a caller that names a target and a value is explicit enough, so the setting is not required.
   * Refused with the reason when the target is read-only.
   */
  set(raw: unknown, after: EditUiValue, by?: string): EditUiActionResult {
    const v = validateTarget(raw);
    if (!v.ok) return { ok: false, reason: v.reason, detail: v.detail, state: this.state() };
    const owner = this.resolve(v.target);
    if (owner.kind === 'read-only') return { ok: false, reason: owner.reason ?? 'bad-target', detail: owner.detail ?? 'read-only', state: this.state() };
    const before = this.read(v.target, owner) ?? null;
    const entry = this.applyOp({ $axf: 'edit-ui-op@1', target: v.target, owner, before, after, gate: 'ctrl' }, by);
    return entry === undefined ? { ok: false, reason: 'owner-unavailable', detail: `${owner.kind} refused the write`, state: this.state() } : { ok: true, entry, state: this.state() };
  }

  /** `editui.set:<target-json>:<value>`: the action form (the value is the text after the JSON; on/off/true/false and numbers are typed). */
  private setFromArgs(args: string[]): void {
    const text = args.join(':');
    let target: unknown; let rest = '';
    try {
      const end = text.indexOf('}:');
      target = JSON.parse(end === -1 ? text : text.slice(0, end + 1));
      rest = end === -1 ? '' : text.slice(end + 2);
    } catch { this.rt.toast('editui.set needs a JSON target then the value', 'warning', 'Edit UI'); return; }
    const value: EditUiValue = /^(on|true|yes)$/i.test(rest) ? true : /^(off|false|no)$/i.test(rest) ? false : rest !== '' && Number.isFinite(Number(rest)) ? Number(rest) : rest === 'null' ? null : rest;
    const r = this.set(target, value, 'action');
    if (!r.ok) this.rt.toast(r.detail, 'warning', 'Edit UI');
  }

  /* ---------------- apply + undo ---------------- */

  /** Write an op through its owner and record it. Returns the entry (null for a no-op), undefined when the write refused. */
  private applyOp(op: EditUiOp, by?: string): EditUiUndoEntry | null | undefined {
    const w = this.write(op.target, op.owner, op.after);
    if (w === undefined) return undefined;
    const r = pushEdit(this.stack, op, new Date().toISOString(), by);
    this.stack = r.stack;
    this.notify();
    if (w instanceof Promise && r.entry) {
      // optimistic: drop the record if the owner says no later
      w.then((res) => { if (!res.ok) { this.rt.toast(`Not saved: ${res.detail}`, 'danger', 'Edit UI'); this.forget(r.entry!); } });
    }
    return r.entry;
  }

  /** Write through the owner now; a refusal is toasted and returns undefined. */
  private write(target: EditUiTarget, owner: EditUiOwner, value: EditUiValue): EditUiWriteResult | Promise<EditUiWriteResult> | undefined {
    const adapter = this.owners.get(owner.kind);
    if (!adapter) { this.rt.toast(`No ${owner.kind} owner in this app`, 'warning', 'Edit UI'); return undefined; }
    let res: EditUiWriteResult | Promise<EditUiWriteResult>;
    try { res = adapter.write(target, owner, value); } catch (e) { res = refuse('owner-unavailable', (e as Error).message); }
    if (res instanceof Promise) return res.catch((e: Error) => refuse('owner-unavailable', e.message));
    if (!res.ok) { this.rt.toast(res.detail, 'warning', 'Edit UI'); return undefined; }
    return res;
  }

  /** Drop one recorded entry (an optimistic write that failed) without re-applying anything. */
  private forget(entry: EditUiUndoEntry): void {
    const i = this.stack.entries.indexOf(entry);
    if (i === -1) return;
    const entries = this.stack.entries.filter((e) => e !== entry);
    this.stack = { ...this.stack, entries, cursor: Math.min(entries.length, i < this.stack.cursor ? this.stack.cursor - 1 : this.stack.cursor) };
    this.notify();
  }

  undo(): EditUiActionResult { return this.step('undo'); }
  redo(): EditUiActionResult { return this.step('redo'); }

  private step(dir: 'undo' | 'redo'): EditUiActionResult {
    const r = dir === 'undo' ? undo(this.stack) : redo(this.stack);
    if ('refused' in r) { this.rt.toast(r.refused.detail, 'info', 'Edit UI'); return { ok: false, ...r.refused, state: this.state() }; }
    this.stack = r.stack;
    const w = this.write(r.apply.target, r.apply.owner, r.apply.value);
    if (w === undefined) { this.stack = revertStep(this.stack, dir); this.notify(); return { ok: false, reason: 'owner-unavailable', detail: `${r.apply.owner.kind} refused the ${dir}`, state: this.state() }; }
    if (w instanceof Promise) w.then((res) => { if (!res.ok) { this.rt.toast(`${dir} not saved: ${res.detail}`, 'danger', 'Edit UI'); this.stack = revertStep(this.stack, dir); this.notify(); } });
    this.notify();
    this.rt.terminal.ok('edit-ui', `${dir}: ${targetKey(r.apply.target)} → ${JSON.stringify(r.apply.value)}`);
    return { ok: true, entry: r.apply.entry, state: this.state() };
  }

  canUndo(): boolean { return canUndo(this.stack); }
  canRedo(): boolean { return canRedo(this.stack); }

  private refused(reason: EditUiReason, detail: string): EditUiStep {
    this.rt.toast(detail, 'warning', 'Edit UI');
    return { state: this.gate, refused: { reason, detail } };
  }

  /** Actions registered (for the Opus phase's transports and the check). */
  static readonly ACTIONS = EDIT_UI_ACTIONS;
}

/* ================================================================ default adapters */

const scalarOrNull = (v: unknown): EditUiValue => (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null);

/** control@1 token overrides, component instance tokens and customizable-slot tokens. */
export function assetTokenAdapter(rt: AxfRuntime): EditUiOwnerAdapter {
  const saveMap = (key: string, next: Record<string, unknown> | null) => { if (next && Object.keys(next).length) rt.settings.set(key, next as unknown as SettingValue); else rt.settings.clear(key); };
  const family = (t: EditUiTarget) => EDIT_UI_INSTANCE_FAMILIES[t.assetType ?? ''];
  return {
    read(t, o) {
      if (t.kind === 'token') {
        const slot = CONTROL_TOKEN_SLOTS[t.slot as keyof typeof CONTROL_TOKEN_SLOTS];
        const over = effectiveTokenOverrides(rt.settings.get(o.key ?? ''), t.assetId)[t.path!];
        if (over !== undefined) return over;
        const a = rt.assetOrNull(slot.slot as AssetType);
        return a ? scalarOrNull(tokenValueIn(t.slot!, a.data, t.path!)) : undefined;
      }
      const fam = family(t);
      if (fam && t.path) return instanceTokenValues(rt.settings.get(INSTANCE_TOKENS_KEY), fam, t.instance ?? t.assetId!)[t.path];
      if (customizable(t.assetType!)) { const key = customKey(t); return key ? rt.customSlot(t.assetType as AssetType).byId[t.assetId!]?.[key] : undefined; }
      return undefined;
    },
    write(t, o, value) {
      if (t.kind === 'token') {
        const raw = rt.settings.get(o.key ?? '');
        const next = value === null ? withoutTokenOverride(raw, t.path, t.assetId ?? '*') : withTokenOverride(raw, t.path!, value, t.assetId ?? '*');
        saveMap(o.key!, next);
        return { ok: true };
      }
      const fam = family(t);
      if (fam && isComponentTokenFamily(fam)) {
        if (!t.path) return refuse('bad-target', `say which ${fam} token (path), e.g. headerBg`);
        if (typeof value === 'boolean') return refuse('bad-target', 'a token is text or a number');
        rt.settings.set(INSTANCE_TOKENS_KEY, setInstanceToken(rt.settings.get(INSTANCE_TOKENS_KEY), fam, t.instance ?? t.assetId!, t.path, value) as unknown as SettingValue);
        return { ok: true };
      }
      if (customizable(t.assetType!)) {
        const key = customKey(t);
        if (!key) return refuse('bad-target', `${t.assetType} has no ${t.prop} token to edit`);
        const slot = rt.customSlot(t.assetType as AssetType);
        const mine = { ...(slot.byId[t.assetId!] ?? {}) };
        if (value === null) delete mine[key]; else mine[key] = value;
        const byId = { ...slot.byId, [t.assetId!]: mine };
        if (!Object.keys(mine).length) delete byId[t.assetId!];
        return rt.setCustomSlot(t.assetType as AssetType, { ...slot, byId }) ? { ok: true } : refuse('permission', 'your role cannot change the look');
      }
      return refuse('owner-unavailable', `no ${t.prop} token is mapped for ${t.assetType} yet`);
    },
  };
}

/** The customize token a size / colour edit lands on: the path when given, else the first token of that kind for the type. */
function customKey(t: EditUiTarget): string | null {
  const tokens = customTokensFor(t.assetType!);
  if (t.path) return tokens.some((x) => x.key === t.path) ? t.path : null;
  const kind = t.prop === 'colour' ? 'color' : 'scale';
  return tokens.find((x) => x.kind === kind)?.key ?? null;
}

/** Chrome instance overrides (chrome-settings@1 fields) and a grid's column overrides. */
export function assetPropertyAdapter(rt: AxfRuntime): EditUiOwnerAdapter {
  const chromeField = (t: EditUiTarget) => {
    const type = t.assetType as ChromeType;
    const field = t.path ?? t.prop!;
    return CHROME_FIELDS[type]?.some((f) => f.key === field) ? field : null;
  };
  return {
    read(t, o) {
      if (o.key?.startsWith('axf.chrome.')) {
        const field = chromeField(t); if (!field) return undefined;
        const base = rt.assetOrNull(t.assetType as AssetType)?.data;
        return scalarOrNull(chromeFieldValue(t.assetType!, base, rt.settings.get(o.key), field));
      }
      if (t.kind === 'column') {
        const cols = rt.settings.get(GRID_COLUMNS_KEY(t.grid!));
        return isObj(cols) && isObj(cols[t.column!]) ? scalarOrNull((cols[t.column!] as Record<string, unknown>)[t.prop!]) : undefined;
      }
      if (t.assetType) return at(rt.assetOrNull(t.assetType as AssetType)?.data, t.path);
      return undefined;
    },
    write(t, o, value) {
      if (rt.gate('assets.swap') !== 'allow') return refuse('permission', 'your role cannot change the look');
      if (o.key?.startsWith('axf.chrome.')) {
        const field = chromeField(t);
        if (!field) return refuse('bad-target', `${t.assetType} has no field "${t.path ?? t.prop}" (${(CHROME_FIELDS[t.assetType as ChromeType] ?? []).map((f) => f.key).join(', ')})`);
        const cur = normalizeInstanceOverride(t.assetType!, rt.settings.get(o.key));
        const next: Record<string, string | number | boolean> = { ...cur };
        if (value === null) delete next[field]; else next[field] = value;
        const clean = normalizeInstanceOverride(t.assetType!, next);
        if (Object.keys(clean).length) rt.settings.set(o.key, clean as unknown as SettingValue); else rt.settings.clear(o.key);
        return { ok: true };
      }
      if (t.kind === 'column') {
        const key = GRID_COLUMNS_KEY(t.grid!);
        const cols = rt.settings.get(key);
        const all: Record<string, Record<string, EditUiValue>> = isObj(cols) ? { ...(cols as Record<string, Record<string, EditUiValue>>) } : {};
        const col = { ...(all[t.column!] ?? {}) };
        if (value === null) delete col[t.prop!]; else col[t.prop!] = value;
        if (Object.keys(col).length) all[t.column!] = col; else delete all[t.column!];
        if (Object.keys(all).length) rt.settings.set(key, all as unknown as SettingValue); else rt.settings.clear(key);
        return { ok: true };
      }
      return refuse('owner-unavailable', `a field of a ${t.assetType} asset has no owner yet (the look-writer path lands with the Edit UI React phase)`);
    },
  };
}

/** Data sources the app registered (`rt.editUi.registerDataSource`). */
export function dataAdapter(sources: Map<string, EditUiDataWriter>): EditUiOwnerAdapter {
  return {
    read(t) { return sources.get(t.source!)?.read?.(t.record!, t.field!); },
    write(t, _o, value) {
      const w = sources.get(t.source!);
      if (!w) return refuse('unknown-source', `no data source "${t.source}"`);
      const r = w.write(t.record!, t.field!, value);
      const wrap = (okay: boolean): EditUiWriteResult => (okay ? { ok: true } : refuse('no-writer', `"${t.source}" did not take the change`));
      return r instanceof Promise ? r.then(wrap) : wrap(r);
    },
  };
}
