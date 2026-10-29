/**
 * GizmoX interface tabs (interface-roller s10, Opus, Oct 27 2026): the console's main window is a tab group —
 * **Main** (today's look, untouched) and one tab per interface asset in the list, each tab the whole app drawn under its
 * own interface scope (framework `<InterfaceScope>`, interface@1). Pages, data, plugins and settings are the same in every
 * tab; only the look, feel, behaviour and branding change. A swap or setting changed inside a tab goes to the app
 * itself, never to the tab's interface.
 *
 * The bar sits in the `app.frame.head` slot, so each tab draws it in its own look. Settings (this console):
 *   console.interfaceTab    the open tab ('main' or an interface id)
 *   console.interfaceTabs   the interface ids shown as tabs (default: GizmoX Night, AmberX Signature); the interface
 *                           roller adds to it
 *
 * Applying a design package or an interface to the app (Settings → Appearance, the Appearance menu, an action) changes
 * Main, which a GizmoX tab doesn't show: the console goes back to Main so the change is visible (fix Oct 29 2026:
 * "click design package, nothing changes" while the AmberX Signature tab was open).
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, InterfaceScope, useRuntime } from './axf/react';
import type { AxfRuntime } from './axf/core';

export const TAB_KEY = 'console.interfaceTab';
export const TABS_KEY = 'console.interfaceTabs';
export const DEFAULT_INTERFACE_TABS = ['gizmox-night', 'amberx-signature'];
export const MAIN_TAB = 'main';
const SCOPE = (id: string) => `gx-${id}`;

interface TabDef { id: string; label: string; icon: string; tagline?: string }

/** The tabs this console shows: Main + every listed interface it ships (missing ones are left out). */
export function interfaceTabs(rt: AxfRuntime): TabDef[] {
  const raw = rt.settings.get(TABS_KEY);
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : DEFAULT_INTERFACE_TABS;
  const tabs: TabDef[] = [{ id: MAIN_TAB, label: 'Main', icon: 'home', tagline: 'The console as it is' }];
  for (const id of ids) {
    const a = rt.registry.get('interface' as never, id) as { name: string; data: { tab?: { label?: string; icon?: string }; tagline?: string } } | undefined;
    if (a && !tabs.some((t) => t.id === id)) tabs.push({ id, label: a.data.tab?.label || a.name, icon: a.data.tab?.icon || 'layout', tagline: a.data.tagline });
  }
  return tabs;
}

/** The open tab, falling back to Main when its interface is gone. */
export function currentInterfaceTab(rt: AxfRuntime): string {
  const v = rt.settings.get(TAB_KEY);
  const id = typeof v === 'string' ? v : MAIN_TAB;
  return interfaceTabs(rt).some((t) => t.id === id) ? id : MAIN_TAB;
}

/** The tab row (rendered inside each tab, so it takes that tab's look). */
export function InterfaceTabBar() {
  const rt = useRuntime();
  useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
  const tabs = interfaceTabs(rt);
  if (tabs.length < 2) return null;
  const open = currentInterfaceTab(rt);
  return (
    <div className="axp-ifx-tabs fx-tabs" role="tablist" aria-label="Interfaces" data-fx-ctx-target="axf-interface-tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className={`fx-tab${t.id === open ? ' is-active' : ''}`} aria-selected={t.id === open} title={t.tagline}
          onClick={() => rt.settings.set(TAB_KEY, t.id)}>
          <Icon name={t.icon} size={14} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A design package or interface applied to the app brings the console back to Main, where it shows. */
export function followAppliedLook(rt: AxfRuntime): () => void {
  return rt.onLookApplied(() => { if (currentInterfaceTab(rt) !== MAIN_TAB) rt.settings.set(TAB_KEY, MAIN_TAB); });
}

/** Wraps the app: Main as it is, any other tab under its interface scope. */
export function InterfaceTabs({ children }: { children: ReactNode }) {
  const rt = useRuntime();
  useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
  useEffect(() => followAppliedLook(rt), [rt]);
  const open = currentInterfaceTab(rt);
  if (open === MAIN_TAB) return <>{children}</>;
  return <InterfaceScope key={open} id={SCOPE(open)} interface={open}>{children}</InterfaceScope>;
}
