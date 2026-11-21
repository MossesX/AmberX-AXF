/**
 * Build rules tab (build-rules@1, framework/spec/BUILD-RULES.md): every rule a build follows, grouped by when it applies,
 * each a row you tap into (`grid:gate.build-rules`, a row `grid:gate.build-rules/row:<rule>`). The row's switch turns the
 * rule on or off; its detail shows the rule, its last runs and its changes, with Edit (the rule dialog).
 * Two tools fold under the list: run a build's rules (dry run first) and preview what a session's brief gets.
 * console-control@1 (all under `view:gate/tab:gate.tabs=build-rules`): `setting:<rule>.enabled` (state = on/off, set =
 * switch, open = its detail), `panel:<rule>.history` (open = the detail, state = the rule and its last run),
 * `setting:build-rules.doer | phase | q` (the filters). Action gate.build-rules.open:<rule>.
 * Every filter is a query the server answers; every change is a REST route the CLI, MCP and voice use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, ControlScope, SelectField, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import { gateCall, type BriefBlocks, type BuildRule, type BuildRuleHistory, type BuildRuleList, type BuildRuleRun, type PhaseRun } from './api';
import { BUILD_RULE_DIALOG } from './BuildRuleDialog';
import { onShowBuildRule, takeWantedRule } from './buildRulesState';
import { Bar, Err, Facts, Fold, RowList, when, type Tone } from './ui';
import { useAct } from './useAct';
import { usePoll } from './usePoll';

export const PHASE_LABEL: Record<string, string> = { before: 'Before launch', dispatch: 'In the brief', after: 'After the build', gate: 'At the gate' };
const PHASE_ICON: Record<string, string> = { before: 'play', dispatch: 'file', after: 'check', gate: 'shield' };
const DOER_LABEL: Record<string, string> = { vps: 'The VPS', session: 'The session' };
const KIND_LABEL: Record<string, string> = { mechanical: 'Mechanical', judgement: 'Judgement' };
const resultTone = (r?: string): Tone => (r === 'pass' || r === 'fixed' ? 'success' : r === 'fail' ? 'danger' : undefined);
interface Filter { doer: string; phase: string; kind: string; enabled: string; q: string }
const query = (f: Filter) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v); const s = p.toString(); return `build-rules${s ? `?${s}` : ''}`; };
const opts = (list: string[] | undefined, labels: Record<string, string>) => (list ?? Object.keys(labels)).map((v) => ({ value: v, label: labels[v] ?? v }));

export function BuildRulesTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [filter, setFilter] = useState<Filter>({ doer: '', phase: '', kind: '', enabled: '', q: '' });
  const { data, error, reload } = usePoll<BuildRuleList>(query(filter), refreshSec);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, act } = useAct('Build rules', reload);
  const rules = data?.rules ?? [];
  const edit = (id: string) => rt.openDialog(BUILD_RULE_DIALOG, { id, onSaved: reload });

  // deep links and actions: gate.build-rules.open:<id> (its detail) or the edit dialog
  useEffect(() => {
    const show = (w: { id: string; panel: 'history' | 'edit' }) => { if (w.panel === 'edit') rt.openDialog(BUILD_RULE_DIALOG, { id: w.id, onSaved: reload }); else setOpen(w.id); };
    const w = takeWantedRule(); if (w) show(w);
    return onShowBuildRule(show);
  }, [rt, reload]);

  const toggle = (r: BuildRule, enabled: boolean) => act(r.id, () => gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(r.id)}/toggle`, 'POST', { enabled, reason: `Switched ${enabled ? 'on' : 'off'} in the Build rules tab` }), (a) => `${a.rule.title}: ${a.rule.enabled ? 'on' : 'off'}.`);

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:build-rules.doer', kind: 'setting', label: 'Build rules: who does it filter', keywords: ['build rules', 'doer', 'vps', 'session'], get: () => filter.doer, set: (v: unknown) => setFilter((f) => ({ ...f, doer: String(v ?? '') })) },
    { address: 'setting:build-rules.phase', kind: 'setting', label: 'Build rules: phase filter', keywords: ['build rules', 'phase'], get: () => filter.phase, set: (v: unknown) => setFilter((f) => ({ ...f, phase: String(v ?? '') })) },
    { address: 'setting:build-rules.q', kind: 'setting', label: 'Build rules: search', keywords: ['build rules', 'search'], get: () => filter.q, set: (v: unknown) => setFilter((f) => ({ ...f, q: String(v ?? '') })) },
    ...rules.flatMap((r): ControlTargetDef[] => [
      { address: `setting:${r.id}.enabled`, kind: 'setting', label: `${r.title}: on / off`, detail: `${DOER_LABEL[r.doer] ?? r.doer}, ${r.phase}, last ${r.last?.result ?? 'not run'}`, keywords: ['build rule', r.id, r.doer], get: () => r.enabled, set: (v: unknown) => toggle(r, v === true || v === 'on' || v === 'true'), open: () => setOpen(r.id) },
      { address: `panel:${r.id}.history`, kind: 'panel', label: `${r.title}: History`, keywords: ['build rule', 'history', r.id], open: () => setOpen(r.id), get: () => ({ id: r.id, title: r.title, doer: r.doer, kind: r.kind, phase: r.phase, enabled: r.enabled, check: r.check, autofix: r.autofix, last: r.last ?? null }) },
    ]),
  ], [rules, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, `${JSON.stringify(filter)}|${rules.map((r) => `${r.id}:${r.enabled}:${r.last?.result ?? ''}`).join('|')}`);

  const set = (k: keyof Filter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const phases = data?.enums.phases ?? Object.keys(PHASE_LABEL);

  return (
    <ControlScope address="tab:gate.tabs=build-rules">
      <Bar id="gate.build-rules" label="Build rules" end={<Button tone="primary" icon="plus" onClick={() => rt.openDialog(BUILD_RULE_DIALOG, { id: '', onSaved: reload })}>Add a rule</Button>}>
        <SelectField label="Who" value={filter.doer} onChange={set('doer')} empty="Everyone" options={opts(data?.enums.doers, DOER_LABEL)} />
        <SelectField label="When" value={filter.phase} onChange={set('phase')} empty="Any time" options={opts(data?.enums.phases, PHASE_LABEL)} />
        <SelectField label="Kind" value={filter.kind} onChange={set('kind')} empty="Any kind" options={opts(data?.enums.kinds, KIND_LABEL)} />
        <SelectField label="State" value={filter.enabled} onChange={set('enabled')} empty="On and off" options={[{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }]} />
        <TextField label="Search" type="search" value={filter.q} onChange={set('q')} placeholder="home card" />
      </Bar>
      {data?.counts && <p className="axp-gate__sub">{data.counts.total} rules · {data.counts.vps} done by the VPS · {data.counts.session} by the session · {data.counts.on} on{data.source === 'seed' ? ' · from the seed until the first change' : ''}</p>}
      <Err text={error} />
      {!data && !error && <p className="axp-gate__sub">Loading the build rules…</p>}
      {data && !rules.length && <p className="axp-gate__sub">No build rules match.</p>}
      {phases.map((ph) => ({ ph, rows: rules.filter((r) => r.phase === ph) })).filter((g) => g.rows.length).map((g, i) => (
        <Fold key={g.ph} title={PHASE_LABEL[g.ph] ?? g.ph} icon={PHASE_ICON[g.ph]} count={g.rows.length} open={i === 0 || g.rows.some((r) => r.id === open)}>
          <RowList<BuildRule>
            id="gate.build-rules" label={`Build rules: ${PHASE_LABEL[g.ph] ?? g.ph}`} rows={g.rows} rowId={(r) => r.id}
            title={(r) => r.title || r.id} sub={(r) => [r.id, r.check, r.autofix ? `fixer ${r.autofix}` : ''].filter(Boolean).join(' · ')}
            chips={(r) => <><Chip tone={r.doer === 'vps' ? 'accent' : undefined}>{r.doer === 'vps' ? 'VPS' : 'Session'}</Chip>{r.last && <Chip tone={resultTone(r.last.result)}>{r.last.result}</Chip>}</>}
            end={(r) => <Switch label={`${r.title}: on / off`} hideLabel checked={r.enabled} disabled={busy === r.id} onChange={(v) => void toggle(r, v)} />}
            tone={(r) => (!r.enabled ? 'muted' : resultTone(r.last?.result) === 'danger' ? 'danger' : r.doer === 'vps' ? 'accent' : undefined)}
            open={open} onOpen={setOpen}
            detail={(r) => <ControlScope address={`panel:${r.id}`}><RuleDetail rule={r} onEdit={() => edit(r.id)} /></ControlScope>}
            empty="No rules here."
          />
        </Fold>
      ))}
      <Fold title="Run a build's rules" icon="play" open={false}><RunTool phases={phases} onRan={reload} /></Fold>
      <Fold title="Preview a session's brief" icon="eye" open={false}><BriefTool /></Fold>
    </ControlScope>
  );
}

/** One rule's detail: the rule, who does it, its last runs and its changes (GET build-rules/<id>), and Edit. */
function RuleDetail({ rule, onEdit }: { rule: BuildRule; onEdit: () => void }) {
  const [d, setD] = useState<{ runs: BuildRuleRun[]; history: BuildRuleHistory[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void gateCall<{ runs: BuildRuleRun[]; history: BuildRuleHistory[] }>(`build-rules/${encodeURIComponent(rule.id)}`).then(setD, (e: Error) => setError(e.message)); }, [rule.id, rule.rev, rule.last?.at]);
  return (
    <div className="axp-gate__form">
      <div className="axp-gate__fields">
        <p>{rule.text}</p>
        <Facts items={[
          ['Who does it', rule.doer === 'vps' ? 'The VPS, by itself' : `The session reads it in its brief (${rule.briefBlock})`],
          ['Kind', KIND_LABEL[rule.kind] ?? rule.kind], ['When', PHASE_LABEL[rule.phase] ?? rule.phase],
          ['Check', rule.check], ['Fixer', rule.autofix], ['Goes to', rule.doer === 'session' ? rule.applies : ''],
          ['Only when the build mentions', (rule.when?.keywords ?? []).join(', ')], ['Note', rule.note ?? ''],
          ['Last changed', `${when(rule.updatedAt)}${rule.updatedBy ? ` by ${rule.updatedBy}` : ''} (rev ${rule.rev})`],
        ]} />
        <Bar id="gate.build-rule-row" label={`${rule.title}: actions`}><span data-axf-target="button:edit"><Button icon="edit" onClick={onEdit}>Edit</Button></span></Bar>
      </div>
      <div className="axp-gate__fields">
        <Err text={error} />
        <p className="axp-gate__label">Last runs</p>
        {!d ? <p className="axp-gate__sub">Loading…</p> : !d.runs.length ? <p className="axp-gate__sub">Not run yet.</p> : (
          <ul className="axp-gate__checks">{d.runs.map((r) => <li key={`${r.at}${r.build}${r.phase}`}><Chip tone={resultTone(r.result)}>{r.result}</Chip><span>{when(r.at)} · {r.build || 'no build'} · {PHASE_LABEL[r.phase] ?? r.phase}{r.dryRun ? ' (dry run)' : ''}<br /><span className="axp-gate__sub">{r.detail}</span></span></li>)}</ul>
        )}
        <p className="axp-gate__label">Changes</p>
        {!d ? <p className="axp-gate__sub">Loading…</p> : !d.history.length ? <p className="axp-gate__sub">No changes since the seed.</p> : (
          <ul className="axp-gate__list">{d.history.map((h) => <li key={`${h.at}${h.rev}`}>{when(h.at)} · {h.by} · {h.action} (rev {h.rev}){h.reason?.title ? `: ${h.reason.title}` : ''}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

/** Run one phase's rules for a build (POST build-rules/run): a dry run changes nothing; a real run may fix and commit. */
function RunTool({ phases, onRan }: { phases: string[]; onRan: () => void | Promise<void> }) {
  const [build, setBuild] = useState('');
  const [phase, setPhase] = useState('after');
  const [only, setOnly] = useState('');
  const [out, setOut] = useState<(PhaseRun & { dryRun: boolean }) | null>(null);
  const { busy, act } = useAct('Build rules', onRan);
  const run = (dryRun: boolean) => void act(dryRun ? 'dry' : 'run', () => gateCall<PhaseRun>('build-rules/run', 'POST', { build: build.trim(), phase, dryRun, ...(only.trim() ? { rules: only } : {}) }), (r) => `${build.trim()} ${PHASE_LABEL[phase] ?? phase}${dryRun ? ' (dry run)' : ''}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`).then((r) => { if (r) setOut({ ...r, dryRun }); });
  return (
    <div className="axp-gate__fields">
      <TextField label="Build" value={build} onChange={setBuild} mono placeholder="build id" hint="The build whose rules run. A real run works in the build's own worktree, never on main." />
      <SelectField label="Phase" value={phase} onChange={setPhase} options={phases.filter((p) => p !== 'dispatch').map((p) => ({ value: p, label: PHASE_LABEL[p] ?? p }))} hint="Which rules run: the ones before launch, after the build, or at the gate." />
      <TextField label="Only these rules" value={only} onChange={setOnly} mono placeholder="home-card, help-stub" hint="Rule ids, comma separated. Empty runs every rule of the phase." />
      <Bar id="gate.build-rules.run" label="Run build rules">
        <Button icon="search" busy={busy === 'dry'} disabled={!build.trim()} onClick={() => run(true)}>Dry run</Button>
        <Button icon="play" busy={busy === 'run'} disabled={!build.trim()} confirm="Run these rules now? Fixers may write files in the build's worktree and commit them on its branch." onClick={() => run(false)}>Run now</Button>
      </Bar>
      {out && (
        <ul className="axp-gate__checks" aria-label="Run results">
          {(out.runs ?? []).map((r) => <li key={r.id}><Chip tone={resultTone(r.result)}>{r.result}</Chip><span><strong>{r.id}</strong> <span className="axp-gate__sub">{r.detail}</span></span></li>)}
          {!(out.runs ?? []).length && <li><span className="axp-gate__sub">No rule of this phase ran.</span></li>}
        </ul>
      )}
    </div>
  );
}

/** What a build session's brief gets from the store (GET build-rules/brief): only session rules; VPS rules never reach it. */
function BriefTool() {
  const [build, setBuild] = useState('');
  const [title, setTitle] = useState('');
  const [words, setWords] = useState('');
  const [ui, setUi] = useState('');
  const [out, setOut] = useState<BriefBlocks | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    const p = new URLSearchParams({ build: build.trim(), title, text: words, ...(ui ? { ui } : {}) });
    setBusy(true); setError('');
    void gateCall<BriefBlocks>(`build-rules/brief?${p.toString()}`).then(setOut, (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <div className="axp-gate__fields">
      <TextField label="Build" value={build} onChange={setBuild} mono placeholder="build id" hint="Optional: the build the brief is for." />
      <TextField label="Build title" value={title} onChange={setTitle} hint="Rules that only apply when a build mentions a word look here." />
      <TextField label="Build text" value={words} onChange={setWords} rows={2} hint="The build's description, searched the same way." />
      <SelectField label="Changes UI" value={ui} onChange={setUi} empty="Decide from the text" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} hint="UI builds get the look rules; others skip them." />
      <Bar id="gate.build-rules.brief" label="Preview a brief"><Button icon="eye" busy={busy} onClick={load}>Preview brief</Button></Bar>
      <Err text={error} />
      {out && (
        <>
          <p className="axp-gate__sub">{out.picked.length} rules in the brief · {out.skipped.length} left out · {out.chars} characters, about {out.tokens} tokens</p>
          <pre className="axp-gate__pre">{out.text || 'No session rule applies to this build.'}</pre>
          {!!out.skipped.length && <ul className="axp-gate__list">{out.skipped.map((s) => <li key={s.id}><strong>{s.id}</strong> <span className="axp-gate__sub">{s.why}</span></li>)}</ul>}
        </>
      )}
    </div>
  );
}
