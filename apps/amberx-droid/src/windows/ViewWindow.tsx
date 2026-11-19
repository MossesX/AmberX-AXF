/**
 * Any AmberX page in a floating window (enterprise-branding s32). The framework's window engine draws the frame
 * (branded title bar with the brand mark, resize from eight edges, snap to screen + window edges, maximize, minimize
 * to a corner); this file only says what goes inside: the page's own render, in a framework Container so it follows
 * the container asset (and its brand watermark when the branding package asks for one).
 *
 *   action  amberx.window:<view>   open that page in a new floating window (nav right-click → Open in a window)
 *   tab kind  view                 payload = the view id
 */
import type { AxfRuntime } from '../axf/core';
import { BrandWatermark, Button, type ViewMap } from '../axf/react';

export const VIEW_TAB_KIND = 'view';

export function ViewPane({ view, views }: { view: string; views: ViewMap }) {
  const v = views[view];
  if (!v) {
    return (
      <div className="amberx-window__empty" role="status">
        <BrandWatermark slot="empty-state" />
        <p>This page isn't available any more (its plugin may be off).</p>
      </div>
    );
  }
  return <div className="amberx-window" data-view={view}>{v.render()}</div>;
}

/** Register `amberx.window:<view>`: opens the page in a floating window titled after the page. */
export function registerWindowActions(rt: AxfRuntime, views: () => ViewMap) {
  rt.actions.register('amberx.window', ([view]) => {
    const v = view ? views()[view] : undefined;
    if (!view || !v) { rt.toast(`No page "${view ?? ''}" to open.`, 'warning', 'Windows'); return; }
    rt.dispatch(`windows.openFloating:${VIEW_TAB_KIND}:${v.title.replace(/:/g, ' ')}:${view}`);
  }, { label: 'Open a page in a window', params: true, searchable: false });
}

/** A button a page can show to pop itself out (used by Approvals). */
export function PopOutButton({ rt, view }: { rt: AxfRuntime; view: string }) {
  return <Button size="sm" tone="quiet" icon="external" onClick={() => rt.dispatch(`amberx.window:${view}`)}>Open in a window</Button>;
}
