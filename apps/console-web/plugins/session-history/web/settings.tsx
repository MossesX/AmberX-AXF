/** Settings → Plugins → Session browser: the folders the run store reads (one absolute or ~ path per line). */
import { useEffect, useState } from 'react';
import { Button, TextField } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'session-history';
type Key = 'transcripts' | 'streams' | 'reports';
const FIELDS: { key: Key; label: string; hint: string }[] = [
  { key: 'transcripts', label: 'Claude Code transcripts', hint: 'Folders holding <project>/<session id>.jsonl (Claude Code’s own session files).' },
  { key: 'streams', label: 'Headless stream logs', hint: 'Folders (and their sub-folders) with stream-json logs from deploy/claude-headless.sh and other headless runs.' },
  { key: 'reports', label: 'Agent run reports', hint: 'Folders with agent-run@1 files or the agent swarm’s runs.json (swarm-runs@1).' },
];

export function SourcesPanel() {
  const [vals, setVals] = useState<Record<Key, string> | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => pluginFetch(FOLDER, 'config').then((r) => r.json()).then((j: { config: Record<Key, string[]> }) => setVals({ transcripts: (j.config.transcripts ?? []).join('\n'), streams: (j.config.streams ?? []).join('\n'), reports: (j.config.reports ?? []).join('\n') }), () => setMsg('Couldn’t read the settings (plugin off?).'));
  useEffect(() => { void load(); }, []);
  if (!vals) return <p className="fx-small fx-muted">{msg || 'Loading…'}</p>;
  const save = async () => {
    setBusy(true);
    const body = Object.fromEntries(FIELDS.map((f) => [f.key, vals[f.key].split('\n').map((s) => s.trim()).filter(Boolean)]));
    try {
      const r = await pluginFetch(FOLDER, 'config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      setMsg(r.ok ? 'Saved. The browser reads these folders from now on.' : `Not saved: ${j.detail ?? r.status}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack">
      {FIELDS.map((f) => <TextField key={f.key} label={f.label} hint={f.hint} mono rows={3} value={vals[f.key]} onChange={(v) => setVals({ ...vals, [f.key]: v })} />)}
      <div><Button tone="primary" size="sm" onClick={() => void save()} busy={busy}>Save folders</Button> {msg ? <span className="fx-small">{msg}</span> : null}</div>
    </div>
  );
}
