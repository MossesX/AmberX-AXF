import { useEffect, useState, type ReactNode } from 'react';
import { compileSlots, regionAccepts } from '../core/engines/layout';
import { useAsset, useAxfState, useRuntime } from './AxfProvider';
import { MenuBar, NavMenu, StatusBar, Toolbar } from './components/Chrome';
import { ContextMenuHost, DialogHost, ToastHost, type DialogMap } from './components/Overlays';
import { Inspector } from './studio/Inspector';
import { builtinDialogs } from './studio/builtinDialogs';
import { bannerSettingsDialog } from './components/BannerSettings';
import { FloatingWindowsHost, TabRenderersProvider, windowDialogs, useWindowShortcuts, type TabRenderers } from './windows/WindowHost';
import { OutputTerminalPane, terminalDialog } from './studio/OutputTerminal';
import { useSearchHost } from './components/Search';
import { Banner } from './components/Banner';
import { FrameBanners, Slot } from './components/Slots';
import { WaitingForHub } from './components/Waiting';
import { Note } from './components/Forms';
import { HelpLayer } from './components/Help';
import { embedHostLabel, embedPageView } from '../core/engines/embed';
import { placedParts } from './placement';

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
  /**
   * Views kept mounted once shown (hidden while another view is in front) instead of being rebuilt on every switch:
   * for views holding a live page (Patches' app tabs are frames; moving or remounting a frame reloads it).
   */
  keep?: readonly string[];
}

/**
 * The application shell. Regions are placed by the layout engine
 * (CSS grid vars compiled from the active `layout` asset).
 */
export function AppShell({ views: declaredViews, dialogs: declaredDialogs = {}, inspector, tabs: declaredTabs = {}, keep = [] }: AppShellProps) {
  const layout = useAsset('layout').data;
  const state = useAxfState();
  // Region slot contract: chrome mounts only where the layout's slot accepts its asset type.
  const slots = compileSlots(layout);
  // Hidden slots (Settings → Appearance → Assets → Hidden) drop out the same way.
  const rt = useRuntime();
  // Placed UIs (engines/placement.ts): a plugin's page shown in a dialog / window / tab group, or its dialog as a page.
  const placed = placedParts(rt, declaredViews, declaredDialogs);
  const views = { ...placed.views, ...declaredViews };
  const dialogs = { ...placed.dialogs, ...declaredDialogs };
  const tabs = { ...placed.tabs, ...declaredTabs };
  const showMenubar = layout.showMenubar && regionAccepts(slots, 'menubar', 'app-menu') && !rt.slotHidden('app-menu');
  const showToolbar = layout.showToolbar && regionAccepts(slots, 'toolbar', 'toolbar') && !rt.slotHidden('toolbar');
  const showNav = regionAccepts(slots, 'nav', 'nav-menu') && !rt.slotHidden('nav-menu');
  useWindowShortcuts();
  const allDialogs: DialogMap = { ...builtinDialogs, ...bannerSettingsDialog, ...windowDialogs, ...terminalDialog, ...dialogs };
  // Live search: views, dialogs and page text go into the runtime's search index; picks are focused here.
  useSearchHost(declaredViews, allDialogs);
  const view = views[state.view] ?? Object.values(views)[0];
  // Kept views (`keep`): mounted the first time they're shown, then only hidden, so their state (a frame) survives.
  const [kept, setKept] = useState<string[]>([]);
  const keepKey = keep.join('|');
  useEffect(() => {
    if (keep.includes(state.view) && !kept.includes(state.view)) setKept((k) => [...k, state.view]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, keepKey]);
  const keptNow = keep.filter((id) => views[id] && (kept.includes(id) || id === state.view));

  // Developer apps (an appearance source is attached): nothing but the waiting screen until the hub has answered the first
  // time (or says this browser may not read the look). A later re-read that fails keeps the app on screen (Nov 1 2026).
  if (state.appearance && rt.appearanceBlocking()) {
    return (
      <div className="fx-frame" data-axf-embed={rt.embedded?.host}>
        <div className="fx-shell fx-shell--waiting"><main className="fx-region fx-main" style={{ gridArea: 'main' }}><div className="fx-main__inner"><WaitingForHub state={state.appearance} hub={rt.appearanceHub?.()} /></div></main></div>
      </div>
    );
  }

  // Page mode (embed@1 `page`): the host shows one page of this app on its own, e.g. its settings inside Patches' combined
  // settings. Only that view, full page, no chrome, no banners; dialogs and toasts still work.
  // A view page (`view:<id>`, e.g. a tabable plugin shown as a host's tab) names one view; a missing view (its plugin is
  // off or not loaded yet) shows a note instead of the whole app.
  const pageView = embedPageView(rt.embedded?.page);
  const page = rt.embedded?.page ? views[pageView ?? rt.embedded.page] ?? (pageView ? { title: pageView, render: () => <MissingPage view={pageView} host={embedHostLabel(rt.embedded)} /> } : undefined) : undefined;
  if (page) {
    return (
      <TabRenderersProvider renderers={{ terminal: (t) => <OutputTerminalPane channel={t.payload || null} />, ...tabs }}>
      <div className="fx-frame fx-frame--page" data-axf-embed={rt.embedded?.host} data-axf-embed-page={rt.embedded?.page}>
        <div className="fx-shell fx-shell--page">
          <main className="fx-region fx-main" style={{ gridArea: 'main' }} data-fx-ctx-target="canvas">
            <div className="fx-main__inner">{page.render()}</div>
          </main>
          <DialogHost dialogs={allDialogs} />
          <ToastHost />
          <HelpLayer />
        </div>
      </div>
      </TabRenderersProvider>
    );
  }

  return (
    <TabRenderersProvider renderers={{ terminal: (t) => <OutputTerminalPane channel={t.payload || null} />, ...tabs }}>
    {/* data-axf-embed (embed@1): the host app this one runs inside, for styles and plugins that adapt to it; absent standalone. */}
    <div className="fx-frame" data-axf-embed={rt.embedded?.host}>
    {/* Banners sit above everything, so they stay visible whatever app.frame.top / app.frame.cover show (Brett, Oct 21 2026):
        the banner asset (thin permanent bar; hidden slot or no banner asset = nothing), then the application menu (Brett,
        Oct 22 2026: "application menus go above the live banners"), then the app.frame.banners slot (banners libraries
        contribute, stacked; scrolls inside itself when tall). The menu bar leaves the layout grid for this; its grid row is
        `auto`, so the empty row takes no space. */}
    <Banner />
    {/* app.frame.head: a page-wide bar above the application menu, e.g. the tabs of the apps a host (Patches) or the App
        tabs plugin shows (Brett, Oct 22 2026: "tabs for the apps above the application menu"). Empty = nothing. */}
    <Slot name="app.frame.head" />
    {showMenubar && (
      <div className="fx-region fx-frame__menubar">
        <MenuBar />
      </div>
    )}
    <FrameBanners />
    {/* Page-level extension points (AxfWebLibrary.slots): app.frame.head sits above the menu bar (app tabs), app.frame.top below the banners (a page-wide bar a plugin adds);
        app.frame.cover is rendered after the shell so a plugin can cover the page (it positions itself). Empty = nothing. */}
    <Slot name="app.frame.top" />
    <div className="fx-shell">
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
        {keptNow.map((id) => (
          <div key={`kept:${id}`} className="fx-main__inner fx-main__inner--kept" hidden={id !== state.view} data-axf-view={id}>
            {views[id]?.render()}
          </div>
        ))}
        {!keep.includes(state.view) && (
          <div className="fx-main__inner" key={state.view}>
            {view?.render()}
          </div>
        )}
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
      {/* Help mode (components/Help.tsx): tooltips on every control, screen intros, What is this?; nothing while it's off */}
      <HelpLayer />
    </div>
    <Slot name="app.frame.cover" />
    </div>
    </TabRenderersProvider>
  );
}

/** A view page whose view isn't here (its plugin is still loading, or off for this app in the host): say so, plainly. */
function MissingPage({ view, host }: { view: string; host: string }) {
  return (
    <Note tone="info" icon="info">
      “{view}” isn’t loaded here yet. If it doesn’t appear, its plugin is off for this app: switch it on in {host}’s plugin settings.
    </Note>
  );
}
