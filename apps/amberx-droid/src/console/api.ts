/**
 * `@console/api` for AmberX: the slice of the console's client that console plugins running here use. Device-local
 * view state only (readLocal / writeLocal, the console's own key prefix so a plugin finds its keys the same way);
 * every server call a plugin makes goes through `@console/plugins` (AmberX's server forwards it). Generic: it never
 * names a plugin.
 */
const LS = 'axf-console:';
export function readLocal<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(LS + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } }
export function writeLocal(key: string, value: unknown) { try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch { /* storage full or off */ } }
