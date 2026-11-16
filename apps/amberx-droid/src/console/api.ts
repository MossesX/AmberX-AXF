/**
 * `@console/api` for AmberX: the slice of the Dev Console's api module that console plugins running here use.
 * Token parts: the page holds no console token (AmberX's server adds it when it forwards a plugin call), so the store is
 * always empty and a request goes out with the hub session alone. Device-local view state (readLocal / writeLocal, the
 * console's own key prefix so a plugin finds its keys the same way); every server call a plugin makes goes through
 * `@console/plugins` (AmberX's server forwards it). Generic: it never names a plugin.
 */
import type { TokenStore } from '../axf/libs/apiclient';

/** No token in the page: AmberX's server adds the console token. */
export const consoleTokens: TokenStore = { key: '', event: 'amberx:console-token', get: () => '', set: () => {}, clear: () => {}, subscribe: () => () => {} };
export const getToken = () => consoleTokens.get();
export const setToken = (t: string) => consoleTokens.set(t);

const LS = 'axf-console:';
export function readLocal<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(LS + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } }
export function writeLocal(key: string, value: unknown) { try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch { /* storage full or off */ } }
