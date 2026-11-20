/**
 * axHub handoff (console plugin, module axHub): The hub's Claude handoff results inside the console (admins): every handoff run, one run's live progress with its gauges and step groups, the prompt with a session picker (claude.ai, Claude Code on each platform, copy), and the kit's files to read or download, through the console's hub-pages relay. Not the Claude handoff plugin (Tools → Claude handoff), which builds the kit; this shows what the hub received.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { HandoffList, HandoffRun } from './Handoff';
import './axhub-handoff.css';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-handoff',
  label: 'axHub handoff',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-handoff.open', () => go(rt, 'handoff'), { label: "Open the hub's handoff results" });
  },
  views: {
    'axhub-handoff': { title: 'Handoff', icon: 'package', keywords: ["claude", "handoff", "new account"], render: () => <HandoffList /> },
    'axhub-handoff-run': { title: 'Handoff run', icon: 'package', keywords: ["handoff run"], render: () => <HandoffRun /> },
  },
  nav: { label: 'axHub', items: [{ id: 'axhub-handoff', label: 'Handoff', icon: 'package', view: 'axhub-handoff' }] },
};
