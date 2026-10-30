/**
 * The AmberX Terminal for held commands (veto@1): one tab per held call with its countdown, Deny / Approve / Shelve and
 * the output when the hub runs it. Since Oct 30 2026 (Brett: "the veto notices, Deny screen and alarm belong to the
 * veto banner plugin") the notices, the veto screen and the alarm come from the console's approvals banner plugin,
 * which AmberX loads too (its `targets`); this plugin keeps the Terminal view and plugs the phone's deciding path into
 * lib-approvals (the assistant title bar badge).
 *
 * Removable: everything is in this folder. Uninstall: `node framework/cli/plugin-catalog.mjs app-uninstall amberx approvals`.
 */
import { type AxfWebLibrary } from '../../../axf/react';
import { native } from '../../../native';
import { checkVeto, startVeto, setVetoHooks } from './store';
import { decideFromPhone, setRuntime } from './deny';
import { setApprovalsHost } from '../../../axf/libs/approvals/react';
import { HUB } from '../../../hub/useHub';
import { showTab, TerminalView } from './terminal';

const ID = 'ai.amberx.amberx.approvals';
export const OPEN_TERMINAL = 'amberx.approvals.openTerminal';

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Terminal (held commands)',
  version: '0.2.0',
  builtWith: { model: 'opus', builtAt: '2026-10-30' },
  provides: ['amberx.terminal'],
  views: { terminal: { title: 'Terminal', icon: 'terminal', keywords: ['terminal', 'held', 'veto', 'deny', 'approve', 'shelve', 'countdown', 'command', 'output'], render: () => <TerminalView /> } },
  nav: { label: 'Terminal', items: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', view: 'terminal' }] },
  settingsTabs: [{ id: 'approvals', label: 'Terminal', icon: 'terminal', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.approvals.terminal', label: 'Terminal', icon: 'terminal', tab: 'approvals', order: 2,
      description: 'Notices, the alarm and Deny / Approve / Shelve are in Settings → Plugins → Approvals banner.',
      settings: [
        { key: OPEN_TERMINAL, label: 'Open a terminal tab when a timer starts', kind: 'toggle', default: false, description: 'The tab shows the command, the countdown, Deny / Approve / Shelve, then the output when it runs.' },
      ],
    },
  ],
  register(rt) {
    setRuntime(rt);
    startVeto();
    // lib-approvals (assistant title bars): this app's hub, no framing (the hub frames only the console), and the
    // phone's deciding path. Removing this plugin leaves the badge on its defaults (hub pages open in the hub view).
    setApprovalsHost({ hub: HUB, frame: false, decide: decideFromPhone, open: (url) => void native.hubOpen({ url }).catch(() => undefined) });
    setVetoHooks({
      started: (t) => { if (rt.settings.get(OPEN_TERMINAL) === true) rt.dispatch(`approvals.terminal:${t.call.id}`); },
    });
    // approvals.terminal[:<id>] — the Terminal view, with that held command's tab in front
    rt.actions.register('approvals.terminal', ([id]) => { showTab(id ?? null); rt.navigate('terminal'); }, { label: 'Open the terminal', params: true });
    rt.actions.register('approvals.terminal.check', () => void checkVeto(), { label: 'Check held commands (terminal)', searchable: false });
  },
};
