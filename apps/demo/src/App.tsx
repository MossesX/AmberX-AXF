import { AccountView, AppShell, AssetStudio, type ViewMap } from './frame/react';
import { dialogs } from './dialogs';
import { Home } from './views/Home';
import { Components } from './views/Components';

/** Views the shell can show. Navigation-menu assets reference these ids. */
const views: ViewMap = {
  home: { title: 'Home', icon: 'home', render: () => <Home /> },
  components: { title: 'Components', icon: 'grid', render: () => <Components /> },
  assets: { title: 'Assets', icon: 'layers', render: () => <AssetStudio /> },
  account: { title: 'Account', icon: 'shield', render: () => <AccountView /> },
};

export function App() {
  return <AppShell views={views} dialogs={dialogs} />;
}
