import type { AxfRuntime } from './axf/core';
import { installHubMenu } from './axf/libs/hub/menu';
import { checkHubNow } from './axf/libs/hub/react';
import { HUB } from './hub/useHub';

/** The live search box on screen (toolbar or banner), not one inside a dialog. */
const visibleSearch = () =>
  [...document.querySelectorAll<HTMLInputElement>('.fx-search--live input')].find((i) => !i.closest('.fx-dialog, [role="dialog"]') && i.offsetParent !== null) ?? null;

/**
 * This app's handlers for the standard action vocabulary. Menus, toolbars and context menus from any
 * asset call these by id. Views, settings, appearance, search and the window manager come from the
 * framework; the hub's pages, live list `hub.approvals` and links (`hub.open:<page>`,
 * `hub.review:<id>`, `hub.download:<project>:<file>`) come from lib-hub's `installHubMenu`.
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  installHubMenu(axf, { hub: HUB, approvalsMore: 'nav:home' });

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
