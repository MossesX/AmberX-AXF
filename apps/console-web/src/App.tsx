import { useEffect } from 'react';
import { AccountView, AppShell, AssetStudio, type ViewMap } from './axf/react';
import { dialogs } from './dialogs';
import { ConsoleStoreProvider, useStore } from './store';
import { Home } from './views/Home';
import { Tracker } from './views/Tracker';
import { Catalog } from './views/Catalog';
import { Libraries } from './views/Libraries';
import { Demos, Modules } from './views/DemosModules';
import { Boilerplates } from './views/Boilerplates';
import { Components } from './views/Components';
import { consoleTabs, useUndockDrop } from './views/Explorer';

/** Views the shell can show. The console-nav asset references these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  tracker: { title: 'Tracker', icon: 'check-circle', render: () => <Tracker /> },
  catalog: { title: 'Catalog', icon: 'layers', render: () => <Catalog /> },
  libraries: { title: 'Libraries', icon: 'box', render: () => <Libraries /> },
  demos: { title: 'Demos', icon: 'smartphone', render: () => <Demos /> },
  modules: { title: 'Modules', icon: 'package', render: () => <Modules /> },
  boilerplates: { title: 'Boilerplates', icon: 'layout', render: () => <Boilerplates /> },
  components: { title: 'Components', icon: 'grid', render: () => <Components /> },
  assets: { title: 'Assets', icon: 'palette', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

function Shell() {
  const s = useStore();
  const drop = useUndockDrop();
  useEffect(() => { (globalThis as unknown as { __axfConsole?: unknown }).__axfConsole = s; }, [s]);
  return <div {...drop} style={{ display: 'contents' }}><AppShell views={views} dialogs={dialogs} tabs={consoleTabs} /></div>;
}

export function App() {
  return <ConsoleStoreProvider><Shell /></ConsoleStoreProvider>;
}
