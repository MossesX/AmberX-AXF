import type { AxfRuntime } from './axf/core';
import { mollyApp, passHash } from './molly/apps';
import { reloadFrame } from './molly/FrameDeck';

/** Molly's actions, called by id from its menu, toolbar and nav assets. */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  const current = () => mollyApp(axf.getState().view);

  on('molly.reload', () => {
    const a = current();
    if (a) reloadFrame(a.id);
    else axf.toast('Open an app first.', 'info', 'Reload');
  }, { label: 'Reload this app' });
  on('molly.own-tab', () => {
    const a = current();
    if (a) window.open(a.url, '_blank', 'noopener');
    else axf.toast('Open an app first.', 'info', 'Open on its own');
  }, { label: 'Open this app on its own' });
  // pass-approval@1: molly.pass:<id>[/approve|/deny] (or pass:<id>) opens the console's pass-approval view on that pass,
  // Approve / Deny there go to the console's shared REST routes with Brett's session.
  on('molly.pass', (args: string[]) => {
    const joined = (args ?? []).join(':');
    let raw = '';
    try { raw = decodeURIComponent(joined); } catch { raw = joined; }
    const [id, decision] = raw.split('/');
    const hash = passHash(id ?? '', decision ?? '');
    if (hash) window.location.hash = hash;
    else axf.toast(`No pass "${raw}".`, 'warning', 'Pass');
  }, { label: 'Open a veto pass (Approve / Deny)', params: true });
}
