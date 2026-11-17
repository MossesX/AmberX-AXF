/**
 * Page toolbar engine — page-toolbar@1 (rules in toolbar-rules.mjs; migration in toolbar-migrate.mjs). Build
 * rebuild-every-toolbar-page-specific (Brett, Nov 17 2026: "Everywhere there's a toolbar, rebuild the asset for that
 * page/plugin with useful, integrated buttons made for it.").
 *
 * The reference engine every port follows (Kotlin twin deferred, spec/PORTING.md). Pure: it takes a toolbar asset, the
 * page's state and a small environment, and answers with ready buttons:
 *   - which asset a page gets (`pickPageToolbar`: the user's pick for the slot, else the asset whose scope and slot match);
 *   - the per-toolbar user settings merged in (chrome-settings@1 overrides, tap-to-confirm) and the settings id
 *     (`gate.auto-lander`) every setting, override and console-control address hangs off;
 *   - each button's action ref turned into an invocation (`action` → an action spec, `command` → plugin + command +
 *     input, `control` → a console-control address and verb, `handler` → a page handler), with `args` filled from
 *     the page state (`"$selection.id"` → state.selection.id);
 *   - enabled and visible from UAC, the host (embed@1 takes and locks), the wiring (a handler or command that nobody
 *     registered is disabled with a reason, never dropped) and the page state (enabledWhen / visibleWhen);
 *   - badges (a runtime counter or a page-state value), pressed toggles (the app-menu bindings plus `state:<key>`);
 *   - the overflow plan: which buttons stay on the bar and which fold into More, by priority, honouring never/always/keep;
 *   - `invokeToolbarButton`: runs an invocation through the dispatchers a host provides, asking first when the button
 *     says confirm.
 * Pages render through framework/react (usePageToolbar); the API spine (console-control toolbar:<id>/button:<b>)
 * reads and presses through the same functions, so the UI and the API can never disagree.
 */
import type { Gate, ToolbarData, ToolbarGroup, ToolbarItem } from '../types';
import type { CompiledMenuItem } from './appmenu';
import { CHROME_INSTANCE_ASSET_KEY, CHROME_INSTANCE_KEY, chromeInstanceData } from './chrome-settings-rules.mjs';
import { tapConfigFor, type TapConfig } from './tapconfirm';
import {
  PAGE_TOOLBAR_CONTRACT, TOOLBAR_DEFAULTS, formatToolbarScope, pageToolbarSettingsId, parseActionRef, parseBadge, parseToolbarChecked, parseToolbarScope, parseWhen, stateAt, toolbarStateKeys, whenHolds,
  type ToolbarActionRef, type ToolbarOverflow, type ToolbarScope,
} from './toolbar-rules.mjs';
import { migrateToolbar } from './toolbar-migrate.mjs';

export { PAGE_TOOLBAR_CONTRACT };

/* ================================================================== inputs */

/** A toolbar asset as the registry holds it (asset@1 envelope + data). */
export interface ToolbarAssetLike { id: string; name?: string; data: ToolbarData }

/** The page a toolbar is asked for: its view id and, when the page belongs to a plugin, the plugin id. */
export interface ToolbarPage { view?: string | null; plugin?: string | null; slot?: string | null }

/** Page state: whatever the page publishes (selection, busy, counts…), read with dotted keys. */
export type ToolbarPageState = Record<string, unknown>;

/**
 * What the engine needs from the host to resolve a toolbar. Everything is optional but `get`: a page with no UAC, no
 * host and no registries still resolves (every ref is assumed wired).
 */
export interface ToolbarEnv {
  /** read a setting (chrome overrides, tap-to-confirm) */
  get: (key: string) => unknown;
  /** UAC gate for an item's `requires` (default: allow) */
  gate?: (requires?: string) => Gate;
  /** runtime counter (`rt.badge`) for counter badges and `counter:` toggles */
  counter?: (name: string) => number;
  /** settings value for `setting:` toggles (default: `get`) */
  setting?: (key: string) => unknown;
  /** whether a chrome slot is hidden, for `slot:` / `hidden:` toggles */
  hidden?: (type: string) => boolean;
  /** the host app does this action itself (embed@1 takes): the button is left out */
  takenByHost?: (action: string) => boolean;
  /** the host locks this action: the button is greyed with the note */
  lockedByHost?: (action: string) => string | null | undefined;
  /** registered page handler ids; when given, a `handler:` ref not in it is disabled ("not wired") */
  handlers?: readonly string[];
  /** known plugin commands as `<plugin>/<command>`; when given, a `command:` ref not in it is disabled */
  commands?: readonly string[];
  /** registered console action ids; when given, an `action:` ref whose id is unknown is disabled */
  actions?: readonly string[];
  /** live provider groups already loaded by the host (`rt.loadToolbarProvider`), by provider id */
  providerItems?: Record<string, readonly CompiledMenuItem[]>;
  /** how many buttons fit on the bar right now (measured by the renderer); undefined = everything fits */
  fit?: number;
}

/* ================================================================== outputs */

export type ToolbarInvocation =
  | { kind: 'action'; spec: string; id: string; args: Record<string, unknown> }
  | { kind: 'command'; plugin: string; command: string; input: Record<string, unknown> }
  | { kind: 'control'; address: string; verb: 'press' | 'open'; args: Record<string, unknown> }
  | { kind: 'handler'; id: string; args: Record<string, unknown> };

export interface ResolvedToolbarButton {
  /** unique within the toolbar: `<group>/<item>` */
  key: string;
  id: string;
  group: string;
  icon: string;
  label: string;
  /** the tooltip: the label, with the reason when disabled */
  title: string;
  ref: ToolbarActionRef | null;
  invocation: ToolbarInvocation | null;
  enabled: boolean;
  visible: boolean;
  /** why it is disabled or hidden, in words (gate, host, wiring, state) */
  reason: string | null;
  /** toggle state: true / false, or null when the button is not a toggle */
  pressed: boolean | null;
  /** badge text (a count or a short state value), or null when none / zero */
  badge: string | null;
  destructive: boolean;
  /** the question to ask first, or null */
  confirm: string | null;
  priority: number;
  overflow: ToolbarOverflow;
  requires: string | null;
  /** console-control address: `toolbar:<settings id>/button:<item id>` */
  address: string;
  /** where the button came from: the asset, or a live provider */
  origin: 'asset' | `provider:${string}`;
}

export interface ResolvedToolbarGroup { id: string; label: string | null; provider: string | null; visible: boolean; buttons: ResolvedToolbarButton[] }

export interface ResolvedToolbar {
  contract: typeof PAGE_TOOLBAR_CONTRACT;
  /** the asset id */
  asset: string;
  /** the settings id (`app`, `gate`, `gate.auto-lander`) */
  id: string;
  scope: ToolbarScope;
  slot: string;
  label: string;
  /** console-control address of the toolbar: `toolbar:<settings id>` */
  address: string;
  /** the look after the user's overrides */
  look: Pick<ToolbarData, 'variant' | 'align' | 'density' | 'surface' | 'divider' | 'showSearch' | 'search' | 'collapsible' | 'widgets'>;
  tapConfirm: TapConfig;
  groups: ResolvedToolbarGroup[];
  /** every visible button in bar order */
  buttons: ResolvedToolbarButton[];
  /** the buttons that stay on the bar */
  bar: ResolvedToolbarButton[];
  /** the buttons folded into More */
  more: ResolvedToolbarButton[];
  moreLabel: string;
  /** the page-state keys the toolbar reads */
  stateKeys: string[];
}

/* ================================================================== picking the asset */

/** Whether a toolbar asset is for this page: its scope names the view, or the plugin, and its slot matches. */
export function toolbarMatchesPage(data: ToolbarData, page: ToolbarPage): boolean {
  const s = parseToolbarScope(data.scope);
  if (!s || s.kind === 'app') return false;
  const slot = data.slot ?? TOOLBAR_DEFAULTS.slot;
  if ((page.slot ?? TOOLBAR_DEFAULTS.slot) !== slot) return false;
  if (s.kind === 'view') return !!page.view && s.id.toLowerCase() === page.view.toLowerCase();
  return !!page.plugin && s.id.toLowerCase() === page.plugin.toLowerCase();
}

/** The settings id of the toolbar a page asks for (before any asset is known): the view's, else the plugin's. */
export function pageToolbarId(page: ToolbarPage): string {
  const scope: ToolbarScope | null = page.view ? { kind: 'view', id: page.view } : page.plugin ? { kind: 'plugin', id: page.plugin } : null;
  return pageToolbarSettingsId(scope, page.slot ?? null);
}

/**
 * Pick the toolbar asset for a page: the user's pick for the slot (`axf.chrome.toolbar.<settings id>.asset`) when it
 * names a registered toolbar, else the first asset whose scope is the view, else the first whose scope is the plugin.
 * Null when the page has no toolbar asset (the page keeps its handwritten bar).
 */
export function pickPageToolbar<T extends ToolbarAssetLike>(assets: readonly T[], page: ToolbarPage, get: (key: string) => unknown): T | null {
  const id = pageToolbarId(page);
  const pick = get(CHROME_INSTANCE_ASSET_KEY('toolbar', id));
  if (typeof pick === 'string') { const hit = assets.find((a) => a.id === pick); if (hit) return hit; }
  const byView = page.view ? assets.find((a) => toolbarMatchesPage(a.data, { view: page.view, slot: page.slot })) : undefined;
  if (byView) return byView;
  return (page.plugin ? assets.find((a) => toolbarMatchesPage(a.data, { plugin: page.plugin, slot: page.slot })) : undefined) ?? null;
}

/* ================================================================== resolving */

const DEFAULT_GATE: Gate = 'allow';

/** Fill `args`: a string value `$key` becomes the page-state value at that key (missing → undefined, dropped). */
export function fillToolbarArgs(args: Record<string, unknown> | undefined, state: ToolbarPageState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (typeof v === 'string' && v.startsWith('$') && v.length > 1) { const x = stateAt(state, v.slice(1)); if (x !== undefined) out[k] = x; continue; }
    out[k] = v;
  }
  return out;
}

/** The action spec the ActionBus parses (`id:arg1:arg2`) from a ref and its args (in key order). */
export function actionSpecOf(ref: ToolbarActionRef, args: Record<string, unknown>): string {
  const extra = Object.values(args).filter((v) => v !== undefined && v !== null && v !== '').map(String);
  return extra.length ? `${ref.id}:${extra.join(':')}` : ref.id;
}

/** An action ref plus filled args → the invocation a host runs. Null for a ref that cannot be parsed. */
export function toolbarInvocation(ref: ToolbarActionRef | null, args: Record<string, unknown>): ToolbarInvocation | null {
  if (!ref) return null;
  switch (ref.kind) {
    case 'action': return { kind: 'action', id: ref.id, spec: actionSpecOf(ref, args), args };
    case 'command': return { kind: 'command', plugin: ref.plugin ?? '', command: ref.command ?? '', input: args };
    case 'control': return { kind: 'control', address: ref.id, verb: /(?:^|\/)(?:view|tab|subtab|panel|plugin|scroll):/.test(ref.id) && !/\/(?:button|function|setting):/.test(ref.id) && !/^(?:button|function|setting):/.test(ref.id) ? 'open' : 'press', args };
    case 'handler': return { kind: 'handler', id: ref.id, args };
    default: return null;
  }
}

/** The badge text of an item: a counter (> 0) or a page-state value (a number > 0, or short text). */
export function toolbarBadgeText(badge: string | undefined, state: ToolbarPageState, counter: (name: string) => number): string | null {
  const b = parseBadge(badge);
  if (!b) return null;
  if (b.kind === 'counter') { const n = counter(b.ref); return n > 0 ? (n > 99 ? '99+' : String(n)) : null; }
  const v = stateAt(state, b.ref);
  if (typeof v === 'number') return v > 0 ? (v > 99 ? '99+' : String(v)) : null;
  if (typeof v === 'string') return v.trim() ? v.trim().slice(0, 12) : null;
  if (Array.isArray(v)) return v.length ? String(v.length) : null;
  return null;
}

/** The pressed state of a toggle binding (app-menu kinds through the env, `state:<key>` from the page state). */
export function toolbarPressed(checked: string | undefined, state: ToolbarPageState, env: ToolbarEnv): boolean | null {
  const c = parseToolbarChecked(checked);
  if (!c) return null;
  const truthy = (v: unknown) => !(v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));
  switch (c.kind) {
    case 'state': return truthy(stateAt(state, c.ref));
    case 'setting': return truthy((env.setting ?? env.get)(c.ref));
    case 'counter': return (env.counter?.(c.ref) ?? 0) > 0;
    case 'slot': return !(env.hidden?.(c.ref) ?? false);
    case 'hidden': return env.hidden?.(c.ref) ?? false;
    default: return null;
  }
}

const confirmTextOf = (it: Pick<ToolbarItem, 'confirm' | 'destructive' | 'label'>): string | null => {
  if (it.confirm === true) return TOOLBAR_DEFAULTS.confirmText;
  if (typeof it.confirm === 'string' && it.confirm.trim()) return it.confirm.trim();
  return null;
};

/** Resolve one item of a group into a button. `origin` says whether it came from the asset or a live provider. */
export function resolveToolbarItem(it: ToolbarItem, group: ToolbarGroup, toolbarId: string, state: ToolbarPageState, env: ToolbarEnv, origin: ResolvedToolbarButton['origin'] = 'asset', lockedNote?: string): ResolvedToolbarButton {
  const ref = parseActionRef(it.action);
  const args = fillToolbarArgs(it.args, state);
  const invocation = toolbarInvocation(ref, args);
  const requires = it.requires ?? null;
  const gate = env.gate?.(requires ?? undefined) ?? DEFAULT_GATE;
  let visible = true;
  let enabled = true;
  let reason: string | null = null;
  const groupVisible = whenHolds(parseWhen(group.visibleWhen) ?? [], state);
  const itemVisible = whenHolds(parseWhen(it.visibleWhen) ?? [], state);
  if (gate === 'hide') { visible = false; reason = `requires ${requires}`; }
  else if (ref && env.takenByHost?.(it.action)) { visible = false; reason = 'done by the host app'; }
  else if (!groupVisible || !itemVisible) { visible = false; reason = 'hidden by the page state'; }
  if (visible) {
    const hostLock = (ref ? env.lockedByHost?.(it.action) : null) ?? lockedNote ?? null;
    if (gate === 'disable') { enabled = false; reason = `requires ${requires}`; }
    else if (hostLock) { enabled = false; reason = hostLock; }
    else if (!ref) { enabled = false; reason = 'no action'; }
    else if (ref.kind === 'handler' && env.handlers && !env.handlers.includes(ref.id)) { enabled = false; reason = `not wired: no handler "${ref.id}" on this page`; }
    else if (ref.kind === 'command' && env.commands && !env.commands.includes(ref.id)) { enabled = false; reason = `not wired: no command "${ref.id}"`; }
    else if (ref.kind === 'action' && env.actions && !env.actions.includes(ref.id.split(':')[0] ?? ref.id)) { enabled = false; reason = `not wired: no action "${ref.id}"`; }
    else if (!whenHolds(parseWhen(group.enabledWhen) ?? [], state) || !whenHolds(parseWhen(it.enabledWhen) ?? [], state)) { enabled = false; reason = 'not available in this state'; }
  }
  const label = it.label ?? it.id;
  const priority = typeof it.priority === 'number' ? it.priority : typeof group.priority === 'number' ? group.priority : TOOLBAR_DEFAULTS.priority;
  const overflow: ToolbarOverflow = it.overflow ?? group.overflow ?? 'auto';
  const badge = visible ? toolbarBadgeText(it.badge, state, env.counter ?? (() => 0)) : null;
  return {
    key: `${group.id}/${it.id}`, id: it.id, group: group.id, icon: it.icon ?? 'chevron-right', label,
    title: reason && (!enabled || !visible) ? `${label} — ${reason}` : label,
    ref, invocation, enabled: visible && enabled, visible, reason,
    pressed: visible ? toolbarPressed(it.checked, state, env) : null, badge,
    destructive: it.destructive === true, confirm: confirmTextOf(it), priority, overflow, requires,
    address: `toolbar:${toolbarId}/button:${it.id}`, origin,
  };
}

/** The overflow plan: which visible buttons stay on the bar (in bar order) and which fold into More. */
export function planToolbarOverflow(buttons: readonly ResolvedToolbarButton[], rule: ToolbarData['overflow'], fit: number | undefined): { bar: ResolvedToolbarButton[]; more: ResolvedToolbarButton[]; label: string } {
  const r = typeof rule === 'string' ? { when: rule } : rule ?? {};
  const when: ToolbarOverflow = r.when ?? TOOLBAR_DEFAULTS.overflow.when;
  const keep = Math.max(0, Math.floor(r.keep ?? TOOLBAR_DEFAULTS.overflow.keep));
  const label = r.label?.trim() || TOOLBAR_DEFAULTS.overflow.label;
  const visible = buttons.filter((b) => b.visible);
  const inMore = new Set<string>();
  for (const b of visible) if (b.overflow === 'always') inMore.add(b.key);
  // Fold order: lowest priority first; at a tie a live provider button folds before a button the asset placed, and
  // the later button on the bar folds before the earlier one (the end of the bar gives way first).
  const pos = new Map(visible.map((b, i) => [b.key, i]));
  const foldFirst = (a: ResolvedToolbarButton, b: ResolvedToolbarButton) => a.priority - b.priority || Number(b.origin !== 'asset') - Number(a.origin !== 'asset') || (pos.get(b.key) ?? 0) - (pos.get(a.key) ?? 0);
  if (when === 'always') {
    // only `keep` buttons stay (the last to fold); `never` buttons always stay
    const candidates = visible.filter((b) => !inMore.has(b.key) && b.overflow !== 'never').sort(foldFirst);
    candidates.slice(0, Math.max(0, candidates.length - keep)).forEach((b) => inMore.add(b.key));
  } else if (when === 'auto' && typeof fit === 'number' && Number.isFinite(fit)) {
    const staying = visible.filter((b) => !inMore.has(b.key));
    const room = Math.max(keep, Math.floor(fit));
    if (staying.length > room) {
      const foldable = staying.filter((b) => b.overflow !== 'never').sort(foldFirst);
      let excess = staying.length - room;
      for (const b of foldable) { if (excess <= 0) break; inMore.add(b.key); excess--; }
    }
  }
  return { bar: visible.filter((b) => !inMore.has(b.key)), more: visible.filter((b) => inMore.has(b.key)), label };
}

/** A live provider's compiled items as toolbar items (the same shape the frame toolbar draws them with). */
const providerItemsOf = (items: readonly CompiledMenuItem[] | undefined): { item: ToolbarItem; locked: boolean }[] =>
  (items ?? []).filter((it) => !it.separator && it.action).map((it) => ({ item: { id: it.id, icon: it.icon ?? 'chevron-right', label: it.label, action: it.action!, badge: it.badge, checked: it.checked, requires: it.requires }, locked: !!it.locked }));

/**
 * Resolve a toolbar asset for a page into ready buttons. The asset is migrated first (both shapes), the user's
 * chrome overrides for the settings id are merged over its look, tap-to-confirm is read for the same id.
 */
export function resolvePageToolbar(asset: ToolbarAssetLike, page: ToolbarPage, state: ToolbarPageState, env: ToolbarEnv): ResolvedToolbar {
  const { data: migrated } = migrateToolbar(asset.data) as { data: ToolbarData };
  const scope = parseToolbarScope(migrated.scope) ?? { kind: 'app', id: '' };
  const slot = migrated.slot ?? page.slot ?? TOOLBAR_DEFAULTS.slot;
  const id = scope.kind === 'app' ? (page.view || page.plugin ? pageToolbarId({ ...page, slot }) : 'app') : pageToolbarSettingsId(scope, slot);
  const data = chromeInstanceData('toolbar', migrated, env.get(CHROME_INSTANCE_KEY('toolbar', id))) as ToolbarData;
  const groups: ResolvedToolbarGroup[] = (data.groups ?? []).map((g) => {
    const fixed = (g.items ?? []).map((it) => resolveToolbarItem(it, g, id, state, env, 'asset'));
    const live = g.provider ? providerItemsOf(env.providerItems?.[g.provider]).map(({ item, locked }) => resolveToolbarItem(item, g, id, state, env, `provider:${g.provider}`, locked ? 'not available' : undefined)) : [];
    const buttons = [...fixed, ...live];
    return { id: g.id, label: g.label ?? null, provider: g.provider ?? null, visible: buttons.some((b) => b.visible), buttons };
  });
  const buttons = groups.flatMap((g) => g.buttons).filter((b) => b.visible);
  const plan = planToolbarOverflow(buttons, data.overflow, env.fit);
  return {
    contract: PAGE_TOOLBAR_CONTRACT, asset: asset.id, id, scope, slot,
    label: asset.name ?? id, address: `toolbar:${id}`,
    look: { variant: data.variant, align: data.align, density: data.density, surface: data.surface, divider: data.divider, showSearch: data.showSearch, search: data.search, collapsible: data.collapsible, widgets: data.widgets },
    tapConfirm: tapConfigFor(env.get, 'toolbar', id),
    groups, buttons, bar: plan.bar, more: plan.more, moreLabel: plan.label,
    stateKeys: toolbarStateKeys(migrated),
  };
}

/* ================================================================== state for the API (console-control) */

/** The readable state of a resolved toolbar (console-control `state` on `toolbar:<id>`): compact, no functions. */
export function toolbarState(t: ResolvedToolbar) {
  return {
    contract: t.contract, id: t.id, asset: t.asset, scope: formatToolbarScope(t.scope), slot: t.slot, label: t.label, address: t.address,
    look: t.look, tapConfirm: t.tapConfirm.enabled, stateKeys: t.stateKeys, moreLabel: t.moreLabel,
    buttons: t.buttons.map((b) => toolbarButtonState(b, t.more.some((m) => m.key === b.key))),
  };
}

/** The readable state of one button (console-control `state` on `toolbar:<id>/button:<b>`). */
export function toolbarButtonState(b: ResolvedToolbarButton, inMore = false) {
  return {
    id: b.id, group: b.group, address: b.address, label: b.label, icon: b.icon, enabled: b.enabled, visible: b.visible, reason: b.reason, pressed: b.pressed, badge: b.badge,
    destructive: b.destructive, confirm: b.confirm !== null, action: b.ref ? `${b.ref.kind}:${b.ref.id}` : null, invocation: b.invocation, priority: b.priority, overflow: b.overflow, inMore, requires: b.requires, origin: b.origin,
  };
}

/** Find a button by its item id (or `group/item` key) on a resolved toolbar. */
export function findToolbarButton(t: ResolvedToolbar, idOrKey: string): ResolvedToolbarButton | null {
  const all = t.groups.flatMap((g) => g.buttons);
  return all.find((b) => b.key === idOrKey) ?? all.find((b) => b.id === idOrKey) ?? all.find((b) => b.id.toLowerCase() === idOrKey.toLowerCase()) ?? null;
}

/* ================================================================== invoking */

/** The dispatchers a host provides: one per invocation kind. A missing one answers `unsupported`. */
export interface ToolbarDispatchers {
  action?: (spec: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
  command?: (plugin: string, command: string, input: Record<string, unknown>) => unknown | Promise<unknown>;
  control?: (address: string, verb: 'press' | 'open', args: Record<string, unknown>) => unknown | Promise<unknown>;
  handler?: (id: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** ask the person (UI) or check the caller's `confirm` flag (API); default: refuse */
  confirm?: (question: string, button: ResolvedToolbarButton) => boolean | Promise<boolean>;
}

export type ToolbarPressOutcome =
  | { ok: true; button: string; invocation: ToolbarInvocation; result: unknown }
  | { ok: false; button: string; code: 'disabled' | 'hidden' | 'no-action' | 'unsupported' | 'confirmation_required' | 'declined' | 'failed'; message: string; question?: string };

/**
 * Press a resolved button: refuse what the UI would refuse (hidden, disabled, no action), ask first when the button
 * says confirm (a destructive button with no question asks the default one through the API), then run the invocation
 * through the matching dispatcher. Never throws: a failure is an outcome with a code.
 */
export async function invokeToolbarButton(b: ResolvedToolbarButton, d: ToolbarDispatchers, opts: { api?: boolean } = {}): Promise<ToolbarPressOutcome> {
  if (!b.visible) return { ok: false, button: b.id, code: 'hidden', message: b.reason ?? 'not on this screen' };
  if (!b.enabled) return { ok: false, button: b.id, code: 'disabled', message: b.reason ?? 'disabled' };
  if (!b.invocation) return { ok: false, button: b.id, code: 'no-action', message: 'the button has no action' };
  const question = b.confirm ?? (opts.api && b.destructive ? TOOLBAR_DEFAULTS.confirmText : null);
  if (question) {
    if (!d.confirm) return { ok: false, button: b.id, code: 'confirmation_required', message: question, question };
    let yes = false;
    try { yes = await d.confirm(question, b); } catch { yes = false; }
    if (!yes) return { ok: false, button: b.id, code: opts.api ? 'confirmation_required' : 'declined', message: question, question };
  }
  const inv = b.invocation;
  try {
    let result: unknown;
    switch (inv.kind) {
      case 'action': if (!d.action) return unsupported(b, inv); result = await d.action(inv.spec, inv.args); break;
      case 'command': if (!d.command) return unsupported(b, inv); result = await d.command(inv.plugin, inv.command, inv.input); break;
      case 'control': if (!d.control) return unsupported(b, inv); result = await d.control(inv.address, inv.verb, inv.args); break;
      case 'handler': if (!d.handler) return unsupported(b, inv); result = await d.handler(inv.id, inv.args); break;
    }
    return { ok: true, button: b.id, invocation: inv, result: result ?? null };
  } catch (e) {
    return { ok: false, button: b.id, code: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

const unsupported = (b: ResolvedToolbarButton, inv: ToolbarInvocation): ToolbarPressOutcome => ({ ok: false, button: b.id, code: 'unsupported', message: `this host cannot run ${inv.kind} refs` });

/* ================================================================== suggestions for the asset builder */

/** A page function the asset builder can offer as a button (from the plugin's commands or the console's actions). */
export interface ToolbarFunctionHint { ref: string; label: string; icon: string; readOnly: boolean; destructive: boolean; confirm: boolean }

/**
 * Buttons a page toolbar could carry, from a plugin's command list (plugin-commands@1): write commands first, read
 * commands after; a command whose title says confirm or reset / delete / remove is destructive and asks first.
 */
export function suggestToolbarButtons(plugin: string, commands: readonly { id: string; title?: string; readOnly?: boolean }[], max = 8): ToolbarFunctionHint[] {
  const icon = (id: string, title: string) => (/run|start|launch/i.test(id + title) ? 'play' : /retry|refresh|reload/i.test(id + title) ? 'refresh' : /pause|stop/i.test(id + title) ? 'pause' : /reset|delete|remove|clear/i.test(id + title) ? 'trash' : /add|new|create/i.test(id + title) ? 'plus' : /export|download/i.test(id + title) ? 'download' : /list|get|status|show/i.test(id + title) ? 'list' : 'zap');
  const hints = commands.map((c) => {
    const title = c.title ?? c.id;
    const destructive = /reset|delete|remove|clear|purge/i.test(c.id + ' ' + title);
    return { ref: `command:${plugin}/${c.id}`, label: title.replace(/^[^:]+:\s*/, '').replace(/\s*\(confirm\)\s*$/i, ''), icon: icon(c.id, title), readOnly: !!c.readOnly, destructive, confirm: destructive || /confirm/i.test(title) };
  });
  return [...hints.filter((h) => !h.readOnly), ...hints.filter((h) => h.readOnly)].slice(0, Math.max(1, max));
}
