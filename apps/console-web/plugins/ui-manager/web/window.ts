/* Opening the UI Manager: one floating window (tab kind `ui-manager`), brought forward when it is already open. */
import type { AxfRuntime } from '@console/axf/core';

export const TAB_KIND = 'ui-manager';
export const TAB_ID = 'ui-manager';

/** True while the UI Manager window is open (minimised counts as open). */
export const isOpen = (rt: AxfRuntime) => !!rt.windows.groupOf(TAB_ID);

export function openUiManager(rt: AxfRuntime): void {
  const wm = rt.windows;
  const inGroup = wm.groupOf(TAB_ID);
  if (inGroup) {
    const g = wm.state.groups[inGroup]!;
    wm.activate(inGroup, g.tabs.findIndex((t) => t.id === TAB_ID));
    const win = wm.state.windows.find((w) => w.id === g.windowId);
    if (win?.minimized) wm.restore(win.id); else if (win) wm.focus(win.id);
    return;
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  const w = Math.max(300, Math.min(920, innerWidth - (touch ? 24 : 48)));
  const h = Math.max(320, Math.min(680, innerHeight - 96));
  wm.openFloating([{ id: TAB_ID, title: 'UI Manager', kind: TAB_KIND, icon: 'sliders' }], 'UI Manager', 'floating', w, h, Math.max(8, innerWidth - w - 16), 64, { minWidth: 300, minHeight: 280 });
}

export function closeUiManager(rt: AxfRuntime): void {
  if (rt.windows.groupOf(TAB_ID)) rt.windows.closeTab(TAB_ID);
}
