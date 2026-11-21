/**
 * History tab: the audit trail, newest first, in three lists picked from one dropdown (`setting:gate.history.source`):
 *   changes   every gate rule change and merge line action (GET history; filters kind, rule, pr, action, since;
 *             `setting:gate.history.kind`), with what it was before and after
 *   build     every change to a build rule (GET build-rules/history; filters id, action, since)
 *   runs      every check and fix the VPS ran (GET build-rules/runs; filters id, build, result, since)
 * Every filter is a query the server answers. Same records as `axf gate history`, MCP gate_history and
 * gate_build_rules_history / _runs. The list is `grid:gate.history`.
 */
import { useMemo, useState } from 'react';
import { Chip, SelectField, TextField, useControlTargets, type ControlTargetDef } from '@console/axf/react';
import type { BuildRuleHistory, BuildRuleRun, HistoryEntry } from './api';
import { Bar, Err, Facts, Fold, RowList, when, type Tone } from './ui';
import { usePoll } from './usePoll';

type Source = 'changes' | 'build' | 'runs';
const SOURCES: { value: Source; label: string }[] = [{ value: 'changes', label: 'Gate and merge line changes' }, { value: 'build', label: 'Build rule changes' }, { value: 'runs', label: 'Build rule runs' }];
const isSource = (v: unknown): v is Source => SOURCES.some((s) => s.value === v);
const reasonText = (r: HistoryEntry['reason'] | undefined) => (!r ? '' : typeof r === 'string' ? r : [r.title, r.description].filter(Boolean).join(': '));
const show = (v: unknown) => (v === undefined || v === null ? 'nothing' : JSON.stringify(v, null, 1));
const resultTone = (r: string): Tone => (r === 'pass' || r === 'fixed' ? 'success' : r === 'fail' ? 'danger' : undefined);
const qs = (o: Record<string, string>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); return p.toString(); };

interface Row { key: string; title: string; sub: string; chip: string; tone: Tone; facts: [string, string][]; before?: unknown; after?: unknown; diff: boolean; detail?: string }

export function HistoryTab({ refreshSec }: { refreshSec: number }) {
  const [source, setSource] = useState<Source>('changes');
  const [kind, setKind] = useState('');
  const [rule, setRule] = useState('');
  const [pr, setPr] = useState('');
  const [action, setAction] = useState('');
  const [build, setBuild] = useState('');
  const [result, setResult] = useState('');
  const [since, setSince] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const path = source === 'changes' ? `history?${qs({ limit: '300', kind, rule, pr, action, since })}`
    : source === 'build' ? `build-rules/history?${qs({ limit: '300', id: rule, action, since })}`
      : `build-rules/runs?${qs({ limit: '300', id: rule, build, result, since })}`;
  const { data, error } = usePoll<{ items?: HistoryEntry[]; entries?: BuildRuleHistory[]; runs?: BuildRuleRun[] }>(path, refreshSec);

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:gate.history.source', kind: 'setting', label: 'History: which list', keywords: ['gate', 'history', 'audit'], get: () => source, set: (v: unknown) => setSource(isSource(v) ? v : 'changes') },
    { address: 'setting:gate.history.kind', kind: 'setting', label: 'History: show', keywords: ['gate', 'history', 'filter'], get: () => kind || 'all', set: (v: unknown) => { setSource('changes'); setKind(v === 'rule' || v === 'lander' ? v : ''); } },
  ], [kind, source]);
  useControlTargets(targets, `${source}|${kind}`);

  const rows: Row[] = source === 'changes'
    ? (data?.items ?? []).map((e) => ({ key: `${e.at}|${e.kind}|${e.action}|${e.id ?? ''}|${e.pr ?? ''}`, title: e.kind === 'lander' ? `${e.action}${e.pr ? ` #${e.pr}` : ''}` : `${e.action} ${e.id ?? 'every rule'}`, sub: `${when(e.at)} · ${e.by}${reasonText(e.reason) ? ` · ${reasonText(e.reason)}` : ''}`, chip: e.kind === 'lander' ? 'merge line' : 'gate', tone: e.kind === 'lander' ? 'accent' : undefined, facts: [['When', when(e.at)], ['Who', e.by], ['Why', reasonText(e.reason)]], before: e.before, after: e.after, diff: true }))
    : source === 'build'
      ? (data?.entries ?? []).map((e) => ({ key: `${e.at}|${e.rev}|${e.id ?? ''}`, title: `${e.action} ${e.id ?? ''}`, sub: `${when(e.at)} · ${e.by}${reasonText(e.reason) ? ` · ${reasonText(e.reason)}` : ''}`, chip: `rev ${e.rev}`, tone: undefined, facts: [['When', when(e.at)], ['Who', e.by], ['Why', reasonText(e.reason)]], before: e.before, after: e.after, diff: true }))
      : (data?.runs ?? []).map((r, i) => ({ key: `${r.at}|${r.id ?? r.rule ?? ''}|${r.build}|${r.phase}|${i}`, title: `${r.id ?? r.rule ?? 'rule'}${r.build ? ` on ${r.build}` : ''}`, sub: `${when(r.at)} · ${r.phase}${r.dryRun ? ' (dry run)' : ''} · ${r.by ?? ''}`, chip: r.result, tone: resultTone(r.result), facts: [['When', when(r.at)], ['Build', r.build], ['Phase', r.phase], ['Who', r.by ?? ''], ['Fixer', r.fix ? `${r.fix.fixer}: ${r.fix.detail}` : ''], ['Files changed', (r.fix?.changed ?? []).join(', ')]], diff: false, detail: r.detail }));

  return (
    <>
      <Bar id="gate.history" label="History filter">
        <SelectField label="Show" value={source} onChange={(v) => { setSource(isSource(v) ? v : 'changes'); setOpen(null); }} options={SOURCES} />
        {source === 'changes' && <SelectField label="Kind" value={kind} onChange={setKind} empty="Rules and merge line" options={[{ value: 'rule', label: 'Gate rules' }, { value: 'lander', label: 'Merge line' }]} />}
        {source === 'runs' && <SelectField label="Result" value={result} onChange={setResult} empty="Every result" options={['pass', 'fixed', 'fail', 'skipped'].map((v) => ({ value: v, label: v }))} />}
      </Bar>
      <Fold title="More filters" icon="sliders" open={false}>
        <Bar id="gate.history.more" label="More history filters">
          <TextField label="Rule" value={rule} onChange={setRule} mono placeholder="rule id" />
          {source === 'changes' && <TextField label="PR number" value={pr} onChange={setPr} placeholder="705" />}
          {source !== 'runs' && <TextField label="Action" value={action} onChange={setAction} placeholder="toggle" />}
          {source === 'runs' && <TextField label="Build id" value={build} onChange={setBuild} mono placeholder="build id" />}
          <TextField label="Since" type="date" value={since} onChange={setSince} />
        </Bar>
      </Fold>
      <Err text={error} />
      <RowList<Row>
        id="gate.history" label="History" rows={rows} rowId={(r) => r.key}
        title={(r) => r.title} sub={(r) => r.sub} chips={(r) => <Chip tone={r.tone}>{r.chip}</Chip>} tone={(r) => r.tone}
        open={open} onOpen={setOpen}
        detail={(r) => (
          <div className="axp-gate__form">
            <div className="axp-gate__fields"><Facts items={r.facts} />{r.detail && <pre className="axp-gate__pre">{r.detail}</pre>}</div>
            {r.diff && (
              <div className="axp-gate__fields">
                <p className="axp-gate__label">Before</p><pre className="axp-gate__pre">{show(r.before)}</pre>
                <p className="axp-gate__label">After</p><pre className="axp-gate__pre">{show(r.after)}</pre>
              </div>
            )}
          </div>
        )}
        empty={data ? 'Nothing here yet.' : 'Loading the history…'}
      />
    </>
  );
}
