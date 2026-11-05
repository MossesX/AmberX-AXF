/**
 * Session sync console plugin (ai.amberx.axf.console.session-sync, handoff@1 + session-link@1, spec/HANDOFF.md).
 * Two Claude sessions on one project, side by side: the Sessions panel (Builds → Sessions), the join dialog, Sync
 * session, the Sessions chip, one helper-status widget per helper (banner / toolbar / any window title bar through
 * "Add widgets…"), Send to helper on every build and step (right-click, long-press, multi-select), helper badges
 * everywhere (assignment directory), "Managed by orchestrator" on a helper's console, live push. Zero tokens.
 */
import { useEffect } from 'react';
import { useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { JoinDialog, JoinWatcher, PairDialog, SendDialog, SessionsPage, SettingsPanel, WidgetsDialog } from './ui';
import { DIALOG_JOIN, DIALOG_PAIR, DIALOG_SEND, DIALOG_WIDGETS, FOLDER, ID, VIEW, actions, isSecondary, startLive } from './core';
import { appMenu } from './menu';
import './session-sync.css';

function Live() {
  const rt = useRuntime();
  useEffect(() => startLive(rt), [rt]);
  // a pairing link: open its page and take the code out of the address bar and history straight away
  useEffect(() => { const m = /[?&]pair=([\w-]+)/.exec(window.location.hash); if (!m) return; window.history.replaceState(null, '', window.location.pathname + window.location.search); rt.openDialog(DIALOG_PAIR, { code: m[1] }); }, [rt]);
  return <JoinWatcher />;
}
const buildOf = (payload: string) => payload.split('.')[0] ?? '';
const stepOf = (payload: string) => payload.split('.').slice(1).join('.');

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Session sync',
  version: '0.1.0',
  register(rt) {
    rt.actions.register('session-sync.open', () => rt.navigate(VIEW), { label: 'Open the Sessions panel' });
    rt.actions.register('session-sync.sync', () => void actions.sync(), { label: 'Sync session: write the sync file' });
    rt.actions.register('session-sync.join', () => rt.openDialog(DIALOG_JOIN, {}), { label: "What's going on? (join dialog)" });
    rt.actions.register('session-sync.request-work', () => void actions.requestWork(60, [], ''), { label: 'Request work from the orchestrator' });
    rt.actions.register('session-sync.widgets', ([host = 'banner']) => rt.openDialog(DIALOG_WIDGETS, { host: host.startsWith('window:') || host === 'toolbar' ? host : host ? `window:${host}` : 'banner' }), { label: 'Add widgets…', params: true, searchable: true });
    rt.actions.register('session-sync.send', ([payload = '']) => { if (isSecondary()) { rt.toast("Secondary sessions can't send work; the orchestrator hands it to you.", 'warning', 'Session sync'); return; } const p = String(payload); const b = buildOf(p); const s = stepOf(p); rt.openDialog(DIALOG_SEND, { build: b, steps: s ? [s] : [] }); }, { label: 'Send to helper', params: true, searchable: false });
    rt.actions.register('session-sync.send-step', ([payload = '', how = 'new']) => { if (isSecondary()) return; const p = String(payload); const b = buildOf(p); const s = stepOf(p); if (!b) return; rt.openDialog(DIALOG_SEND, { build: b, steps: how === 'with' ? [] : s ? [s] : [], withCurrent: how === 'with' }); }, { label: 'Send step to helper', params: true, searchable: false });
    // generic handover actions other lists dispatch without naming this plugin (`handover.send:<build>:<s1,s2>`)
    rt.actions.register('handover.send', ([build = '', steps = '']) => { if (isSecondary()) { rt.toast("Secondary sessions can't send work; the orchestrator hands it to you.", 'warning', 'Session sync'); return; } rt.openDialog(DIALOG_SEND, { build: String(build), steps: String(steps).split(',').map((x) => x.trim()).filter(Boolean) }); }, { label: 'Send to helper (build, steps)', params: true, searchable: false });
    rt.actions.register('handover.take-back', ([build = '']) => { if (!isSecondary()) { rt.navigate(VIEW); rt.toast(`Take ${String(build)} back from the Sessions panel.`, 'info', 'Session sync'); } }, { label: 'Take back from helper', params: true, searchable: false });
    rt.actions.register('session-sync.take-back', ([payload = '']) => { if (isSecondary()) return; rt.navigate(VIEW); rt.toast(`Take ${buildOf(String(payload))} back from the Sessions panel (Offers and assigned work).`, 'info', 'Session sync'); }, { label: "Remove from helper's queue / take back", params: true, searchable: false });
  },
  appMenu,
  views: { 'session-sync': { title: 'Sessions', icon: 'users', keywords: ['sessions', 'sync', 'handoff', 'helper', 'claims', 'pairing'], render: () => <SessionsPage /> } },
  nav: { label: 'Builds', items: [{ id: 'session-sync', label: 'Sessions', icon: 'users', view: 'session-sync' }] },
  dialogs: {
    [DIALOG_JOIN]: { title: "What's going on?", icon: 'log-in', searchable: true, render: (_p, close) => <JoinDialog close={close} /> },
    [DIALOG_SEND]: { title: 'Send to helper', icon: 'send', searchable: false, render: (props, close) => <SendDialog props={props} close={close} /> },
    [DIALOG_PAIR]: { title: 'Connect a helper account', icon: 'lock', searchable: false, render: (props, close) => <PairDialog props={props} close={close} /> },
    [DIALOG_WIDGETS]: { title: 'Add widgets…', icon: 'layout', searchable: true, render: (props, close) => <WidgetsDialog props={props} close={close} /> },
  },
  slots: {
    'app.frame.cover': [{ id: 'session-sync.live', order: 97, render: () => <Live /> }],
  },
  contextMenu: [
    // every build reference, everywhere (orchestrator cards, pending items, ref links, helper badges, chat lines): Send to helper / take back
    ...['axf-build', 'axf-orchestrator-build', 'axf-pending-item'].map((target) => ({ id: `session-sync.${target}`, target, order: 40, items: [
      { id: 'session-sync.send', label: 'Send to helper', icon: 'send', action: 'session-sync.send:{payload}' },
      { id: 'session-sync.take-back', label: "Remove from helper's queue / take back", icon: 'rotate-ccw', action: 'session-sync.take-back:{payload}' },
    ] })),
    { id: 'session-sync.axf-step', target: 'axf-step', order: 40, items: [
      { id: 'session-sync.step-new', label: 'Send to helper as a new build', icon: 'send', action: 'session-sync.send-step:{payload}:new' },
      { id: 'session-sync.step-with', label: 'Send to helper with its current build', icon: 'send', action: 'session-sync.send-step:{payload}:with' },
      { id: 'session-sync.step-take-back', label: 'Take back from helper', icon: 'rotate-ccw', action: 'session-sync.take-back:{payload}' },
    ] },
    { id: 'session-sync.axf-ref', target: 'axf-ref', order: 40, items: [{ id: 'session-sync.send-ref', label: 'Send to helper', icon: 'send', action: 'session-sync.send:{payload}' }] },
    { id: 'session-sync.window-title', target: 'window-title', order: 60, items: [{ id: 'session-sync.widgets', label: 'Add widgets…', icon: 'layout', action: 'session-sync.widgets:{payload}' }] },
    { id: 'session-sync.default', target: 'default', order: 62, items: [{ id: 'session-sync.open', label: 'Sessions (side by side)', icon: 'users', action: 'session-sync.open' }, { id: 'session-sync.sync', label: 'Sync session', icon: 'refresh', action: 'session-sync.sync' }] },
  ],
  settingsTabs: [{ id: FOLDER, label: 'Session sync', icon: 'users', order: 32, parent: 'plugins', description: 'Two Claude sessions side by side: claims, helper widget, Send to helper, the /sync command and hook.' }],
  settingsPanels: [{ id: 'session-sync.settings', tab: FOLDER, title: 'Session sync', icon: 'users', order: 10, render: () => <SettingsPanel /> }],
};
