/**
 * axHub passes (console plugin, module axHub): The hub's passes inside the console: the Go pass (one pass for a whole session: rules, threads, repos) and timed veto passes (what each covers, time left, revoke, the calls that ran under it), through the console's hub-pages relay with a hub session.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { GoPass } from './GoPass';
import { Passes } from './Passes';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-passes',
  label: 'axHub passes',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-passes.open', () => go(rt, 'passes'), { label: "Open the hub's passes" });
    rt.actions.register('axhub-go-pass.open', () => go(rt, 'go-pass'), { label: "Open the Go pass" });
  },
  views: {
    'axhub-go-pass': { title: 'Go pass', icon: 'check', keywords: ["go", "pass", "session", "rules", "threads"], render: () => <GoPass /> },
    'axhub-passes': { title: 'Passes', icon: 'clock', keywords: ["pass", "veto", "allow", "timer"], render: () => <Passes /> },
  },
  nav: { label: 'axHub', items: [{ id: 'axhub-go-pass', label: 'Go pass', icon: 'check', view: 'axhub-go-pass' }, { id: 'axhub-passes', label: 'Passes', icon: 'clock', view: 'axhub-passes' }] },
};
