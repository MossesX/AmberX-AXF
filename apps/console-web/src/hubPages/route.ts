/**
 * Which hub page is open, with its parameters (which request, which run, which filter), for the console's axHub plugins
 * (hub-pages@1). The pages call `go(rt, '<page>', params)` with the old axHub web app's page names (home, approval,
 * approvals-log, go-pass, passes, apps, users, handoff, handoff-run, account, hub); each is the console view
 * `axhub-<page>` (home = `axhub-approvals`), registered by the plugin that has it. A page whose plugin isn't installed
 * says so in a toast instead of opening an empty screen.
 *
 * Old links: the axHub web app took `#/<route>` addresses (`#/approvals/<id>`, `#/handoff/<run>` …). `followHubHash`
 * reads one on load, opens the same console page and clears the hash, so a link from before the fold still lands.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../axf/core';
import { pluginProviding } from '../plugins';
import { parseRoute, type Route } from './core';

/** The page names the hub's pages use → console view ids. */
export const consoleView = (page: string): string => `axhub-${page === 'home' ? 'approvals' : page}`;
/** The console view id → the page name (`axhub-approvals` → home); '' for any other view. */
export const pageOf = (view: string): string => (view === 'axhub-approvals' ? 'home' : view.startsWith('axhub-') ? view.slice(6) : '');

const PAGE_LABEL: Record<string, string> = {
  home: 'axHub approvals', approval: 'axHub approvals', 'approvals-log': 'axHub approvals', 'go-pass': 'axHub passes', passes: 'axHub passes',
  apps: 'axHub apps', users: 'axHub users', handoff: 'axHub handoff', 'handoff-run': 'axHub handoff', account: 'axHub account', hub: 'axHub account',
};

let route: Route = { view: 'home', params: {} };
const listeners = new Set<() => void>();
const set = (r: Route) => { route = r; listeners.forEach((l) => l()); };

/** Is the console view for this page there (a plugin providing `view:<id>` is installed)? */
const has = (view: string): boolean => pluginProviding(`view:${view}`) !== null;

/** Opens a hub page with its parameters (a request id, a filter …). */
export function go(rt: AxfRuntime, page: string, params: Record<string, string> = {}) {
  const view = consoleView(page);
  if (!has(view)) {
    rt.toast(`That page comes with the ${PAGE_LABEL[page] ?? 'axHub'} plugin, which isn't installed. Settings → Plugins → Plugin Manager installs it.`, 'warning', 'axHub');
    return;
  }
  set({ view: page, params });
  if (rt.getState().view !== view) rt.navigate(view);
}

/** The parameters of `page` while it is the open one, `{}` otherwise. */
export function useRouteParams(page: string): Record<string, string> {
  const r = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => route, () => route);
  return r.view === page ? r.params : EMPTY;
}
const EMPTY: Record<string, string> = {};

/** Hub routes the old axHub web app answered (`#/approvals…`, `#/handoff…`, `#/account` …). */
const HUB_HASH = /^#\/(approvals|handoff|account|users|apps|passes|go-pass|hub)(\/|\?|$)/;

let followed = false;
/** Once per page load: a hub `#/<route>` address opens the same console page (only routes the hub used). */
export function followHubHash(rt: AxfRuntime): void {
  if (followed || typeof location === 'undefined') return;
  followed = true;
  if (!HUB_HASH.test(location.hash)) return;
  const r = parseRoute(location.hash);
  history.replaceState(history.state, '', location.pathname + location.search);
  go(rt, r.view, r.params);
}

/** Keeps the parameters in step when the console opens a hub page some other way (nav, search, back). */
export function installRouteSync(rt: AxfRuntime): () => void {
  let last = rt.getState().view;
  return rt.subscribe(() => {
    const v = rt.getState().view;
    if (v === last) return;
    last = v;
    const page = pageOf(v);
    if (page && route.view !== page) set({ view: page, params: {} });
  });
}
