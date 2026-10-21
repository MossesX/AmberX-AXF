import type { ReactNode } from 'react';
import { compileSlots, regionAccepts } from '../core/engines/layout';
import { useAsset, useAxfState, useRuntime } from './AxfProvider';
import { MenuBar, NavMenu, StatusBar, Toolbar } from './components/Chrome';
import { ContextMenuHost, DialogHost, ToastHost, type DialogMap } from './components/Overlays';
import { Inspector } from './studio/Inspector';
import { builtinDialogs } from './studio/builtinDialogs';
import { FloatingWindowsHost, TabRenderersProvider, windowDialogs, useWindowShortcuts, type TabRenderers } from './windows/WindowHost';
import { OutputTerminalPane, terminalDialog } from './studio/OutputTerminal';
import { useSearchHost } from './components/Search';
import { Banner } from './components/Banner';
import { FrameBanners, Slot } from './components/Slots';
import { WaitingForHub } from './components/Waiting';

export interface ViewDef {
  title: string;
  icon?: string;
  render: () => ReactNode;
  /** extra words the toolbar search should find this view by */
  keywords?: string[];
}
export type ViewMap = Record<string, ViewDef>;

export interface AppShellProps {
  views: ViewMap;
  dialogs?: DialogMap;
  /** content for the inspector region (defaults to the hot-swap inspector) */
  inspector?: ReactNode;
  /** tab renderers (kind → component) for the windowing engine; `terminal` and `placeholder` are built in */
  tabs?: TabRenderers;
}

/**
 * The application shell. Regions are placed by the layout engine
 * (CSS grid vars compiled from the active `layout` asset).
 */
export function AppShell({ views, dialogs = {}, inspector, tabs = {} }: AppShellProps) {
  const layout = useAsset('layout').data;
  const state = useAxfState();
  // Region slot contract: chrome mounts only where the layout's slot accepts its asset type.
  const slots = compileSlots(layout);
  // Hidden slots (Settings → Appearance → Assets → Hidden) drop out the same way.
  const rt = useRuntime();
  const showMenubar = layout.showMenubar && regionAccepts(slots, 'menubar', 'app-menu') && !rt.slotHidden('app-menu');
  const showToolbar = layout.showToolbar && regionAccepts(slots, 'toolbar', 'toolbar') && !rt.slotHidden('toolbar');
  const showNav = regionAccepts(slots, 'nav', 'nav-menu') && !rt.slotHidden('nav-menu');
  useWindowShortcuts();
  const allDialogs: DialogMap = { ...builtinDialogs, ...windowDialogs, ...terminalDialog, ...dialogs };
  // Live search: views, dialogs and page text go into the runtime's search index; picks are focused here.
  useSearchHost(views, allDialogs);
  const view = views[state.view] ?? Object.values(views)[0];

  // Developer apps (an appearance source is attached): nothing but the waiting screen until the hub has answered.
  if (state.appearance && state.appearance.status !== 'ready') {
    return (
      <div className="fx-frame" data-axf-embed={rt.embedded?.host}>
        <div className="fx-shell fx-shell--waiting"><main className="fx-region fx-main" style={{ gridArea: 'main' }}><div className="fx-main__inner"><WaitingForHub state={state.appearance} hub={rt.appearanceHub?.()} /></div></main></div>
      </div>
    );
  }

  return (
    <TabRenderersProvider renderers={{ terminal: (t) => <OutputTerminalPane channel={t.payload || null} />, ...tabs }}>
    {/* data-axf-embed (embed@1): the host app this one runs inside, for styles and plugins that adapt to it; absent standalone. */}
    <div className="fx-frame" data-axf-embed={rt.embedded?.host}>
    {/* Banners sit above everything, so they stay visible whatever app.frame.top / app.frame.cover show (Brett, Oct 21 2026):
        the banner asset (thin permanent bar; hidden slot or no banner asset = nothing), then the app.frame.banners slot
        (banners libraries contribute, stacked; scrolls inside itself when tall). */}
    <Banner />
    <FrameBanners />
    {/* Page-level extension points (AxfWebLibrary.slots): app.frame.top sits below the banners (a page-wide bar a plugin adds);
        app.frame.cover is rendered after the shell so a plugin can cover the page (it positions itself). Empty = nothing. */}
    <Slot name="app.frame.top" />
    <div className="fx-shell">
      {showMenubar && (
        <div className="fx-region" style={{ gridArea: 'menubar' }}>
          <MenuBar />
        </div>
      )}
      {showToolbar && (
        <div className="fx-region fx-region--toolbar" style={{ gridArea: 'toolbar' }} data-pos={layout.toolbarPosition}>
          <Toolbar views={views} />
        </div>
      )}
      {showNav && (
        <div className="fx-region fx-region--nav" style={{ gridArea: 'nav' }} data-side={layout.nav}>
          <NavMenu views={views} />
        </div>
      )}
      <main className="fx-region fx-main" style={{ gridArea: 'main' }} data-fx-ctx-target="canvas">
        <div className="fx-main__inner" key={state.view}>
          {view?.render()}
        </div>
      </main>
      {layout.inspector !== 'none' && (
        <aside className="fx-region fx-region--inspector" style={{ gridArea: 'inspector' }} data-side={layout.inspector}>
          {inspector ?? <Inspector />}
        </aside>
      )}
      {layout.showStatusbar && (
        <div className="fx-region fx-region--status" style={{ gridArea: 'status' }}>
          <StatusBar />
        </div>
      )}
      <DialogHost dialogs={allDialogs} />
      <ToastHost />
      <ContextMenuHost />
      <FloatingWindowsHost />
    </div>
    <Slot name="app.frame.cover" />
    </div>
    </TabRenderersProvider>
  );
}
