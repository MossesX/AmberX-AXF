import type { AxfRuntime } from './axf/core';

/**
 * Bind this app's handlers to the standard action vocabulary (About, shortcuts, the developer console). Patches' own
 * actions are in patchesLibrary.tsx; the template's demo actions (new file, save, build…) are gone, so the one search
 * box finds only real things.
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);

  on('help.about', () => axf.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => axf.openDialog('patches.shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => axf.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });
}
