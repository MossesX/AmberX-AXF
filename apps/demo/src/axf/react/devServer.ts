/*
 * Web hot reload from `axf dev` (framework/cli/dev-server.mjs).
 *
 *   const status = useDevServer(devServerUrl(location.search));   // opt in with ?axfDev=http://<pc-ip>:7070
 *
 * Loads the server's /assets.json once, then long-polls /events?since=<rev>. Every changed asset is fetched and
 * re-registered in place (`registry.register` through `rt.hotReplaceAsset`, then `rt.refreshFromSaved()`), so a
 * theme or layout edit on disk shows in the open page in under a second, with no reload and no lost state.
 * Invalid files never reach the runtime: the server marks them `ok: false` (with `error`) and the page writes a
 * terminal line instead. Android twin: the axf-assets remote source (flag axf.hotReload, setting axf.devServer).
 */
import { useEffect, useState } from 'react';
import { useRuntime } from './AxfProvider';

/** The query parameter a page opts in with: `?axfDev=http://192.168.1.20:7070` (or `?axfDev=1` = same host, 7070). */
export const DEV_SERVER_PARAM = 'axfDev';
export const DEV_SERVER_PORT = 7070;
const CHANNEL = 'axf-dev';

export interface DevServerChange {
  rev?: number;
  type: string;
  id: string;
  action: 'changed' | 'removed' | string;
  ok: boolean;
  /** why the file was not sent (invalid JSON, schema errors) */
  error?: string;
  /** a renamed file: the asset it used to be */
  from?: { type: string; id: string };
}

export interface DevServerStatus {
  url: string | null;
  connected: boolean;
  rev: number;
  applied: number;
  lastError: string | null;
}

/** What the loop needs from the runtime (AxfRuntime has all of it). */
export interface DevServerRuntime {
  hotReplaceAsset(raw: unknown, origin?: string): { ok: boolean; errors?: string[] };
  refreshFromSaved(): unknown;
  terminal?: { ok(c: string, t: string): void; warn(c: string, t: string): void; error(c: string, t: string): void; note(c: string, t: string): void };
}

/** `?axfDev=…` → the dev server's base URL (null when the page did not opt in). */
export function devServerUrl(search: string, here: { protocol: string; hostname: string } = globalThis.location ?? { protocol: 'http:', hostname: 'localhost' }): string | null {
  const v = (new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get(DEV_SERVER_PARAM) ?? '').trim();
  if (!v || v === '0' || v === 'false') return null;
  if (v === '1' || v === 'true') return `${here.protocol}//${here.hostname}:${DEV_SERVER_PORT}`;
  if (/^\d+$/.test(v)) return `${here.protocol}//${here.hostname}:${v}`;
  return (/^https?:\/\//.test(v) ? v : `http://${v}`).replace(/\/+$/, '');
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Applies one /events batch: fetches each valid changed asset and hot-replaces it. Returns how many landed. */
export async function applyDevChanges(rt: DevServerRuntime, base: string, changes: DevServerChange[], fetchFn: Fetch = fetch): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];
  for (const c of changes) {
    const name = `${c.type}/${c.id}`;
    if (!c.ok) { errors.push(`${name}: ${c.error ?? 'invalid'}; kept the last good version`); continue; }
    if (c.action === 'removed') { rt.terminal?.note(CHANNEL, `${name} removed on disk; the loaded copy stays until the next reload`); continue; }
    try {
      const r = await fetchFn(`${base}/assets/${encodeURIComponent(c.type)}/${encodeURIComponent(c.id)}.json`, { cache: 'no-store' });
      if (!r.ok) { errors.push(`${name}: dev server answered ${r.status}`); continue; }
      const res = rt.hotReplaceAsset(await r.json(), CHANNEL);
      if (res.ok) { applied++; rt.terminal?.ok(CHANNEL, `${name} reloaded${c.from ? ` (renamed from ${c.from.type}/${c.from.id})` : ''}`); }
      else errors.push(`${name}: ${(res.errors ?? []).join('; ') || 'not accepted'}`);
    } catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  if (applied) rt.refreshFromSaved();
  for (const e of errors) rt.terminal?.error(CHANNEL, e);
  return { applied, errors };
}

/** Connects a runtime to a dev server (no React). Returns a stop function. */
export function connectDevServer(rt: DevServerRuntime, url: string, onStatus: (s: DevServerStatus) => void = () => undefined, fetchFn: Fetch = (u, i) => fetch(u, i)): () => void {
  const base = url.replace(/\/+$/, '');
  const ctl = new AbortController();
  const status: DevServerStatus = { url: base, connected: false, rev: 0, applied: 0, lastError: null };
  const emit = (patch: Partial<DevServerStatus>) => { Object.assign(status, patch); onStatus({ ...status }); };
  const get = async <T,>(path: string): Promise<T> => {
    const r = await fetchFn(`${base}${path}`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  void (async () => {
    while (!ctl.signal.aborted) {
      try {
        if (!status.connected) {
          // First contact (and after every drop): load the whole set so nothing changed while offline is missed.
          const snap = await get<{ rev: number; assets: unknown[] }>('/assets.json');
          let applied = 0;
          for (const a of snap.assets) if (rt.hotReplaceAsset(a, CHANNEL).ok) applied++;
          rt.refreshFromSaved();
          rt.terminal?.ok(CHANNEL, `connected to ${base} (${snap.assets.length} assets, rev ${snap.rev})`);
          emit({ connected: true, rev: snap.rev, applied: status.applied + applied, lastError: null });
        }
        const ev = await get<{ rev: number; changed: DevServerChange[]; error?: string }>(`/events?since=${status.rev}`);
        const res = await applyDevChanges(rt, base, ev.changed ?? [], fetchFn);
        emit({ rev: ev.rev, applied: status.applied + res.applied, lastError: res.errors[res.errors.length - 1] ?? ev.error ?? status.lastError });
      } catch (e) {
        if (ctl.signal.aborted) break;
        if (status.connected) rt.terminal?.warn(CHANNEL, `lost ${base}; retrying`);
        emit({ connected: false, lastError: (e as Error).message });
        await wait(3000);
      }
    }
  })();
  return () => ctl.abort();
}

/** React: keeps the app hot-reloading from `url` while mounted (null = off). Returns the live status. */
export function useDevServer(url: string | null | undefined): DevServerStatus {
  const rt = useRuntime();
  const [status, setStatus] = useState<DevServerStatus>({ url: url ?? null, connected: false, rev: 0, applied: 0, lastError: null });
  useEffect(() => {
    if (!url) return undefined;
    return connectDevServer(rt as unknown as DevServerRuntime, url, setStatus);
  }, [rt, url]);
  return status;
}
