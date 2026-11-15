/**
 * Build rules tab (build-rules@1, framework/spec/BUILD-RULES.md): every rule a build follows, who does it (the VPS or the
 * session), its kind, phase, on/off and last run, in a DataGrid (`grid:gate.build-rules`, a row per rule:
 * `grid:gate.build-rules/row:<rule>`, drawn by the DataGrid). A row opens its History panel; Edit opens the rule dialog.
 * console-control@1 (all under `view:gate/tab:gate.tabs=build-rules`, the TabGroup's own tab address, so a deep link opens
 * the tab first): `setting:<rule>.enabled` (state = on/off, set = switch, open = its History), `panel:<rule>.history`
 * (open = the History panel, state = the rule and its last run), `setting:build-rules.doer | phase | q` (the filters),
 * `grid:gate.build-rules/row:<rule>` (the DataGrid's rows). Deep links: console_show view:gate/tab:gate.tabs=build-rules,
 * …/setting:home-card.enabled, …/panel:home-card.history; console_open gate; action gate.build-rules.open:<rule>.
 * Every change goes through the REST routes the CLI, MCP and voice use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Chip, ControlScope, IconButton, Switch, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { gateCall, type BuildRule, type BuildRuleList } from './api';
import { BUILD_RULE_DIALOG } from './BuildRuleDialog';
import { BuildRuleHistory } from './BuildRuleHistory';
import { BuildRulesToolbar, type BuildRuleFilter } from './BuildRulesToolbar';
import { onShowBuildRule, takeWantedRule } from './buildRulesState';
import { GateList } from './GateList';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

const PHASE_LABEL: Record<string, string> = { before: 'Before launch', dispatch: 'In the brief', after: 'After the build', gate: 'At the gate' };
const resultTone = (r?: string) => (r === 'pass' || r === 'fixed' ? 'success' : r === 'fail' ? 'danger' : undefined);
const query = (f: BuildRuleFilter) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v); const s = p.toString(); return `build-rules${s ? `?${s}` : ''}`; };

export function BuildRulesTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const rows = useGridRows();
  const [filter, setFilter] = useState<BuildRuleFilter>({ doer: '', phase: '', q: '' });
  const { data, error, reload } = usePoll<BuildRuleList>(query(filter), refreshSec);
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const rules = data?.rules ?? [];

  // deep links and actions: gate.build-rules.open:<id>, console_show row:<id> (History) or the edit dialog
  useEffect(() => {
    const show = (w: { id: string; panel: 'history' | 'edit' }) => {
      if (w.panel === 'edit') rt.openDialog(BUILD_RULE_DIALOG, { id: w.id, onSaved: reload });
      else setOpen((o) => (o.includes(w.id) ? o : [...o, w.id]));
    };
    const w = takeWantedRule(); if (w) show(w);
    return onShowBuildRule(show);
  }, [rt, reload]);

  const toggle = async (r: BuildRule, enabled: boolean) => {
    setBusy(r.id);
    try {
      const a = await gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(r.id)}/toggle`, 'POST', { enabled, by: 'console', reason: `Switched ${enabled ? 'on' : 'off'} in the Build rules tab` });
      rt.toast(`${a.rule.title}: ${a.rule.enabled ? 'on' : 'off'}.`, 'success', 'Build rules');
      await reload();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build rules'); } finally { setBusy(''); }
  };
  const toggleOpen = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const edit = (id: string) => rt.openDialog(BUILD_RULE_DIALOG, { id, onSaved: reload });

  // console-control@1: each rule's on/off and its row, readable and settable without the UI
  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:build-rules.doer', kind: 'setting', label: 'Build rules: who does it filter', keywords: ['build rules', 'doer', 'vps', 'session'], get: () => filter.doer, set: (v: unknown) => setFilter((f) => ({ ...f, doer: String(v ?? '') })) },
    { address: 'setting:build-rules.phase', kind: 'setting', label: 'Build rules: phase filter', keywords: ['build rules', 'phase'], get: () => filter.phase, set: (v: unknown) => setFilter((f) => ({ ...f, phase: String(v ?? '') })) },
    { address: 'setting:build-rules.q', kind: 'setting', label: 'Build rules: search', keywords: ['build rules', 'search'], get: () => filter.q, set: (v: unknown) => setFilter((f) => ({ ...f, q: String(v ?? '') })) },
    ...rules.flatMap((r): ControlTargetDef[] => {
      const el = () => document.querySelector(`[data-axf-build-rule="${r.id}"]`);
      const show = () => setOpen((o) => (o.includes(r.id) ? o : [...o, r.id]));
      return [
        { address: `setting:${r.id}.enabled`, kind: 'setting', label: `${r.title}: on / off`, detail: `${r.doer === 'vps' ? 'VPS' : 'session'}, ${r.phase}, last ${r.last?.result ?? 'not run'}`, keywords: ['build rule', r.id, r.doer], element: el, get: () => r.enabled, set: (v: unknown) => toggle(r, v === true || v === 'on' || v === 'true'), open: show },
        { address: `panel:${r.id}.history`, kind: 'panel', label: `${r.title}: History`, keywords: ['build rule', 'history', r.id], element: el, open: show, get: () => ({ id: r.id, title: r.title, doer: r.doer, kind: r.kind, phase: r.phase, enabled: r.enabled, check: r.check, autofix: r.autofix, last: r.last ?? null }) },
      ];
    }),
  ], [rules, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, `${JSON.stringify(filter)}|${rules.map((r) => `${r.id}:${r.enabled}:${r.last?.result ?? ''}`).join('|')}`);

  const columns: GridColumn<BuildRule>[] = [
    { id: 'title', label: 'Rule', width: 'calc(var(--fx-space) * 80)', fixed: true, sortable: true, sortValue: (r) => r.title, render: (r) => (
      <span className="axp-gate__cell"><strong>{r.title || r.id}</strong>{rows === 2 && <span className="axp-gate__sub">{r.id}{r.check ? ` · ${r.check}` : ''}{r.autofix ? ` · fixer ${r.autofix}` : ''}</span>}</span>
    ) },
    { id: 'doer', label: 'Who', width: 'calc(var(--fx-space) * 20)', sortable: true, sortValue: (r) => r.doer, render: (r) => <Chip tone={r.doer === 'vps' ? 'accent' : undefined}>{r.doer === 'vps' ? 'VPS' : 'Session'}</Chip> },
    { id: 'kind', label: 'Kind', width: 'calc(var(--fx-space) * 22)', sortable: true, sortValue: (r) => r.kind, render: (r) => <span className="axp-gate__sub">{r.kind}</span> },
    { id: 'phase', label: 'When', width: 'calc(var(--fx-space) * 26)', sortable: true, sortValue: (r) => r.phase, render: (r) => <span>{PHASE_LABEL[r.phase] ?? r.phase}</span> },
    { id: 'last', label: 'Last result', width: 'calc(var(--fx-space) * 24)', sortable: true, sortValue: (r) => r.last?.at ?? '', render: (r) => (r.last ? <Chip tone={resultTone(r.last.result)}>{r.last.result}</Chip> : <span className="axp-gate__sub">not run</span>) },
    { id: 'enabled', label: 'On', width: 'calc(var(--fx-space) * 24)', render: (r) => (
      <span className="axp-gate__cell axp-gate__cell--row" data-axf-build-rule={r.id}>
        <Switch label={`${r.title}: on / off`} hideLabel checked={r.enabled} disabled={busy === r.id} onChange={(v) => void toggle(r, v)} />
        <IconButton icon="edit" label={`Edit ${r.title}`} onClick={(e) => { e.stopPropagation(); edit(r.id); }} />
      </span>
    ) },
  ];

  return (
    <ControlScope address="tab:gate.tabs=build-rules">
      <BuildRulesToolbar filter={filter} onFilter={setFilter} counts={data?.counts} source={data?.source} onChanged={reload} />
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <GateList<BuildRule>
        id="gate.build-rules" label="Build rules" title={`Build rules (${rules.length})`} rows={rules} columns={columns}
        rowId={(r) => r.id} rowLabel={(r) => r.title || r.id}
        expanded={open} onToggleExpand={toggleOpen} onRowClick={(r) => toggleOpen(r.id)}
        rowTone={(r) => (!r.enabled ? 'muted' : r.last?.result === 'fail' ? 'danger' : r.doer === 'vps' ? 'accent' : 'info')}
        renderDetail={(r) => <ControlScope address={`panel:${r.id}`}><BuildRuleHistory rule={r} onEdit={() => edit(r.id)} /></ControlScope>}
        empty={<p className="axp-gate__sub">{data ? 'No build rules match.' : 'Loading the build rules…'}</p>}
      />
    </ControlScope>
  );
}
