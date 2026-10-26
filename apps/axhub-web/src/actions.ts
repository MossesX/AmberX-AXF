import type { AxfRuntime } from './axf/core';
import { installHubMenu } from './axf/libs/hub/menu';
import { checkHubNow } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';
import { APPROVAL_ID_RE, signInUrl } from './hub/core';
import { go } from './hub/route';
import { signOut } from './hub/api';

/** `hub.open:<page>` → this app's own page (the hub's HTML pages moved here, axHub decision #96). */
const PAGES: Record<string, [view: string, params?: Record<string, string>]> = {
  approvals: ['home'], home: ['home'], log: ['approvals-log'], apps: ['apps'], account: ['account'], users: ['users'], handoff: ['handoff'],
};

/** The live search box on screen (toolbar or banner), not one inside a dialog. */
const visibleSearch = () =>
  [...document.querySelectorAll<HTMLInputElement>('.fx-search--live input')].find((i) => !i.closest('.fx-dialog, [role="dialog"]') && i.offsetParent !== null) ?? null;

/**
 * This app's handlers for the standard action vocabulary. Menus, toolbars and context menus from any
 * asset call these by id. Views, settings, appearance, search and the window manager come from the
 * framework; the hub's pages, live lists (`hub.approvals`, `hub.apps`) and links (`hub.open:<page>`,
 * `hub.review:<id>`, `hub.download:<project>:<file>`) come from lib-hub's `installHubMenu`.
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  installHubMenu(axf, { hub: HUB, approvalsMore: 'nav:home', appsMore: 'nav:apps' });
  // The hub's pages live in this app now, so lib-hub's links open here instead of a new tab.
  on('hub.open', ([page]) => {
    if (page === 'sign-in') { location.href = signInUrl(HUB, location.href); return; }
    const [view, params] = PAGES[page ?? 'home'] ?? PAGES.home!;
    go(axf, view, params);
  }, { label: 'Open a hub page', params: true });
  on('hub.review', ([id]) => { if (id && APPROVAL_ID_RE.test(id)) go(axf, 'approval', { id }); }, { label: 'Review the request', params: true });

  on('axhub.signout', async () => {
    try { axf.toast(await signOut(), 'info', 'axHub'); location.href = `${HUB}/auth/login`; }
    catch (e) { axf.toast(e instanceof Error ? e.message : String(e), 'danger', 'Sign out'); }
  }, { label: 'Sign out of axHub' });

  on('axhub.check', () => {
    checkHubNow(); // the approvals watcher and the Apps view read the hub again
    axf.toast('Reading the hub again.', 'info', 'Checking');
  }, { label: 'Check the hub now' });

  on('axhub.search', () => {
    const input = visibleSearch();
    if (input) { input.focus(); input.select(); }
    else axf.toast('Turn the toolbar or the banner on (View) to search.', 'info', 'Search');
  }, { label: 'Search everything' });

  on('help.about', () => axf.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => axf.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => axf.openDialog('dev-console'), { label: 'Developer console', requires: 'dev.tools' });
}
