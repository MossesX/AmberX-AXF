/**
 * Send a page to the phone (s8, contract C31): the console's open_url. The URL rule is the phone's own (https,
 * amberxai.com or a subdomain, no user name, no port, at most 2000 characters); the server checks it, the phone again.
 * Every button here is a route (POST open-url, GET open-url, POST open-url/{id}/cancel, settings), so MCP
 * (console-commands_open-url…), the CLI and Amber by voice reach the same. Deep link: console_settings("console-commands").
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'console-commands';
interface Sent { id: string; url: string; state: string; at: number; via?: string; reason?: string; device?: string }
interface S { browser: string; openUrlNotifyWhenBlocked: boolean; openUrlViaHub: boolean }
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | undefined> = { opened: 'success', notified: 'accent', sent: 'accent', queued: 'warning', refused: 'danger', failed: 'danger', cancelled: undefined };

async function call(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await pluginFetch(FOLDER, path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

export function OpenUrlPanel() {
  const rt = useRuntime();
  const [url, setUrl] = useState('https://console.amberxai.com/');
  const [rows, setRows] = useState<Sent[]>([]);
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [h, st] = await Promise.all([call('open-url?limit=20'), call('settings')]);
    if (h.status === 200) setRows(h.json.items ?? []);
    if (st.status === 200) setS(st.json.settings);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    setBusy(true);
    const r = await call('open-url', { url });
    setBusy(false);
    rt.toast(r.json.ok ? `Sent (${r.json.state}).` : r.json.reason || r.json.detail || 'Not sent.', r.json.ok ? 'success' : 'danger', 'Open on the phone');
    void load();
  };
  const set = async (patch: Partial<S>) => {
    const r = await call('settings', patch);
    if (r.status !== 200) { rt.toast(r.json.detail || 'Not saved.', 'danger', 'Open on the phone'); return; }
    setS(r.json.settings);
  };
  return (
    <div className="axp-console-commands__openurl" data-help="console-commands.open-url">
      <div className="axp-console-commands__row" role="toolbar" aria-label="Open on the phone">
        <TextField label="Page" type="url" value={url} onChange={setUrl} placeholder="https://console.amberxai.com/…" />
        <Button tone="primary" icon="smartphone" busy={busy} disabled={!url.trim()} onClick={() => void send()}>Open on the phone</Button>
      </div>
      {s && (
        <div className="axp-console-commands__row">
          <SelectField label="Browser" value={s.browser} onChange={(v) => void set({ browser: v })} options={[{ value: 'chrome', label: 'Chrome' }, { value: 'default', label: 'Default browser' }]} />
          <Switch label="Send through axHub when the phone isn't picking up" checked={s.openUrlViaHub} onChange={(v) => void set({ openUrlViaHub: v })} />
          <Switch label="Notify when Android blocks the browser" checked={s.openUrlNotifyWhenBlocked} onChange={(v) => void set({ openUrlNotifyWhenBlocked: v })} />
        </div>
      )}
      {!rows.length && <Note tone="info">Nothing sent yet.</Note>}
      {rows.map((r) => (
        <div key={r.id} className="axp-console-commands__row" data-open-url={r.id}>
          <Chip tone={TONE[r.state]}>{r.state}</Chip>
          <span className="axp-console-commands__grow">{r.url}</span>
          <span className="fx-muted">{new Date(r.at).toLocaleTimeString()}{r.via ? ` · ${r.via}` : ''}{r.reason ? ` · ${r.reason}` : ''}</span>
          {r.state === 'queued' && <Button size="sm" tone="ghost" onClick={() => void call(`open-url/${encodeURIComponent(r.id)}/cancel`, {}).then(() => load())}>Cancel</Button>}
        </div>
      ))}
    </div>
  );
}
