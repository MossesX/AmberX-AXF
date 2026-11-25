import type { AxfRuntime } from './axf/core';
import { deepLink, mollyApp, passHash } from './molly/apps';
import { reloadFrame, routeFrame } from './molly/FrameDeck';

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
  // pass-approval@1: `molly.pass:<id>[/approve|/deny]` (also `molly.pass:pass:<id>`) opens the console's pass-approval
  // view on that veto pass. Approve / Deny there call the shared pass routes with Brett's own console session; the
  // link or this action only opens the pass (a primed decision highlights its button), it never decides.
  on('molly.pass', (args) => {
    const joined = (args ?? []).join(':');
    let named = joined;
    try { named = decodeURIComponent(joined); } catch { /* not percent-encoded: keep it as written */ }
    const hash = passHash(named);
    const link = hash ? deepLink(hash) : null;
    if (!link) { axf.toast(named ? `"${named}" is not a pass.` : 'Say which pass, for example molly.pass:<pass id>.', 'warning', 'Pass'); return; }
    // the same link again changes no hash, so go there directly as well
    if (window.location.hash !== hash) window.location.hash = hash;
    else { axf.navigate(link.app.id); routeFrame(link.app.id, link.src); }
  }, { label: 'Open a veto pass (Approve / Deny)', params: true });
}
