/**
 * Screen layouts (screen-layouts@1; core/engines/screen-layouts.mjs). Brett, Nov 4 2026: "From now on, all plugin
 * screens get three layouts, and come with a toolbar to select which one, with the toolbar hidden by default."
 *
 * A plugin screen uses two things:
 *
 *   const screen = useScreenLayout('example');            // { layout, layouts, set, toolbarShown, rootProps, headProps }
 *   <div className="fx-stack fx-stack--lg" {...screen.rootProps}>
 *     <header className="fx-pagehead"><div {...screen.headProps}>…title…</div></header>
 *     <LayoutToolbar view="example" plugin={PLUGIN_ID} />
 *     {screen.layout === 'compact' ? … : …}
 *   </div>
 *
 * `rootProps` puts `data-axf-screen` / `data-axf-layout` on the screen's root (the base stylesheet tightens or widens
 * the stack for compact / spacious; a plugin's own CSS keys off the same attribute). `headProps` makes the title a
 * right-click target (Show / Hide layout toolbar, the layouts). `LayoutToolbar` draws the shared `layout-switcher`
 * toolbar (or the plugin's own copy) only while the screen shows it; its buttons come from the runtime's
 * `screen-layouts` live list, so one shared asset serves every plugin.
 */
import { useAxfState, useRuntime } from '../AxfProvider';
import { LAYOUT_SWITCHER_TOOLBAR, SCREEN_LAYOUT_CTX, type ScreenLayout } from '../../core/engines/screen-layouts.mjs';
import { AssetToolbar } from './Chrome';

export interface ScreenLayoutApi {
  /** the layout the screen shows now ('' when the view declared none) */
  layout: string;
  layouts: ScreenLayout[];
  default: string;
  set: (id: string) => void;
  toolbarShown: boolean;
  showToolbar: (on: boolean | null) => void;
  /** spread on the screen's root element */
  rootProps: Record<string, string | undefined>;
  /** spread on the title block inside the page head (right-click → layouts, Show / Hide layout toolbar) */
  headProps: Record<string, string | undefined>;
}

/** A screen's current layout and the ways to change it; re-renders on every pick. */
export function useScreenLayout(view: string): ScreenLayoutApi {
  const rt = useRuntime();
  useAxfState();
  const spec = rt.screenLayouts(view);
  const layout = rt.screenLayout(view);
  return {
    layout,
    layouts: spec?.layouts ?? [],
    default: spec?.default ?? '',
    set: (id) => rt.setScreenLayout(view, id),
    toolbarShown: rt.layoutToolbarShown(view),
    showToolbar: (on) => rt.setLayoutToolbarShown(view, on),
    rootProps: { 'data-axf-screen': view, 'data-axf-layout': layout || undefined },
    headProps: { 'data-fx-ctx-target': SCREEN_LAYOUT_CTX.title, 'data-fx-ctx-payload': view },
  };
}

/**
 * The layout toolbar of a plugin screen: nothing while hidden (the default); when shown, the shared switcher asset or
 * this plugin's own copy, as a normal toolbar (tap-to-confirm, Toolbars settings, right-click: own copy / shared, hide).
 */
export function LayoutToolbar({ view, plugin, label }: { view: string; plugin: string; label?: string }) {
  const rt = useRuntime();
  useAxfState();
  if (!rt.layoutToolbarShown(view)) return null;
  const resolved = rt.resolveLayoutToolbar(plugin);
  if (!resolved) return null;
  return (
    <div className="fx-layout-switch" data-axf-layout-switch={resolved.shared ? 'shared' : 'copy'} data-axf-not-toolbar="wrapper of the layout switcher; the AssetToolbar inside is the toolbar">
      <AssetToolbar id={LAYOUT_SWITCHER_TOOLBAR} asset={resolved} label={label ?? 'Layout toolbar'} ctxTarget={SCREEN_LAYOUT_CTX.toolbar} ctxPayload={plugin} />
    </div>
  );
}
