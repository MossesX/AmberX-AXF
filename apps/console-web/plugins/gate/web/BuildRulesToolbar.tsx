/**
 * The Build rules tab toolbar (role="toolbar", settings id gate.build-rules): filter by who does a rule and when, search,
 * Add a rule (the rule dialog) and Run a build's rules (POST build-rules/run, dry run first). The same routes the CLI
 * (`axf gate build-rules …`), MCP (gate_build_rules_*) and voice (gate.build-rules.*) call.
 */
import { useState } from 'react';
import { Button, SelectField, TextField, useRuntime } from '@console/axf/react';
import { gateCall, type BuildRuleList } from './api';
import { BUILD_RULE_DIALOG } from './BuildRuleDialog';

export interface BuildRuleFilter { doer: string; phase: string; q: string }
const PHASES = [{ value: '', label: 'Any time' }, { value: 'before', label: 'Before launch' }, { value: 'dispatch', label: 'In the brief' }, { value: 'after', label: 'After the build' }, { value: 'gate', label: 'At the gate' }];

export function BuildRulesToolbar({ filter, onFilter, counts, source, onChanged }: { filter: BuildRuleFilter; onFilter: (f: BuildRuleFilter) => void; counts?: BuildRuleList['counts']; source?: string; onChanged: () => void | Promise<void> }) {
  const rt = useRuntime();
  const [build, setBuild] = useState('');
  const [phase, setPhase] = useState('after');
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    const id = build.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { rt.toast('Type a build id first.', 'warning', 'Build rules'); return; }
    setBusy(true);
    try {
      const r = await gateCall<{ pass: boolean; counts: Record<string, number> }>('build-rules/run', 'POST', { build: id, phase, dryRun, by: 'console' });
      rt.toast(`${id} ${phase}${dryRun ? ' (dry run)' : ''}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`, r.pass ? 'success' : 'warning', 'Build rules');
      await onChanged();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build rules'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Build rules" data-axf-toolbar="gate.build-rules">
        <SelectField label="Who" value={filter.doer} onChange={(v) => onFilter({ ...filter, doer: v })} options={[{ value: '', label: 'Everyone' }, { value: 'vps', label: 'The VPS' }, { value: 'session', label: 'The session' }]} />
        <SelectField label="When" value={filter.phase} onChange={(v) => onFilter({ ...filter, phase: v })} options={PHASES} />
        <TextField label="Search" value={filter.q} onChange={(v) => onFilter({ ...filter, q: v })} placeholder="home card" />
        <span className="axp-gate__bar-end">
          <Button tone="primary" icon="plus" onClick={() => rt.openDialog(BUILD_RULE_DIALOG, { id: '', onSaved: onChanged })}>Add a rule</Button>
        </span>
      </div>
      <div className="axp-gate__bar" role="toolbar" aria-label="Run build rules" data-axf-toolbar="gate.build-rules.run">
        <TextField label="Build" value={build} onChange={setBuild} placeholder="build id" />
        <SelectField label="Phase" value={phase} onChange={setPhase} options={PHASES.filter((p) => p.value && p.value !== 'dispatch')} />
        <Button icon="search" busy={busy} onClick={() => void run(true)}>Dry run</Button>
        <Button icon="play" busy={busy} confirm="Run these rules now? Fixers may write files in the build's worktree and commit them on its branch." onClick={() => void run(false)}>Run now</Button>
        {counts && <span className="axp-gate__bar-end axp-gate__sub">{counts.total} rules · {counts.vps} by the VPS · {counts.session} by the session · {counts.on} on{source === 'seed' ? ' · from the seed until the first change' : ''}</span>}
      </div>
    </>
  );
}
