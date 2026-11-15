import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Container, Icon, Segmented, Switch, useControlTarget, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginApi } from '@console/plugins';

/*
 * Auto-lander tab (build auto-lander-controls-in-the-gate-plugin, Brett Nov 15 2026: "we need a control for the auto
 * lander, put it in the plugin we built today where we put the rules for the gate"). The gate's plugin shows and drives
 * the auto-lander; the lander is the push banner's (cron /etc/cron.d/axf-auto-land → land/land.mjs run), reached only
 * through this plugin's routes, which call the capability auto-lander@1.
 *
 * One switch the cron reads (off = the next run ends at once, reason switched-off), the mode (serial: one PR at a time on
 * the real main, the default; merge queue: the configured batch/stack queue), the live status (last run, result, what it
 * is landing, why it is not), the landing line (in order, one at a time) with Move up / Skip / Land now per PR, and the
 * recent runs. Same calls: REST auto-lander/*, MCP plugin commands lander-*, `axf lander …`, voice ("turn on the auto
 * lander", "what's landing", "why isn't it landing", "land 633 now"). Deep links: build-orchestrator.tab:auto-lander,
 * setting:autoLander.enabled, setting:autoLander.mode, row:<pr> (action:move-up | skip | land-now).
 */

export type LanderRun = { startedAt: string; finishedAt: string; result: string; mode: string; landing: { pr: number; title: string } | null; merged: number[]; reason: string; reasonText: string; waiting?: number; error?: string };
export type LanderStatus = { enabled: boolean; mode: 'serial' | 'merge-queue'; lastRun: LanderRun | null; lastRunAt: string; result: string; reason: string; reasonText: string; landing: { pr: number; title: string; build?: string } | null; inLine: number; landedRecently: number[] };
export type LineRow = { position: number; pr: number; title: string; build: string; url: string; ci: string; state: string; conflict: boolean; why: string; skipped: { why: string; at: string } | null };

const api = pluginApi('build-orchestrator', 'Auto-lander', { unavailable: 'The auto-lander is not available: the build orchestrator or the push banner is switched off.' });
export const landerApi = {
  status: () => api.call<LanderStatus>('auto-lander/status'),
  line: () => api.call<{ line: LineRow[] }>('auto-lander/line'),
  runs: (limit = 20) => api.call<{ runs: LanderRun[] }>(`auto-lander/runs?limit=${limit}`),
  enabled: (enabled: boolean) => api.post<LanderStatus>('auto-lander/enabled', { enabled }),
  mode: (mode: string) => api.post<LanderStatus>('auto-lander/mode', { mode }),
  move: (pr: number, direction: 'up' | 'down') => api.post('auto-lander/line/move', { pr, direction }),
  skip: (pr: number, why: string) => api.post('auto-lander/line/skip', { pr, why, confirm: true }),
  unskip: (pr: number) => api.post('auto-lander/line/unskip', { pr }),
  landNow: (pr: number) => api.post('auto-lander/line/land-now', { pr, confirm: true }),
};

const when = (iso: string) => { const d = new Date(iso); return !iso || Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (iso: string) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return 'never'; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const RESULT_TONE: Record<string, 'success' | 'accent' | 'warning' | 'danger' | undefined> = { landed: 'success', landing: 'accent', idle: undefined, skipped: 'warning', error: 'danger' };
const CI_TONE: Record<string, 'success' | 'accent' | 'warning' | 'danger' | undefined> = { success: 'success', running: 'accent', failure: 'danger', none: undefined };
const MODES = [{ value: 'serial' as const, label: 'Serial', title: 'One PR at a time, tested on the real main, then landed' }, { value: 'merge-queue' as const, label: 'Merge queue', title: 'The configured merge queue (batch or stack)' }];
const SKIP_WHY = 'Skipped in the console';

export function AutoLanderTab() {
  const rt = useRuntime();
  const [st, setSt] = useState<LanderStatus | null>(null);
  const [rows, setRows] = useState<LineRow[]>([]);
  const [runs, setRuns] = useState<LanderRun[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    try { const [s, l, r] = await Promise.all([landerApi.status(), landerApi.line(), landerApi.runs()]); setSt(s); setRows(l.line || []); setRuns((r.runs || []).slice().reverse()); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, []);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); rt.toast(ok, 'success'); await load(); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(''); }
  };
  const setOn = (on: boolean) => run('enabled', () => landerApi.enabled(on), on ? 'Auto-lander on: the next run starts within 3 minutes' : 'Auto-lander off: the next run stops at once');
  const setMode = (m: string) => run('mode', () => landerApi.mode(m), `Auto-lander mode: ${m === 'serial' ? 'serial, one at a time' : 'merge queue'}`);

  const swEl = useRef<HTMLDivElement | null>(null);
  const swTarget = useControlTarget({
    address: 'setting:autoLander.enabled', kind: 'setting', label: 'Auto-lander on/off', keywords: ['auto lander', 'lander', 'landing', 'switch'], element: () => swEl.current,
    can: ['state', 'focus', 'set'], get: () => (st?.enabled ? 'on' : 'off'),
    set: (v) => { const t = String(v ?? '').trim().toLowerCase(); const on = ['on', 'true', 'yes', '1'].includes(t) ? true : ['off', 'false', 'no', '0'].includes(t) ? false : null; if (on === null) return `"${String(v)}" is not on or off`; void setOn(on); return undefined; },
    state: () => ({ enabled: !!st?.enabled }),
  }, [st?.enabled]);
  const modeEl = useRef<HTMLDivElement | null>(null);
  const modeTarget = useControlTarget({
    address: 'setting:autoLander.mode', kind: 'setting', label: 'Auto-lander mode', keywords: ['serial', 'merge queue', 'one at a time'], element: () => modeEl.current,
    can: ['state', 'focus', 'set'], get: () => st?.mode ?? 'serial',
    set: (v) => { const m = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '-'); const mode = m === 'queue' ? 'merge-queue' : m; if (!['serial', 'merge-queue'].includes(mode)) return 'serial or merge-queue'; void setMode(mode); return undefined; },
    state: () => ({ mode: st?.mode ?? 'serial' }),
  }, [st?.mode]);

  const live = rows.filter((r) => !r.skipped);
  const columns: GridColumn<LineRow>[] = [
    { id: 'position', label: '#', width: 'calc(var(--fx-font-size) * 3)', fixed: true, render: (r) => (r.skipped ? <Chip tone="warning">skipped</Chip> : <span>{r.position}</span>) },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-font-size) * 6)', render: (r) => <a href={r.url || undefined} target="_blank" rel="noreferrer">#{r.pr}</a> },
    { id: 'build', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 14), 1fr)', render: (r) => <span title={r.title}>{r.build || r.title}{(r.skipped?.why || r.why) && <span className="fx-muted fx-small"> · {r.skipped?.why || r.why}</span>}</span> },
    { id: 'ci', label: 'CI', width: 'calc(var(--fx-font-size) * 6)', render: (r) => <Chip tone={CI_TONE[r.ci]}>{r.ci}</Chip> },
    { id: 'state', label: 'State', width: 'calc(var(--fx-font-size) * 6)', render: (r) => <Chip tone={r.conflict ? 'danger' : r.state === 'testing' ? 'accent' : undefined}>{r.conflict ? 'conflict' : r.state}</Chip> },
    { id: 'actions', label: 'Actions', width: 'auto', align: 'end', render: (r) => <RowTools r={r} index={live.findIndex((x) => x.pr === r.pr)} busy={busy} run={run} /> },
  ];
  const runCols: GridColumn<LanderRun & { key: string }>[] = [
    { id: 'at', label: 'When', width: 'calc(var(--fx-font-size) * 9)', render: (r) => <span>{when(r.finishedAt || r.startedAt)}</span> },
    { id: 'result', label: 'Result', width: 'calc(var(--fx-font-size) * 6)', render: (r) => <Chip tone={RESULT_TONE[r.result]}>{r.result}</Chip> },
    { id: 'mode', label: 'Mode', width: 'calc(var(--fx-font-size) * 6)', render: (r) => <span>{r.mode}</span> },
    { id: 'what', label: 'What happened', width: 'minmax(calc(var(--fx-font-size) * 14), 1fr)', render: (r) => <span>{r.merged?.length ? `Landed ${r.merged.map((n) => `#${n}`).join(', ')}` : r.landing ? `Landing #${r.landing.pr}` : ''}{r.reason ? `${r.merged?.length || r.landing ? ' · ' : ''}${r.reasonText || r.reason}` : ''}</span> },
  ];
  const lastRun = st?.lastRun;
  return (
    <div className="fx-stack fx-stack--lg al-tab" data-axf-view="auto-lander">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Gate · lands finished PRs on main</p>
          <h1>Auto-lander {st && <Chip tone={st.enabled ? 'success' : 'warning'}>{st.enabled ? 'on' : 'off'}</Chip>}</h1>
          <p className="fx-muted">The cron runs it every 3 minutes. Off stops the next run at once. Serial lands one PR at a time, each tested on the main it will sit on.</p>
        </div>
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Auto-lander"><Button icon="refresh" disabled={!!busy} onClick={() => void load()}>Reload</Button></div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="al-controls">
        <Container title="Switch and mode" icon="zap">
          <div className="fx-stack">
            <div ref={(d) => { swEl.current = d; swTarget(d); }} data-axf-target="setting:autoLander.enabled" className="al-switch">
              <Switch label="Auto-lander" text={st?.enabled ? 'On: lands what is ready' : 'Off: lands nothing'} checked={!!st?.enabled} disabled={!st || busy === 'enabled'} onChange={(v: boolean) => void setOn(v)} />
            </div>
            <div ref={(d) => { modeEl.current = d; modeTarget(d); }} data-axf-target="setting:autoLander.mode">
              <Segmented label="Landing mode" value={st?.mode ?? 'serial'} options={MODES} disabled={!st || busy === 'mode'} onChange={(v) => void setMode(v)} />
            </div>
          </div>
        </Container>
        <Container title="Status" icon="chart">
          {!st ? <div className="fx-empty">Loading…</div> : (
            <dl className="al-status" data-axf-target="auto-lander.status">
              <dt>Last run</dt><dd>{lastRun ? `${ago(st.lastRunAt)} · ${when(st.lastRunAt)}` : 'no run recorded yet'}</dd>
              <dt>Result</dt><dd>{st.result ? <Chip tone={RESULT_TONE[st.result]}>{st.result}</Chip> : '—'}</dd>
              <dt>Landing now</dt><dd>{st.landing ? `#${st.landing.pr} ${st.landing.title}` : 'nothing'}</dd>
              <dt>Why it is not landing</dt><dd>{st.reason ? st.reasonText || st.reason : st.landing ? 'it is landing' : '—'}</dd>
              <dt>In line</dt><dd>{st.inLine}</dd>
            </dl>
          )}
        </Container>
      </div>
      <Container title="Landing line" icon="list">
        <DataGrid<LineRow> id="build-orchestrator.auto-lander.line" label="Landing line" groups={[{ id: 'line', title: `${live.length} in line`, rows, groups: [], fixed: true }]}
          columns={columns} rowId={(r) => `row:${r.pr}`} rowLabel={(r) => `#${r.pr} ${r.build || r.title}`} hidden={[]}
          rowTone={(r) => (r.skipped ? 'muted' : r.conflict ? 'danger' : r.state === 'testing' ? 'accent' : '')}
          empty={<p className="fx-muted">Nothing is in the landing line: no open PR is ready.</p>} />
      </Container>
      <Container title="Recent runs" icon="clock">
        <DataGrid<LanderRun & { key: string }> id="build-orchestrator.auto-lander.runs" label="Recent runs" groups={[{ id: 'runs', title: `${runs.length} run(s)`, rows: runs.map((r, i) => ({ ...r, key: `${r.startedAt}-${i}` })), groups: [], fixed: true }]}
          columns={runCols} rowId={(r) => r.key} rowLabel={(r) => `${r.result} ${when(r.finishedAt || r.startedAt)}`} hidden={[]} compact
          empty={<p className="fx-muted">No runs recorded yet. The cron writes one every 3 minutes.</p>} />
      </Container>
    </div>
  );
}

/** One row's toolbar: Move up / Skip / Land now (Land now and Skip confirm first). Control address row:<pr>/action:… */
function RowTools({ r, index, busy, run }: { r: LineRow; index: number; busy: string; run: (key: string, fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const el = useRef<HTMLDivElement | null>(null);
  const setTarget = useControlTarget({
    address: `row:${r.pr}`, kind: 'row', label: `#${r.pr} ${r.build || r.title}`.slice(0, 160), keywords: [String(r.pr), r.build, r.state], element: () => el.current,
    can: ['state', 'focus'], state: () => ({ pr: r.pr, position: r.position, ci: r.ci, state: r.state, conflict: r.conflict, skipped: !!r.skipped }),
  }, [r.pr, r.position, r.state, r.ci, !!r.skipped]);
  const key = (a: string) => `${a}:${r.pr}`;
  if (r.skipped) {
    return (
      <div ref={(d) => { el.current = d; setTarget(d); }} className="fx-row" role="toolbar" aria-label={`PR #${r.pr}`}>
        <Button size="sm" icon="undo" data-axf-target={`row:${r.pr}/action:unskip`} disabled={!!busy} onClick={() => void run(key('unskip'), () => landerApi.unskip(r.pr), `#${r.pr} is back in the line`)}>Put back</Button>
      </div>
    );
  }
  return (
    <div ref={(d) => { el.current = d; setTarget(d); }} className="fx-row" role="toolbar" aria-label={`PR #${r.pr}`}>
      <Button size="sm" icon="chevron-up" data-axf-target={`row:${r.pr}/action:move-up`} disabled={!!busy || index <= 0} onClick={() => void run(key('up'), () => landerApi.move(r.pr, 'up'), `#${r.pr} moved up`)}>Move up</Button>
      <Button size="sm" icon="minus" data-axf-target={`row:${r.pr}/action:skip`} confirm={`Skip #${r.pr}? It stays out of the landing line until you put it back.`} disabled={!!busy} onClick={() => void run(key('skip'), () => landerApi.skip(r.pr, SKIP_WHY), `#${r.pr} skipped`)}>Skip</Button>
      <Button size="sm" tone="primary" icon="play" data-axf-target={`row:${r.pr}/action:land-now`} confirm={`Land #${r.pr} now? It goes to the head of the line and a run starts.`} disabled={!!busy || index === 0} onClick={() => void run(key('land'), () => landerApi.landNow(r.pr), `#${r.pr} is landing next`)}>Land now</Button>
    </div>
  );
}
