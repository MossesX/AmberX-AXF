/**
 * xLayout's IDE mode (dock@1): with the switch on, the apps open as tabs in panes on the dock engine instead of one at
 * a time. Panes are dragged by their tabs (any tab header, a pane's centre or edges, the dock's outer edges), resized
 * by the splitters between them, and capped at the xlayout's pane limit (a drop past it joins as a tab). An app opens in
 * the main area, a floating window or a pane (`openApp`); a layout preset lays the open apps out (the layout picker,
 * with a preview before it applies). The arrangement is kept (`xlayout.ide.dock`) and comes back with the switch.
 */
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import type { TabSpec } from '../../../src/axf/core/engines/windows';
import { paneGroups } from '../../../src/axf/core/engines/windows';
import { normalizeDockLayout, type DockLayoutData } from '../../../src/axf/core/engines/dock';
import { LAYOUT_MODE_PRESET, containerIsTabs, dockRulesOf, idePresets, setContainerTabs, type LayoutMode, type OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { parseRef } from '../../../src/axf/core/engines/shell-surface';
import { mollyService } from '../../../src/molly/host';
import { Button, Icon, useAxfState, useRuntime } from '../../../src/axf/react';
import { DockHost, DockPresetThumb } from '../../../src/axf/react/windows/DockHost';
import { useWindowState } from '../../../src/axf/react/windows/WindowHost';
import { NativeView } from '../../../src/molly/native';
import { MOLLY_APPS, mollyApp } from '../../../src/molly/apps';
import { docked, effectiveXLayout, K } from './model';

/** Tab kind of an app in a pane (payload = the app id). */
export const APP_TAB = 'molly-app';
export const LAYOUT_DIALOG = 'xlayout.layout';
/** Drag payload of a menu item (One shell's menus and Go to anything): a qualified ref `<app>:<kind>:<id>`. */
export const REF_MIME = 'text/x-axf-ref';
const tabId = (app: string) => `molly-app:${app}`;
/** A tab for an app, or one of its screens (`console/plan`, a native app's screen). */
const tabOf = (app: string, title?: string): TabSpec => { const a = mollyApp(app.split('/')[0]); return { id: tabId(app), title: title ?? a?.label ?? app, kind: APP_TAB, payload: app, icon: a?.icon ?? 'box', closable: true }; };

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
  const l0 = effectiveXLayout(rt);
  const ide = l0.ide.on, inDock = docked(l0);
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
  if (inDock) showInDock(rt, app);
}

/* ---------- containers: tab groups, and dropping a menu item onto one (molly-one-shell s10) ---------- */

/** The pane number (1-based, the dock's pane order) of a group in the main dock; 0 when it isn't there. */
export function paneOf(rt: AxfRuntime, group: string): number {
  const tree = rt.windows.state.layouts[rt.windows.mainWindowId];
  return tree ? paneGroups(tree).indexOf(group) + 1 : 0;
}
/** The group of pane `n` (1-based) in the main dock, or null. */
export function groupOfPane(rt: AxfRuntime, n: number): string | null {
  const tree = rt.windows.state.layouts[rt.windows.mainWindowId];
  return tree ? paneGroups(tree)[n - 1] ?? null : null;
}
/** Is this container a tab group (xlayout@1: tabs mode = the first pane; split / IDE = the user's per-container switch)? */
export function isTabGroup(rt: AxfRuntime, group: string): boolean {
  const l = effectiveXLayout(rt);
  return containerIsTabs({ mode: l.mode, containers: l.ide.containers }, paneOf(rt, group));
}
/** Switch a container to a tab group or back (`on` absent = flip). */
export function setTabGroup(rt: AxfRuntime, group: string, on?: boolean): boolean | null {
  const pane = paneOf(rt, group);
  if (!pane) return null;
  const next = on ?? !isTabGroup(rt, group);
  rt.settings.set(K.containers, JSON.stringify(setContainerTabs(effectiveXLayout(rt).ide.containers, pane, next)));
  return next;
}

interface ShellLike { surfaces(): { app: { id: string }; items: { kind: string; id: string; label: string }[] }[]; open(ref: string, target?: OpenTarget): boolean }

/**
 * Open a menu item (a qualified ref) in a container: an app's screen becomes a tab there (after the front tab when the
 * container is a tab group; alone otherwise, xlayout@1 `openInContainer`); anything else (an action, a setting, a
 * dialog, one of Molly's own screens) just runs through One shell. `group` null = the current pane.
 */
export function openRefIn(rt: AxfRuntime, group: string | null, ref: string): boolean {
  const p = parseRef(ref);
  const shell = mollyService<ShellLike>('axf.shell@1');
  if (!p) return false;
  const app = mollyApp(p.app);
  if (!app || p.kind !== 'screen') return shell?.open(ref) ?? false;
  const payload = p.id === 'home' ? app.id : `${app.id}/${p.id}`;
  const label = shell?.surfaces().find((s) => s.app.id === app.id)?.items.find((i) => i.kind === 'screen' && i.id === p.id)?.label;
  const wm = rt.windows;
  const g = group ?? currentGroup(rt);
  if (!g) { wm.openGroup([tabOf(payload, label && p.id !== 'home' ? `${app.label}: ${label}` : undefined)]); keepIde(rt); return true; }
  const at = findTab(rt, payload);
  if (at && at.group === g) { wm.activate(at.group, at.index); return true; }
  if (at) wm.closeTab(tabId(payload));
  const grp = wm.state.groups[g];
  const tabs = isTabGroup(rt, g);
  wm.addTab(g, tabOf(payload, label && p.id !== 'home' ? `${app.label}: ${label}` : undefined), tabs && grp ? grp.active + 1 : -1);
  const now = findTab(rt, payload);
  if (now) wm.activate(now.group, now.index);
  // not a tab group: the container shows only the new thing
  if (!tabs) for (const t of [...(wm.state.groups[g]?.tabs ?? [])]) if (t.id !== tabId(payload)) wm.closeTab(t.id);
  keepIde(rt);
  return true;
}

/** Drop handlers for the IDE dock: a menu item dragged onto a pane opens there; the pane under the pointer lights up. */
function useRefDrop(rt: AxfRuntime) {
  const paneAt = (e: { target: EventTarget | null }) => (e.target as Element | null)?.closest?.('.fx-tabgroup[data-fx-ctx-payload]') as HTMLElement | null;
  const clear = () => document.querySelectorAll('[data-axp-drop]').forEach((el) => el.removeAttribute('data-axp-drop'));
  return {
    // capture phase: a menu item dropped on a pane is the dock's, never the app screen's inside it (its own drop zones)
    onDragOverCapture: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(REF_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      const pane = paneAt(e);
      if (pane && !pane.hasAttribute('data-axp-drop')) { clear(); pane.setAttribute('data-axp-drop', 'on'); }
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) clear(); },
    onDropCapture: (e: DragEvent) => {
      const ref = e.dataTransfer.getData(REF_MIME);
      clear();
      if (!ref) return;
      e.preventDefault();
      e.stopPropagation();
      openRefIn(rt, paneAt(e)?.getAttribute('data-fx-ctx-payload') ?? null, ref);
    },
  };
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

/** The tab body of an app in a pane: the app mounted natively (shell-surface@1). `app` may name one of its screens
 *  (`console/plan`). */
export function AppTab({ app }: { app: string }) {
  const [id, ...rest] = app.split('/');
  return <NativeView app={id!} view={rest.join('/') || 'home'} />;
}

/** IDE mode's main area: the dock of the main window, the app on screen brought up in it. */
export function Workspace({ app }: { app: string }) {
  const rt = useRuntime();
  const s = useWindowState();
  useEffect(() => { enterIde(rt); showInDock(rt, app); }, [rt, app]);
  // keep the arrangement whenever it changes (debounced: a splitter drag changes it on every move)
  useEffect(() => { const t = setTimeout(() => keepIde(rt), 400); return () => clearTimeout(t); }, [rt, s.layouts, s.groups]);
  const drop = useRefDrop(rt);
  return (
    <div className="axp-xlayout-ide" data-fx-ctx-target="xlayout-ide" {...drop}>
      <DockHost empty={<div className="fx-empty">No apps open. Pick one from the navigation, or a layout from View → Pane layout.</div>} />
    </div>
  );
}

/** What an app's view shows: the dock in IDE mode, its screen alone otherwise. */
export function AppMain({ app }: { app: string }) {
  const rt = useRuntime();
  useAxfState();
  const ide = docked(effectiveXLayout(rt));
  return ide ? <Workspace app={app} /> : <AppTab app={app} />;
}

/**
 * Lay the apps out with a dock-layout preset: the mode (tabs / split / ide) and preset are saved, the dock rules put in
 * force, enough apps opened to fill the panes (the open ones first, the one on screen leading), the preset applied and
 * the arrangement kept. Single mode keeps the arrangement and shows one app at a time.
 */
export function applyPresetById(rt: AxfRuntime, presetId: string, mode: LayoutMode): boolean {
  if (mode === 'single') { keepIde(rt); rt.settings.set(K.mode, 'single'); rt.settings.set(K.ideOn, false); return true; }
  const all = rt.registry.list('dock-layout' as never) as unknown as { id: string; data: unknown }[];
  const asset = all.find((a) => a.id === presetId) ?? all.find((a) => a.id === LAYOUT_MODE_PRESET[mode]);
  if (!asset) return false;
  const data = normalizeDockLayout(asset.data);
  rt.settings.set(K.mode, mode);
  rt.settings.set(K.ideOn, mode === 'ide');
  if (mode === 'ide') rt.settings.set(K.preset, asset.id);
  rt.windows.setDockRules(dockRulesOf(effectiveXLayout(rt)));
  const limit = dockRulesOf(effectiveXLayout(rt)).paneLimit;
  const view = rt.getState().view.split('/')[0] ?? '';
  const open = Object.values(rt.windows.state.groups).filter((g) => g.windowId === rt.windows.mainWindowId).flatMap((g) => g.tabs).filter((t) => t.kind === APP_TAB).map((t) => t.payload!);
  const order = [...new Set([...(mollyApp(view) ? [view] : []), ...open, ...MOLLY_APPS.map((a) => a.id)])];
  const placed = order.slice(0, Math.max(Math.min(data.panes, limit), Math.min(open.length, order.length)));
  for (const app of placed) if (!findTab(rt, app)) { const g = currentGroup(rt); if (g) rt.windows.addTab(g, tabOf(app)); else rt.windows.openGroup([tabOf(app)]); }
  rt.windows.applyPreset(data);
  keepIde(rt);
  if (!mollyApp(view)) rt.navigate(placed[0] ?? MOLLY_APPS[0]!.id);
  return true;
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
    applyPresetById(rt, chosen.id, 'ide');
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
