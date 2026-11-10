/**
 * xLayout's IDE mode (dock@1): with the switch on, the apps open as tabs in panes on the dock engine instead of one at
 * a time. Panes are dragged by their tabs (any tab header, a pane's centre or edges, the dock's outer edges), resized
 * by the splitters between them, and capped at the xlayout's pane limit (a drop past it joins as a tab). An app opens in
 * the main area, a floating window or a pane (`openApp`); a layout preset lays the open apps out (the layout picker,
 * with a preview before it applies). The arrangement is kept (`xlayout.ide.dock`) and comes back with the switch.
 *
 * Tabs are instances (molly-shell@1): `console` and `console#2` are two tabs of the same app, each over its own frame.
 * Closing a numbered copy's tab closes that copy; closing a copy (Molly menu → Close this tab) closes its tab.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import type { TabSpec } from '../../../src/axf/core/engines/windows';
import { paneGroups } from '../../../src/axf/core/engines/windows';
import { normalizeDockLayout, type DockLayoutData } from '../../../src/axf/core/engines/dock';
import { instanceTitle, parseInstance } from '../../../src/axf/core/engines/molly-shell';
import { dockRulesOf, idePresets, type OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { Button, Icon, useAxfState, useRuntime } from '../../../src/axf/react';
import { DockHost, DockPresetThumb } from '../../../src/axf/react/windows/DockHost';
import { useWindowState } from '../../../src/axf/react/windows/WindowHost';
import { AppSlot } from '../../../src/molly/FrameDeck';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { appOfInstance, closeInstance, ensureInstance, instanceOfMollyView, openInstances } from '../../../src/molly/host';
import { effectiveXLayout, K } from './model';

/** Tab kind of an app copy in a pane (payload = the instance id). */
export const APP_TAB = 'molly-app';
export const LAYOUT_DIALOG = 'xlayout.layout';
const tabId = (instance: string) => `molly-app:${instance}`;
const tabOf = (instance: string): TabSpec => { const i = parseInstance(instance); const a = appOfInstance(instance); return { id: tabId(instance), title: a ? instanceTitle(a.label, i?.n ?? 1) : instance, kind: APP_TAB, payload: instance, icon: a?.icon ?? 'box', closable: true }; };

/** Where an instance's tab is in the dock (group + index), or null. */
function findTab(rt: AxfRuntime, instance: string): { group: string; index: number; windowId: string } | null {
  for (const g of Object.values(rt.windows.state.groups)) { const i = g.tabs.findIndex((t) => t.id === tabId(instance)); if (i >= 0) return { group: g.id, index: i, windowId: g.windowId }; }
  return null;
}

/** The group the user is working in: the one holding the copy on screen, else the main dock's first. */
function currentGroup(rt: AxfRuntime): string | null {
  const inst = instanceOfMollyView(rt.getState().view) ?? '';
  const here = findTab(rt, inst);
  if (here && here.windowId === rt.windows.mainWindowId) return here.group;
  const tree = rt.windows.state.layouts[rt.windows.mainWindowId];
  return tree ? paneGroups(tree)[0] ?? null : null;
}

/** Bring a copy up in the dock: its tab activated, or added to the current pane (the first pane when there is none). */
export function showInDock(rt: AxfRuntime, instance: string): void {
  const wm = rt.windows;
  const at = findTab(rt, instance);
  if (at) { wm.activate(at.group, at.index); if (at.windowId !== wm.mainWindowId) wm.focus(at.windowId); return; }
  ensureInstance(instance);
  const g = currentGroup(rt);
  if (g) { wm.addTab(g, tabOf(instance)); const now = findTab(rt, instance); if (now) wm.activate(now.group, now.index); }
  else wm.openGroup([tabOf(instance)]);
}

/**
 * Open a copy of an app where an item says: `main` = Molly's main area (the dock in IDE mode), `floating` = a floating
 * window of its own, `pane` = a new pane beside the current one (IDE on; past the pane limit it joins the current pane as a tab).
 */
export function openApp(rt: AxfRuntime, instance: string, target: OpenTarget): void {
  const a = appOfInstance(instance); if (!a) return;
  const wm = rt.windows;
  const ide = effectiveXLayout(rt).ide.on;
  if (target === 'floating') {
    const at = findTab(rt, instance);
    if (at && at.windowId !== wm.mainWindowId) { wm.focus(at.windowId); return; }
    if (at) wm.closeTab(tabId(instance));
    ensureInstance(instance);
    wm.openFloating([tabOf(instance)], tabOf(instance).title, 'floating', 720, 520);
    return;
  }
  if (target === 'pane' && ide) {
    const at = findTab(rt, instance);
    if (at && at.windowId === wm.mainWindowId && paneGroups(wm.state.layouts[wm.mainWindowId]!).length > 1) { wm.activate(at.group, at.index); return; }
    if (at) wm.closeTab(tabId(instance));
    ensureInstance(instance);
    const g = currentGroup(rt);
    if (g) wm.splitGroup(g, 'right', [tabOf(instance)]); else wm.openGroup([tabOf(instance)]);
    rt.navigate(instance);
    return;
  }
  rt.navigate(instance);
  if (ide) showInDock(rt, instance);
}

/** Put the xlayout's pane limit in force, and bring back the arrangement kept from last time. */
export function enterIde(rt: AxfRuntime): void {
  const l = effectiveXLayout(rt);
  rt.windows.setDockRules(dockRulesOf(l));
  if (rt.windows.state.layouts[rt.windows.mainWindowId]) return;
  const saved = rt.settings.get(K.dock);
  if (typeof saved === 'string' && saved) { try { if (rt.windows.restoreLayout(JSON.parse(saved))) { for (const t of appTabs(rt)) ensureInstance(t); return; } } catch { /* a broken snapshot: start fresh */ } }
  const inst = instanceOfMollyView(rt.getState().view);
  if (inst) showInDock(rt, inst);
}

/** Keep the arrangement (a dock@1 snapshot of the main dock's app tabs) so IDE mode comes back the same. */
export function keepIde(rt: AxfRuntime): void {
  const snap = rt.windows.snapshot();
  if (snap) rt.settings.set(K.dock, JSON.stringify(snap));
}

/** The instances that have a tab anywhere (main dock and floating windows). */
function appTabs(rt: AxfRuntime): string[] {
  return Object.values(rt.windows.state.groups).flatMap((g) => g.tabs).filter((t) => t.kind === APP_TAB && t.payload).map((t) => t.payload!);
}

/** The copy a dock group shows now (its active tab), or null when that tab is not an app copy. */
export function activeInstanceOf(rt: AxfRuntime, groupId: string): string | null {
  const g = rt.windows.state.groups[groupId];
  const t = g?.tabs[g.active];
  return t?.kind === APP_TAB && t.payload ? t.payload : null;
}

/** The tab row's + and its menu (molly-multi-instance-tabs s2): what a tab-row command does to the group's active copy. */
export function tabRowCommand(rt: AxfRuntime, op: string, groupId: string): void {
  const inst = activeInstanceOf(rt, groupId);
  const app = inst ? appOfInstance(inst)?.id : null;
  if (op === 'new') { rt.dispatch(`molly.new-tab${app ? `:${app}` : ''}`); return; }
  if (!inst) { rt.toast('That tab is not an app.', 'info', 'Tab'); return; }
  if (op === 'close') { rt.dispatch(`molly.close-tab:${inst}`); if ((parseInstance(inst)?.n ?? 1) === 1) rt.windows.closeTab(tabId(inst)); return; }
  if (op === 'float' || op === 'pane') { openApp(rt, inst, op === 'float' ? 'floating' : 'pane'); return; }
  rt.toast(`No tab command ${op}. Commands: new, close, float, pane.`, 'warning', 'Tab');
}

/** The tab body of a copy in a pane: its frame's slot, covering only the pane. */
export function AppTab({ app }: { app: string }) {
  return <AppSlot id={app} fill="self" />;
}

/** IDE mode's main area: the dock of the main window, the copy on screen brought up in it. */
export function Workspace({ app }: { app: string }) {
  const rt = useRuntime();
  const s = useWindowState();
  useEffect(() => { enterIde(rt); showInDock(rt, app); }, [rt, app]);
  // keep the arrangement whenever it changes (debounced: a splitter drag changes it on every move)
  useEffect(() => { const t = setTimeout(() => keepIde(rt), 400); return () => clearTimeout(t); }, [rt, s.layouts, s.groups]);
  // tabs and copies stay in step: a numbered copy whose tab was closed closes; a copy that was closed loses its tab
  const before = useRef<Set<string>>(new Set(appTabs(rt)));
  useEffect(() => {
    const now = new Set(appTabs(rt));
    for (const id of before.current) if (!now.has(id) && (parseInstance(id)?.n ?? 1) > 1) closeInstance(id);
    before.current = now;
    const open = openInstances();
    for (const id of now) if (!open.includes(id) && (parseInstance(id)?.n ?? 1) > 1) rt.windows.closeTab(tabId(id));
  }, [rt, s.groups, openInstances().join(',')]);
  return (
    <div className="axp-xlayout-ide" data-fx-ctx-target="xlayout-ide">
      <DockHost onNewTab={(g) => tabRowCommand(rt, 'new', g)} empty={<div className="fx-empty">No apps open. Pick one from the navigation, or a layout from View → Pane layout.</div>} />
    </div>
  );
}

/** What an app's view shows: the dock in IDE mode, the copy's frame alone otherwise. */
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
  const here = instanceOfMollyView(rt.getState().view);
  // the copies that will be laid out: the open ones first (the one on screen leading), then the rest of the apps, up to the panes
  const open = Object.values(rt.windows.state.groups).filter((g) => g.windowId === rt.windows.mainWindowId).flatMap((g) => g.tabs).filter((t) => t.kind === APP_TAB).map((t) => t.payload!);
  const order = [...new Set([...(here ? [here] : []), ...open, ...MOLLY_APPS.map((a) => a.id)])];
  const placed = order.slice(0, Math.max(panes, Math.min(open.length, order.length)));
  const title = (id: string) => { const i = parseInstance(id); const a = mollyApp(i?.app); return a ? instanceTitle(a.label, i?.n ?? 1) : id; };
  const apply = () => {
    if (!chosen) return;
    rt.settings.set(K.ideOn, true);
    rt.settings.set(K.preset, chosen.id);
    rt.windows.setDockRules(dockRulesOf(effectiveXLayout(rt)));
    for (const id of placed) if (!findTab(rt, id)) { ensureInstance(id); const g = currentGroup(rt); if (g) rt.windows.addTab(g, tabOf(id)); else rt.windows.openGroup([tabOf(id)]); }
    rt.windows.applyPreset(chosen.data);
    keepIde(rt);
    if (!here) rt.navigate(placed[0] ?? MOLLY_APPS[0]!.id);
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
            <p className="fx-muted">{panes} pane{panes === 1 ? '' : 's'} (the pane limit is {limit}): {placed.map(title).join(', ') || 'no apps'}.</p>
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
