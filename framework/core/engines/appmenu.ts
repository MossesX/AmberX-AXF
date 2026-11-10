/**
 * App-menu engine — the application menu as one compiled tree.
 *
 * Inputs: the active `app-menu` asset (static menus), run-time **contributions** (a library or plugin adds items or
 * whole submenus into a named top-level menu, created when missing, or under an item path) and **live lists**
 * (an item with `provider: "<id>"` is a submenu filled on open by a provider registered at run time). Output: menus
 * with stable ids, placement applied (`order` / `before` / `after`), UAC gating (hide drops, disable locks), badges
 * (runtime counters), check marks (`checked` bindings), empty submenus pruned, a depth cap, and the conflicts found
 * (the same id contributed by two modules: later wins, reported like context items through `rt.diagnostics`).
 *
 * Pure and framework-agnostic, pinned by spec/fixtures/app-menu.json (replayed by spec/check-app-menu.mts). The Android
 * twin (`AppMenuEngine.kt`, same names) is deferred: Android port on hold, Brett Oct 21 2026 (see spec/PORTING.md).
 * Field names and limits come from schemas/asset-types.json → `menuItems`.
 *
 * Live-list rows (a provider's items, never an asset's) may also carry `buttons` (Deny / Approve on the row itself,
 * run through the provider's `act`), `detail` (a second line), `deadline` (a live countdown), `paused` and `expand` (details in place, `<kind>:<key>`); they pass
 * through untouched, buttons gated like items (hide drops, disable locks). Runtime only: not asset fields.
 *
 * menu-item@2 (spec/MENUS.md, Nov 10 2026): every compiled item carries its `kind` and `path`; a choice setting
 * (`setting` + `choices`) compiles to its current value, the choices with the picked one marked and the action each
 * pick runs; a live status slot (`status`) compiles to the state, tone, animation, icon and tooltip to draw; `hint`
 * is the tooltip of the row and its icon; per-item token overrides (settings key `axf.tokens.menu`, keyed by path)
 * are applied at compile time: behaviour tokens change the item, appearance tokens ride along as `look`. The pure
 * rules live in menu-item-rules.mjs (shared with the build engine's validator and control@1).
 */
import spec from '../../schemas/asset-types.json';
import type { AppMenuData, Gate, MenuChoice, MenuItem, MenuItemButton, MenuItemKind, MenuItemTag, MenuStatusReading, MenuStatusSpec } from '../types';
import {
  MENU_ITEM_APPEARANCE_TOKENS, choiceAction, compileStatus, currentChoice, menuItemKind, menuItemPath, menuItemV2Errors, nextChoice, normalizeMenuOverrides,
  parseStatusSource, switchAction, type CompiledMenuStatus, type MenuOverrides, type MenuTokenValue,
} from './menu-item-rules.mjs';
export {
  MENU_ITEMS_VERSION, MENU_KINDS, MENU_STATUS_KINDS, MENU_STATUS_STATES, MENU_STATUS_TONES, MENU_STATUS_ANIMS, MENU_STATUS_DEFAULT_ANIMS, MENU_STATUS_TEXT, MENU_CHOICES_MAX,
  MENU_TOKENS_KEY, MENU_TOKENS_TARGET, MENU_SETTING_SET, MENU_SETTING_TOGGLE, MENU_ITEM_TOKENS, MENU_ITEM_TOKEN_IDS, MENU_ITEM_APPEARANCE_TOKENS, MENU_ITEM_BEHAVIOR_TOKENS,
  menuItemKind, choiceAction, switchAction, parseChoiceAction, currentChoice, nextChoice, parseStatusSource, statusSpec, compileStatus, menuItemPath, isMenuItemPath,
  normalizeMenuOverrides, normalizeMenuToken, withMenuOverride, withoutMenuOverrides, listMenuOverrides, migrateMenuItems, migrateMenuAsset, menuItemV2Errors,
  MENU_ITEM_DIALOG, MENU_ITEM_ACTIONS, MENU_TOKEN_SEP, menuTokenPath, parseMenuTokenPath, menuTokenErrors,
  type CompiledMenuStatus, type MenuOverrides, type MenuTokenValue, type MenuTokenSpec,
} from './menu-item-rules.mjs';

const MENU_SPEC = spec.menuItems as { optional_fields: Record<string, string>; checkedKinds: string[]; maxDepth: number; providerMax: number; defaultOrder: number; version: number };
const TYPE_LABELS = spec.types as unknown as Record<string, { label: string; icon?: string; hideable?: boolean }>;

/** Optional menu-item fields the validators accept (asset-types.json → menuItems.optional_fields). */
export const MENU_ITEM_FIELDS: readonly string[] = Object.keys(MENU_SPEC.optional_fields);
/** Kinds a `checked` binding may use: setting | counter | slot | hidden. */
export const CHECKED_KINDS: readonly string[] = MENU_SPEC.checkedKinds;
/** Deepest submenu level kept (menu items are depth 1). */
export const MENU_MAX_DEPTH: number = MENU_SPEC.maxDepth;
/** Default cap on a live list before its More… entry. */
export const PROVIDER_MAX: number = MENU_SPEC.providerMax;
/** Placement order when none is given. */
export const MENU_DEFAULT_ORDER: number = MENU_SPEC.defaultOrder;
/** Origin of items that come from the app-menu asset itself. */
export const ASSET_ORIGIN = 'asset';
/** Top-level menu id a contribution without `menu` lands in. */
export const DEFAULT_MENU = 'more';

/** One step of a contribution's `path`: an existing submenu id, or one to create with a label. */
export interface MenuPathStep { id: string; label?: string; icon?: string }

/** Items a library or plugin contributes to the application menu (web `AxfWebLibrary.appMenu`, `rt.addAppMenuItems`). */
export interface AppMenuContribution {
  /** Unique, e.g. `<module>.<name>`; adding the same id again replaces it. */
  id: string;
  /** The contributing library or plugin id; `removeAppMenuItems(module)` drops all of its items. */
  module: string;
  /** Top-level menu id (created when missing, with `menuLabel` / `menuOrder`); default `more`. */
  menu?: string;
  menuLabel?: string;
  menuOrder?: number;
  /** Submenu path under the menu (`["builds", "pending"]`); a missing step is created as a submenu. */
  path?: (string | MenuPathStep)[];
  /** Placement of the items among their siblings (each item may override with its own order / before / after). */
  order?: number;
  before?: string;
  after?: string;
  items: MenuItem[];
}

/** A conflict found while merging: the same id contributed by two modules (the later one wins). */
export interface AppMenuConflict { what: 'app-menu item' | 'app-menu menu'; id: string; was: string; now: string }

/** The merged (not yet gated) tree: every item carries the module it came from. */
export interface MergedMenuItem extends Omit<MenuItem, 'items' | 'order' | 'before' | 'after'> { origin: string; items?: MergedMenuItem[] }
export interface MergedMenu { id: string; label: string; origin: string; items: MergedMenuItem[] }
export interface MergedAppMenu { menus: MergedMenu[]; conflicts: AppMenuConflict[]; notes: string[] }

/** A compiled choice: the author's choice plus whether it is the current value and the action a pick runs. */
export interface CompiledMenuChoice extends MenuChoice { on: boolean; action: string }

/** Appearance overrides on a compiled item (menu-item@2 tokens; theme tokens only, never literal colours). */
export interface CompiledMenuLook { tone?: string; iconTone?: string; weight?: string; emphasis?: string; size?: string }

/** A compiled (display-ready) item: gated, with its badge count and check state resolved. */
export interface CompiledMenuItem {
  id: string;
  label: string;
  /** menu-item@2: what the item is, and its stable path (`app-menu/file/exports/json`) for overrides and tests */
  kind: MenuItemKind;
  path: string;
  /** tooltip of the row and its icon (the label when the item gives none) */
  hint?: string;
  icon?: string;
  action?: string;
  shortcut?: string;
  requires?: string;
  separator?: boolean;
  /** a choice setting: its key, the current value's label (shown beside the entry), the choices and whether a click cycles */
  setting?: string;
  value?: MenuTokenValue | null;
  valueLabel?: string;
  choices?: CompiledMenuChoice[];
  cycle?: boolean;
  /** the live status slot to draw */
  status?: CompiledMenuStatus;
  /** appearance overrides in force (from `axf.tokens.menu`) */
  look?: CompiledMenuLook;
  /** submenu; empty for a `provider` item until the provider answers */
  items?: CompiledMenuItem[];
  provider?: string;
  /** counter name (as authored) and its value when above 0 */
  badge?: string;
  count?: number;
  /** the `checked` binding and its resolved state (absent when the binding doesn't resolve) */
  checked?: string;
  check?: boolean;
  /** UAC disable gate: shown but not runnable */
  locked: boolean;
  origin: string;
  /** live-list rows: buttons on the row (gated), second line, countdown deadline (local ms), paused text */
  buttons?: CompiledMenuButton[];
  detail?: string;
  deadline?: number;
  paused?: string;
  /** live-list rows: `<kind>:<key>` for the expandable details (React `registerMenuRowDetails`) */
  expand?: string;
  tag?: MenuItemTag;
  chip?: string;
}
export interface CompiledMenuButton extends MenuItemButton { locked: boolean }
export interface CompiledMenu { id: string; label: string; origin: string; items: CompiledMenuItem[] }
export interface CompiledAppMenu { menus: CompiledMenu[]; conflicts: AppMenuConflict[]; notes: string[] }

/** What compiling needs from the runtime (pure functions, so ports and fixtures can supply them). */
export interface AppMenuEnv {
  gate: (requires?: string) => Gate;
  /** runtime counter value (`rt.badge(name)`) */
  counter: (name: string) => number;
  /** settings value for `checked: setting:<key>` */
  setting: (key: string) => unknown;
  /** is a chrome slot hidden? (`rt.slotHidden`) */
  hidden: (type: string) => boolean;
  /** registered live-list provider ids */
  providers: readonly string[];
  maxDepth?: number;
  /**
   * Hooks the host app took over (embed@1 `takes`, e.g. settings): an item whose action or live list is
   * one of them is dropped. Absent = nothing taken.
   */
  taken?: (item: { action?: string; provider?: string }) => boolean;
  /**
   * Hooks of a function the host locks (embed@1 take with `lock`, e.g. plugins): the item stays, greyed
   * out (`locked`). Absent = nothing locked.
   */
  locked?: (item: { action?: string; provider?: string }) => boolean;
  /* ---- menu-item@2 ---- */
  /** a registered status source's reading (`status: source:<id>`); null / absent = not registered (the slot reads Unknown) */
  status?: (id: string) => MenuStatusReading | null | undefined;
  /** per-item token overrides (the `axf.tokens.menu` settings value, raw: normalized here) */
  overrides?: unknown;
  /** path root of the items compiled (`app-menu` for the application menu, `context-menu` for context menus) */
  pathRoot?: string;
}

/* ---------------- helpers ---------------- */

const ord = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : MENU_DEFAULT_ORDER);

/** `pending-builds` → `Pending builds` (the label for a menu or submenu created from an id). */
export function titleFromId(id: string): string {
  const s = id.replace(/[-_.]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : id;
}

type Node = {
  id: string; label?: string; icon?: string; action?: string; shortcut?: string; requires?: string; separator?: boolean;
  provider?: string; badge?: string; checked?: string;
  kind?: MenuItemKind; hint?: string; setting?: string; choices?: MenuChoice[]; cycle?: boolean; status?: string | MenuStatusSpec;
  buttons?: MenuItemButton[]; detail?: string; deadline?: number; paused?: string; tag?: MenuItemTag; chip?: string; expand?: string;
  items?: Node[]; origin: string; order: number; seq: number; before?: string; after?: string;
};
type MenuNode = { id: string; label: string; origin: string; order: number; seq: number; items: Node[] };

function toNode(it: MenuItem, origin: string, seq: number, defaults: { order?: number; before?: string; after?: string } = {}): Node {
  const n: Node = {
    id: it.id, origin, seq, order: ord(it.order ?? defaults.order),
    ...(it.label !== undefined ? { label: it.label } : {}),
    ...(it.icon !== undefined ? { icon: it.icon } : {}),
    ...(it.action !== undefined ? { action: it.action } : {}),
    ...(it.shortcut !== undefined ? { shortcut: it.shortcut } : {}),
    ...(it.requires !== undefined ? { requires: it.requires } : {}),
    ...(it.separator ? { separator: true } : {}),
    ...(it.provider !== undefined ? { provider: it.provider } : {}),
    ...(it.badge !== undefined ? { badge: it.badge } : {}),
    ...(it.checked !== undefined ? { checked: it.checked } : {}),
    ...(it.kind !== undefined ? { kind: it.kind } : {}),
    ...(typeof it.hint === 'string' && it.hint ? { hint: it.hint } : {}),
    ...(typeof it.setting === 'string' && it.setting ? { setting: it.setting } : {}),
    ...(Array.isArray(it.choices) && it.choices.length ? { choices: it.choices.map((c) => ({ ...c })) } : {}),
    ...(it.cycle === true ? { cycle: true } : {}),
    ...(it.status !== undefined && parseStatusSource(typeof it.status === 'string' ? it.status : it.status?.source) ? { status: typeof it.status === 'string' ? it.status : { ...it.status } } : {}),
    ...(Array.isArray(it.buttons) && it.buttons.length ? { buttons: it.buttons.map((b) => ({ ...b })) } : {}),
    ...(typeof it.detail === 'string' ? { detail: it.detail } : {}),
    ...(typeof it.deadline === 'number' && Number.isFinite(it.deadline) ? { deadline: it.deadline } : {}),
    ...(typeof it.paused === 'string' ? { paused: it.paused } : {}),
    ...(it.tag && typeof it.tag.label === 'string' && it.tag.label ? { tag: { ...it.tag } } : {}),
    ...(typeof it.chip === 'string' && it.chip ? { chip: it.chip } : {}),
    ...(typeof it.expand === 'string' && it.expand ? { expand: it.expand } : {}),
  };
  const before = it.before ?? defaults.before;
  const after = it.after ?? defaults.after;
  if (before) n.before = before;
  if (after) n.after = after;
  if (Array.isArray(it.items)) n.items = it.items.map((c, i) => toNode(c, origin, i));
  return n;
}

/** Stable sort by order, then anchors (`before` / `after` a sibling id) move items next to their anchor. */
function placeSiblings(list: Node[]): Node[] {
  const sorted = [...list].sort((a, b) => a.order - b.order || a.seq - b.seq);
  for (const n of [...sorted]) {
    const anchorId = n.before ?? n.after;
    if (!anchorId || anchorId === n.id) continue;
    const from = sorted.indexOf(n);
    const anchor = sorted.findIndex((x) => x.id === anchorId);
    if (anchor < 0) continue;
    sorted.splice(from, 1);
    const at = sorted.findIndex((x) => x.id === anchorId);
    sorted.splice(n.before ? at : at + 1, 0, n);
  }
  return sorted.map((n) => (n.items ? { ...n, items: placeSiblings(n.items) } : n));
}

function strip(n: Node): MergedMenuItem {
  const out: MergedMenuItem = { id: n.id, origin: n.origin };
  if (n.label !== undefined) out.label = n.label;
  if (n.icon !== undefined) out.icon = n.icon;
  if (n.action !== undefined) out.action = n.action;
  if (n.shortcut !== undefined) out.shortcut = n.shortcut;
  if (n.requires !== undefined) out.requires = n.requires;
  if (n.separator) out.separator = true;
  if (n.provider !== undefined) out.provider = n.provider;
  if (n.badge !== undefined) out.badge = n.badge;
  if (n.checked !== undefined) out.checked = n.checked;
  if (n.kind !== undefined) out.kind = n.kind;
  if (n.hint !== undefined) out.hint = n.hint;
  if (n.setting !== undefined) out.setting = n.setting;
  if (n.choices !== undefined) out.choices = n.choices;
  if (n.cycle) out.cycle = true;
  if (n.status !== undefined) out.status = n.status;
  if (n.buttons) out.buttons = n.buttons;
  if (n.detail !== undefined) out.detail = n.detail;
  if (n.deadline !== undefined) out.deadline = n.deadline;
  if (n.paused !== undefined) out.paused = n.paused;
  if (n.tag !== undefined) out.tag = n.tag;
  if (n.chip !== undefined) out.chip = n.chip;
  if (n.expand !== undefined) out.expand = n.expand;
  if (n.items) out.items = n.items.map(strip);
  return out;
}

/* ---------------- merge ---------------- */

/**
 * Merge the asset's menus with every contribution (applied in `order`, then the order they were added).
 * Same id among siblings: a later contribution replaces the earlier one in place; when the two come from
 * different modules that is a conflict (an asset item replaced by a module is deliberate, not a conflict).
 */
export function mergeAppMenu(asset: Pick<AppMenuData, 'menus'>, contributions: readonly AppMenuContribution[]): MergedAppMenu {
  const conflicts: AppMenuConflict[] = [];
  const notes: string[] = [];
  const menus: MenuNode[] = asset.menus.map((m, i) => ({ id: m.id, label: m.label, origin: ASSET_ORIGIN, order: ord(m.order), seq: i, items: (m.items ?? []).map((it, j) => toNode(it, ASSET_ORIGIN, j)) }));
  let seq = menus.length;
  const ordered = contributions.map((c, i) => ({ c, i })).sort((a, b) => ord(a.c.order) - ord(b.c.order) || a.i - b.i).map((x) => x.c);
  for (const c of ordered) {
    const menuId = c.menu || DEFAULT_MENU;
    let menu = menus.find((m) => m.id === menuId);
    if (!menu) {
      menu = { id: menuId, label: c.menuLabel ?? titleFromId(menuId), origin: c.module, order: ord(c.menuOrder), seq: seq++, items: [] };
      menus.push(menu);
    }
    let parent: Node[] = menu.items;
    let where = menuId;
    for (const stepRaw of c.path ?? []) {
      const step: MenuPathStep = typeof stepRaw === 'string' ? { id: stepRaw } : stepRaw;
      let node = parent.find((n) => n.id === step.id);
      if (!node) {
        node = { id: step.id, label: step.label ?? titleFromId(step.id), ...(step.icon ? { icon: step.icon } : {}), origin: c.module, order: MENU_DEFAULT_ORDER, seq: parent.length, items: [] };
        parent.push(node);
        notes.push(`${c.id}: created submenu ${where}/${step.id}`);
      } else if (node.provider) {
        notes.push(`${c.id}: ${where}/${step.id} is a live list; items placed beside it`);
        break;
      }
      if (!node.items) node.items = [];
      parent = node.items;
      where = `${where}/${step.id}`;
    }
    for (const it of c.items) {
      const node = toNode(it, c.module, parent.length, { order: c.order, before: c.before, after: c.after });
      const at = parent.findIndex((n) => n.id === it.id);
      if (at < 0) { parent.push(node); continue; }
      const was = parent[at]!;
      if (was.origin !== ASSET_ORIGIN && was.origin !== c.module) conflicts.push({ what: 'app-menu item', id: `${where}/${it.id}`, was: was.origin, now: c.module });
      parent[at] = { ...node, seq: was.seq };
    }
  }
  const placed = [...menus].sort((a, b) => a.order - b.order || a.seq - b.seq);
  return {
    menus: placed.map((m) => ({ id: m.id, label: m.label, origin: m.origin, items: placeSiblings(m.items).map(strip) })),
    conflicts,
    notes,
  };
}

/* ---------------- checked bindings ---------------- */

/** `setting:x` → {kind, ref}; null when the kind isn't one of CHECKED_KINDS or the ref is empty. */
export function parseChecked(binding: string | undefined): { kind: string; ref: string } | null {
  if (typeof binding !== 'string') return null;
  const i = binding.indexOf(':');
  if (i <= 0) return null;
  const kind = binding.slice(0, i);
  const ref = binding.slice(i + 1);
  return CHECKED_KINDS.includes(kind) && ref ? { kind, ref } : null;
}

/** How a settings value reads as a check: booleans as they are, numbers ≠ 0, strings unless empty / false / 0 / off / no. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return !['', 'false', '0', 'off', 'no'].includes(v.trim().toLowerCase());
  return true;
}

/** The check state of a binding (null = no check mark). */
export function resolveChecked(binding: string | undefined, env: Pick<AppMenuEnv, 'counter' | 'setting' | 'hidden'>): boolean | null {
  const p = parseChecked(binding);
  if (!p) return null;
  switch (p.kind) {
    case 'setting': return truthy(env.setting(p.ref));
    case 'counter': return env.counter(p.ref) > 0;
    case 'slot': return !env.hidden(p.ref);
    case 'hidden': return env.hidden(p.ref);
    default: return null;
  }
}

/* ---------------- compile ---------------- */

/** Drop leading, trailing and doubled separators. */
export function cleanSeparators<T extends { separator?: boolean }>(items: T[]): T[] {
  return items.filter((i, idx, arr) => !(i.separator && (idx === 0 || idx === arr.length - 1 || arr[idx - 1]?.separator)));
}

/** The state of a status source for the kinds the engine resolves itself; `source:` asks the environment. */
export function resolveStatus(source: string, env: Pick<AppMenuEnv, 'counter' | 'setting' | 'hidden' | 'status'>): MenuStatusReading | null {
  const p = parseStatusSource(source);
  if (!p) return null;
  switch (p.kind) {
    case 'counter': { const n = env.counter(p.ref); return n > 0 ? { state: 'on', text: `${n}` } : { state: 'off' }; }
    case 'setting': return { state: truthy(env.setting(p.ref)) ? 'on' : 'off' };
    case 'slot': return { state: env.hidden(p.ref) ? 'off' : 'on', text: env.hidden(p.ref) ? 'Hidden' : 'Shown' };
    case 'hidden': return { state: env.hidden(p.ref) ? 'on' : 'off', text: env.hidden(p.ref) ? 'Hidden' : 'Shown' };
    case 'source': return env.status?.(p.ref) ?? null;
    default: return null;
  }
}

/** The label a choice setting shows beside its entry. */
const SWITCH_LABELS = { on: 'On', off: 'Off' };

/**
 * One item with its token overrides applied: behaviour tokens change the item (a copy), `visible: false` drops it
 * (null), appearance tokens come back as `look`.
 */
function overrideItem(it: MergedMenuItem, o: Record<string, MenuTokenValue> | undefined): { item: MergedMenuItem; look?: CompiledMenuLook } | null {
  if (!o) return { item: it };
  if (o.visible === false) return null;
  const item: MergedMenuItem = { ...it };
  if (typeof o.label === 'string') item.label = o.label;
  if (typeof o.icon === 'string') item.icon = o.icon;
  if (typeof o.hint === 'string') item.hint = o.hint;
  if (typeof o.action === 'string' && !item.provider && !item.setting) item.action = o.action;
  if (typeof o.shortcut === 'string') item.shortcut = o.shortcut;
  const look: CompiledMenuLook = {};
  for (const t of MENU_ITEM_APPEARANCE_TOKENS) if (typeof o[t] === 'string') (look as Record<string, string>)[t] = o[t] as string;
  return Object.keys(look).length ? { item, look } : { item };
}

/** Siblings re-placed by their `order` overrides: overridden ones sort by that order, the rest keep their place as a block at 100. */
function reorderByOverrides(items: readonly MergedMenuItem[], paths: readonly string[], ov: MenuOverrides): MergedMenuItem[] {
  if (!items.some((_, i) => typeof ov[paths[i]!]?.order === 'number')) return [...items];
  return items.map((it, i) => ({ it, i, key: typeof ov[paths[i]!]?.order === 'number' ? (ov[paths[i]!]!.order as number) : MENU_DEFAULT_ORDER }))
    .sort((a, b) => a.key - b.key || a.i - b.i).map((x) => x.it);
}

function compileList(items: readonly MergedMenuItem[], env: AppMenuEnv, depth: number, where: string, notes: string[], ov: MenuOverrides = normalizeMenuOverrides(env.overrides)): CompiledMenuItem[] {
  const max = env.maxDepth ?? MENU_MAX_DEPTH;
  const root = env.pathRoot ?? 'app-menu';
  const out: CompiledMenuItem[] = [];
  const pathOf = (id: string) => menuItemPath(root, [...where.split('/'), id]);
  for (const raw of reorderByOverrides(items, items.map((i) => pathOf(i.id)), ov)) {
    const path = pathOf(raw.id);
    if (raw.separator) { if (ov[path]?.visible === false) continue; out.push({ id: raw.id, label: '', kind: 'separator', path, separator: true, locked: false, origin: raw.origin }); continue; }
    const over = overrideItem(raw, ov[path]);
    if (!over) continue;
    const it = over.item;
    const gate = env.gate(it.requires);
    if (gate === 'hide') continue;
    if (env.taken && (it.action !== undefined || it.provider !== undefined) && env.taken({ action: it.action, provider: it.provider })) continue;
    const hostLock = !!env.locked && (it.action !== undefined || it.provider !== undefined) && env.locked({ action: it.action, provider: it.provider });
    const c: CompiledMenuItem = { id: it.id, label: it.label ?? titleFromId(it.id), kind: menuItemKind(it), path, locked: gate === 'disable' || hostLock, origin: it.origin };
    if (it.hint !== undefined) c.hint = it.hint;
    if (over.look) c.look = over.look;
    if (it.icon !== undefined) c.icon = it.icon;
    if (it.action !== undefined) c.action = it.action;
    if (it.shortcut !== undefined) c.shortcut = it.shortcut;
    if (it.requires !== undefined) c.requires = it.requires;
    if (it.badge !== undefined) { c.badge = it.badge; const n = Math.max(0, Math.floor(env.counter(it.badge)) || 0); if (n > 0) c.count = n; }
    if (it.checked !== undefined && c.kind !== 'choice') { c.checked = it.checked; const on = resolveChecked(it.checked, env); if (on !== null) c.check = on; }
    if (it.status !== undefined) {
      const src = typeof it.status === 'string' ? it.status : it.status.source;
      const reading = resolveStatus(src, env);
      if (!reading && parseStatusSource(src)?.kind === 'source') notes.push(`${where}/${it.id}: status source "${parseStatusSource(src)!.ref}" is not registered`);
      const st = compileStatus(it.status, reading, c.label);
      if (st) c.status = st;
    }
    if (c.kind === 'choice' && it.setting) {
      // a choice setting: the current value beside the label; a pick (or the switch's click) applies at once
      c.setting = it.setting;
      const cur = env.setting(it.setting);
      c.value = cur === undefined || cur === null || !(typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') ? null : cur;
      if (it.choices?.length) {
        const now = currentChoice(it.choices, cur);
        c.choices = it.choices.map((ch) => ({ ...ch, on: !!now?.picked && now.choice === ch, action: choiceAction(it.setting!, ch.value) }));
        c.valueLabel = now?.picked ? now.choice.label : '';
        if (it.cycle) { c.cycle = true; const nx = nextChoice(it.choices, cur); if (nx) c.action = choiceAction(it.setting, nx.value); }
      } else {
        const on = truthy(cur);
        c.check = on;
        c.valueLabel = on ? SWITCH_LABELS.on : SWITCH_LABELS.off;
        c.action = switchAction(it.setting);
      }
    }
    if (it.buttons) {
      const bs: CompiledMenuButton[] = [];
      for (const b of it.buttons) { const g = env.gate(b.requires); if (g !== 'hide' && b.id && b.label) bs.push({ ...b, locked: g === 'disable' || c.locked }); }
      if (bs.length) c.buttons = bs;
    }
    if (it.detail !== undefined) c.detail = it.detail;
    if (it.deadline !== undefined) c.deadline = it.deadline;
    if (it.paused !== undefined) c.paused = it.paused;
    if (it.tag !== undefined) c.tag = it.tag;
    if (it.chip !== undefined) c.chip = it.chip;
    if (it.expand !== undefined) c.expand = it.expand;
    if (it.provider !== undefined) {
      if (!env.providers.includes(it.provider)) { notes.push(`${where}/${it.id}: live list "${it.provider}" is not registered`); continue; }
      if (depth >= max) { notes.push(`${where}/${it.id}: live list cut at depth ${max}`); continue; }
      c.provider = it.provider;
      c.items = [];
      out.push(c);
      continue;
    }
    if (it.items) {
      if (depth >= max) { notes.push(`${where}/${it.id}: submenu cut at depth ${max}`); if (!it.action) continue; }
      else {
        const sub = compileList(it.items, env, depth + 1, `${where}/${it.id}`, notes, ov);
        if (!sub.length && !it.action) continue;
        if (sub.length) c.items = sub;
      }
    }
    out.push(c);
  }
  return cleanSeparators(out);
}

/** Gate, resolve and prune a merged tree for display. */
export function compileAppMenu(merged: MergedAppMenu, env: AppMenuEnv): CompiledAppMenu {
  const notes = [...merged.notes];
  const menus: CompiledMenu[] = [];
  for (const m of merged.menus) {
    const items = compileList(m.items, env, 1, m.id, notes);
    if (!items.length) continue;
    menus.push({ id: m.id, label: m.label, origin: m.origin, items });
  }
  return { menus, conflicts: [...merged.conflicts], notes };
}

/** Asset + contributions → compiled tree in one go. */
export function buildAppMenu(asset: Pick<AppMenuData, 'menus'>, contributions: readonly AppMenuContribution[], env: AppMenuEnv): CompiledAppMenu {
  return compileAppMenu(mergeAppMenu(asset, contributions), env);
}

/**
 * One flat list of items (a context-menu target, a plugin's ⋯ menu) compiled like the application menu: kinds, paths
 * (`<env.pathRoot>/<where>/<id>`), gating, badges, checks, choice settings, status slots and overrides. `where` is
 * the list's name (a context target such as `default`); `origin` the module the items come from.
 */
export function compileMenuItems(items: readonly MenuItem[], env: AppMenuEnv, where: string, origin: string = ASSET_ORIGIN): { items: CompiledMenuItem[]; notes: string[] } {
  const notes: string[] = [];
  const merged = placeSiblings(items.map((it, i) => toNode(it, origin, i))).map(strip);
  return { items: compileList(merged, env, 1, where, notes), notes };
}

/* ---------------- live lists (providers) ---------------- */

export interface ProviderOptions {
  /** the provider item's id (the More… entry is `<id>.more`) */
  id: string;
  /** cap before More… (default PROVIDER_MAX) */
  max?: number;
  /** action the More… entry runs (e.g. `nav:pending`); without one the overflow is only counted */
  moreAction?: string;
  moreLabel?: string;
  /** depth of the provider item (its entries are one deeper) */
  depth?: number;
  /** the provider item's path inside its menu (`file/recent`); its entries' paths hang under it (default: the id) */
  where?: string;
}

/**
 * What a live list shows: the provider's items compiled like any others (gating, badges, checks, nested submenus),
 * capped at `max` with a More… entry when there are more (runs `moreAction`; locked when there is none).
 */
export function compileProviderItems(items: readonly MenuItem[], env: AppMenuEnv, opts: ProviderOptions): CompiledMenuItem[] {
  const max = Math.max(1, Math.floor(opts.max ?? PROVIDER_MAX));
  const merged = items.map((it, i) => strip(toNode(it, `provider:${opts.id}`, i)));
  const where = opts.where ?? opts.id;
  const all = compileList(merged, env, (opts.depth ?? 1) + 1, where, []);
  if (all.length <= max) return all;
  const kept = cleanSeparators(all.slice(0, max));
  const rest = all.filter((i) => !i.separator).length - kept.filter((i) => !i.separator).length;
  const more: CompiledMenuItem = {
    id: `${opts.id}.more`, label: opts.moreLabel ?? (opts.moreAction ? 'More…' : `${rest} more…`), icon: 'more', kind: 'action',
    path: menuItemPath(env.pathRoot ?? 'app-menu', [...where.split('/'), `${opts.id}.more`]), hint: opts.moreAction ? 'Show the whole list' : `${rest} more entries are not shown`,
    locked: !opts.moreAction, origin: `provider:${opts.id}`,
    ...(opts.moreAction ? { action: opts.moreAction } : {}),
  };
  return [...kept, more];
}

/* ---------------- chrome visibility toggles ---------------- */

/** Hideable chrome types, in spec order (app-menu left out by default: a menu can't bring itself back). */
export function chromeToggleTypes(all = false): string[] {
  return Object.keys(TYPE_LABELS).filter((t) => TYPE_LABELS[t]?.hideable === true && (all || t !== 'app-menu'));
}

/**
 * Standard "show / hide chrome" items: one per type, checked while the slot is shown, running `slot.hide:<type>:toggle`.
 * Any app or plugin can drop them into a View menu; the built-in `chrome` provider lists them too.
 */
export function chromeToggleItems(types: readonly string[] = chromeToggleTypes(), labels: Record<string, string> = {}): MenuItem[] {
  return types.filter((t) => TYPE_LABELS[t]?.hideable === true).map((t) => ({
    id: `chrome.${t}`, label: labels[t] ?? TYPE_LABELS[t]!.label, icon: TYPE_LABELS[t]!.icon ?? 'layout',
    action: `slot.hide:${t}:toggle`, checked: `slot:${t}`, requires: 'assets.swap',
  }));
}

/* ---------------- search ---------------- */

export interface MenuSearchEntry {
  id: string; kind: 'menu'; label: string; detail: string; icon?: string; keywords: string[]; requires?: string;
  focus: { kind: 'action'; spec: string };
}

/**
 * Contributed items with an action, as search entries (the search engine lists them under kind `menu`). Asset items
 * are left out (their argument-free actions are already indexed as actions), as are specs in `skip` (actions the
 * action provider already lists), separators and live lists.
 */
export function appMenuSearchEntries(compiled: Pick<CompiledAppMenu, 'menus'>, skip: ReadonlySet<string> = new Set()): MenuSearchEntry[] {
  const out: MenuSearchEntry[] = [];
  const walk = (items: readonly CompiledMenuItem[], trail: string[], ids: string[]) => {
    for (const it of items) {
      if (it.separator) continue;
      const path = [...ids, it.id];
      if (it.action && it.origin !== ASSET_ORIGIN && !skip.has(it.action)) {
        const e: MenuSearchEntry = { id: `menu:${path.join('/')}`, kind: 'menu', label: it.label, detail: `Menu › ${trail.join(' › ')}`, keywords: [it.id, it.action], focus: { kind: 'action', spec: it.action } };
        if (it.icon) e.icon = it.icon;
        if (it.requires) e.requires = it.requires;
        out.push(e);
      }
      if (it.items?.length) walk(it.items, [...trail, it.label], path);
    }
  };
  for (const m of compiled.menus) walk(m.items, [m.label], [m.id]);
  return out;
}

/* ---------------- validation (shared by the three validators) ---------------- */

/**
 * Checks the optional item fields wherever menu items appear (`data.menus[i].items`, `data.targets.<t>`, nested
 * `items`). Same messages in build-engine.mjs (the Kotlin validator stays spec-driven and accepts the fields untouched).
 */
export function validateMenuItems(items: unknown, path: string, depth = 0): string[] {
  if (!Array.isArray(items)) return [`${path} must be a list of menu items`];
  const errors: string[] = [];
  items.forEach((it, i) => {
    const p = `${path}[${i}]`;
    if (typeof it !== 'object' || it === null || Array.isArray(it)) { errors.push(`${p} must be a menu item object`); return; }
    const o = it as Record<string, unknown>;
    for (const k of ['provider', 'badge', 'before', 'after']) if (k in o && (typeof o[k] !== 'string' || !(o[k] as string))) errors.push(`${p}.${k} must be a non-empty string`);
    if ('checked' in o && (typeof o.checked !== 'string' || !parseChecked(o.checked))) errors.push(`${p}.checked must be one of: ${CHECKED_KINDS.map((k) => `${k}:<ref>`).join(', ')}`);
    if ('order' in o && (typeof o.order !== 'number' || !Number.isFinite(o.order))) errors.push(`${p}.order must be a number`);
    if ('provider' in o && 'items' in o) errors.push(`${p} has both provider and items (a live list fills its own)`);
    errors.push(...menuItemV2Errors(o, p));
    if ('items' in o) {
      if (depth + 1 >= MENU_MAX_DEPTH) errors.push(`${p}.items is deeper than ${MENU_MAX_DEPTH} levels`);
      else errors.push(...validateMenuItems(o.items, `${p}.items`, depth + 1));
    }
  });
  return errors;
}
