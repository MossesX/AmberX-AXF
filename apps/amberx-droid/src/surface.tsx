/**
 * AmberX as a native surface (shell-surface@1, build molly-one-shell s8, Nov 2026): a shell such as Molly imports this
 * module (built on its own as `/surface/amberx-surface.js`, vite.surface.config.ts) and mounts AmberX's screens and its
 * plugins' screens (voice, monitoring, walkthroughs …) in its own page: no frame, no second chrome. The seam:
 * framework/react/nativeSurface.tsx. Its own server's routes (AI, walkthroughs, the console plugins it forwards) go back to AmberX's address; `/api/me` stays
 * with the console's when both are mounted (both answer it the same way: the signed-in account).
 */
import { useMemo } from 'react';
import { installLibraries, useRuntime } from './axf/react';
import { createNativeSurface } from './axf/react/nativeSurface';
import { dialogs } from './dialogs';
import { libraries, views } from './App';
import { createAmberXRuntime } from './runtime';
import './windows/windows.css';

function useContents() {
  const rt = useRuntime();
  const c = useMemo(() => installLibraries(rt, libraries), [rt]);
  return { views: { ...c.views, ...views }, dialogs: { ...c.dialogs, ...dialogs }, tabs: c.tabs, slots: c.slots };
}

export const { SURFACE_CONTRACT, APP, routes, mountSurface, searchEntries, screens, run, subscribe } = createNativeSurface({
  app: { id: 'amberx', label: 'AmberX', icon: 'sparkles', description: 'The AmberX app: plugins, voice, walkthroughs.' },
  routes: ['/api/ai/', '/api/walkthrough', '/api/console/plugins/'],
  createRuntime: () => createAmberXRuntime({ look: false }),
  useContents,
});
