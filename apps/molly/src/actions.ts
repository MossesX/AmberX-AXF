import type { AxfRuntime } from './axf/core';
import { mollyApp } from './molly/apps';
import { reloadFrame } from './molly/FrameDeck';

/** Molly's actions, called by id from its menu, toolbar and nav assets. */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  // an app id from a context menu ({payload}), else the app on screen
  const current = (id?: string) => mollyApp(id || axf.getState().view);

  on('molly.reload', ([id]) => {
    const a = current(id);
    if (a) reloadFrame(a.id);
    else axf.toast('Open an app first.', 'info', 'Reload');
  }, { label: 'Reload this app', params: true });
  on('molly.own-tab', ([id]) => {
    const a = current(id);
    if (a) window.open(a.url, '_blank', 'noopener');
    else axf.toast('Open an app first.', 'info', 'Open on its own');
  }, { label: 'Open this app on its own', params: true });
}
