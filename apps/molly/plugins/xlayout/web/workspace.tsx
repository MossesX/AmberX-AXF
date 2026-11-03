/**
 * xLayout's IDE mode (dock@1): with the switch on, the apps open as tabs in panes on the dock engine instead of one at
 * a time. Panes are dragged by their tabs (any tab header, a pane's centre or edges, the dock's outer edges), resized
 * by the splitters between them, and capped at the xlayout's pane limit (a drop past it joins as a tab). An app opens in
 * the main area, a floating window or a pane (`openApp`); a layout preset lays the open apps out (the layout picker,
 * with a preview before it applies). The arrangement is kept (`xlayout.ide.dock`) and comes back with the switch.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import type { TabSpec } from '../../../src/axf/core/engines/windows';
import { paneGroups } from '../../../src/axf/core/engines/windows';
import { normalizeDockLayout, type DockLayoutData } from '../../../src/axf/core/engines/dock';
import { dockRulesOf, idePresets, type OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { Button, Icon, useAxfState, useRuntime } from '../../../src/axf/react';
import { DockHost, DockPresetThumb } from '../../../src/axf/react/windows/DockHost';
import { useWindowState } from '../../../src/axf/react/windows/WindowHost';
import { AppSlot } from '../../../src/molly/FrameDeck';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { effectiveXLayout, K } from './model';

/** Tab kind of an app in a pane (payload = the app id). */
export const APP_TAB = 'molly-app';
export const LAYOUT_DIALOG = 'xlayout.layout';
const tabId = (app: string) => `molly-app:${app}`;
const tabOf = (app: string): TabSpec => { const a = mollyApp(app); return { id: tabId(app), title: a?.label ?? app, kind: APP_TAB, payload: app, icon: a?.icon ?? 'box', closable: true }; };

/** Where an app's tab is in the dock (group + index), or null. */
function findTab(rt: AxfRuntime, app: string): { group: string; index: number; windowId: string } | null {
  for (const g of Object.values(rt.windows.state.groups)) { const i = g.tabs.findIndex((t) => t.id === tabId(app)); if (i >= 0) return { group: g.id, index: i, windowId: g.windowId }; }
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

/** Keep the arrangement (a dock@1 snapshot of the main dock's app tabs) so IDE mode comes back the same. */
export function keepIde(rt: AxfRuntime): void {
  const snap = rt.windows.snapshot();
  if (snap) rt.settings.set(K.dock, JSON.stringify(snap));
}

/** The tab body of an app in a pane: its frame's slot, covering only the pane. */
export function AppTab({ app }: { app: string }) {
  return <AppSlot id={app} fill="self" />;
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
