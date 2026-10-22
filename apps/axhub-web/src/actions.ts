import type { AxfRuntime } from './axf/core';
import { accountUrl, appsUrl, approvalsUrl, isHub, loginUrl } from './axf/libs/hub';
import { HUB } from './hub/useHub';

/** Hub pages this app can open. Each is built from the hub address, never from a reply. */
const PAGES: Record<string, (base: string) => string> = {
  approvals: approvalsUrl,
  apps: appsUrl,
  account: accountUrl,
  'sign-in': (base) => loginUrl(base),
  users: (base) => `${base}/auth/admin/users`,
  home: (base) => base,
};

/** Asks the open views to read the hub again (the approvals watcher and the Apps view listen). */
export const CHECK_EVENT = 'axhub:check';

/**
 * This app's handlers for the standard action vocabulary. Menus, toolbars and context menus from any
 * asset call these by id. Views, settings, appearance, search and the window manager come from the
 * framework; everything here is about the hub.
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);

  on('axhub.check', () => {
    globalThis.dispatchEvent?.(new Event(CHECK_EVENT));
    axf.toast('Reading the hub again.', 'info', 'Checking');
  }, { label: 'Check the hub now' });

  on('axhub.open', (args) => {
    const page = PAGES[args[0] ?? 'home'] ?? ((base: string) => base);
    const url = page(HUB);
    // Only ever the hub's own pages.
    if (!isHub(HUB, url)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, { label: 'Open on the hub', params: true });

  on('help.about', () => axf.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => axf.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => axf.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });
}
