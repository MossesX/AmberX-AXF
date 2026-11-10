/**
 * The Dev Console as a native surface (shell-surface@1, build molly-one-shell s7, Nov 2026): a shell such as Molly
 * imports this module (built on its own as `/surface/console-surface.js`, vite.surface.config.ts) and mounts the
 * console's screens in its own page: no frame, no second banner, menu, nav or settings. The seam and how it works:
 * framework/react/nativeSurface.tsx.
 */
import { createNativeSurface } from './axf/react/nativeSurface';
import { ConsoleStoreProvider } from './store';
import { usePlugins, views } from './App';
import { dialogs } from './dialogs';
import { consoleTabs } from './views/Explorer';
import { PlanFeatureTab } from './views/Plan';
import { useBindAccount } from './account';
import { createConsoleRuntime } from './runtime';
import './console.css';

function useContents() {
  // signed in through axHub's wall: the account decides the access role (src/account.tsx)
  useBindAccount();
  const p = usePlugins().contributed;
  return {
    views: { ...p.views, ...views },
    dialogs: { ...p.dialogs, ...dialogs },
    tabs: { ...p.tabs, ...consoleTabs, 'plan-feature': (t: { payload?: string }) => <PlanFeatureTab id={t.payload || ''} /> },
    slots: p.slots,
  };
}

export const { SURFACE_CONTRACT, APP, routes, mountSurface, searchEntries, screens, run, subscribe } = createNativeSurface({
  app: { id: 'console', label: 'Console', icon: 'terminal', description: 'The AXF Dev Console: builds, plugins, UI Review.' },
  routes: ['/api/', '/data/'],
  createRuntime: createConsoleRuntime,
  useContents,
  wrap: (children) => <ConsoleStoreProvider>{children}</ConsoleStoreProvider>,
});
