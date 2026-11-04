/**
 * xLayout's IDE mode (dock@1): with the switch on, the apps open as tabs in panes on the dock engine instead of one at
 * a time. Panes are dragged by their tabs (any tab header, a pane's centre or edges, the dock's outer edges), resized
 * by the splitters between them, and capped at the xlayout's pane limit (a drop past it joins as a tab). An app opens in
 * the main area, a floating window or a pane (`openApp`); a layout preset lays the open apps out (the layout picker,
 * with a preview before it applies). The arrangement is kept (`xlayout.ide.dock`) and comes back with the switch.
 *
 * molly-multi-instance-tabs (Brett, Nov 4 2026: "Need to be able to add a tab so I can have multiple instances", "How do
 * I reset the layout?"): the "+" at the end of every tab group opens the new-tab picker (an app, a copy of an app up to
 * the xlayout's `maxInstances`, any Molly view, Duplicate this tab); each copy is its own tab, frame and session (tab
 * `instance`, frame key `console#2`, console client "Console 2"); tabs rename and are remembered with the arrangement;
 * Reset layout (View menu, the right-click of any pane or tab, xLayout settings, the console action) confirms first
 * and can be undone, like every drop.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import type { TabSpec } from '../../../src/axf/core/engines/windows';
import { instanceOf, instanceTab, instancesOf, nextInstance, paneGroups } from '../../../src/axf/core/engines/windows';
import { normalizeDockLayout, type DockLayoutData } from '../../../src/axf/core/engines/dock';
import { PLACED_VIEW_TAB } from '../../../src/axf/core/engines/placement';
import { canAddInstance, dockRulesOf, idePresets, instanceKey, instanceLabel, newTabChoices, type NewTabChoice, type OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { Button, Icon, useAxfState, useRuntime } from '../../../src/axf/react';
import { DockHost, DockPresetThumb } from '../../../src/axf/react/windows/DockHost';
import { useWindowState } from '../../../src/axf/react/windows/WindowHost';
import { AppSlot } from '../../../src/molly/FrameDeck';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { appOfView } from '../../../src/molly/host';
import { effectiveXLayout, K } from './model';

/** Tab kind of an app in a pane (payload = the app id; `instance` = which copy). */
export const APP_TAB = 'molly-app';
export const LAYOUT_DIALOG = 'xlayout.layout';
export const NEW_TAB_DIALOG = 'xlayout.newtab';
export const RESET_DIALOG = 'xlayout.reset';
const tabId = (app: string) => `molly-app:${app}`;
const tabOf = (app: string): TabSpec => { const a = mollyApp(app); return { id: tabId(app), title: a?.label ?? app, kind: APP_TAB, payload: app, icon: a?.icon ?? 'box', closable: true }; };
/** The frame key of an app tab (`console`, `console#2`). */
export const frameKeyOf = (t: Pick<TabSpec, 'payload' | 'instance'>) => instanceKey(t.payload ?? '', instanceOf(t));

/** Where an app's tab is in the dock (group + index), or null; `instance` picks a copy (default: the first open one). */
function findTab(rt: AxfRuntime, app: string, instance?: number): { group: string; index: number; windowId: string } | null {
  const copies = instancesOf(rt.windows.allTabs(), APP_TAB, app);
  const want = instance ? copies.find((t) => instanceOf(t) === instance) : copies[0];
  if (!want) return null;
  for (const g of Object.values(rt.windows.state.groups)) { const i = g.tabs.findIndex((t) => t.id === want.id); if (i >= 0) return { group: g.id, index: i, windowId: g.windowId }; }
  return null;
}

/** The group the user is working in: the one holding the app on screen, else the main dock's first. */
function currentGroup(rt: AxfRuntime): string | null {
  const view = rt.getState().view.split('/')[0] ?? '';
  const here = findTab(rt, view);
  if (here && here.windowId === rt.windows.mainWindowId) return here.group;
  const tree = rt.windows.state.layouts[rt.windows.mainWindowId];
  return tree ? paneGroups(tree)[0] ?? null : null;
}

/** Bring an app up in the dock: its tab activated, or added to the current pane (the first pane when there is none). */
export function showInDock(rt: AxfRuntime, app: string): void {
  const wm = rt.windows;
  const at = findTab(rt, app);
  if (at) { wm.activate(at.group, at.index); if (at.windowId !== wm.mainWindowId) wm.focus(at.windowId); return; }
  const g = currentGroup(rt);
  if (g) { wm.addTab(g, tabOf(app)); const now = findTab(rt, app); if (now) wm.activate(now.group, now.index); }
  else wm.openGroup([tabOf(app)]);
}

/** How many copies of each app are open (by app id). */
export function openInstances(rt: AxfRuntime): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of rt.windows.allTabs()) if (t.kind === APP_TAB && t.payload) out[t.payload] = (out[t.payload] ?? 0) + 1;
  return out;
}

/**
 * Another copy of an app as a new tab in `group` (the current pane when none): "Console 2", its own frame and session.
 * Past the xlayout's `maxInstances` nothing opens (a toast says so). Returns the new tab's id, or null.
 */
export function openInstance(rt: AxfRuntime, app: string, group?: string | null): string | null {
  const a = mollyApp(app); if (!a) return null;
  const l = effectiveXLayout(rt);
  const open = openInstances(rt)[app] ?? 0;
  if (!canAddInstance(l, open)) { rt.toast(`At most ${l.ide.maxInstances} ${a.label} tab${l.ide.maxInstances === 1 ? '' : 's'} at once (xLayout settings).`, 'info', 'New tab'); return null; }
  const wm = rt.windows;
  const n = nextInstance(wm.allTabs(), APP_TAB, app);
  const tab = instanceTab(tabOf(app), n);
  const g = group && wm.state.groups[group] ? group : currentGroup(rt);
  if (g) wm.addTab(g, tab); else wm.openGroup([tab]);
  return tab.id;
}

/** A Molly view (a plugin's screen, a page) as a tab in `group` (placed-view tab, drawn by the shell). */
export function openViewTab(rt: AxfRuntime, view: string, label: string, icon: string, group?: string | null): string {
  const wm = rt.windows;
  const open = wm.allTabs().find((t) => t.kind === PLACED_VIEW_TAB && t.payload === view);
  if (open) { const gid = wm.groupOf(open.id)!; wm.activate(gid, wm.state.groups[gid]!.tabs.findIndex((t) => t.id === open.id)); return open.id; }
  const tab: TabSpec = { id: `molly-view:${view.replace(/[^A-Za-z0-9._:-]+/g, '-')}`, title: label, kind: PLACED_VIEW_TAB, payload: view, icon, closable: true };
  const g = group && wm.state.groups[group] ? group : currentGroup(rt);
  if (g) wm.addTab(g, tab); else wm.openGroup([tab]);
  return tab.id;
}

/**
 * Open an app where an item says: `main` = Molly's main area (the dock in IDE mode), `floating` = a floating window of
 * its own, `pane` = a new pane beside the current one (IDE on; past the pane limit it joins the current pane as a tab).
 */
export function openApp(rt: AxfRuntime, app: string, target: OpenTarget): void {
  const a = mollyApp(app); if (!a) return;
  const wm = rt.windows;
  const ide = effectiveXLayout(rt).ide.on;
  if (target === 'floating') {
    const at = findTab(rt, app);
    if (at && at.windowId !== wm.mainWindowId) { wm.focus(at.windowId); return; }
    if (at) wm.closeTab(tabId(app));
    wm.openFloating([tabOf(app)], a.label, 'floating', 720, 520);
    return;
  }
  if (target === 'pane' && ide) {
    const at = findTab(rt, app);
    if (at && at.windowId === wm.mainWindowId && paneGroups(wm.state.layouts[wm.mainWindowId]!).length > 1) { wm.activate(at.group, at.index); return; }
    if (at) wm.closeTab(tabId(app));
    const g = currentGroup(rt);
    if (g) wm.splitGroup(g, 'right', [tabOf(app)]); else wm.openGroup([tabOf(app)]);
    rt.navigate(app);
    return;
  }
  rt.navigate(app);
  if (ide) showInDock(rt, app);
}

/** Put the xlayout's pane limit in force, and bring back the arrangement kept from last time. */
export function enterIde(rt: AxfRuntime): void {
  const l = effectiveXLayout(rt);
  rt.windows.setDockRules(dockRulesOf(l));
  if (rt.windows.state.layouts[rt.windows.mainWindowId]) return;
  const saved = rt.settings.get(K.dock);
  if (typeof saved === 'string' && saved) { try { if (rt.windows.restoreLayout(JSON.parse(saved))) return; } catch { /* a broken snapshot: start fresh */ } }
  const view = rt.getState().view.split('/')[0] ?? '';
  if (mollyApp(view)) showInDock(rt, view);
}

/** Keep the arrangement (a dock@1 snapshot of the main dock's tabs: apps, copies, names) so IDE mode comes back the same. */
export function keepIde(rt: AxfRuntime): void {
  const snap = rt.windows.snapshot();
  rt.settings.set(K.dock, snap ? JSON.stringify(snap) : '');
}

/**
 * Reset the layout (Brett: "How do I reset the layout? Because I run it IDE style and I made a bunch of tabs"): every
 * pane and tab closes, the saved arrangement goes, and the app on screen comes back alone in one pane. Undoable
 * (`undoLayout`): the dock engine remembers what was there.
 */
export function resetLayout(rt: AxfRuntime): void {
  const wm = rt.windows;
  wm.resetDock();
  rt.settings.set(K.dock, '');
  const view = rt.getState().view.split('/')[0] ?? '';
  const app = mollyApp(view) ? view : MOLLY_APPS[0]!.id;
  wm.openGroup([tabOf(app)]);
  if (!mollyApp(view)) rt.navigate(app);
  keepIde(rt);
  rt.toast('One pane, one tab again. View → Undo layout change puts everything back.', 'success', 'Layout reset');
}

/** Undo the last layout change in the main dock (a drop, a pop-out, a close-others, a reset…). */
export function undoLayout(rt: AxfRuntime): void {
  if (rt.windows.undoLayout()) { keepIde(rt); rt.toast('Layout put back.', 'info', 'Undo'); }
  else rt.toast('Nothing to undo.', 'info', 'Undo');
}

/** The tab body of an app in a pane: its frame's slot (one per copy), covering only the pane. */
export function AppTab({ tab }: { tab: TabSpec }) {
  return <AppSlot id={frameKeyOf(tab)} fill="self" />;
}

/** IDE mode's main area: the dock of the main window, the app on screen brought up in it. */
export function Workspace({ app }: { app: string }) {
  const rt = useRuntime();
  const s = useWindowState();
  useEffect(() => { enterIde(rt); showInDock(rt, app); }, [rt, app]);
  // keep the arrangement whenever it changes (debounced: a splitter drag changes it on every move)
  useEffect(() => { const t = setTimeout(() => keepIde(rt), 400); return () => clearTimeout(t); }, [rt, s.layouts, s.groups]);
  return (
    <div className="axp-xlayout-ide" data-fx-ctx-target="xlayout-ide">
      <DockHost empty={<div className="fx-empty">No apps open. Pick one from the navigation, or a layout from View → Pane layout.</div>} />
    </div>
  );
}

/** What an app's view shows: the dock in IDE mode, its frame alone otherwise. */
export function AppMain({ app }: { app: string }) {
  const rt = useRuntime();
  useAxfState();
  const ide = effectiveXLayout(rt).ide.on;
  // the app area already fills the main region edge to edge (xlayout.css), so the frame covers just its slot
  return ide ? <Workspace app={app} /> : <AppSlot id={app} fill="self" />;
}

/** The presets the layout picker offers: the xlayout's list, kept to the dock-layout assets installed, in its order. */
function usePresets(rt: AxfRuntime): { id: string; name: string; data: DockLayoutData }[] {
  return useMemo(() => {
    const l = effectiveXLayout(rt);
    const all = rt.registry.list('dock-layout' as never) as unknown as { id: string; name: string; data: unknown }[];
    const ids = idePresets(l, all.map((a) => a.id));
    return ids.map((id) => { const a = all.find((x) => x.id === id)!; return { id, name: a.name, data: normalizeDockLayout(a.data) }; });
  }, [rt]);
}

/**
 * The layout picker: the xlayout's preset pane layouts, each previewed (its shape, how many panes, which apps land
 * where) before Apply. The pane limit holds: a preset with more panes than the limit uses its first panes only.
 * Applying turns IDE mode on, opens enough apps to fill the panes, and lays them out.
 */
export function LayoutPicker({ close }: { close: () => void }) {
  const rt = useRuntime();
  const presets = usePresets(rt);
  const l = effectiveXLayout(rt);
  const limit = dockRulesOf(l).paneLimit;
  const [pick, setPick] = useState<string>(presets.find((p) => p.id === l.ide.preset)?.id ?? presets[0]?.id ?? '');
  const chosen = presets.find((p) => p.id === pick) ?? null;
  const panes = chosen ? Math.min(chosen.data.panes, limit) : 0;
  const view = rt.getState().view.split('/')[0] ?? '';
  // the apps that will be laid out: the open ones first (the one on screen leading), then the rest, up to the panes
  const open = Object.values(rt.windows.state.groups).filter((g) => g.windowId === rt.windows.mainWindowId).flatMap((g) => g.tabs).filter((t) => t.kind === APP_TAB).map((t) => t.payload!);
  const order = [...new Set([...(mollyApp(view) ? [view] : []), ...open, ...MOLLY_APPS.map((a) => a.id)])];
  const placed = order.slice(0, Math.max(panes, Math.min(open.length, order.length)));
  const apply = () => {
    if (!chosen) return;
    rt.settings.set(K.ideOn, true);
    rt.settings.set(K.preset, chosen.id);
    rt.windows.setDockRules(dockRulesOf(effectiveXLayout(rt)));
    for (const app of placed) if (!findTab(rt, app)) { const g = currentGroup(rt); if (g) rt.windows.addTab(g, tabOf(app)); else rt.windows.openGroup([tabOf(app)]); }
    rt.windows.applyPreset(chosen.data);
    keepIde(rt);
    if (!mollyApp(view)) rt.navigate(placed[0] ?? MOLLY_APPS[0]!.id);
    close();
  };
  if (!presets.length) return <p className="fx-muted">No pane layouts are installed (dock-layout assets).</p>;
  return (
    <div className="fx-form">
      <div className="fx-dock-presets" role="listbox" aria-label="Pane layouts">
        {presets.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={p.id === pick} className={`fx-btn fx-dock-preset ${p.id === pick ? 'is-selected' : ''}`.trim()} onClick={() => setPick(p.id)} onDoubleClick={() => { setPick(p.id); }}>
            <DockPresetThumb data={p.data} />
            <span className="fx-dock-preset__name">{p.name}</span>
            <span className="fx-dock-preset__hint">{p.data.panes} pane{p.data.panes === 1 ? '' : 's'}{p.data.panes > limit ? ` · first ${limit} used` : ''}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="fx-dock-preview" aria-live="polite">
          <DockPresetThumb data={chosen.data} className="fx-dock-preview__thumb" />
          <div>
            <div className="fx-dock-preset__name">Preview: {chosen.name}</div>
            {chosen.data.hint && <p className="fx-muted">{chosen.data.hint}</p>}
            <p className="fx-muted">{panes} pane{panes === 1 ? '' : 's'} (the pane limit is {limit}): {placed.map((a) => mollyApp(a)?.label ?? a).join(', ') || 'no apps'}.</p>
            {!l.ide.on && <p className="fx-muted"><Icon name="info" /> Applying turns IDE mode on.</p>}
          </div>
        </div>
      )}
      <div className="fx-form__actions">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="layout" disabled={!chosen} onClick={apply}>Apply layout</Button>
      </div>
    </div>
  );
}

/** Molly's own screens a tab can show: every registered view that is not an app or one of an app's pages. */
function mollyViews(rt: AxfRuntime): { id: string; label: string; icon?: string }[] {
  const out: { id: string; label: string; icon?: string }[] = [];
  for (const e of rt.search.entries()) {
    if (e.kind !== 'view' || !e.id.startsWith('view:')) continue;
    const id = e.id.slice(5);
    if (appOfView(id) || id.startsWith('axf.placed:')) continue;
    out.push({ id, label: e.label, ...(e.icon ? { icon: e.icon } : {}) });
  }
  return out;
}

/**
 * The new-tab picker (the "+" at the end of a tab group, the tab menu's New tab…): an app (another copy when it is
 * open already, up to `maxInstances`), any Molly view (a plugin's screen, Home, Account), or a copy of the current tab.
 * `arg` = the group the tab goes in.
 */
export function NewTabPicker({ group, close }: { group: string; close: () => void }) {
  const rt = useRuntime();
  const l = effectiveXLayout(rt);
  const wm = rt.windows;
  const g = wm.state.groups[group];
  const current = g ? g.tabs[g.active] : undefined;
  const choices = newTabChoices(l, openInstances(rt), mollyViews(rt), !!current);
  const pick = (c: NewTabChoice) => {
    if (c.kind === 'app') { const id = openInstance(rt, c.id, group); if (!id) return; }
    else if (c.kind === 'view') openViewTab(rt, c.id, c.label, c.icon, group);
    else if (current && !wm.duplicateTab(current.id, undefined, current.kind === APP_TAB ? l.ide.maxInstances : 0)) { rt.toast(`At most ${l.ide.maxInstances} copies of one app at once (xLayout settings).`, 'info', 'Duplicate'); return; }
    keepIde(rt);
    close();
  };
  const apps = choices.filter((c) => c.kind === 'app'), views = choices.filter((c) => c.kind === 'view'), dup = choices.find((c) => c.kind === 'duplicate');
  const row = (c: NewTabChoice, hint: string) => (
    <button key={`${c.kind}:${c.id}`} type="button" data-fx-row className="axp-xlayout-choice" disabled={c.allowed === false} onClick={() => pick(c)} title={c.allowed === false ? `At most ${l.ide.maxInstances} at once` : undefined}>
      <Icon name={c.icon} size={16} /><span className="fx-grow">{c.label}</span><span className="fx-muted">{hint}</span>
    </button>
  );
  return (
    <div className="fx-stack axp-xlayout-picker">
      <section>
        <h3 className="axp-xlayout-h">Apps</h3>
        <div className="fx-stack">{apps.map((c) => row(c, c.open ? `${c.open} open · ${c.allowed === false ? 'at the limit' : `opens ${instanceLabel(c.label, (c.open ?? 0) + 1)}`}` : 'open'))}</div>
      </section>
      {views.length > 0 && (
        <section>
          <h3 className="axp-xlayout-h">Molly</h3>
          <div className="fx-stack">{views.map((c) => row(c, 'screen'))}</div>
        </section>
      )}
      {dup && current && (
        <section>
          <h3 className="axp-xlayout-h">This tab</h3>
          <div className="fx-stack">{row(dup, `copies ${current.title}`)}</div>
        </section>
      )}
      <div className="fx-form__actions"><Button onClick={close}>Cancel</Button></div>
    </div>
  );
}

/** Reset layout, confirmed first (it closes every tab; Undo brings them back). */
export function ResetLayoutDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  const tabs = rt.windows.allTabs().length;
  const panes = rt.windows.paneCount();
  return (
    <div className="fx-form">
      <p>Close {tabs} tab{tabs === 1 ? '' : 's'} in {panes} pane{panes === 1 ? '' : 's'} and start again with one pane holding the app on screen?</p>
      <p className="fx-muted">You can undo it afterwards: View → Undo layout change.</p>
      <div className="fx-form__actions">
        <Button onClick={close}>Cancel</Button>
        <Button tone="danger" icon="refresh" onClick={() => { resetLayout(rt); close(); }}>Reset layout</Button>
      </div>
    </div>
  );
}
