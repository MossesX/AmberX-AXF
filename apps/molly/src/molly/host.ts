import type { ReactNode } from 'react';
import type { ViewMap } from '../axf/react';
import { instanceOfView, instancesOf, nextInstance, normalizeInstances, parseInstance, type ShellInstance } from '../axf/core/engines/molly-shell';
import { mollyApp, MOLLY_APPS, type MollyApp } from './apps';

/**
 * Molly's extension points for its plugins (plugins/<folder>/web, loaded by App.tsx without naming them). Each one is
 * empty by default, and Molly without plugins is exactly what it was: plain frames, one app on screen at a time.
 *   - `frameUrl`: the address an app's frame opens (a host plugin adds the embed@1 marker);
 *   - `onFrame`: told when an instance's frame mounts (its window, for messages) and unmounts;
 *   - `main`: what an app's view shows (default: the instance's frame slot);
 *   - `views`: extra views (an app's own pages as Molly views, `<app>/<item id>`);
 *   - `warm`: apps whose frame opens (hidden) as soon as Molly starts, e.g. the Console, so a remote command always has a
 *     console inside Molly to go to instead of waking a separate tab.
 * One owner per hook: the last plugin to set one wins, and clears only its own.
 */
export interface MollyHostHooks {
  frameUrl: ((app: MollyApp, start: string) => string) | null;
  onFrame: ((instance: string, frame: HTMLIFrameElement | null) => void) | null;
  main: ((instance: string) => ReactNode) | null;
  views: ViewMap;
  warm: string[] | null;
}

const hooks: MollyHostHooks = { frameUrl: null, onFrame: null, main: null, views: {}, warm: null };
const owners = new Map<keyof MollyHostHooks, string>();
const listeners = new Set<() => void>();
let rev = 0;
const changed = () => { rev++; listeners.forEach((f) => f()); };

export const mollyHooks = (): Readonly<MollyHostHooks> => hooks;
export const mollyHooksRev = () => rev;
/** Told when a hook or the open instances change (one revision counter for both). */
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

/* ---------- instances (molly-shell@1): an app open more than once ---------- */

const APP_IDS = MOLLY_APPS.map((a) => a.id);
const INSTANCES_KEY = 'molly.instances';
const readKept = (): string[] => { try { return normalizeInstances(JSON.parse(sessionStorage.getItem(INSTANCES_KEY) ?? '[]'), APP_IDS); } catch { return []; } };
/** The instances open now (`console`, `console#2`…), kept per browser tab so a reload brings the same tabs back. */
let instances: string[] = typeof sessionStorage === 'undefined' ? [] : readKept();
const keep = () => { try { sessionStorage.setItem(INSTANCES_KEY, JSON.stringify(instances)); } catch { /* no storage: the list lives for this page only */ } };

export const openInstances = (): readonly string[] => instances;
export const instanceInfo = (id: string): ShellInstance | null => parseInstance(id);
/** The app of an instance id (`console#2` → Console). */
export const appOfInstance = (id: string | null | undefined): MollyApp | undefined => mollyApp(parseInstance(id)?.app);

/** Open another copy of an app → its instance id (the first copy is the app id), or null past the per-app cap. */
export function openInstance(app: string): string | null {
  const id = nextInstance(instances, app);
  if (!id) return null;
  ensureInstance(id);
  return id;
}

/** Make sure an instance counts as open (a deep link or a kept dock tab named it). */
export function ensureInstance(id: string): void {
  const i = parseInstance(id);
  if (!i || !APP_IDS.includes(i.app) || instances.includes(id)) return;
  instances = normalizeInstances([...instances, id], APP_IDS);
  keep(); changed();
}

/** Close an instance: its frame goes (the app's first copy may close too; it comes back the next time the app opens). */
export function closeInstance(id: string): boolean {
  if (!instances.includes(id)) return false;
  instances = instances.filter((x) => x !== id);
  keep(); changed();
  return true;
}

/** The open copies of an app, lowest number first. */
export const instancesOfApp = (app: string): ShellInstance[] => instancesOf(instances, app);

/** The app a Molly view belongs to: the app's own view (`console`), a copy (`console#2`) or one of its pages (`console/nav:build`). */
export function appOfView(view: string | null | undefined): MollyApp | undefined {
  return mollyApp(instanceOfView(view, APP_IDS)?.app);
}

/** The instance a Molly view belongs to (`console#2/nav:build` → `console#2`), or null on Molly's own pages. */
export function instanceOfMollyView(view: string | null | undefined): string | null {
  return instanceOfView(view, APP_IDS)?.id ?? null;
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
