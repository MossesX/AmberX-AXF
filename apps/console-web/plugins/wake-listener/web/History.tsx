/**
 * Voice command history (wake-listener; build voice-listener-use-claude-when-connected s9): every command with who
 * understood it (Claude or the scripted matcher, and why the scripted one took it while Claude mode was on), filterable
 * by mode. The same list is GET /api/plugins/wake-listener/history?mode=claude|scripted (MCP wake-listener_history,
 * CLI `listener.mjs history --mode …`). Deep link: action `wake-listener.history:<mode>` opens this filtered.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Segmented } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { FALLBACK_LABEL, FOLDER, type HistoryEntry } from '../core.mjs';

export type ModeFilter = '' | 'claude' | 'scripted';
const FILTERS: { value: ModeFilter | 'all'; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'claude', label: 'Claude' }, { value: 'scripted', label: 'Scripted' }];

let wanted: ModeFilter = '';
const listeners = new Set<(m: ModeFilter) => void>();
/** The deep link's way in: pick the filter (the panel follows when it is open, and starts with it when it opens). */
export function setHistoryFilter(m: ModeFilter) { wanted = m; listeners.forEach((f) => f(m)); }

/** Sends one entry to the server's history (fire and forget). */
export function recordHistory(entry: Omit<HistoryEntry, 'at'> & { at?: number }) {
  void pluginFetch(FOLDER, 'history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry: { at: Date.now(), ...entry } }) }).catch(() => undefined);
}

const time = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function HistoryPanel() {
  const [mode, setMode] = useState<ModeFilter>(wanted);
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async (m: ModeFilter) => {
    try {
      const r = await pluginFetch(FOLDER, `history?limit=100${m ? `&mode=${m}` : ''}`);
      const j = (await r.json()) as { ok?: boolean; entries?: HistoryEntry[]; message?: string };
      if (r.ok && j.ok && Array.isArray(j.entries)) { setRows(j.entries); setErr(''); } else setErr(j.message || `The console answered ${r.status}.`);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { const f = (m: ModeFilter) => setMode(m); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  useEffect(() => { void load(mode); const t = setInterval(() => void load(mode), 10_000); return () => clearInterval(t); }, [mode, load]);
  return (
    <div className="axp-wake-listener" data-axf-target="wake-listener.history">
      <div className="axp-wake-listener__row" role="toolbar" aria-label="History filter">
        <span data-axf-target="wake-listener.history.mode">
          <Segmented<ModeFilter | 'all'> value={mode || 'all'} onChange={(v) => { const m = (v === 'all' ? '' : v) as ModeFilter; wanted = m; setMode(m); }} options={FILTERS} label="Filter by mode" size="sm" /> 
        </span>
        <Button size="sm" icon="refresh-cw" onClick={() => void load(mode)}>Refresh</Button>
      </div>
      {err && <p className="fx-muted">{err}</p>}
      {!rows.length && !err ? <p className="fx-muted">No voice commands{mode ? ` handled by ${mode === 'claude' ? 'Claude' : 'the scripted matcher'}` : ''} yet.</p> : (
        <div className="fx-tablewrap">
          <table className="fx-table">
            <thead><tr><th>When</th><th>Heard</th><th>Command</th><th>Mode</th><th>Reply</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.at}-${i}`} data-mode={e.mode}>
                  <td className="fx-muted">{time(e.at)}</td>
                  <td>{e.heard}</td>
                  <td><code>{e.command || '–'}</code></td>
                  <td>
                    <span className="axp-wake-listener__mode" title={e.reason ? `Scripted: ${FALLBACK_LABEL[e.reason] ?? e.reason}` : e.mode === 'claude' ? 'Understood by Claude' : 'Scripted matcher'}>
                      <Chip tone={e.mode === 'claude' ? 'accent' : e.reason && e.reason !== 'off' && e.reason !== 'approvals' ? 'warning' : undefined}>{e.mode === 'claude' ? 'Claude' : 'Scripted'}</Chip>
                    </span>
                    {e.reason && <span className="fx-muted fx-small"> {FALLBACK_LABEL[e.reason] ?? e.reason}</span>}
                  </td>
                  <td className="fx-muted">{e.reply}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
