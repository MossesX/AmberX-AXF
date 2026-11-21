/**
 * Host services console plugin (ai.amberx.axf.console.host-services): the console's view of host-service@1
 * (framework/spec/HOST-SERVICES.md). The parts of the console that must keep running while the container is down, or
 * that touch Docker, disk or git, run on the VPS as systemd units; this is where they are seen and driven.
 *
 * - Settings → Plugins → Host services: the page toolbar (page-toolbar asset assets/toolbar/host-services.json), one
 *   DataGrid row per service (status chip with since, mode, unit, heartbeat, last run, Restart / Start / Stop / Run),
 *   expanded: description, actions, logs tail, and the mode / rollback control (container → shadow → host, Roll back).
 * - Settings → Plugins → Systems check → Host services: the same list, compact, next to the rest of the checks.
 * - HostServiceGate (src/hostServices.tsx) gives each moved plugin's own UI the "Host service down" state.
 *
 * Every row, button and the mode control carries a console-control address (row:<id>, host:<id>/unit:<verb>,
 * host:<id>/action:<action>, host:<id>/mode, host:<id>/rollback) and calls /api/host-services, the same REST the MCP
 * tools (plugin commands), the CLI (`axf host …`) and voice (host.status / host.restart / host.rollback) use.
 */
import { useState } from 'react';
import { Button, Note, PageToolbar, SelectField, useAxfState, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { HostStatusChip, hostServicesApi, refreshHostServices, since, useHostServices, type HostServiceState } from '@console/hostServices';
import { registerHostActions } from './actions';
import './host.css';

const FOLDER = 'host-services';
const VIEW = 'host-services';
const MODES = ['container', 'shadow', 'host'] as const;
const MODE_LABEL: Record<string, string> = { container: 'Container (console runs it)', shadow: 'Shadow (both run, host dry-runs)', host: 'Host (host runs it)' };

type Res = { ok?: boolean; [k: string]: unknown };

async function press(path: string, body: Record<string, unknown> = {}, method = 'POST'): Promise<Res | null> {
  try { return await hostServicesApi<Res>(path, { method, body }); } finally { void refreshHostServices(true); }
}

function Row({ s }: { s: HostServiceState }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const go = async (k: string, path: string, body: Record<string, unknown> = {}) => {
    setBusy(k); setErr('');
    try { await press(path, body); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const id = encodeURIComponent(s.id);
  const tick = s.kind === 'tick';
  return (
    <span className="axp-host-services__actions" role="toolbar" aria-label={`${s.id} actions`} data-axf-toolbar={`host-services.row.${s.id}`}>
      <Button size="sm" icon="refresh" busy={busy === 'restart'} confirm={`Restart ${s.unit}?`} onClick={() => void go('restart', `${id}/unit/restart`, { confirm: true })} data-axf-target={`host:${s.id}/unit:restart`}>Restart</Button>
      {tick
        ? <Button size="sm" tone="ghost" icon="play" busy={busy === 'run'} onClick={() => void go('run', `${id}/unit/run`)} data-axf-target={`host:${s.id}/unit:run`}>Run now</Button>
        : s.unitState === 'active'
          ? <Button size="sm" tone="ghost" icon="stop" busy={busy === 'stop'} confirm={`Stop ${s.unit}? What it does on the host stops until it is started again.`} onClick={() => void go('stop', `${id}/unit/stop`, { confirm: true })} data-axf-target={`host:${s.id}/unit:stop`}>Stop</Button>
          : <Button size="sm" tone="ghost" icon="play" busy={busy === 'start'} onClick={() => void go('start', `${id}/unit/start`)} data-axf-target={`host:${s.id}/unit:start`}>Start</Button>}
      {err && <span className="fx-small fx-danger" role="status">{err}</span>}
    </span>
  );
}

function Detail({ s }: { s: HostServiceState }) {
  const [logs, setLogs] = useState<{ at: string; line: string }[] | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [to, setTo] = useState<string>(s.mode === 'container' ? 'shadow' : s.mode === 'shadow' ? 'host' : 'shadow');
  const id = encodeURIComponent(s.id);
  const run = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k); setMsg('');
    try { const r = await fn(); setMsg(typeof r === 'object' && r ? JSON.stringify(r).slice(0, 600) : String(r ?? 'done')); } catch (e) { setMsg((e as Error).message); } finally { setBusy(''); }
  };
  const back = (MODES.indexOf(to as typeof MODES[number]) < MODES.indexOf((s.mode ?? 'container') as typeof MODES[number]));
  return (
    <div className="axp-host-services__detail" data-axf-target={`row:${s.id}/detail`}>
      <div className="fx-stack">
        <p className="fx-small">{s.manifest?.description}</p>
        <p className="fx-small fx-muted">{s.reason || ''}{s.health ? ` · socket ${s.health.ok ? 'answers' : 'silent'}${s.health.latencyMs ? ` (${s.health.latencyMs} ms)` : ''}` : ''}{s.restarts ? ` · ${s.restarts} restart(s)` : ''}</p>
        {(s.manifest?.actions ?? []).length > 0 && (
          <div className="axp-host-services__actions" role="toolbar" aria-label={`${s.id} service actions`} data-axf-toolbar={`host-services.actions.${s.id}`}>
            {(s.manifest?.actions ?? []).map((a) => (
              <Button key={a.id} size="sm" tone={a.confirm ? 'danger' : 'neutral'} busy={busy === a.id} title={a.description}
                confirm={a.confirm ? `${a.title} on the host?` : undefined}
                disabled={!!a.modes && !a.modes.includes(s.mode ?? 'container')}
                onClick={() => void run(a.id, () => hostServicesApi(`${id}/actions/${encodeURIComponent(a.id)}`, { method: 'POST', body: { args: {}, confirm: a.confirm === true } }))}
                data-axf-target={`host:${s.id}/action:${a.id}`}>{a.title}</Button>
            ))}
          </div>
        )}
        <div className="axp-host-services__mode" data-axf-target={`host:${s.id}/mode`}>
          <SelectField label="Where it runs" value={to} onChange={setTo} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m, disabled: m === s.mode }))} />
          <Button size="sm" icon="arrow-right" busy={busy === 'mode'} confirm={back ? `Move ${s.id} back to ${to}?` : undefined}
            onClick={() => void run('mode', () => press(`${id}/mode`, { to, confirm: back }, 'PUT'))} data-axf-target={`host:${s.id}/set-mode`}>Move</Button>
          <Button size="sm" tone="danger" icon="undo" busy={busy === 'rollback'} disabled={s.mode === 'container'} confirm={`Roll ${s.id} back to the console's copy? The host unit stops; the container loop runs again.`}
            onClick={() => void run('rollback', () => press(`${id}/rollback`, { to: 'container', confirm: true, why: 'rolled back from the Host services view' }))} data-axf-target={`host:${s.id}/rollback`}>Roll back</Button>
        </div>
        {msg && <p className="fx-small fx-muted" role="status">{msg}</p>}
      </div>
      <div className="fx-stack">
        <Button size="sm" tone="ghost" icon="list" busy={busy === 'logs'} onClick={() => void run('logs', async () => { const r = await hostServicesApi<{ lines: { at: string; line: string }[] }>(`${id}/logs?lines=80`); setLogs(r.lines); return `${r.lines.length} lines`; })} data-axf-target={`host:${s.id}/logs`}>Logs</Button>
        {logs && <pre className="axp-host-services__logs" aria-label={`${s.id} logs`}>{logs.map((l) => `${l.at} ${l.line}`).join('\n') || 'no lines'}</pre>}
      </div>
    </div>
  );
}

/** Fixed widths in text units (like the other grids): every row lines up with the head (fr tracks size from each row's own content). */
function useColumns(narrow = false): GridColumn<HostServiceState>[] {
  const w = (wide: number, phone: number) => `calc(var(--fx-font-size) * ${narrow ? phone : wide})`;
  return [
    { id: 'name', label: 'Service', width: w(16, 8), fixed: true, sortable: true, sortValue: (s) => s.id,
      render: (s) => <span className="axp-host-services__name"><b>{s.manifest?.title || s.id}</b><span className="fx-small fx-muted">{s.id} · {s.unit}</span></span> },
    { id: 'status', label: 'Status', width: w(6, 5), sortable: true, sortValue: (s) => s.status,
      render: (s) => <span className="axp-host-services__name"><HostStatusChip s={s} /><span className="fx-small fx-muted">{s.since ? `for ${since(s.since)}` : ''}</span></span> },
    { id: 'mode', label: 'Mode', width: w(5, 4), sortable: true, sortValue: (s) => s.mode ?? '', render: (s) => <span className="fx-small">{s.mode ?? 'container'}</span> },
    { id: 'heartbeat', label: 'Heartbeat', width: w(6, 6), render: (s) => <span className="fx-small fx-muted">{s.heartbeat?.at ? `${since(s.heartbeat.at)} ago` : s.kind === 'tick' ? 'tick' : '—'}</span> },
    { id: 'last', label: 'Last run', width: w(9, 9), render: (s) => <span className="fx-small fx-muted" title={s.lastRun?.message}>{s.lastRun ? `${s.lastRun.result} · ${since(s.lastRun.at)} ago` : '—'}</span> },
    { id: 'actions', label: 'Actions', width: w(10, 6), render: (s) => <Row s={s} /> },
  ];
}

export function HostServicesView({ compact = false }: { compact?: boolean }) {
  const { list, error } = useHostServices();
  const [expanded, setExpanded] = useState<string[]>([]);
  // a phone gets the short column set (service, status, mode, actions); the rest is in each row's detail
  const rt = useRuntime(); useAxfState();
  const phone = 'data-fx-narrow' in rt.viewportAttrs();
  const narrow = compact || phone;
  const rows = list?.services ?? [];
  const counts = list?.counts ?? {};
  usePublishPageState(VIEW, { services: rows.length, down: (counts.down ?? 0) + (counts.unknown ?? 0), hostApiUp: !list?.down });
  useToolbarHandlers(VIEW, {
    'host-services.refresh': async () => { await refreshHostServices(true); return { services: rows.length }; },
    'host-services.expand-all': () => { setExpanded(expanded.length ? [] : rows.map((r) => r.id)); return null; },
    'host-services.restart-down': async () => {
      const down = rows.filter((r) => r.mode !== 'container' && (r.status === 'down' || r.status === 'degraded'));
      for (const r of down) { try { await press(`${encodeURIComponent(r.id)}/unit/restart`, { confirm: true }); } catch { /* the row says why */ } }
      return { restarted: down.map((r) => r.id) };
    },
  });
  const cols = useColumns(phone);
  return (
    <div className="axp-host-services" data-axf-target={compact ? 'panel:host-services.syscheck' : 'view:host-services'}>
      {!compact && <PageToolbar view={VIEW} />}
      {list?.down && (
        <Note tone="danger"><b>Host service down: the host API</b>{list.downSince ? ` (for ${since(list.downSince)})` : ''}. {list.down.message} Every row shows unknown until it answers; the units on the host keep running.</Note>
      )}
      {error && !list && <Note tone="warning">{error}</Note>}
      <div className="axp-host-services__counts" aria-label="Host services by status">
        {(['up', 'degraded', 'down', 'unknown'] as const).filter((k) => counts[k]).map((k) => <span key={k} className="fx-small">{counts[k]} {k}</span>)}
      </div>
      <DataGrid<HostServiceState>
        id="host-services.grid" label="Host services" compact={narrow}
        groups={[{ id: 'all', title: `${rows.length} service${rows.length === 1 ? '' : 's'}`, rows, groups: [], fixed: true }]}
        columns={narrow ? cols.filter((c) => ['name', 'status', 'mode', 'actions'].includes(c.id)) : cols}
        rowId={(s) => s.id} rowLabel={(s) => s.manifest?.title || s.id} hidden={[]}
        rowCtx={(s) => ({ target: `row:${s.id}` })}
        expanded={expanded} onToggleExpand={(rid) => setExpanded((e) => (e.includes(rid) ? e.filter((x) => x !== rid) : [...e, rid]))}
        renderDetail={(s) => <Detail s={s} />}
      />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.host-services',
  label: 'Host services',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-18' },
  settingsTabs: [{ id: FOLDER, label: 'Host services', icon: 'server', order: 7, parent: 'plugins', description: 'The console parts that run on the VPS host: status, actions, mode and rollback.' }],
  settingsPanels: [
    { id: 'host-services.list', tab: FOLDER, title: 'Host services', icon: 'server', order: 10, render: () => <HostServicesView /> },
    { id: 'host-services.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
    { id: 'host-services.syscheck', tab: 'systems-check', title: 'Host services', icon: 'server', order: 15, render: () => <HostServicesView compact /> },
  ],
  register(rt) { registerHostActions(rt); },
};
