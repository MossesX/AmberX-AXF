/*
 * Placed UIs (engines/placement.ts): the views, dialogs and tab renderers AppShell adds so a plugin's primary UI can
 * open in the main area, a floating window, a dialog or the shared plugin tab group, whatever it was declared as.
 */
import type { ReactNode } from 'react';
import type { AxfRuntime } from '../core/runtime';
import { PLACED_DIALOG_TAB, PLACED_VIEW_TAB, placedId } from '../core/engines/placement';
import type { DialogMap } from './components/Overlays';
import type { ViewMap } from './AppShell';
import type { TabRenderers } from './windows/WindowHost';

export function placedParts(rt: AxfRuntime, views: ViewMap, dialogs: DialogMap): { views: ViewMap; dialogs: DialogMap; tabs: TabRenderers } {
  const outViews: ViewMap = {};
  const outDialogs: DialogMap = {};
  for (const p of rt.placedUis()) {
    if (p.ui.kind === 'view') {
      const v = views[p.ui.id];
      if (v) outDialogs[placedId(p.ui.id)] = { title: v.title, icon: v.icon, searchable: false, render: () => v.render() };
    } else {
      const d = dialogs[p.ui.id];
      if (!d) continue;
      // a dialog shown as a page: closing it goes back to the page it was opened from
      const close = () => rt.navigateHere(rt.placedReturn && rt.placedReturn !== placedId(p.ui.id) ? rt.placedReturn : 'home');
      outViews[placedId(p.ui.id)] = { title: d.title, icon: d.icon, render: () => <PlacedPage title={d.title}>{d.render(rt.placedProps.get(p.ui.id) ?? {}, close)}</PlacedPage> };
    }
  }
  const tabs: TabRenderers = {
    [PLACED_VIEW_TAB]: (t) => views[t.payload ?? '']?.render() ?? <div className="fx-empty">{t.title}</div>,
    [PLACED_DIALOG_TAB]: (t) => {
      const d = dialogs[t.payload ?? ''];
      return d ? d.render(rt.placedProps.get(t.payload ?? '') ?? {}, () => rt.windows.closeTab(t.id)) : <div className="fx-empty">{t.title}</div>;
    },
  };
  return { views: outViews, dialogs: outDialogs, tabs };
}

function PlacedPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <header className="fx-pagehead"><h1>{title}</h1></header>
      {children}
    </section>
  );
}
