/**
 * Overview tab: the pipeline at a glance, each tile a way into its tab. It reads the same routes the tabs read (GET
 * auto-lander, lander, rules, build-rules) and shows what they answered; the counts and the service state are the
 * server's. The quick actions are the lander's Run now / Pause / Resume (allowed by its `can`) and Check a PR.
 */
import { useState } from 'react';
import { Button, TextField, useRuntime } from '@console/axf/react';
import { gateCall, TAB_LABEL, type BuildRuleList, type GateTab, type LanderStatus, type RuleSet } from './api';
import { autoLanderPath, type AutoLanderStatus } from './autoLanderState';
import { CHECK_PR_DIALOG } from './CheckPrDialog';
import { Bar, Err, Stats, when, type StatDef, type Tone } from './ui';
import { useAct } from './useAct';
import { usePoll } from './usePoll';

const serviceTone = (s?: string): Tone => (s === 'up' ? 'success' : s === 'paused' ? 'warning' : 'danger');
const lineTone = (s: string): Tone => (s === 'running' ? 'success' : s === 'paused' ? 'warning' : s === 'error' ? 'danger' : undefined);

export function OverviewTab({ refreshSec, onOpen }: { refreshSec: number; onOpen: (tab: GateTab) => void }) {
  const rt = useRuntime();
  const al = usePoll<AutoLanderStatus>(autoLanderPath(), refreshSec);
  const line = usePoll<LanderStatus>('lander', refreshSec);
  const rules = usePoll<RuleSet>('rules', refreshSec);
  const build = usePoll<BuildRuleList>('build-rules', refreshSec);
  const [pr, setPr] = useState('');
  const { busy, act } = useAct('Lander', al.reload);
  const post = (key: string, done: string) => act(key, () => gateCall(autoLanderPath(key), 'POST', {}), done);
  const s = al.data; const l = line.data;
  const open = (tab: GateTab) => ({ onOpen: () => onOpen(tab), hint: `Open ${TAB_LABEL[tab]}` });

  const tiles: StatDef[] = [
    ...(s ? [
      { id: 'service', label: 'Lander', value: '', chip: { text: s.service.state ?? 'unknown', tone: serviceTone(s.service.state) }, sub: s.service.lastTick ? `last tick ${when(s.service.lastTick)}` : 'never ticked', ...open('auto-lander') },
      { id: 'landing', label: 'Landing now', value: s.current || 'Nothing', sub: `${s.queue.length} waiting · ${s.failing.length} failing`, ...open('auto-lander') },
      { id: 'limits', label: 'Size cap', value: `${s.settings.sizeCapLines} lines a PR`, sub: s.settings.enabled ? 'lands by itself' : 'landing is off', ...open('limits') },
    ] : []),
    ...(l ? [{ id: 'line', label: 'Merge line', value: l.mergeQueue ? 'Merge queue' : 'One at a time', chip: { text: l.status, tone: lineTone(l.status) }, sub: `${l.counts.waiting} PRs waiting`, ...open('line') }] : []),
    ...(rules.data?.counts ? [{ id: 'rules', label: 'Gates', value: `${rules.data.counts.on} of ${rules.data.counts.total} on`, sub: `${rules.data.counts.blocking} block a PR`, ...open('rules') }] : []),
    ...(build.data ? [{ id: 'build-rules', label: 'Build rules', value: `${build.data.counts.on} of ${build.data.counts.total} on`, sub: `${build.data.counts.vps} by the VPS · ${build.data.counts.session} by the session`, ...open('build-rules') }] : []),
    { id: 'triage', label: 'Model triage', value: 'Not live yet', sub: 'ready for the VPS gate', ...open('triage') },
    { id: 'history', label: 'History', value: 'Audit trail', sub: 'every change and run', ...open('history') },
  ];

  return (
    <>
      <Err text={al.error || line.error || rules.error || build.error} />
      <Stats label="Pipeline at a glance" items={tiles} />
      <Bar id="gate.overview" label="Quick actions"
        end={<><TextField label="PR" value={pr} onChange={setPr} placeholder="705" /><Button icon="search" disabled={!pr.trim()} onClick={() => rt.openDialog(CHECK_PR_DIALOG, { pr: pr.trim() })}>Check a PR</Button></>}>
        <Button icon="play" busy={busy === 'run'} disabled={!s?.can?.run} onClick={() => void post('run', 'The lander runs within a minute.')}>Run now</Button>
        {s?.can?.resume
          ? <Button icon="play" tone="primary" busy={busy === 'resume'} onClick={() => void post('resume', 'The lander is running again.')}>Resume lander</Button>
          : <Button icon="pause" busy={busy === 'pause'} disabled={!s?.can?.pause} confirm="Pause the lander? Nothing new is merged, fixed or landed until you resume it." onClick={() => void post('pause', 'The lander is paused.')}>Pause lander</Button>}
      </Bar>
    </>
  );
}
