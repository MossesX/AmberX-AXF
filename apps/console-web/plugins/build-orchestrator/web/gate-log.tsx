import { useEffect, useState } from 'react';
import { Button, Chip, Icon, TabGroup } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

/*
 * Server gate log (build server-gate-one-session-per-build-no-duplicate-launches, Nov 12 2026): every time a server
 * gate is hit on the VPS (a duplicate launch refused, a duplicate session reaped by the watchdog, the agent-slot limit,
 * the orchestrator-ID (dispatch) gate, the main gate), one entry: when, which gate, which build, who or what tried it,
 * what the gate did. Kept on the server (framework/cli/server-gate.mjs, server-gate-log@1), read through GET gate-log.
 * Same data: MCP command gate-log, CLI `node framework/cli/server-gate.mjs log`, voice "show the gate log".
 * Deep link: action build-orchestrator.gate-log[:<gate>] (console_open / console_show), view server-gate-log.
 */

export type GateEntry = { at: string; gate: string; build: string; by: string; action: string; detail: string; session?: string };
export type GateLog = { ok?: boolean; total: number; counts: Record<string, number>; gates: { id: string; label: string; count: number }[]; matched: number; shown: number; entries: GateEntry[] };

const api = pluginApi('build-orchestrator', 'Server gate log', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
export const loadGateLog = (gate = '', limit = 200) => api.call<GateLog>(`gate-log?limit=${limit}${gate ? `&gate=${encodeURIComponent(gate)}` : ''}`);

/** The gate filter the deep link asked for (build-orchestrator.gate-log:<gate>), read once by the page. */
let wantGate = '';
const listeners = new Set<(g: string) => void>();
export function openGate(g: string) { wantGate = g; listeners.forEach((fn) => fn(g)); }

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const TONE: Record<string, 'accent' | 'warning' | 'danger' | undefined> = { 'duplicate-launch': 'danger', 'duplicate-reaped': 'warning', 'slot-limit': 'accent', dispatch: 'warning', main: undefined };

export function GateLogPage() {
  const [gate, setGate] = useState(wantGate);
  const [log, setLog] = useState<GateLog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (g = gate) => {
    setBusy(true);
    try { setLog(await loadGateLog(g)); setError(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { const fn = (g: string) => setGate(g); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  useEffect(() => { void load(gate); const t = setInterval(() => void load(gate), 30_000); return () => clearInterval(t); }, [gate]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (id: string) => log?.gates.find((g) => g.id === id)?.label ?? id;
  return (
    <div className="fx-stack fx-stack--lg" data-axf-view="server-gate-log">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · server gates on the VPS</p>
          <h1>Server gate log {log ? <Chip tone={log.total ? 'warning' : undefined}>{log.total}</Chip> : null}</h1>
          <p className="fx-muted">Every time a server gate stops or changes something: a second launch of a running build, a duplicate session ended by the watchdog, the agent-slot limit, a launch without the orchestrator's dispatch token, a PR kicked out at the main gate.</p>
        </div>
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Server gate log"><Button icon="refresh" disabled={busy} onClick={() => void load()}>Reload</Button></div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <TabGroup id="build-orchestrator.gate-log" label="Filter by gate" value={gate || 'all'} onChange={(v: string) => setGate(v === 'all' ? '' : v)}
        tabs={[{ value: 'all', label: 'All gates', icon: 'shield', badge: log?.total || undefined }, ...(log?.gates ?? []).map((g) => ({ value: g.id, label: g.label, badge: g.count || undefined }))]} />
      {!log ? <div className="fx-empty">Loading the server gate log…</div>
        : !log.entries.length ? <div className="fx-empty">{gate ? `No ${label(gate).toLowerCase()} hits.` : 'No server gate has been hit yet.'}</div>
          : <ul className="fx-stack" aria-label="Server gate hits">
            {log.entries.map((e, i) => (
              <li key={`${e.at}-${i}`} className="pd-card">
                <div className="pd-card__top">
                  <h3 className="pd-card__title"><Chip tone={TONE[e.gate]}>{label(e.gate)}</Chip> {e.build || 'no build'}</h3>
                  <span className="fx-muted fx-small">{when(e.at)}</span>
                </div>
                <p className="fx-small"><b>{e.action}</b> · tried by {e.by}{e.session ? ` · session ${e.session}` : ''}</p>
                {e.detail && <p className="fx-small fx-muted">{e.detail}</p>}
              </li>
            ))}
          </ul>}
      {log && log.matched > log.shown && <p className="fx-small fx-muted">Showing the newest {log.shown} of {log.matched}.</p>}
    </div>
  );
}
