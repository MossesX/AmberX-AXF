/**
 * The Hub screens' data layer: one read per screen through the plugin's server (hub-console@1 `state` / `rows.read`),
 * polled while the page is visible, and the actions (`POST <screen>[/<row>]/<action>`). A read that could not be
 * served comes back as an `Unavailable` state with the server's code and words (signed_out, forbidden, old_hub,
 * hub_unavailable, hub_missing, relay_off), never as an exception the screen has to guess at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginFetch } from '@console/plugins';
import { FOLDER } from './ids';

export interface Unavailable { ok: false; code: string; message: string; proposed?: string; via?: string; screen?: string }
export type Read<T> = ({ ok: true; hub: string; screen: string; shape: string; via?: string } & T) | Unavailable;

export const UNAVAILABLE_WORDS: Record<string, string> = {
  signed_out: 'Sign in to axHub in this browser (or set the console’s owner sign-in) to see this.',
  forbidden: 'This hub account is not an admin.',
  old_hub: 'This hub has not got its JSON pages yet. Update axHub; its own pages still work meanwhile.',
  hub_unavailable: 'axHub did not answer. The console tried three times.',
  hub_missing: 'axHub has no route for this yet.',
  relay_off: 'The approvals-banner plugin (the relay that holds the hub session) is off.',
  hub_error: 'axHub refused the read.',
};

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** One read: `GET <screen>[/<row>]?params`. A transport failure is an `Unavailable` too (code hub_unavailable). */
export async function readScreen<T>(screen: string, params: Record<string, string | number | undefined> = {}, row?: string): Promise<Read<T>> {
  try {
    const r = await pluginFetch(FOLDER, `${screen}${row ? `/${encodeURIComponent(row)}` : ''}${query(params)}`);
    const j = (await r.json().catch(() => null)) as Read<T> | { detail?: string } | null;
    if (!r.ok) return { ok: false, code: r.status === 404 ? 'not_found' : r.status === 401 ? 'console_token' : 'hub_error', message: (j as { detail?: string } | null)?.detail ?? `The console answered ${r.status}.` };
    if (!j || typeof j !== 'object' || !('ok' in j)) return { ok: false, code: 'hub_error', message: 'The console sent something unexpected.' };
    return j as Read<T>;
  } catch (e) {
    return { ok: false, code: 'hub_unavailable', message: `Could not reach the console (${(e as Error).message}).` };
  }
}

/** One action: `POST <screen>[/<row>]/<action>` with a JSON body; → the server's answer ({ ok, message, code?, … }). */
export async function runAction(screen: string, action: string, body: Record<string, unknown> = {}, row?: string, method: 'POST' | 'DELETE' = 'POST'): Promise<{ ok: boolean; message: string; code?: string; state?: string; [k: string]: unknown }> {
  try {
    const path = method === 'DELETE' && row ? `${screen}/${encodeURIComponent(row)}` : `${screen}${row ? `/${encodeURIComponent(row)}` : ''}/${action}`;
    const r = await pluginFetch(FOLDER, path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string; detail?: string; code?: string; state?: string } | null;
    return { ...(j ?? {}), ok: r.ok && j?.ok === true, message: j?.message ?? j?.detail ?? (r.ok ? '' : `The console answered ${r.status}.`) };
  } catch (e) {
    return { ok: false, code: 'unreachable', message: `Could not reach the console (${(e as Error).message}).` };
  }
}

/**
 * A screen read, polled while the tab is visible (`everyMs`, re-read on focus and on `reload`). Keeps the last good
 * answer while a refresh fails (`stale` says so), so a blip never blanks a screen.
 */
export function useHubRead<T>(screen: string, params: Record<string, string | number | undefined>, everyMs: number, row?: string) {
  const [data, setData] = useState<Read<T> | null>(null);
  const [stale, setStale] = useState<Unavailable | null>(null);
  const [reading, setReading] = useState(false);
  const key = JSON.stringify([screen, row ?? '', params]);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setReading(true);
    const r = await readScreen<T>(screen, params, row);
    if (n !== seq.current) return;
    setReading(false);
    if (r.ok) { setData(r); setStale(null); }
    else setData((prev) => { if (prev && prev.ok) { setStale(r); return prev; } setStale(null); return r; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setData(null);
    void reload();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, Math.max(1000, everyMs));
    const back = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); };
  }, [reload, everyMs]);
  return { data, stale, reading, reload };
}

/** Relative time in plain words ("12 s ago", "in 3 min"). */
export function relTime(iso: string | number | undefined, now: number = Date.now()): string {
  if (iso === undefined || iso === '') return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const words = abs < 60 ? `${abs} s` : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 86400 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} d`;
  return s < 0 ? `${words} ago` : `in ${words}`;
}

export const when = (iso: string | number | undefined): string => {
  if (iso === undefined || iso === '') return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : String(iso);
};
