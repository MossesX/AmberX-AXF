import type { AxfRuntime } from './axf/core';
import { mollyApp } from './molly/apps';
import { authSettingKeys, connectionLine, normalizeApiBase } from './molly/credentials';
import { reloadFrame } from './molly/FrameDeck';
import { mollyCredentials } from './molly/host';

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

  registerAuthActions(axf);
}

/** `molly.auth.<x>:<app>[:rest]` → the app and the rest of the arguments joined back (a URL keeps its colons). */
const argsOf = (args: string[], payload?: string): { app: string; rest: string } => {
  const all = args.length ? args : (payload ?? '').split(':');
  return { app: (all[0] ?? '').trim(), rest: all.slice(1).join(':').trim() };
};

/**
 * The credential seam's actions (molly-sign-in-once): every connection readable and every sign-in step callable without
 * a screen. Sign-in with a token takes the token as the argument; a session app answers the page to open.
 */
function registerAuthActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  const title = 'App connections';
  const seam = () => mollyCredentials();
  const need = (app: string) => {
    const p = seam().provider(app);
    if (!p) axf.toast(app ? `Molly doesn't hold an app "${app}".` : 'Say which app: console, axhub, expenses or amberx.', 'warning', title);
    return p;
  };

  on('molly.auth.status', () => {
    const cs = seam().connections();
    axf.toast(cs.map(connectionLine).join('\n'), 'info', title);
    return cs;
  }, { label: 'App connections: status', effect: 'read' });

  on('molly.auth.check', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    const run = app ? (need(app) ? seam().check(app).then((c) => (c ? [c] : [])) : null) : seam().checkAll();
    if (!run) return;
    void run.then((cs) => axf.toast(cs.map(connectionLine).join('\n') || 'Nothing to check.', cs.every((c) => c.state === 'signed-in' || c.state === 'none') ? 'success' : 'warning', title));
  }, { label: 'App connections: check who I am', params: true, effect: 'read' });

  on('molly.auth.sign-in', (args, ctx) => {
    const { app, rest } = argsOf(args, ctx.payload);
    const p = need(app);
    if (!p) return;
    void p.signIn(rest || undefined).then(({ connection, open }) => {
      if (open) { window.open(open, '_blank', 'noopener'); axf.toast(`Sign in to ${connection.label} in the tab that opened, then check again.`, 'info', title); return; }
      axf.toast(connectionLine(connection), connection.state === 'signed-in' ? 'success' : 'warning', title);
    });
  }, { label: 'App connections: sign in (app, token)', params: true, effect: 'write' });

  on('molly.auth.sign-out', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    const p = need(app);
    if (!p) return;
    void p.signOut().then((c) => axf.toast(connectionLine(c), 'info', title));
  }, { label: 'App connections: sign out (app)', params: true, effect: 'write' });

  on('molly.auth.base', (args, ctx) => {
    const { app, rest } = argsOf(args, ctx.payload);
    const p = need(app);
    if (!p) return;
    const key = authSettingKeys(app).base;
    if (!rest) { axf.toast(`${p.connection().label} API: ${p.apiBase()}${p.connection().baseOverridden ? ' (changed from the default)' : ''}`, 'info', title); return p.apiBase(); }
    if (rest === 'default') { axf.settings.clear(key); axf.toast(`${p.connection().label} API is back to ${p.apiBase()}.`, 'info', title); return p.apiBase(); }
    const base = normalizeApiBase(rest);
    if (!base) { axf.toast('An API base is an https address with no query or fragment.', 'danger', title); return; }
    axf.settings.set(key, base);
    axf.toast(`${p.connection().label} API: ${base}. Check the connection again.`, 'info', title);
    return base;
  }, { label: 'App connections: API base (app, url | default)', params: true, effect: 'write' });
}
