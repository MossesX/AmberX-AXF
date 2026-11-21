/**
 * Lander tab: the server lander (lander@1, deploy/lander/run.mjs on the VPS). Service status, the build landing, every
 * build waiting to land (`grid:gate.auto-lander`, a row a build: `grid:gate.auto-lander/row:<build>`) with its live
 * status; a row's detail shows its PRs, steps, failure and status log (GET auto-lander/builds/<build>) with Retry and
 * Fix. Toolbar: Run now, Pause / Resume (`button:gate-al-run | gate-al-pause | gate-al-resume`; a row's
 * `gate-al-retry | gate-al-fix`). What may be pressed (`can`) and the service state come from the lander; this tab only
 * shows them. Deep links: `console_show view:gate/tab:gate.tabs=auto-lander`, action `gate.auto-lander.open:<build>`.
 * Every press is the REST route the CLI (`axf gate auto-lander …`), MCP (gate_auto_lander_*) and voice use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, useControlTargets, type ControlTargetDef } from '@console/axf/react';
import { gateCall } from './api';
import { autoLanderPath, onShowAutoLanderBuild, takeAutoLanderBuild, type AutoLanderBuild, type AutoLanderBuildDetail, type AutoLanderStatus } from './autoLanderState';
import { Bar, Err, Facts, Fold, RowList, Stats, when, type Tone } from './ui';
import { useAct } from './useAct';
import { usePoll } from './usePoll';

const STATUS_LABEL: Record<string, string> = { 'build-complete': 'build complete', 'merging-pr': 'merging to one PR', 'pr-pulling-main': 'pulling in main', 'running-ci': 'running CI', 'merging-main': 'merging into main', landed: 'landed', failed: 'failed', building: 'building' };
const label = (b: { status: string; attempt?: number }) => (b.status === 'failed' ? `failed, attempt ${b.attempt || 1}` : STATUS_LABEL[b.status] ?? b.status);
const statusTone = (s: string): Tone => (s === 'failed' ? 'danger' : s === 'landed' ? 'success' : s in STATUS_LABEL && s !== 'build-complete' && s !== 'building' ? 'accent' : undefined);
const serviceTone = (s?: string): Tone => (s === 'up' ? 'success' : s === 'paused' ? 'warning' : 'danger');
const RETRY: Record<string, string> = { rerun: 're-run the failed jobs', split: 'split into one PR per step', fix: 'a fix session on the PR branch', 'pull-main': 'pull main again', same: 'the same phase again' };

export function LanderTab({ refreshSec }: { refreshSec: number }) {
  const st = usePoll<AutoLanderStatus>(autoLanderPath(), Math.min(refreshSec, 30));
  const [open, setOpen] = useState<string | null>(() => takeAutoLanderBuild() || null);
  useEffect(() => onShowAutoLanderBuild(setOpen), []);
  const { busy, act } = useAct('Lander', st.reload);
  const s = st.data;
  const builds = s?.builds ?? [];
  const post = (key: string, path: string, done: string) => act(key, () => gateCall(autoLanderPath(path), 'POST', {}), done);

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'panel:gate.auto-lander', kind: 'panel', label: 'Lander status', keywords: ['auto-lander', 'lander', 'server', 'service', 'failed', 'fix'], get: () => (s ? { state: s.service.state, paused: s.service.paused, current: s.current, builds: s.builds.length, failing: s.failing.map((f) => f.build) } : null) },
  ], [s]);
  useControlTargets(targets, s?.at ?? s?.service.lastTick ?? '');

  return (
    <>
      <Bar id="gate.auto-lander" label="Lander"
        end={s?.can?.resume
          ? <Button id="gate-al-resume" icon="play" tone="primary" busy={busy === 'resume'} onClick={() => void post('resume', 'resume', 'The lander is running again.')}>Resume lander</Button>
          : <Button id="gate-al-pause" icon="pause" busy={busy === 'pause'} disabled={!s?.can?.pause} confirm="Pause the lander? Nothing new is merged, fixed or landed until you resume it." onClick={() => void post('pause', 'pause', 'The lander is paused.')}>Pause lander</Button>}>
        <Button id="gate-al-run" icon="play" busy={busy === 'run'} disabled={!s?.can?.run} onClick={() => void post('run', 'run', 'The lander runs within a minute.')}>Run now</Button>
      </Bar>
      <Err text={st.error} />
      {!s && !st.error && <p className="axp-gate__sub">Loading the lander…</p>}
      {s && (
        <Stats label="Lander status" items={[
          { id: 'service', label: 'Service', value: '', chip: { text: s.service.state ?? 'unknown', tone: serviceTone(s.service.state) }, sub: s.service.paused ? `paused ${when(s.service.pausedAt)}${s.service.pausedBy ? ` by ${s.service.pausedBy}` : ''}` : s.service.lastTick ? `last tick ${when(s.service.lastTick)}` : 'never ticked' },
          { id: 'landing', label: 'Landing', value: s.current || 'Nothing right now', sub: `${s.queue.length} waiting to land` },
          { id: 'failing', label: 'Failing', value: s.failing.length ? `${s.failing.length} build${s.failing.length === 1 ? '' : 's'}` : 'Nothing', sub: 'it retries by itself' },
          { id: 'last', label: 'Last tick', value: s.service.result || 'none', sub: s.service.error || s.service.build || undefined },
        ]} />
      )}
      {!!s?.failing.length && (
        <Fold title="Failing repeatedly" icon="alert" count={s.failing.length}>
          <ul className="axp-gate__checks">{s.failing.map((f) => <li key={f.build}><Chip tone="danger">attempt {f.attempt}</Chip><span><strong>{f.build}</strong>{f.pr ? ` #${f.pr}` : ''} <span className="axp-gate__sub">{f.kind}: {f.why} (since {when(f.since)})</span></span></li>)}</ul>
        </Fold>
      )}
      <Fold title="Builds in the lander" icon="layers" count={builds.length}>
        <RowList<AutoLanderBuild>
          id="gate.auto-lander" label="Builds in the lander" rows={builds} rowId={(b) => b.build}
          title={(b) => b.title || b.build} sub={(b) => (b.failure ? b.failure.why : `${b.build}${b.statusAt ? ` · since ${when(b.statusAt)}` : ''}`)}
          chips={(b) => <Chip tone={statusTone(b.status)}>{label(b)}</Chip>} tone={(b) => statusTone(b.status)}
          open={open} onOpen={setOpen}
          detail={(b) => (
            <BuildDetail build={b} busy={busy}
              onRetry={() => void post(`retry-${b.build}`, `retry/${encodeURIComponent(b.build)}`, `${b.build}: its next attempt is due now.`)}
              onFix={() => void post(`fix-${b.build}`, `fix/${encodeURIComponent(b.build)}`, `${b.build}: a fix session starts within a minute.`)} />
          )}
          empty={s ? 'Nothing waits to land: the lander picks a build up when it is complete.' : 'Loading…'}
        />
      </Fold>
    </>
  );
}

/** One build in the lander: its PRs, steps, failure and status log, with Retry and Fix when the lander allows them. */
function BuildDetail({ build: b, busy, onRetry, onFix }: { build: AutoLanderBuild; busy: string; onRetry: () => void; onFix: () => void }) {
  const [d, setD] = useState<AutoLanderBuildDetail | null>(null);
  useEffect(() => { void gateCall<AutoLanderBuildDetail>(autoLanderPath(`builds/${encodeURIComponent(b.build)}`)).then(setD, () => setD(null)); }, [b.build, b.status, b.attempt]);
  return (
    <div className="axp-gate__form" data-axf-target={`panel:gate.auto-lander.log=${b.build}`}>
      <div className="axp-gate__fields">
        <Facts items={[
          ['Build', b.build], ['Status', label(b)],
          ['PRs', b.prs.length ? b.prs.map((p) => `#${p.pr} (${p.state})`).join(' · ') : 'None yet'],
          ['Steps still to add', b.waiting.length ? String(b.waiting.length) : ''],
          ['What failed', b.failure ? `${b.failure.kind} in ${STATUS_LABEL[b.failure.status] ?? b.failure.status}: ${b.failure.why}` : ''],
          ['Failing checks', (b.failure?.failing ?? []).join(', ')],
          ['Next', b.failure ? `${RETRY[b.failure.retry] ?? b.failure.retry}${b.failure.notBefore ? ` at ${when(b.failure.notBefore)}` : ''}` : ''],
          ['Fix session', b.failure?.fix ? `${b.failure.fix.session || 'started'} since ${when(b.failure.fix.at)}` : ''],
        ]} />
        <Bar id="gate.auto-lander-row" label={`${b.build}: actions`}>
          <Button id="gate-al-retry" icon="refresh" disabled={!b.can?.retry} busy={busy === `retry-${b.build}`} onClick={onRetry}>Retry</Button>
          <Button id="gate-al-fix" icon="hammer" tone="primary" disabled={!b.can?.fix} busy={busy === `fix-${b.build}`} confirm={`Start a fix session for ${b.build} now instead of after its wait?`} onClick={onFix}>Fix now</Button>
        </Bar>
      </div>
      <div className="axp-gate__fields">
        <p className="axp-gate__label">Steps</p>
        {!b.steps.length ? <p className="axp-gate__sub">No steps.</p> : (
          <ul className="axp-gate__checks">{b.steps.map((x) => <li key={x.id}><Chip tone={x.status === 'in-pr' ? 'success' : x.status === 'failed' ? 'danger' : undefined}>{x.status === 'in-pr' && x.prNumber ? `in PR #${x.prNumber}` : x.status || 'pending'}</Chip><span><strong>{x.id}</strong> <span className="axp-gate__sub">{[x.model, x.slot != null ? `slot ${x.slot}` : ''].filter(Boolean).join(' · ')}</span></span></li>)}</ul>
        )}
        <p className="axp-gate__label">Status log</p>
        {!d ? <p className="axp-gate__sub">Loading…</p> : !d.statusLog.length ? <p className="axp-gate__sub">Nothing logged yet.</p> : (
          <ul className="axp-gate__list">{[...d.statusLog].reverse().slice(0, 30).map((l, i) => <li key={`${l.at}${i}`}>{when(l.at)} · {label({ status: l.status, attempt: l.attempt })} · {l.by}{l.note ? `: ${l.note}` : ''}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
