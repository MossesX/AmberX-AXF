/**
 * axHub apps (console plugin, module axHub): The hub's app catalog inside the console: every app the framework's CI has built, with the latest build, earlier builds, sizes, times and a download link each (the download is the hub's own path, so the hub decides who may), read through the console's hub-pages relay.
 *
 * The pages share the console's hub-pages kit (src/hubPages: the relay client, the sign-in gate, the routes); no
 * axHub plugin imports another's folder, and a page whose plugin isn't installed says so instead of opening.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { go } from '@console/hubPages/route';
import { Apps } from './Apps';
import { appMenu } from './menu';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.axhub-apps',
  label: 'axHub apps',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('axhub-apps.open', () => go(rt, 'apps'), { label: "Open the hub's app catalog" });
  },
  views: {
    'axhub-apps': { title: 'Apps', icon: 'download', keywords: ["apk", "download", "catalog"], render: () => <Apps /> },
  },
  // Its own section right under Home (the nav-menu asset's "Apps" anchor), so the downloads are one tap away on a
  // phone too (Brett, Nov 23 2026: "we need an app catalog, a link in the console, so I can download all the Android apps").
  nav: { label: 'Apps', items: [{ id: 'axhub-apps', label: 'Android apps', icon: 'download', view: 'axhub-apps' }] },
};
