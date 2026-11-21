/**
 * Merge line tab: the one Merge queue on/off switch (`setting:gate.lander.mergeQueue`), the line's status, the PRs
 * waiting (`grid:gate.waiting`, a row a PR: which rule holds it and why; its detail has Land next and Check this PR), the
 * last runs (`grid:gate.runs`) and Pause / Resume (`button:gate-pause | gate-resume`). The filters are queries the server
 * answers. Every press is the REST route the CLI (`axf gate lander …`), MCP (lander_*) and voice use.
 */
import { useMemo, useState } from 'react';
import { Button, Chip, SelectField, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import { confirmed, gateCall, type LanderStatus, type Run, type Waiting } from './api';
import { CHECK_PR_DIALOG } from './CheckPrDialog';
import { Bar, Err, Facts, Fold, RowList, Stats, when, type Tone } from './ui';
import { useAct } from './useAct';
import { usePoll } from './usePoll';

const statusTone = (s: string): Tone => (s === 'running' ? 'success' : s === 'paused' ? 'warning' : s === 'error' ? 'danger' : undefined);
const stateTone = (s: string): Tone => (s === 'kicked' ? 'danger' : s === 'held' ? 'warning' : s === 'testing' || s === 'merging' ? 'accent' : undefined);
const resultTone = (s: string): Tone => (s === 'landed' ? 'success' : s === 'error' ? 'danger' : s === 'landing' ? 'accent' : undefined);
const MODE_LABEL: Record<string, string> = { serial: 'one at a time', stack: 'stacked' };
const STATES = ['waiting', 'held', 'testing', 'merging', 'kicked', 'skipped'];
const RESULTS = ['landed', 'landing', 'idle', 'error'];

export function LineTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [state, setState] = useState('');
  const [result, setResult] = useState('');
  const [limit, setLimit] = useState('20');
  const st = usePoll<LanderStatus>('lander', refreshSec);
  const wt = usePoll<{ items: Waiting[] }>(`lander/waiting${state ? `?state=${state}` : ''}`, refreshSec);
  const rn = usePoll<{ items: Run[] }>(`lander/runs?limit=${limit}${result ? `&result=${result}` : ''}`, refreshSec);
  const [openPr, setOpenPr] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const s = st.data;
  const waiting = wt.data?.items ?? [];
  const runs = rn.data?.items ?? [];
  const { busy, act } = useAct('Merge line', async () => { await Promise.all([st.reload(), wt.reload(), rn.reload()]); });

  const setMode = (on: boolean) => act('mode', () => gateCall<LanderStatus>('lander/mode', 'POST', { mergeQueue: on, reason: `Merge queue ${on ? 'on' : 'off'} from the Merge line tab` }), on ? 'Merge queue on: PRs go through the stacked merge queue.' : 'Merge queue off: builds land one at a time.');
  const landNow = (pr: number) => act(`land-${pr}`, () => confirmed('lander/land-now', { pr, reason: 'Land next from the Merge line tab' }), `#${pr} lands next.`);
  const pause = () => act('pause', () => gateCall('lander/pause', 'POST', { why }), 'The line is paused: what is in flight finishes, nothing new starts.');
  const resume = () => act('resume', () => gateCall('lander/resume', 'POST', {}), 'The line is running again.');

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:gate.lander.mergeQueue', kind: 'setting', label: 'Merge queue on / off', keywords: ['gate', 'lander', 'merge queue', 'one at a time'], get: () => s?.mergeQueue ?? null, set: (v: unknown) => setMode(v === true || v === 'on' || v === 'true') },
  ], [s?.mergeQueue]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, String(s?.mergeQueue));

  return (
    <>
      <Bar id="gate.lander" label="Merge line"
        end={s?.paused
          ? <Button id="gate-resume" icon="play" tone="primary" busy={busy === 'resume'} onClick={() => void resume()}>Resume</Button>
          : <><TextField label="Why pause" value={why} onChange={setWhy} placeholder="optional" /><Button id="gate-pause" icon="pause" busy={busy === 'pause'} disabled={!s} onClick={() => void pause()}>Pause</Button></>}>
        <Switch label="Merge queue" checked={!!s?.mergeQueue} disabled={!s || busy === 'mode'} onChange={(v) => void setMode(v)}
          hint={s?.mergeQueue ? 'On: PRs go through the stacked merge queue; the one-at-a-time lander is off.' : 'Off: each finished build lands one at a time (main merged in first, clashes fixed, then landed).'} />
      </Bar>
      <Err text={st.error || wt.error || rn.error} />
      {s && (
        <Stats label="Merge line status" items={[
          { id: 'line', label: 'Line', value: '', chip: { text: s.status, tone: statusTone(s.status) }, sub: s.paused && s.pause ? `since ${when(s.pause.at)}${s.pause.why ? `: ${s.pause.why}` : ''}${s.pause.by ? ` (${s.pause.by})` : ''}` : undefined },
          { id: 'mode', label: 'Mode', value: s.mergeQueue ? `Merge queue, ${MODE_LABEL[s.mode] ?? s.mode}` : 'One at a time', sub: s.modeSince ? `since ${when(s.modeSince)}${s.modeBy ? ` (${s.modeBy})` : ''}` : undefined },
          { id: 'landing', label: 'Landing now', value: s.landing ? `#${s.landing.pr} ${s.landing.title || s.landing.build}` : 'Nothing', sub: s.landing?.since ? `since ${when(s.landing.since)}` : undefined },
          { id: 'waiting', label: 'In line', value: `${s.counts.waiting} waiting`, sub: s.lastRun ? `last run ${when(s.lastRun.startedAt)}: ${s.lastRun.result}` : undefined },
        ]} />
      )}
      <Fold title="Waiting to land" icon="clock" count={waiting.length}>
        <Bar id="gate.waiting" label="Waiting filter">
          <SelectField label="State" value={state} onChange={setState} empty="Every state" options={STATES.map((v) => ({ value: v, label: v }))} />
        </Bar>
        <RowList<Waiting>
          id="gate.waiting" label="Waiting to land" rows={waiting} rowId={(w) => String(w.pr)}
          title={(w) => `#${w.pr} ${w.title}`} sub={(w) => w.reason || w.build || w.branch}
          chips={(w) => (w.rule ? <Chip tone="warning">{w.rule}</Chip> : <Chip tone={stateTone(w.state)}>{w.state}</Chip>)}
          tone={(w) => stateTone(w.state)} open={openPr} onOpen={setOpenPr}
          detail={(w) => (
            <div className="axp-gate__fields">
              <Facts items={[['Place in line', String(w.position)], ['Build', w.build], ['Branch', w.branch], ['State', w.state], ['Held by', w.rule], ['Why', w.reason], ['Waiting since', when(w.since)]]} />
              {!!w.gate && !w.gate.pass && !!w.gate.reasons.length && <ul className="axp-gate__list">{w.gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <Bar id="gate.waiting-row" label={`#${w.pr}: actions`}>
                <Button id={`gate-land-now-${w.pr}`} icon="rocket" tone="primary" busy={busy === `land-${w.pr}`} confirm={`Land #${w.pr} next? It still has to pass every rule.`} onClick={() => void landNow(w.pr)}>Land next</Button>
                <Button icon="search" onClick={() => rt.openDialog(CHECK_PR_DIALOG, { pr: String(w.pr) })}>Check this PR</Button>
              </Bar>
            </div>
          )}
          empty={wt.data ? 'Nothing waits to land.' : 'Loading…'}
        />
      </Fold>
      <Fold title="Last runs" icon="list" count={runs.length} open={false}>
        <Bar id="gate.runs" label="Runs filter">
          <SelectField label="Result" value={result} onChange={setResult} empty="Every result" options={RESULTS.map((v) => ({ value: v, label: v }))} />
          <SelectField label="How many" value={limit} onChange={setLimit} options={['20', '50', '100'].map((v) => ({ value: v, label: `Last ${v}` }))} />
        </Bar>
        <RowList<Run>
          id="gate.runs" label="Last runs" rows={runs} rowId={(r) => `${r.startedAt}-${r.landing?.pr ?? ''}-${r.result}`}
          title={(r) => (r.landing ? `#${r.landing.pr} ${r.landing.title || r.landing.build}` : 'Nothing landed')} sub={(r) => `${when(r.startedAt)}${r.reasonText ? ` · ${r.reasonText}` : ''}`}
          chips={(r) => <Chip tone={resultTone(r.result)}>{r.result}</Chip>} tone={(r) => resultTone(r.result)}
          open={openRun} onOpen={setOpenRun}
          detail={(r) => <Facts items={[['Started', when(r.startedAt)], ['Finished', when(r.finishedAt)], ['Mode', r.mode === 'serial' ? 'One at a time' : 'Merge queue'], ['Why', r.reasonText], ['Merged', r.merged?.length ? r.merged.map((n) => `#${n}`).join(' ') : '']]} />}
          empty={rn.data ? 'No runs yet.' : 'Loading…'}
        />
      </Fold>
    </>
  );
}
