/**
 * Notification history (build move-amberx-web-app-into-the-console-amberx-andr s9, contract C35b): every alert the
 * console delivered to each device (the phone, a browser), with when it was delivered, read and tapped, from
 * GET /api/alerts/history. Mark read (POST /api/alerts/ack) and dismiss (POST /api/alerts/dismiss) are the alerts
 * hub's own routes, so MCP (alerts_*), the CLI (`axf alerts …`) and voice reach the same. Deep link:
 * alerts-history.focus:<alert id> or alerts-history.focus:device:<name>.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, useRuntime } from '@console/axf/react';
import { getToken } from '@console/api';

export const HISTORY_VIEW = 'alerts-history';
export const FOCUS_EVENT = 'alerts-history:focus';

interface Rec { alert: string; key: string; device: string; channel: string; deliveredAt: string; readAt: string | null; tappedAt: string | null; title?: string; source?: string; severity?: string; legacy?: boolean }

async function call(path: string, body?: unknown): Promise<any> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(`/api/alerts${path}`, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  return r.json().catch(() => ({}));
}

const TONE: Record<string, 'danger' | 'warning' | 'success' | 'accent' | undefined> = { critical: 'danger', error: 'danger', warning: 'warning', success: 'success', info: 'accent' };
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '');

export function HistoryPage() {
  const rt = useRuntime();
  const [rows, setRows] = useState<Rec[]>([]);
  const [devices, setDevices] = useState<string[]>([]);
  const [device, setDevice] = useState('');
  const [focus, setFocus] = useState('');
  const load = useCallback(async () => {
    const j = await call(`/history?limit=200${device ? `&device=${encodeURIComponent(device)}` : ''}`);
    setRows(j.items ?? []); setDevices(j.devices ?? []);
  }, [device]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = (e: Event) => {
      const f = decodeURIComponent(String((e as CustomEvent).detail ?? ''));
      if (f.startsWith('device:')) setDevice(f.slice(7)); else setFocus(f);
    };
    window.addEventListener(FOCUS_EVENT, on);
    const w = window as { __alertsHistoryFocus?: string };
    if (w.__alertsHistoryFocus) { const f = w.__alertsHistoryFocus; w.__alertsHistoryFocus = undefined; on(new CustomEvent(FOCUS_EVENT, { detail: f })); }
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, []);
  useEffect(() => { if (focus) document.querySelector(`[data-alert="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'center' }); }, [focus, rows]);
  const act = async (path: string, body: unknown, msg: string) => { await call(path, body); rt.toast(msg, 'success', 'Notifications'); void load(); };
  return (
    <div className="axp-alerts-history" data-help="view:alerts-history">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Alerts</p>
          <h1>Notification history</h1>
          <p className="fx-muted">Every alert the console delivered to each device: when it arrived, when it was read and when it was tapped.</p>
        </div>
        <div className="axp-alerts-history__row" role="toolbar" aria-label="Notification history">
          <SelectField label="Device" value={device} onChange={setDevice} empty="Every device" options={devices.map((d) => ({ value: d, label: d }))} />
          <Button icon="check" onClick={() => void act('/ack', { all: true, ...(device ? { device } : {}) }, 'Marked read.')}>Mark all read</Button>
          <Button icon="refresh" onClick={() => void load()}>Refresh</Button>
        </div>
      </header>
      {!rows.length && <Note tone="info">Nothing delivered yet. A device shows up here once it reads the alerts with its name (the phone does).</Note>}
      <Container title={device || 'Every device'} icon="bell">
        <div className="axp-alerts-history__list">
          {rows.map((r) => (
            <div key={`${r.alert}:${r.device}`} className={`axp-alerts-history__item${focus === r.alert ? ' is-focused' : ''}`} data-alert={r.alert}>
              <div className="axp-alerts-history__row">
                {r.severity && <Chip tone={TONE[r.severity]}>{r.severity}</Chip>}
                <strong className="axp-alerts-history__grow">{r.title || r.key}</strong>
                <Chip>{r.device}</Chip>
              </div>
              <div className="axp-alerts-history__row fx-muted">
                <span>Delivered {when(r.deliveredAt)}</span>
                {r.readAt ? <span>· read {when(r.readAt)}</span> : <Chip tone="warning">Unread</Chip>}
                {r.tappedAt && <span>· tapped {when(r.tappedAt)}</span>}
                {r.legacy && <span>· from before the move</span>}
              </div>
              <div className="axp-alerts-history__row" role="toolbar" aria-label="Notification actions">
                {!r.readAt && <Button size="sm" onClick={() => void act('/ack', { ids: [r.alert], device: r.device }, 'Marked read.')}>Mark read</Button>}
                <Button size="sm" tone="ghost" onClick={() => void act('/dismiss', { ids: [r.alert] }, 'Dismissed.')}>Dismiss</Button>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}
