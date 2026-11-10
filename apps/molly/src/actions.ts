import type { AxfRuntime } from './axf/core';
import { instanceTitle, parseInstance, shellState, type MollyShellState } from './axf/core/engines/molly-shell';
import { MOLLY_APPS, mollyApp } from './molly/apps';
import { reloadFrame } from './molly/FrameDeck';
import { appOfView, closeInstance, instanceOfMollyView, instancesOfApp, openInstance, openInstances } from './molly/host';

/**
 * Molly's actions, called by id from its menu, toolbar and nav assets, and by every remote caller (the console API, MCP,
 * CLI and voice reach them through the console inside Molly: molly-shell@1 host catalog, plugins/control).
 *   molly.reload · molly.own-tab · molly.switch:<app> · molly.new-tab[:<app>] · molly.close-tab[:<instance>] ·
 *   molly.next-tab · molly.state
 */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  const current = () => appOfView(axf.getState().view);
  const currentInstance = () => instanceOfMollyView(axf.getState().view);

  on('molly.reload', () => {
    const id = currentInstance();
    if (id) reloadFrame(id);
    else axf.toast('Open an app first.', 'info', 'Reload');
  }, { label: 'Reload this app' });
  on('molly.own-tab', () => {
    const a = current();
    if (a) window.open(a.url, '_blank', 'noopener');
    else axf.toast('Open an app first.', 'info', 'Open on its own');
  }, { label: 'Open this app on its own' });
  on('molly.switch', (args) => {
    const a = mollyApp(args[0]);
    if (!a) { axf.toast(`No app called ${args[0] ?? '(none)'}. Apps: ${MOLLY_APPS.map((x) => x.id).join(', ')}.`, 'warning', 'Switch app'); return; }
    axf.navigate(a.id);
  }, { label: 'Switch to an app', params: true, effect: 'navigate' });
  on('molly.new-tab', (args) => {
    const a = mollyApp(args[0]) ?? current() ?? mollyApp('console')!;
    const id = openInstance(a.id);
    if (!id) { axf.toast(`${a.label} is open as many times as it can be.`, 'warning', 'New tab'); return; }
    axf.navigate(id);
    const n = parseInstance(id)?.n ?? 1;
    if (n > 1) axf.toast(`${instanceTitle(a.label, n)} opened.`, 'info', 'New tab');
  }, { label: 'New tab (another copy of an app)', params: true, effect: 'navigate' });
  on('molly.close-tab', (args) => {
    const id = args[0] || currentInstance();
    if (!id) { axf.toast('Open an app first.', 'info', 'Close tab'); return; }
    const i = parseInstance(id); const a = mollyApp(i?.app);
    if (!i || !a || !closeInstance(id)) { axf.toast(`${id} isn't open.`, 'info', 'Close tab'); return; }
    // what is left of that app: its other copies, else Molly's start page
    const left = instancesOfApp(a.id)[0]?.id;
    if (currentInstance() === id) axf.navigate(left ?? 'home');
    axf.toast(`${instanceTitle(a.label, i.n)} closed.`, 'info', 'Close tab');
  }, { label: 'Close this tab', params: true });
  on('molly.next-tab', () => {
    const open = openInstances();
    if (!open.length) { axf.toast('Nothing is open.', 'info', 'Next tab'); return; }
    const at = open.indexOf(currentInstance() ?? '');
    axf.navigate(open[(at + 1) % open.length]!);
  }, { label: 'Next tab', effect: 'navigate' });
  on('molly.state', () => {
    const s = mollyState(axf);
    axf.toast(`${s.instances.length} open: ${s.instances.map((i) => instanceTitle(mollyApp(i.app)?.label ?? i.app, i.n) + (i.on ? ' (on screen)' : '')).join(', ') || 'none'}. IDE mode ${s.ide.on ? 'on' : 'off'}.`, 'info', 'Molly');
  }, { label: 'What Molly shows now', effect: 'read' });
}

/** The readable snapshot of the shell (molly-shell@1): the plugins/control plugin hands it to remote callers. */
export function mollyState(axf: AxfRuntime, extra: { connected?: readonly string[]; pages?: Record<string, string> } = {}): MollyShellState {
  const on = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLIFrameElement>('iframe.molly-frame[data-on="true"]')].map((f) => f.dataset.instance ?? '').filter(Boolean);
  const saved = axf.settings.savedValues();
  return shellState({
    view: axf.getState().view,
    apps: MOLLY_APPS.map((a) => a.id),
    instances: openInstances(),
    on,
    pages: extra.pages,
    ide: { on: saved['xlayout.ide.on'] === true, preset: saved['xlayout.ide.preset'], paneLimit: saved['xlayout.ide.paneLimit'] },
    connected: extra.connected,
  });
}
