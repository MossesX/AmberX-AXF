/**
 * Orchestrator demo console plugin (ai.amberx.axf.console.orchestrator-demo).
 *
 * A guided live tour of the Build orchestrator on throwaway demo-* builds (demo-run@1): the start overlay (dialog
 * `orchestrator-demo.start`), the live caption bar (slot `app.frame.cover`), the summary (dialog
 * `orchestrator-demo.summary`) and the page with the crossed-off check-list (view `orchestrator-demo`).
 *
 * Reached the same four ways: deep link `?axf-open=orchestrator-demo` (`?axf-open=orchestrator-demo:summary`,
 * `:settings`, `:page`) and console-control `view:orchestrator-demo` / `dialog:orchestrator-demo.start`; REST
 * `/api/plugins/orchestrator-demo/*`; MCP (plugin-commands tools from those routes, console actions `demo.*`); the CLI
 * `axf demo orchestrator …`; AmberX voice (voice.json).
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { DIALOG_START, DIALOG_SUMMARY, FOLDER, VIEW, demo, type DemoState } from './api';
import actionsDoc from '../actions.json';
import voiceDoc from '../voice.json';
import { CaptionBar } from './CaptionBar';
import { DemoView } from './DemoView';
import { appMenu } from './menu';
import { SettingsPanel } from './Settings';
import { StartOverlay } from './StartOverlay';
import { SummaryDialog } from './SummaryDialog';

const ID = 'ai.amberx.axf.console.orchestrator-demo';
export const DEEP_LINK = 'axf-open';
export const SETTINGS_TAB = FOLDER;

/** What `?axf-open=` asks for when it names this plugin: the overlay (default), the summary, the page or the settings. */
export function parseOpen(search: string): 'start' | 'summary' | 'page' | 'settings' | null {
  const v = new URLSearchParams(search).get(DEEP_LINK) ?? '';
  const [who, what = 'start'] = v.split(':');
  if (who !== FOLDER) return null;
  return what === 'summary' || what === 'page' || what === 'settings' ? what : 'start';
}

function openDeepLink(rt: AxfRuntime) {
  const what = parseOpen(globalThis.location?.search ?? '');
  if (!what) return;
  const u = new URL(globalThis.location.href); u.searchParams.delete(DEEP_LINK); globalThis.history?.replaceState(null, '', u.toString());
  // the shell restores its last page while plugins load (late on a cold start or a slow phone): keep the link's
  // screen on top until it has stayed for a few seconds, then leave the person free to move on
  const dialog = what === 'summary' ? DIALOG_SUMMARY : what === 'start' ? DIALOG_START : '';
  const there = () => (dialog ? rt.getState().dialog?.id === dialog : what === 'page' ? rt.getState().view === VIEW : true);
  const open = () => {
    if (what === 'settings') rt.dispatch(`settings.open:${SETTINGS_TAB}`);
    else if (what === 'page') rt.navigate(VIEW);
    else rt.openDialog(dialog);
  };
  if (what === 'settings') { for (const ms of [0, 1200, 3000]) setTimeout(open, ms); return; }
  const until = Date.now() + 25000;
  let stable = 0;
  const keep = setInterval(() => {
    if (there()) { stable += 300; if (stable >= 2500) clearInterval(keep); return; }
    stable = 0;
    if (Date.now() > until) { clearInterval(keep); return; }
    open();
  }, 300);
  open();
}

type Reply = { state?: DemoState | null; settings?: unknown };
type VoiceRegistry = { register(module: string, commands: { id: string; phrases: string[]; action: string; reply?: string; owner?: string }[]): () => void };

/** One line of where the run is, for demo.state and voice. */
export function stateLine(s: DemoState | null | undefined): string {
  const run = s?.run;
  if (!run) return 'No orchestrator demo has run yet.';
  const sum = s.summary;
  const cap = s.caption;
  const where = cap ? `act ${cap.n} of ${cap.of}: ${cap.title}` : run.state;
  return `Demo ${s.held ? 'paused' : run.state}${cap ? `, ${where}` : ''}. ${sum?.pass ?? 0} passed, ${sum?.fail ?? 0} failed, ${sum?.skipped ?? 0} skipped.`;
}

/** The console actions (actions.json): each is one REST call; the answer or the plain refusal goes to a toast. */
function registerActions(rt: AxfRuntime) {
  const calls: Record<string, (args: string[]) => Promise<Reply>> = {
    'demo.start': ([how = '']) => demo.start(how === 'pause' ? true : how === 'no-pause' ? false : undefined),
    'demo.pause': () => demo.pause(),
    'demo.resume': () => demo.resume(),
    'demo.next': () => demo.next(),
    'demo.stop': () => demo.stop(),
    'demo.state': () => demo.state(),
  };
  for (const a of actionsDoc.actions) {
    const call = calls[a.id];
    if (!call) continue;
    rt.actions.register(a.id, (args: string[]) => {
      call(args ?? []).then(
        (r) => { rt.toast(a.id === 'demo.state' ? stateLine(r.state) : a.reply, 'info', 'Orchestrator demo'); if (a.id === 'demo.start') rt.navigate('builds'); },
        (e: Error) => rt.toast(e.message, 'warning', 'Orchestrator demo'),
      );
    }, { label: a.label, params: a.id === 'demo.start' } as never);
  }
}

function registerVoice() {
  const v = (globalThis as { amberxVoice?: VoiceRegistry }).amberxVoice;
  v?.register(ID, voiceDoc.commands.map((c) => ({ id: c.id, phrases: [...c.phrases], action: c.action, owner: voiceDoc.owner, reply: actionsDoc.actions.find((a) => a.id === c.action.split(':')[0])?.reply || undefined })));
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Orchestrator demo',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-17' },
  opens: 'dialog',
  opensUi: `dialog:${DIALOG_START}`,
  appMenu,
  register(rt) {
    rt.actions.register('orchestrator-demo.open', () => rt.openDialog(DIALOG_START), { label: 'Orchestrator demo: open the start overlay' });
    rt.actions.register('orchestrator-demo.summary', () => rt.openDialog(DIALOG_SUMMARY), { label: 'Orchestrator demo: summary' });
    rt.actions.register('orchestrator-demo.page', () => rt.navigate(VIEW), { label: 'Orchestrator demo: the check-list page' });
    registerActions(rt);
    registerVoice();
    openDeepLink(rt);
  },
  views: {
    [VIEW]: { title: 'Orchestrator demo', icon: 'play', keywords: ['orchestrator demo', 'guided demo', 'live demo', 'watch the orchestrator', 'demo builds', 'test'], render: () => <DemoView /> },
  },
  dialogs: {
    [DIALOG_START]: { title: 'Orchestrator demo', icon: 'play', render: (_p, close) => <StartOverlay close={close} /> },
    [DIALOG_SUMMARY]: { title: 'Orchestrator demo: summary', icon: 'list', size: 'wide', render: (_p, close) => <SummaryDialog close={close} /> },
  },
  slots: {
    'app.frame.cover': [{ id: 'orchestrator-demo.caption', order: 96, render: () => <CaptionBar /> }],
  },
  settingsTabs: [{ id: SETTINGS_TAB, label: 'Orchestrator demo', icon: 'play', parent: 'plugins', order: 60, description: 'Guided live demo of the Build orchestrator: default pause between steps, the 30 s minimum gap.' }],
  settingsPanels: [
    { id: 'orchestrator-demo.settings', tab: SETTINGS_TAB, title: 'Orchestrator demo', icon: 'play', order: 10, render: () => <SettingsPanel /> },
    { id: 'orchestrator-demo.lifecycle', tab: SETTINGS_TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
