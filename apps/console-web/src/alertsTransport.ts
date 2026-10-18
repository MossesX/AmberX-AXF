/**
 * The alerts library's transport for the Dev Console: alerts live on the console server (/api/alerts, server/alerts.py),
 * which also runs the sources (CI, deploys, systems check, builds, plugins, crashes) and pushes to phones (ntfy, web push).
 *
 * Live updates come over /api/alerts/stream read with fetch (EventSource can't send the console token, and the token
 * never goes in a URL). It reconnects with back-off and falls back to polling every 30 s.
 */
import type { Alert, AlertInput } from './axf/core';
import type { AlertConfig, AlertConfigPatch, AlertTransport } from './axf/libs/alerts';
import { getToken } from './api';

const headers = (json = false): Record<string, string> => {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  if (json) h['content-type'] = 'application/json';
  return h;
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/alerts${path}`, { method: body === undefined ? 'GET' : 'POST', headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) {
    const d = j.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg).join('; ') : r.status === 401 ? 'Set the console token (Settings → Account & security) first.' : r.statusText || `HTTP ${r.status}`);
  }
  return j;
}

export const consoleAlertsTransport: AlertTransport = {
  label: 'the console server',
  list: async () => (await call<{ alerts: Alert[] }>('')).alerts,
  raise: async (input: AlertInput) => { await call('', input); },
  ack: async (ids) => { await call('/ack', ids === 'all' ? { all: true } : { ids }); },
  resolve: async (keys) => { await call('/resolve', { keys }); },
  dismiss: async (ids) => { await call('/dismiss', { ids }); },
  subscribe(onList) {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let delay = 2000;
    const refresh = () => call<{ alerts: Alert[] }>('').then((j) => onList(j.alerts), () => { /* offline: keep what we have */ });
    const connect = async () => {
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const r = await fetch('/api/alerts/stream', { headers: headers(), cache: 'no-store', signal: ctrl.signal });
          if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
          delay = 2000;
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
              if (data) { try { onList((JSON.parse(data) as { alerts: Alert[] }).alerts); } catch { /* bad frame */ } }
            }
          }
        } catch { /* aborted or offline: fall through to back-off */ }
        if (stopped) break;
        await new Promise((res) => setTimeout(res, delay));
        delay = Math.min(delay * 2, 60_000);
      }
    };
    void refresh();
    void connect();
    poll = setInterval(() => void refresh(), 30_000);
    return () => { stopped = true; ctrl?.abort(); if (poll) clearInterval(poll); };
  },
  config: {
    get: () => call<AlertConfig>('/config'),
    set: (patch: AlertConfigPatch) => call<AlertConfig>('/config', patch),
    test: (channel) => call<{ ok: boolean; detail: string }>('/test', { channel }),
  },
  webPush: {
    subscribe: async (sub) => { await call('/webpush/subscribe', { subscription: sub }); },
    unsubscribe: async (endpoint) => { await call('/webpush/unsubscribe', { endpoint }); },
    test: () => call<{ ok: boolean; detail: string }>('/webpush/test', {}),
  },
};
