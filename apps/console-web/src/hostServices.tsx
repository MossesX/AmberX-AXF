/**
 * Host services in the console (host-service@1, framework/spec/HOST-SERVICES.md): one shared poll of
 * /api/host-services, and HostServiceGate, the "Host service down" state every moved plugin's own UI shows.
 *
 *   import { HostServiceGate, useHostServices, hostServicesApi } from '@console/hostServices';
 *   <HostServiceGate service="agent-swarm">…the plugin's screen…</HostServiceGate>
 *
 * The gate renders its children while the service is up, or while it is in `container` mode (the console still runs
 * that part). When the service runs on the host and is down, or the host API cannot be reached, it shows a clear note
 * above the screen: what is down, since when, what that stops, and Restart / Open Host services buttons. It never
 * hides the screen (reads still work from the shared data); `block` hides it for screens that only drive the host.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Note, useRuntime } from '@console/axf/react';
import { consoleTokens } from './api';
import './hostServices.css';

export type HostStatus = 'up' | 'degraded' | 'down' | 'unknown';
export interface HostServiceState {
  id: string; unit?: string; kind?: 'tick' | 'daemon'; plugin?: string; status: HostStatus; since?: string; at?: string; reason?: string; code?: string;
  unitState?: string; timerState?: string; mode?: 'container' | 'shadow' | 'host'; reachable?: boolean; pid?: number; restarts?: number;
  health?: { ok: boolean; at: string; message?: string; latencyMs?: number } | null;
  lastRun?: { at: string; result: string; durationMs?: number; message?: string } | null;
  heartbeat?: { at: string; pid?: number; mode?: string } | null;
  manifest?: { title?: string; description?: string; actions?: { id: string; title: string; description?: string; confirm?: boolean; modes?: string[]; args?: Record<string, { type: string; values?: string[] }> }[]; settings?: Record<string, { type: string; default: unknown; title?: string; values?: string[]; min?: number; max?: number }> } | null;
}
export interface HostError { $axf?: string; code: string; message: string; service?: string; action?: string }
export interface HostList { services: HostServiceState[]; down?: HostError; downSince?: string; hostApi?: { up: boolean; downSince?: number | null; endpoint?: string }; counts?: Record<string, number> }

const POLL_MS = 10_000;

/** Calls /api/host-services/<path>; a non-2xx answer throws its host-error@1 frame (code, message). */
export async function hostServicesApi<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = new Headers({ accept: 'application/json' });
  const tok = consoleTokens.get();
  if (tok) headers.set('authorization', `Bearer ${tok}`);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const r = await fetch(`/api/host-services${path ? `/${path.replace(/^\/+/, '')}` : ''}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const f = (body && typeof body === 'object' ? ((body as { code?: string }).code ? body : (body as { detail?: unknown }).detail) : null) as HostError | null;
    throw Object.assign(new Error(f?.message || `host services answered ${r.status}`), { code: f?.code || (r.status === 503 ? 'host_service_down' : 'internal'), status: r.status, frame: f });
  }
  return body as T;
}

/* ---------------- one shared poll ---------------- */

let snap: { list: HostList | null; error: string; at: number } = { list: null, error: '', at: 0 };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
export async function refreshHostServices(fresh = false): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try { snap = { list: await hostServicesApi<HostList>(fresh ? '?fresh=true' : ''), error: '', at: Date.now() }; } catch (e) { snap = { ...snap, error: (e as Error).message, at: Date.now() }; } finally { inFlight = false; }
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void refreshHostServices(); timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshHostServices(); }, POLL_MS); }
  return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const getSnap = () => snap;
export function useHostServices() { return useSyncExternalStore(subscribe, getSnap); }

export const STATUS_TONE: Record<HostStatus, 'success' | 'warning' | 'danger' | undefined> = { up: 'success', degraded: 'warning', down: 'danger', unknown: 'danger' };
export function since(iso?: string): string {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}
/** A service is "down" for its plugin's UI when it runs on the host (shadow / host) and is down, or the host API is unreachable. */
export function isDown(s: HostServiceState | undefined, list: HostList | null): boolean {
  if (!s) return !!list?.down;
  if (s.reachable === false || s.status === 'unknown') return true;
  return s.mode !== 'container' && s.status === 'down';
}

export function HostStatusChip({ s }: { s: HostServiceState }) {
  const label = s.mode === 'container' && s.status === 'down' ? 'in console' : s.status;
  return <span title={s.reason || label} data-host-status={s.status}><Chip tone={s.mode === 'container' && s.status === 'down' ? undefined : STATUS_TONE[s.status]}>{label}</Chip></span>;
}

/**
 * The "Host service down" state for a moved plugin's own UI. `service` is the host service id (manifest id).
 * Renders `children` as they are, with a note above them while the service is down.
 */
export function HostServiceGate({ service, children, block = false, what }: { service: string; children?: ReactNode; block?: boolean; what?: string }) {
  const { list } = useHostServices();
  const rt = useRuntime();
  const s = list?.services.find((x) => x.id === service);
  if (!isDown(s, list)) return <>{children}</>;
  const hostApiDown = !!list?.down || s?.reachable === false;
  const title = s?.manifest?.title || service;
  const when = hostApiDown ? (list?.downSince ? since(list.downSince) : '') : since(s?.since);
  const restart = async () => {
    try { await hostServicesApi(`${encodeURIComponent(service)}/unit/restart`, { method: 'POST', body: { confirm: true } }); } catch { /* the note keeps showing; the poll says why */ }
    void refreshHostServices(true);
  };
  return (
    <div className="axf-host-gate fx-stack" data-axf-target={`host-gate:${service}`} data-host-service-down={service}>
      <Note tone="danger">
        <b>Host service down: {hostApiDown ? 'the host API' : title}</b>{when ? ` (for ${when})` : ''}.{' '}
        {hostApiDown ? 'The console cannot reach the host side, so it cannot show or drive this part. ' : `${s?.reason ? `${s.reason}. ` : ''}`}
        {what ?? `What it does on the host stops until it is back${s?.manifest?.description ? `: ${s.manifest.description}` : '.'}`}
        <span className="axf-host-gate__actions" role="toolbar" aria-label="Host service down actions" data-axf-toolbar="host-gate">
          {!hostApiDown && <Button size="sm" icon="refresh" confirm={`Restart ${s?.unit || service}?`} onClick={() => void restart()} data-axf-target={`host:${service}/unit:restart`}>Restart</Button>}
          <Button size="sm" tone="ghost" icon="settings" onClick={() => rt.dispatch('settings.open:host-services')} data-axf-target={`host:${service}`}>Host services</Button>
        </span>
      </Note>
      {block ? null : children}
    </div>
  );
}
