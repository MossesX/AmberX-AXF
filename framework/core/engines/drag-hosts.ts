/**
 * Drag host adapters that need no UI framework (drag-move@1, spec/DRAG-MOVE.md): the list / apply pairs of the widget
 * hosts (banner, toolbar), the window engine's tab stacks and panes, the layout regions, the id helpers and the element
 * locators. framework/react/dragHost.ts re-exports them and adds the React hooks; a port mirrors this file.
 */
import type { AxfRuntime } from '../runtime';
import type { DragHostSnapshot, DragPlan } from './drag-move';
import { hostSpec, type PlacedAttachment } from './widgets';
import { paneGroups } from './windows';
import type { DockSide } from './dock';
import { SLOT_REGIONS, compileSlots } from './layout';
import { hideable } from './hide';
import type { AssetType, LayoutData } from '../types';

/** What a host hands the registry besides kind / container: its snapshot, its apply, and (optionally) its elements. */
export interface DragHostAdapter {
  list: () => Omit<DragHostSnapshot, 'kind' | 'container'>;
  apply: (plan: DragPlan) => unknown | Promise<unknown>;
  /** The host's element (id null) or one item's, for a deep link or a preview to highlight (drag:<kind>:<container>:<item>). */
  locate?: (id: string | null) => Element | null;
}

export const cssEsc = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
const locators = new Map<string, (id: string | null) => Element | null>();
const locKey = (kind: string, container: string) => `${kind}\u0000${container.toLowerCase()}`;
/** Register how to find a host's elements (the hooks do it; a host registered by hand may too). Returns a remover. */
export function setDragLocator(kind: string, container: string, locate: (id: string | null) => Element | null): () => void {
  const k = locKey(kind, container);
  locators.set(k, locate);
  return () => { if (locators.get(k) === locate) locators.delete(k); };
}
/** The element of a host (id null) or of one of its items, or null when the host gave no locator or it is not drawn. */
export function dragLocate(kind: string, container: string, id: string | null): Element | null {
  try { return locators.get(locKey(kind, container))?.(id) ?? null; } catch { return null; }
}


/**
 * Item ids for a list whose entries may repeat (a toolbar's separators, the same command twice): the entry itself, the
 * second and later copies `entry~2`, `entry~3`. `entryOfItemId` strips the suffix back off.
 */
export function uniqueItemIds(entries: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((e) => { const n = (seen.get(e) ?? 0) + 1; seen.set(e, n); return n === 1 ? e : `${e}~${n}`; });
}
export function entryOfItemId(id: string): string { return id.replace(/~\d+$/, ''); }

/** Columns in `order` (ids it names first, in that order; the rest after, as declared). */
export function orderColumns<C extends { id: string }>(columns: readonly C[], order: readonly string[]): C[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...columns].map((c, i) => ({ c, i })).sort((a, b) => (rank.get(a.c.id) ?? order.length + a.i) - (rank.get(b.c.id) ?? order.length + b.i)).map((x) => x.c);
}

/**
 * A grid's whole column order after a `grid-column` plan: the plan's order of the shown columns (the moved id in the
 * grid's spelling), then every other column (hidden ones) in their order now. `all` = every column id in order now.
 */
export function nextColumnOrder(plan: DragPlan, gridId: string, all: readonly string[]): string[] | null {
  const next = Object.entries(plan.order).find(([c]) => c.toLowerCase() === gridId.toLowerCase())?.[1];
  if (!Array.isArray(next)) return null;
  const own = all.find((id) => id.toLowerCase() === plan.item.id.toLowerCase()) ?? plan.item.id;
  const shown = next.map((id) => (id.toLowerCase() === own.toLowerCase() ? own : id));
  return [...shown, ...all.filter((id) => !shown.includes(id))];
}

/** A `grid-row` plan as the grid's own move: before the next row in the new order, else after the previous one. */
export function rowDropOf(plan: DragPlan, gridId: string): { id: string; pos: 'before' | 'after' } | null {
  const next = Object.entries(plan.order).find(([c]) => c.toLowerCase() === gridId.toLowerCase())?.[1];
  if (!Array.isArray(next)) return null;
  const i = next.indexOf(plan.item.id);
  if (i < 0) return null;
  if (next[i + 1]) return { id: next[i + 1]!, pos: 'before' };
  if (i > 0) return { id: next[i - 1]!, pos: 'after' };
  return null;
}

/**
 * Where `key` lands in the host's *full* side list (hidden widgets included, what rt.moveHostItem counts) given the new
 * order of the side as drawn: right before the next drawn item, else right after the previous one, else last. Pure.
 */
export function fullSideIndex(all: readonly string[], drawn: readonly string[], key: string): number {
  const rest = all.filter((k) => k !== key);
  const i = drawn.indexOf(key);
  const next = i >= 0 ? drawn.slice(i + 1).find((k) => rest.includes(k)) : undefined;
  if (next !== undefined) return rest.indexOf(next);
  const prev = i > 0 ? [...drawn.slice(0, i)].reverse().find((k) => rest.includes(k)) : undefined;
  return prev !== undefined ? rest.indexOf(prev) + 1 : rest.length;
}

/**
 * The list / apply pair of a widget host (widgets engine: banner, toolbar, any host a library registers). Items are the
 * attachments as drawn, per side. A move goes through rt.moveHostItem (the arrangement setting), the same write the
 * pointer and the arrow keys make. The banner also adds and removes: add shows a widget the banner knows (the banner
 * widget engine's `hidden` choice) and places it, remove hides it; a widget is never deleted, so add brings it back.
 */
export function widgetHostAdapter(rt: AxfRuntime, host: string, placed: () => Record<string, PlacedAttachment[]>): DragHostAdapter {
  const isBanner = host === 'banner';
  const sides = () => hostSpec(host)?.sides ?? [];
  const place = (key: string, plan: DragPlan) => {
    const to = plan.to!;
    const side = to.side ?? sides()[0]!;
    const order = plan.order[host];
    const drawn = (order && !Array.isArray(order) ? order[side] ?? [] : []).map((k) => (k.toLowerCase() === key.toLowerCase() ? key : k));
    const all = (rt.hostPlaced(host)[side] ?? []).map((p) => p.key);
    if (!rt.moveHostItem(host, key, side, fullSideIndex(all, drawn, key))) throw new Error(`${host}: ${key} could not move (no arrange permission, or it is not attached)`);
  };
  const attr = isBanner ? 'data-axf-banner-item' : host === 'toolbar' ? 'data-axf-toolbar-widget' : 'data-axf-arrange-item';
  return {
    locate: (id) => (typeof document === 'undefined' ? null : id ? document.querySelector(`[${attr}="${cssEsc(id)}"]`) : document.querySelector(`[data-axf-arrange-host="${cssEsc(host)}"]`)),
    list: () => {
      const p = placed();
      const ss = sides();
      return {
        label: isBanner ? 'Banner' : host === 'toolbar' ? 'Toolbar' : host, sides: [...ss],
        items: ss.flatMap((s) => (p[s] ?? []).map((a) => ({ id: a.key, side: s, type: a.type, ...(isBanner ? { label: rt.bannerWidgets().find((w) => w.key === a.key)?.label ?? a.id } : {}) }))),
        accepts: { add: isBanner, remove: isBanner },
      };
    },
    apply: (plan) => {
      const key = plan.item.id;
      if (plan.op === 'remove') {
        if (!isBanner || !rt.setBannerWidget(key, { hidden: true })) throw new Error(`${host}: ${key} could not be removed`);
        return;
      }
      if (plan.op === 'add') {
        const w = isBanner ? rt.bannerWidgets().find((x) => x.key.toLowerCase() === key.toLowerCase()) : undefined;
        if (!w) throw new Error(`${host}: no widget "${key}" to add (${rt.bannerWidgets().filter((x) => !x.shown).map((x) => x.key).join(', ') || 'every widget is on the banner'})`);
        if (!w.attached) throw new Error(`${host}: ${w.key} is not attached right now (its plugin is off)`);
        if (!rt.setBannerWidget(w.key, { hidden: false })) throw new Error(`${host}: ${w.key} could not be shown`);
        place(w.key, plan);
        return;
      }
      place(key, plan);
    },
  };
}

/**
 * The window engine's tab stacks and panes as drag hosts (dock@1 through the same engine call a pointer drop makes,
 * WindowManager.dropTab → applyDockDrop):
 *  - every tab stack (window group) is a `tab` host (container = the group id): reorder, or move a tab to another stack;
 *  - every window with a pane tree is a `dock-pane` host (container = the window id, items = its panes in reading
 *    order): `side` splits the pane named by `ref` (or the whole tree without one) and moves the pane's tabs there;
 *    `into` joins the pane at `index` of the list without the moved pane (the tabs join that stack); remove closes the
 *    pane's tabs (confirm). Registered once per runtime (installDragHosts) and kept in step with the window state.
 */
export function installWindowDragHosts(rt: AxfRuntime): () => void {
  const wm = rt.windows;
  const offs = new Map<string, () => void>();
  const tabs = (gid: string) => wm.state.groups[gid]?.tabs ?? [];
  const groupIds = () => Object.keys(wm.state.groups);
  const tabHost = (gid: string) => rt.drag.hosts.register({
    kind: 'tab', container: gid,
    list: () => ({ kind: 'tab', container: gid, label: `Tab stack ${gid}`, items: tabs(gid).map((t) => ({ id: t.id, label: t.title })), accepts: { from: groupIds() } }),
    apply: (plan) => {
      const to = plan.to; if (!to || to.container.toLowerCase() !== gid.toLowerCase()) return; // the target stack places it
      const g = wm.state.groups[gid]; if (!g) throw new Error(`tab stack ${gid} is gone`);
      const cur = g.tabs.findIndex((t) => t.id === plan.item.id);
      // applyDockDrop counts a header index before the tab leaves its own stack; the plan counts after
      const index = cur >= 0 && to.index >= cur ? to.index + 1 : to.index;
      if (!wm.dropTab(plan.item.id, g.windowId, { target: 'group', groupId: g.id, zone: 'header', index })) throw new Error(`${plan.item.id} could not move to ${gid}`);
    },
  });
  const panesOf = (wid: string) => { const l = wm.state.layouts[wid]; return l ? paneGroups(l) : []; };
  const moveAll = (wid: string, from: string, first: Parameters<typeof wm.dropTab>[2]) => {
    const ids = tabs(from).map((t) => t.id);
    if (!ids.length || !wm.dropTab(ids[0]!, wid, first)) throw new Error(`pane ${from} could not move`);
    const into = wm.groupOf(ids[0]!);
    for (const id of ids.slice(1)) if (into) wm.dropTab(id, wid, { target: 'group', groupId: into, zone: 'centre' });
  };
  const paneHost = (wid: string) => rt.drag.hosts.register({
    kind: 'dock-pane', container: wid,
    list: () => ({ kind: 'dock-pane', container: wid, label: wm.state.windows.find((w) => w.id === wid)?.title ?? wid, items: panesOf(wid).map((gid) => ({ id: gid, label: tabs(gid).map((t) => t.title).join(', ') || gid })) }),
    apply: (plan) => {
      const gid = plan.item.id;
      if (plan.op === 'remove') { for (const t of [...tabs(gid)]) wm.closeTab(t.id); return; }
      const to = plan.to!;
      if (to.side) return moveAll(wid, gid, to.ref ? { target: 'group', groupId: to.ref, zone: to.side as DockSide } : { target: 'root', zone: to.side as DockSide });
      const others = panesOf(wid).filter((x) => x !== gid);
      const join = others[Math.min(to.index, others.length - 1)];
      if (!join) throw new Error(`no other pane in ${wid} to join`);
      moveAll(wid, gid, { target: 'group', groupId: join, zone: 'centre' });
    },
  });
  const sync = () => {
    const want = new Set([...groupIds().map((g) => `tab\u0000${g}`), ...Object.keys(wm.state.layouts).map((w) => `dock-pane\u0000${w}`)]);
    for (const [k, off] of offs) if (!want.has(k)) { off(); offs.delete(k); }
    for (const k of want) if (!offs.has(k)) { const [kind, id] = k.split('\u0000') as [string, string]; offs.set(k, kind === 'tab' ? tabHost(id) : paneHost(id)); }
  };
  sync();
  const unsub = wm.subscribe(sync);
  return () => { unsub(); for (const off of offs.values()) off(); offs.clear(); };
}

/**
 * The layout's regions as `layout-slot` hosts (container = the region: menubar, toolbar, nav, main, inspector, status,
 * fab, sheet, overlay; items = the slot types drawn there). Add shows a hidden slot (rt.setSlotHidden), remove hides
 * one; both obey the hide rules and the UAC gate like the View menu. Which region holds a slot type is the layout
 * asset's (`data.slots`), so a move answers `failed` and names the way: edit the layout.
 */
export function installLayoutSlotHosts(rt: AxfRuntime): () => void {
  const slots = () => compileSlots((rt.assetOrNull('layout')?.data ?? {}) as LayoutData);
  const offs = SLOT_REGIONS.map((region) => rt.drag.hosts.register({
    kind: 'layout-slot', container: region,
    list: () => ({ kind: 'layout-slot', container: region, label: `${region} region`, items: slots()[region].filter((t) => !rt.slotHidden(t as AssetType)).map((t) => ({ id: t, type: t, ...(hideable(t as AssetType) ? {} : { locked: true }) })), accepts: { from: [] } }),
    apply: (plan) => {
      const type = plan.item.id as AssetType;
      if (plan.op === 'move') throw new Error(`which region holds ${type} is set by the layout asset (data.slots); edit the layout to move it`);
      if (plan.op === 'add' && !slots()[region].includes(type)) throw new Error(`the ${region} region does not take ${type} (${slots()[region].join(', ') || 'nothing'})`);
      rt.setSlotHidden(type, plan.op === 'remove');
      if (rt.slotHidden(type) !== (plan.op === 'remove')) throw new Error(`${type} could not be ${plan.op === 'remove' ? 'hidden' : 'shown'} (not hideable, owned by the host app, or no permission)`);
    },
  }));
  return () => offs.forEach((off) => off());
}

