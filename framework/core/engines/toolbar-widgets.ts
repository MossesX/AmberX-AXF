/**
 * Toolbar widgets engine (toolbar-widgets@1; build attach-widgets-to-any-toolbar-banner, Nov 16 2026. Brett, Nov 13:
 * "I can attach widgets to the toolbar right, just like the banner widgets").
 *
 * Every toolbar on screen is an instance of the `toolbar` widget host (engines/widgets.ts): the app's own (`app`), a page
 * toolbar (its asset id), a workspace toolbar (`axf-ws-toolbar:<ws>`), … The instance id is the toolbar's chrome-settings
 * id (`toolbarIdOf` in engines/tapconfirm.ts), so its widgets, its tap-to-confirm choice and its chrome settings are one
 * family of keys (`axf.toolbar.<id>.*`). What sits on one toolbar is layered, lowest first:
 *
 *   1. the toolbar asset's own `widgets[]` (hostEntry: type, id, at, order, `widget` = banner widget style, `shape`);
 *   2. what modules attached at run time for that instance (rt.attachToToolbar; origin = the plugin);
 *   3. the legacy app-toolbar arrangement `axf.widgets.arrange.toolbar` (side + order; read so nothing moves);
 *   4. the app's default widget style `axf.toolbars.widgetStyle`, then the toolbar's `axf.toolbar.<id>.widgetStyle`;
 *   5. the person's slots `axf.toolbar.<id>.widgets`: widgets they added (a slot with `at`), and their per-widget choices
 *      by the banner's rules (hidden, size, show, maxWidth, priority, hideWhenEmpty, overflow) plus a shape ref.
 *
 * How each widget is drawn is the banner's `bannerWidgetView` (engines/bannerwidgets.ts) over the folded hint, so a
 * widget looks the same on a toolbar as on the banner. `fitToolbar` states the snap-not-overlap order (Brett, Oct 28
 * 2026) the CSS follows: sides size to their content, the flexible piece shrinks to its minimum first, widgets that may
 * leave go into ⋯ by priority, and a bar that is still full scrolls sideways with every item a snap point.
 *
 * Pure functions. Kotlin twin deferred (spec/PORTING.md); fixture spec/fixtures/toolbar-widgets.json, checks in
 * spec/check-widgets.mts. Validation rules shared with the CLI: toolbar-widget-rules.mjs.
 */
import type { HostShape } from '../types';
import { BANNER_WIDGET_SIZES, bannerWidgetCapCss, bannerWidgetView, findBannerWidget, normalizeBannerWidgetPref, overflowWidgets, type BannerWidgetHint, type BannerWidgetPref, type BannerWidgetQueryable, type BannerWidgetShow, type BannerWidgetSize, type BannerWidgetView } from './bannerwidgets';
import { TOOLBAR_APP_INSTANCE, TOOLBAR_PERSON_ORDER, TOOLBAR_WIDGETS_MAX, isShapeId, isToolbarInstanceId } from './toolbar-widget-rules.mjs';
import { toolbarIdOf } from './tapconfirm';
import { TOOLBAR_SIDES, attachmentKey, placeOnHost, type HostArrangement, type HostAttachment, type PlacedAttachment } from './widgets';

export { TOOLBARS_WIDGET_STYLE_KEY, TOOLBAR_APP_INSTANCE, TOOLBAR_PERSON_ORDER, TOOLBAR_WIDGETS_CONTRACT, TOOLBAR_WIDGETS_KEY, TOOLBAR_WIDGETS_MAX, TOOLBAR_WIDGET_STYLE_KEY, HOST_ENTRY_WIDGET, HOST_ENTRY_WIDGET_FIELDS, WIDGET_STYLE_FIELDS, hostEntryErrors, hostShapeErrors, hostWidgetStyleErrors, isShapeId, isToolbarInstanceId, toolbarInstanceOfKey, type HostEntryWidgetSpec } from './toolbar-widget-rules.mjs';

/** A toolbar's instance id from what the element carries (`data-axf-toolbar`, its asset id, its label); `app` for the app's own. */
export const toolbarInstanceId = (attrs: { id?: string | null; asset?: string | null; label?: string | null }): string => toolbarIdOf(attrs);

const TYPE = /^[a-z0-9-]{1,40}$/;
const ID = /^[A-Za-z0-9._-]{1,80}$/;

/**
 * One slot of a person's list for a toolbar (`axf.toolbar.<id>.widgets`): the widget, where they put it (`at` + `order`
 * only when they added or moved it) and their choices for it. A slot with nothing in it is dropped.
 */
export interface ToolbarWidgetSlot extends BannerWidgetPref {
  type: string;
  id: string;
  at?: string;
  order?: number;
  /** shape@1 asset id for this one widget */
  shape?: string;
}

/** A person's default style for every widget on a toolbar (or on every toolbar in the app). */
export interface WidgetStyle {
  size?: BannerWidgetSize;
  show?: BannerWidgetShow;
  priority?: number;
  hideWhenEmpty?: boolean;
  overflow?: boolean;
  shape?: string;
}

export const slotKey = (s: Pick<ToolbarWidgetSlot, 'type' | 'id'>): string => attachmentKey(s.type, s.id);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One slot with only valid fields, or null when it names nothing or nothing is left in it. */
export function normalizeToolbarWidgetSlot(raw: unknown, sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot | null {
  if (!isObj(raw) || typeof raw.type !== 'string' || !TYPE.test(raw.type) || typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  const out: ToolbarWidgetSlot = { type: raw.type, id: raw.id, ...normalizeBannerWidgetPref(raw) };
  if (typeof raw.at === 'string' && sides.includes(raw.at)) {
    out.at = raw.at;
    if (num(raw.order)) out.order = raw.order;
  }
  if (isShapeId(raw.shape)) out.shape = raw.shape;
  return Object.keys(out).length > 2 ? out : null;
}

/** The saved list with only valid slots, one per widget, at most TOOLBAR_WIDGETS_MAX. Anything else is dropped. */
export function normalizeToolbarWidgetSlots(raw: unknown, sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot[] {
  const list = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!Array.isArray(list)) return [];
  const out: ToolbarWidgetSlot[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (out.length >= TOOLBAR_WIDGETS_MAX) break;
    const s = normalizeToolbarWidgetSlot(r, sides);
    if (!s || seen.has(slotKey(s))) continue;
    seen.add(slotKey(s));
    out.push(s);
  }
  return out;
}

/** A saved default style with only valid fields. */
export function normalizeWidgetStyle(raw: unknown): WidgetStyle {
  const list = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!isObj(list)) return {};
  const p = normalizeBannerWidgetPref(list);
  const out: WidgetStyle = {};
  if (p.size) out.size = p.size;
  if (p.show) out.show = p.show;
  if (num(p.priority)) out.priority = p.priority;
  if (typeof p.hideWhenEmpty === 'boolean') out.hideWhenEmpty = p.hideWhenEmpty;
  if (typeof p.overflow === 'boolean') out.overflow = p.overflow;
  if (isShapeId(list.shape)) out.shape = list.shape;
  return out;
}

/** The toolbar's style over the app's: a field the toolbar sets wins. */
export const mergeWidgetStyle = (app: WidgetStyle | null | undefined, toolbar: WidgetStyle | null | undefined): WidgetStyle => ({ ...(app ?? {}), ...(toolbar ?? {}) });

/** Is there anything saved? (an empty list is cleared, not stored) */
export const toolbarSlotsEmpty = (slots: readonly ToolbarWidgetSlot[]): boolean => slots.length === 0;

/* ---------------- resolving what one toolbar instance draws ---------------- */

/** A host entry as the toolbar asset or a module gives it: the attachment plus its banner widget style and shape ref. */
export interface ToolbarHostEntry extends HostAttachment { shape?: string }

export interface ToolbarWidgetsInput {
  /** the toolbar asset's data; null = no toolbar (or hidden): nothing is drawn, run-time entries included */
  toolbar: { widgets?: ToolbarHostEntry[]; shape?: HostShape } | null | undefined;
  /** what modules attached to this instance at run time */
  extra?: readonly ToolbarHostEntry[];
  /** the person's slots for this instance (`axf.toolbar.<id>.widgets`, normalized) */
  slots?: readonly ToolbarWidgetSlot[];
  /** the merged default style (`axf.toolbars.widgetStyle` under `axf.toolbar.<id>.widgetStyle`) */
  style?: WidgetStyle | null;
  /** the legacy arrangement (`axf.widgets.arrange.toolbar`; the app toolbar only) */
  arrange?: HostArrangement | null;
  /** does the asset exist? */
  has: (type: string, id: string) => boolean;
  sides?: readonly string[];
}

export interface ResolvedToolbarWidget extends PlacedAttachment {
  /** how it is drawn: the banner's rules over the folded hint and the person's choices */
  view: BannerWidgetView;
  /** the hint it was attached with (name, icon, aliases for the picker and voice) */
  hint: BannerWidgetHint | null;
  /** the shape@1 id it is cut to, or null for the engine default */
  shape: string | null;
  /** attributes / custom properties the UI puts on the item (tokens only) */
  attrs: Record<string, string>;
  /** who decided the shape: slot | entry | style | host | none */
  shapeFrom: 'slot' | 'entry' | 'style' | 'host' | 'none';
}

export interface ResolvedToolbarWidgets {
  /** drawn widgets per side, in bar order (hidden ones left out) */
  sides: Record<string, ResolvedToolbarWidget[]>;
  /** hidden widgets (the person unticked them, or the hint hides them until ticked), in bar order */
  hidden: ResolvedToolbarWidget[];
}

/** Which of the host's two shape defaults a widget takes: `icon` when it draws without text, else `chip`. */
export const hostShapeSlot = (view: Pick<BannerWidgetView, 'size' | 'show'>): keyof HostShape => (view.size === 'icon' || view.show === 'icon' ? 'icon' : 'chip');

/** The attributes the UI puts on one widget item (data-fx-wsize / data-fx-wshow / --fx-widget-cap / data-fx-shape). */
export function toolbarWidgetAttrs(view: BannerWidgetView, shape: string | null): Record<string, string> {
  const out: Record<string, string> = { 'data-fx-wsize': view.size, 'data-fx-wshow': view.show };
  const cap = bannerWidgetCapCss(view.cap);
  if (cap) out['--fx-widget-cap'] = cap;
  if (shape) out['data-fx-shape'] = shape;
  return out;
}

/**
 * Everything one toolbar instance draws, side by side, and what is hidden. The person's slots are the top layer: a slot
 * with `at` adds a widget (or moves one that is already there); every slot's choices patch the widget's style. A widget
 * is only placed when the host takes its type, the side is known and the asset exists (widgets.ts rules).
 */
export function resolveToolbarWidgets(input: ToolbarWidgetsInput, types: readonly string[]): ResolvedToolbarWidgets {
  const sides = input.sides ?? TOOLBAR_SIDES;
  const empty: ResolvedToolbarWidgets = { sides: Object.fromEntries(sides.map((s) => [s, []])), hidden: [] };
  if (!input.toolbar) return empty;
  const own = Array.isArray(input.toolbar.widgets) ? input.toolbar.widgets : [];
  const extra = input.extra ?? [];
  const slots = input.slots ?? [];
  const style = input.style ?? {};
  const known = new Set([...own, ...extra].map((a) => attachmentKey(a.type, a.id)));
  // slots that add a widget nobody else attached
  const added: HostAttachment[] = [];
  const arrange: HostArrangement = { ...(input.arrange ?? {}) };
  slots.forEach((s, i) => {
    if (!s.at || !sides.includes(s.at)) return;
    const key = slotKey(s);
    const order = num(s.order) ? s.order : TOOLBAR_PERSON_ORDER + i * 10;
    if (known.has(key)) arrange[key] = { at: s.at, order };
    else added.push({ type: s.type, id: s.id, at: s.at, order, origin: 'person' });
  });
  const placed = placeOnHost(own, [...extra, ...added], input.has, types, sides, arrange);
  const entryOf = (key: string): ToolbarHostEntry | undefined => [...extra].reverse().find((a) => attachmentKey(a.type, a.id) === key) ?? own.find((a) => attachmentKey(a.type, a.id) === key);
  const bySlot = new Map(slots.map((s) => [slotKey(s), s]));
  const out: ResolvedToolbarWidgets = { sides: Object.fromEntries(sides.map((s) => [s, []])), hidden: [] };
  for (const side of sides) {
    for (const p of placed[side] ?? []) {
      const entry = entryOf(p.key);
      const hint = entry?.widget ?? null;
      const slot = bySlot.get(p.key);
      // hard default < the entry's hint < the app's / toolbar's default style < the person's choices for this widget
      const folded: BannerWidgetHint = { ...(hint ?? {}), ...pickStyle(style) };
      const pref: BannerWidgetPref | null = slot ? stripSlot(slot) : null;
      const view = bannerWidgetView(p.type, folded, pref);
      const hostShape = input.toolbar.shape?.[hostShapeSlot(view)];
      const [shape, shapeFrom]: [string | null, ResolvedToolbarWidget['shapeFrom']] = slot?.shape ? [slot.shape, 'slot'] : entry?.shape ? [entry.shape, 'entry'] : style.shape ? [style.shape, 'style'] : hostShape ? [hostShape, 'host'] : [null, 'none'];
      const r: ResolvedToolbarWidget = { ...p, view, hint, shape, shapeFrom, attrs: toolbarWidgetAttrs(view, shape) };
      (view.hidden ? out.hidden : out.sides[side]!).push(r);
    }
  }
  return out;
}

const pickStyle = (s: WidgetStyle): BannerWidgetHint => {
  const out: BannerWidgetHint = {};
  if (s.size) out.size = s.size;
  if (s.show) out.show = s.show;
  if (num(s.priority)) out.priority = s.priority;
  if (typeof s.hideWhenEmpty === 'boolean') out.hideWhenEmpty = s.hideWhenEmpty;
  if (typeof s.overflow === 'boolean') out.overflow = s.overflow;
  return out;
};
const stripSlot = (s: ToolbarWidgetSlot): BannerWidgetPref => {
  const { type: _t, id: _i, at: _a, order: _o, shape: _s, ...pref } = s;
  return pref;
};

/* ---------------- snap, never overlap: the sizing order (Brett, Oct 28 2026) ---------------- */

export interface ToolbarFitItem {
  key: string;
  /** the width it takes on the bar at its size, px */
  width: number;
  priority: number;
  /** may it leave the bar for ⋯? */
  overflow: boolean;
}
export interface ToolbarFitPlan {
  /** widgets per side, in bar order */
  sides: Record<string, readonly ToolbarFitItem[]>;
  /** the flexible piece between the sides (the toolbar's buttons and search), its natural width and its minimum; null when there is none */
  flex: { width: number; min: number } | null;
  /** the gap between items and between pieces, px */
  gap: number;
  /** the ⋯ button's width, px (added to the last side when something leaves) */
  moreWidth: number;
  /** the host's padding at each end, px */
  padding?: number;
  /** false for a toolbar with no ⋯ menu: too wide goes straight to scrolling */
  overflowMenu?: boolean;
}
export interface ToolbarFitResult {
  /** each side's width, px (its content; the ⋯ button counted once it is there) */
  sides: Record<string, number>;
  /** the flexible piece's width after shrinking, px */
  flex: number;
  /** widgets that left for ⋯, lowest priority first */
  overflow: string[];
  /** the bar is still wider than its room: it scrolls sideways, every piece a snap point */
  scroll: boolean;
  /** snap points: the start of every piece and item still on the bar, px from the bar's start (only when scrolling) */
  snap: number[];
  /** the bar's content width after everything, px */
  width: number;
}

const sum = (items: readonly ToolbarFitItem[], gap: number) => items.reduce((s, i) => s + i.width, 0) + gap * Math.max(0, items.length - 1);

/**
 * The order things give way in when a toolbar is too narrow: (1) a side is never narrower than what is on it; (2) the
 * flexible piece shrinks first, down to its minimum; (3) widgets that may leave go into ⋯, lowest priority first (last on
 * the bar first within a priority), until the rest plus the ⋯ button fit; (4) still too wide: the bar scrolls sideways and
 * every piece and item is a snap point. Nothing is ever clipped or drawn over a neighbour. Same arithmetic on every port.
 */
export function fitToolbar(plan: ToolbarFitPlan, available: number): ToolbarFitResult {
  const sides = Object.keys(plan.sides);
  const gap = Math.max(0, plan.gap);
  const pad = Math.max(0, plan.padding ?? 0) * 2;
  let items: Record<string, ToolbarFitItem[]> = Object.fromEntries(sides.map((s) => [s, [...(plan.sides[s] ?? [])]]));
  const overflow: string[] = [];
  const flexFull = plan.flex ? Math.max(0, plan.flex.width) : 0;
  const flexMin = plan.flex ? Math.max(0, Math.min(plan.flex.min, plan.flex.width)) : 0;
  const pieces = () => sides.filter((s) => items[s]!.length > 0).length + (plan.flex ? 1 : 0) + (overflow.length ? 1 : 0);
  const width = (flex: number) => sides.reduce((w, s) => w + sum(items[s]!, gap), 0) + flex + (overflow.length ? plan.moreWidth : 0) + gap * Math.max(0, pieces() - 1) + pad;
  let flex = flexFull;
  // (2) the flexible piece gives way first
  if (width(flex) > available) flex = Math.max(flexMin, flexFull - (width(flex) - available));
  // (3) widgets leave for ⋯ by priority
  if (width(flex) > available && plan.overflowMenu !== false) {
    const all = sides.flatMap((s) => items[s]!);
    const fixed = width(flex) - sum(all, gap) - (all.length ? gap : 0);
    const leaving = overflowWidgets(all, Math.max(0, available - fixed), plan.moreWidth, gap);
    if (leaving.length) {
      overflow.push(...leaving);
      items = Object.fromEntries(sides.map((s) => [s, items[s]!.filter((i) => !leaving.includes(i.key))]));
    }
  }
  // (4) still too wide: scroll with snap
  const total = width(flex);
  const scroll = total > available;
  const snap: number[] = [];
  if (scroll) {
    // the flexible piece sits after the first side; every item on the bar and the ⋯ button are snap points too
    let x = pad / 2;
    sides.forEach((s, si) => {
      if (plan.flex && si === 1) { snap.push(x); x += flex + gap; }
      for (const i of items[s]!) { snap.push(x); x += i.width + gap; }
    });
    if (plan.flex && sides.length < 2) { snap.push(x); x += flex + gap; }
    if (overflow.length) snap.push(x);
  }
  const widths: Record<string, number> = Object.fromEntries(sides.map((s) => [s, sum(items[s]!, gap)]));
  if (overflow.length) { const last = sides[sides.length - 1]!; widths[last] = widths[last]! + (items[last]!.length ? gap : 0) + plan.moreWidth; }
  return { sides: widths, flex, overflow, scroll, snap, width: total };
}

/* ---------------- the person's slots: edits the picker, the actions and voice make ---------------- */

/** The list with a widget added at a side, after everything already there. The same widget again moves it there and shows it. */
export function addToolbarWidget(slots: readonly ToolbarWidgetSlot[], type: string, id: string, at: string, types: readonly string[], sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot[] {
  if (!TYPE.test(type) || !types.includes(type) || !ID.test(id) || !sides.includes(at)) return [...slots];
  const key = attachmentKey(type, id);
  const rest = slots.filter((s) => slotKey(s) !== key);
  if (rest.length >= TOOLBAR_WIDGETS_MAX) return [...slots];
  const prev = slots.find((s) => slotKey(s) === key);
  const order = TOOLBAR_PERSON_ORDER + rest.filter((s) => s.at).length * 10;
  const { hidden: _h, ...keep } = prev ?? { type, id };
  return [...rest, { ...keep, type, id, at, order }];
}

/** The list without a widget (its choices go too). A widget the toolbar or a plugin put there stays on the bar: hide it instead. */
export const removeToolbarWidget = (slots: readonly ToolbarWidgetSlot[], key: string): ToolbarWidgetSlot[] => slots.filter((s) => slotKey(s) !== key);

/**
 * The list with one widget's choices patched (the banner's rules: a field set to null goes back to the default; `shape`
 * null = back to the toolbar's). A widget with no slot yet gets one; a slot with nothing left goes.
 */
export function patchToolbarWidget(slots: readonly ToolbarWidgetSlot[], key: string, patch: Record<string, unknown>, sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot[] {
  const i = key.indexOf(':');
  if (i <= 0) return [...slots];
  const type = key.slice(0, i), id = key.slice(i + 1);
  const prev = slots.find((s) => slotKey(s) === key) ?? { type, id };
  const merged: Record<string, unknown> = { ...prev, ...patch, type, id };
  for (const [k, v] of Object.entries(merged)) if (v === null || v === undefined) delete merged[k];
  const next = normalizeToolbarWidgetSlot(merged, sides);
  const rest = slots.filter((s) => slotKey(s) !== key);
  if (!next) return rest;
  const at = slots.findIndex((s) => slotKey(s) === key);
  if (at < 0) return [...rest, next];
  const out = [...slots];
  out[at] = next;
  return out;
}

/**
 * Move one drawn widget to a side at a position (0 = first; past the end = last) and return the list with every drawn
 * widget's side and order written (index × 10), so the result reads the same on every device whatever attaches later.
 * `drawn` is what the toolbar shows now (`resolveToolbarWidgets(...).sides`).
 */
export function moveToolbarWidget(slots: readonly ToolbarWidgetSlot[], drawn: Record<string, readonly { key: string }[]>, key: string, side: string, index: number, sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot[] {
  if (!sides.includes(side)) return [...slots];
  const lists: Record<string, string[]> = Object.fromEntries(sides.map((s) => [s, (drawn[s] ?? []).map((p) => p.key)]));
  if (!sides.some((s) => lists[s]!.includes(key))) return [...slots];
  for (const s of sides) lists[s] = lists[s]!.filter((k) => k !== key);
  const at = Math.max(0, Math.min(lists[side]!.length, Math.floor(Number.isFinite(index) ? index : lists[side]!.length)));
  lists[side]!.splice(at, 0, key);
  let out = [...slots];
  for (const s of sides) lists[s]!.forEach((k, i) => { out = patchToolbarWidget(out, k, { at: s, order: i * 10 }, sides); });
  return out;
}

/** Everything back to what the toolbar and its modules put there. */
export const resetToolbarWidgets = (): ToolbarWidgetSlot[] => [];

/**
 * Fold a legacy arrangement (`axf.widgets.arrange.toolbar`, the app toolbar) into the slots once: a key the person has
 * not placed themselves takes the arrangement's side and order, so nothing moves when the old key is retired.
 */
export function foldArrangement(slots: readonly ToolbarWidgetSlot[], arrange: HostArrangement | null | undefined, sides: readonly string[] = TOOLBAR_SIDES): ToolbarWidgetSlot[] {
  if (!arrange) return [...slots];
  let out = [...slots];
  for (const [key, a] of Object.entries(arrange)) {
    if (!sides.includes(a.at) || !num(a.order)) continue;
    const have = out.find((s) => slotKey(s) === key);
    if (have?.at) continue;
    out = patchToolbarWidget(out, key, { at: a.at, order: a.order }, sides);
  }
  return out;
}

/* ---------------- the action grammar (console actions, REST, MCP, CLI, voice) ---------------- */

/** Everything a `toolbar.widget` action may do to one widget. */
export const TOOLBAR_WIDGET_OPS = ['add', 'remove', 'hide', 'show', 'reset', ...BANNER_WIDGET_SIZES, 'start', 'end'] as const;
export type ToolbarWidgetOp = typeof TOOLBAR_WIDGET_OPS[number];
export const isToolbarWidgetOp = (v: unknown): v is ToolbarWidgetOp => (TOOLBAR_WIDGET_OPS as readonly unknown[]).includes(v);

/**
 * Split a `toolbar.widget` action's arguments: the last is the op, the first the instance when there are three or more
 * (`settings:cpu:add`), else the app toolbar (`cpu:add`). The rest, joined by `:`, names the widget (a key like
 * `status:cpu` needs the instance spelled out). Null when there is no op or no name.
 */
export function parseToolbarWidgetArgs(args: readonly string[]): { instance: string; name: string; op: ToolbarWidgetOp } | null {
  if (args.length < 2) return null;
  const op = args[args.length - 1]!;
  if (!isToolbarWidgetOp(op)) return null;
  const body = args.slice(0, -1);
  const instance = body.length >= 2 ? body[0]! : TOOLBAR_APP_INSTANCE;
  const name = (body.length >= 2 ? body.slice(1) : body).join(':');
  if (!name || !isToolbarInstanceId(instance)) return null;
  return { instance, name, op };
}

/** `toolbar.widget.shape:<instance>:<name>:<shape id | inherit>` → the instance, the widget and the shape (null = inherit). */
export function parseToolbarWidgetShapeArgs(args: readonly string[]): { instance: string; name: string; shape: string | null } | null {
  if (args.length < 3) return null;
  const shape = args[args.length - 1]!;
  if (shape !== 'inherit' && !isShapeId(shape)) return null;
  const instance = args[0]!;
  const name = args.slice(1, -1).join(':');
  if (!name || !isToolbarInstanceId(instance)) return null;
  return { instance, name, shape: shape === 'inherit' ? null : shape };
}

export interface ToolbarOnScreen { id: string; label: string }

/**
 * Which toolbar a person means ("the main toolbar", "settings toolbar", "ui-review"): `app` for the app's own (main, app,
 * top, the toolbar, nothing), an exact id, else the toolbar whose id or label is made of the words, or contains them.
 * "toolbar", "bar", "the", "widgets" are dropped. Null when nothing matches.
 */
export function matchToolbarInstance(rows: readonly ToolbarOnScreen[], words: string): string | null {
  const raw = String(words ?? '').trim();
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|this|toolbar|tool|bar|widgets?|of|on|to)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const want = norm(raw);
  if (!raw || !want || /^(app|main|top|default)$/.test(want)) return TOOLBAR_APP_INSTANCE;
  const exact = rows.find((r) => r.id === raw);
  if (exact) return exact.id;
  const score = (r: ToolbarOnScreen) => {
    const id = norm(r.id), label = norm(r.label);
    if (id === want || label === want) return 3;
    if (id.split(' ').includes(want) || label.split(' ').includes(want)) return 2;
    if (id.includes(want) || label.includes(want)) return 1;
    return 0;
  };
  const best = rows.map((r, i) => ({ r, i, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i)[0];
  if (best) return best.r.id;
  return isToolbarInstanceId(raw) ? raw : null;
}

/** Find a widget on a toolbar from what someone said: its key or id, else the closest name or alias (the banner's rule). */
export function findToolbarWidget<T extends BannerWidgetQueryable>(rows: readonly T[], query: string): T | null { return findBannerWidget(rows, query); }
