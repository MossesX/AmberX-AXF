/**
 * axHub account (console plugin, module axHub): The hub's session and your hub account inside the console: which hub the console belongs to, which session the hub's pages use here (this browser's own or the console's owner sign-in), a tap to each hub page; your name and email, change your password, the browsers signed in as you and signing the others out, through the console's hub-pages relay.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { HubView } from './HubView';
import { HubAccount } from './HubAccount';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-account',
  label: 'axHub account',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-hub.open', () => go(rt, 'hub'), { label: "Open axHub in the console" });
    rt.actions.register('axhub-account.open', () => go(rt, 'account'), { label: "Open your hub account" });
  },
  views: {
    'axhub-hub': { title: 'axHub', icon: 'external', keywords: ["axhub", "session", "sign in", "hub"], render: () => <HubView /> },
    'axhub-account': { title: 'Hub account', icon: 'key', keywords: ["password", "sign out", "browsers"], render: () => <HubAccount /> },
  },
  nav: { label: 'axHub', items: [{ id: 'axhub-hub', label: 'axHub', icon: 'external', view: 'axhub-hub' }, { id: 'axhub-account', label: 'Hub account', icon: 'key', view: 'axhub-account' }] },
};
