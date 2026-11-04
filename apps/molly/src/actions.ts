import type { AxfRuntime } from './axf/core';
import { mollyApp } from './molly/apps';
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
  // `molly.show:<app>` brings one of Molly's apps on screen (the control surface runs it: `app_action {app: 'molly',
  // action: 'molly.show', args: ['amberx']}`; navigation only, so it needs no write permission).
  on('molly.show', (args, ctx) => {
    const id = String(args[0] ?? ctx.payload ?? '').trim();
    const a = mollyApp(id);
    if (a) axf.navigate(a.id);
    else axf.toast(id ? `Molly has no app "${id}".` : 'Say which app: amberx, axhub or console.', 'info', 'Show app');
  }, { label: 'Show an app', params: true, effect: 'navigate' } as never);
  on('molly.own-tab', () => {
    const a = current();
    if (a) window.open(a.url, '_blank', 'noopener');
    else axf.toast('Open an app first.', 'info', 'Open on its own');
  }, { label: 'Open this app on its own' });
}
