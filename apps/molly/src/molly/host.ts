import type { ReactNode } from 'react';
import type { ViewMap } from '../axf/react';
import { mollyApp, type MollyApp } from './apps';

/**
 * Molly's extension points for its plugins (plugins/<folder>/web, loaded by App.tsx without naming them). Each one is
 * empty by default, and Molly without plugins shows one app screen at a time, mounted natively (molly/native.tsx).
 *   - `main`: what an app's view (`console`) or one of its screens (`console/plan`) shows (default: the screen alone);
 *   - `views`: extra views.
 * One owner per hook: the last plugin to set one wins, and clears only its own. (The frame hooks went with Molly's
 * frames, molly-one-shell s11: every app mounts natively.)
 */
export interface MollyHostHooks {
  main: ((app: string) => ReactNode) | null;
  views: ViewMap;
}

const hooks: MollyHostHooks = { main: null, views: {} };
const owners = new Map<keyof MollyHostHooks, string>();
const listeners = new Set<() => void>();
let rev = 0;
const changed = () => { rev++; listeners.forEach((f) => f()); };

export const mollyHooks = (): Readonly<MollyHostHooks> => hooks;
export const mollyHooksRev = () => rev;
export function onMollyHooks(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Set one hook for `owner` (a plugin id). */
export function setMollyHook<K extends keyof MollyHostHooks>(owner: string, key: K, value: MollyHostHooks[K]): void {
  hooks[key] = value; owners.set(key, owner); changed();
}

/** Clear every hook `owner` set (its plugin was switched off). */
export function clearMollyHooks(owner: string): void {
  let any = false;
  for (const [k, o] of owners) {
    if (o !== owner) continue;
    owners.delete(k); any = true;
    if (k === 'views') hooks.views = {}; else (hooks as unknown as Record<string, unknown>)[k] = null;
  }
  if (any) changed();
}

/** The app a Molly view belongs to: the app's own view (`console`) or one of its pages (`console/nav:build`). */
export function appOfView(view: string | null | undefined): MollyApp | undefined {
  if (!view) return undefined;
  return mollyApp(view.split('/')[0]);
}

/**
 * Capability services between Molly's plugins (the web side of plugin_services: a plugin provides one by name, others
 * look it up when they need it and get null when it isn't there), so either side can be removed, e.g.
 * `axf.toolbar-designer@1`. Never by folder name.
 */
const services = new Map<string, { owner: string; impl: unknown }>();
export function provideMollyService(owner: string, name: string, impl: unknown): () => void {
  services.set(name, { owner, impl });
  return () => { if (services.get(name)?.impl === impl) services.delete(name); };
}
export function mollyService<T>(name: string): T | null { return (services.get(name)?.impl as T | undefined) ?? null; }
