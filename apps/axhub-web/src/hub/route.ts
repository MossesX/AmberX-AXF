/**
 * The address bar ⇄ the shell's view. The hub sends its old pages here as `#/<route>` (see `core.ts`), and every page
 * of this app gets an address you can share, reload or go back to. The framework keeps the view; this keeps the
 * view's parameters (which request, which run, which filter) next to it and writes the hash.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../axf/core';
import { parseRoute, routeHash, type Route } from './core';

let route: Route = typeof location === 'undefined' ? { view: 'home', params: {} } : parseRoute(location.hash);
const listeners = new Set<() => void>();
const set = (r: Route) => { route = r; listeners.forEach((l) => l()); };

/** Opens a view with its parameters (a request id, a filter …). */
export function go(rt: AxfRuntime, view: string, params: Record<string, string> = {}) {
  set({ view, params });
  if (rt.getState().view !== view) rt.navigate(view);
  else write(false);
}

function write(push: boolean) {
  const h = routeHash(route.view, route.params);
  if (location.hash === h) return;
  if (push) history.pushState(null, '', h);
  else history.replaceState(null, '', h);
}

/** The parameters of `view` while it is the open one, `{}` otherwise. */
export function useRouteParams(view: string): Record<string, string> {
  const r = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => route, () => route);
  return r.view === view ? r.params : EMPTY;
}
const EMPTY: Record<string, string> = {};

/** Follows the hash (links from the hub, back/forward) and writes it whenever the view changes. */
export function installRouter(rt: AxfRuntime): () => void {
  const apply = () => {
    const r = parseRoute(location.hash);
    set(r);
    if (rt.getState().view !== r.view) rt.navigate(r.view);
  };
  if (location.hash && location.hash !== '#' && location.hash !== '#/') apply();
  let last = rt.getState().view;
  const off = rt.subscribe(() => {
    const v = rt.getState().view;
    if (v === last) return;
    last = v;
    if (route.view !== v) set({ view: v, params: {} });
    write(true);
  });
  write(false);
  addEventListener('hashchange', apply);
  return () => { off(); removeEventListener('hashchange', apply); };
}
