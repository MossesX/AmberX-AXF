import type { ReactNode } from 'react';
import { useAsset, useAxfState } from './AxfProvider';
import { MenuBar, NavMenu, StatusBar, Toolbar } from './components/Chrome';
import { ContextMenuHost, DialogHost, ToastHost, type DialogMap } from './components/Overlays';
import { Inspector } from './studio/Inspector';
import { builtinDialogs } from './studio/builtinDialogs';

export interface ViewDef {
  title: string;
  icon?: string;
  render: () => ReactNode;
}
export type ViewMap = Record<string, ViewDef>;

export interface AppShellProps {
  views: ViewMap;
  dialogs?: DialogMap;
  /** content for the inspector region (defaults to the hot-swap inspector) */
  inspector?: ReactNode;
}

/**
 * The application shell. Regions are placed by the layout engine
 * (CSS grid vars compiled from the active `layout` asset).
 */
export function AppShell({ views, dialogs = {}, inspector }: AppShellProps) {
  const layout = useAsset('layout').data;
  const state = useAxfState();
  const view = views[state.view] ?? Object.values(views)[0];

  return (
    <div className="fx-shell">
      {layout.showMenubar && (
        <div className="fx-region" style={{ gridArea: 'menubar' }}>
          <MenuBar />
        </div>
      )}
      {layout.showToolbar && (
        <div className="fx-region fx-region--toolbar" style={{ gridArea: 'toolbar' }} data-pos={layout.toolbarPosition}>
          <Toolbar views={views} />
        </div>
      )}
      <div className="fx-region fx-region--nav" style={{ gridArea: 'nav' }} data-side={layout.nav}>
        <NavMenu views={views} />
      </div>
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
      <DialogHost dialogs={{ ...builtinDialogs, ...dialogs }} />
      <ToastHost />
      <ContextMenuHost />
    </div>
  );
}
