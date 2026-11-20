/**
 * axHub users (console plugin, module axHub): The hub's users inside the console (admins): every hub account with its role, permissions, password state and sign-in, add, edit, disable and remove accounts, through the console's hub-pages relay with a hub session.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { Users } from './Users';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-users',
  label: 'axHub users',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-users.open', () => go(rt, 'users'), { label: "Open the hub's users" });
  },
  views: {
    'axhub-users': { title: 'Users', icon: 'user', keywords: ["accounts", "permissions", "roles"], render: () => <Users /> },
  },
  nav: { label: 'axHub', items: [{ id: 'axhub-users', label: 'Users', icon: 'user', view: 'axhub-users' }] },
};
