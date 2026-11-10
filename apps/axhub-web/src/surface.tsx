/**
 * axHub web as a native surface (shell-surface@1, build molly-one-shell s8, Nov 2026): a shell such as Molly imports this
 * module (built on its own as `/surface/axhub-surface.js`, vite.surface.config.ts) and mounts the hub's screens
 * (approvals, go pass, passes, users, handoff …) in its own page: no frame, no second chrome. The seam:
 * framework/react/nativeSurface.tsx. The hub's calls are absolute (HUB), so it routes no relative paths.
 */
import { useMemo } from 'react';
import { installLibraries, useRuntime } from './axf/react';
import { createNativeSurface } from './axf/react/nativeSurface';
import { dialogs } from './dialogs';
import { libraries, views } from './App';
import { createHubWebRuntime } from './runtime';
import './hub.css';

function useContents() {
  const rt = useRuntime();
  const c = useMemo(() => installLibraries(rt, libraries), [rt]);
  return { views: { ...c.views, ...views }, dialogs: { ...c.dialogs, ...dialogs }, tabs: c.tabs, slots: c.slots };
}

export const { SURFACE_CONTRACT, APP, routes, mountSurface, searchEntries, screens, run, subscribe } = createNativeSurface({
  app: { id: 'axhub', label: 'axHub', icon: 'shield', description: 'The connector hub: approvals, go pass, services.' },
  routes: [],
  createRuntime: () => createHubWebRuntime({ look: false }),
  useContents,
});
