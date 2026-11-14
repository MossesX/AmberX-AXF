/**
 * Test harness (no console server): a small runtime stand-in with a settings store, so the host and every family
 * run in a plain page. Built by test/run.mjs with esbuild into a page that also loads framework/ui/axf.css.
 * `window.tc` exposes the settings and the live host to the tests.
 */
import { startHost, liveHost } from '../web/host';
import { ELEMENT_FAMILIES, GLOBAL_FAMILIES } from '../web/families';

type Fn = (...a: unknown[]) => void;
const values = new Map<string, unknown>();
const anyListeners = new Set<(k: string, v: unknown) => void>();
const subs = new Set<() => void>();
const toasts: string[] = [];
const rt = {
  settings: {
    get: (k: string) => values.get(k),
    set: (k: string, v: unknown) => { values.set(k, v); for (const l of anyListeners) l(k, v); for (const s of subs) s(); },
    onAnyChange: (fn: (k: string, v: unknown) => void) => { anyListeners.add(fn); return () => anyListeners.delete(fn); },
    subscribe: (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); },
    getTab: (id: string) => (id === 'themed-controls' ? { id } : undefined),
  },
  actions: { register: (_id: string, _fn: Fn) => () => undefined },
  dispatch: () => true,
  toast: (m: string) => { toasts.push(m); },
  terminal: { warn: (...a: unknown[]) => console.warn(...a), log: () => undefined, ok: () => undefined },
};
const stop = startHost(rt as never, { elements: ELEMENT_FAMILIES, globals: GLOBAL_FAMILIES });
(globalThis as Record<string, unknown>).tc = { rt, set: rt.settings.set, host: liveHost, stop, toasts };
