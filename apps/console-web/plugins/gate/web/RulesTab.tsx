/**
 * Rules tab: every gate rule in a DataGrid (`grid:gate.rules`, a row per rule: `grid:gate.rules/row:<rule>`), one or two
 * lines a row (useGridRows). Each row has its on/off Switch, a severity chip and a Settings button that opens the rule's
 * settings under the row, drawn with framework fields. console-control@1: every rule's fields are
 * `panel:<rule>/setting:enabled | severity | owner | <settings key>` (state = the value, set = change it).
 * Every change goes through PUT rules/<id> or POST rules/<id>/toggle, the routes the CLI and MCP use.
 */
import { useMemo, useState } from 'react';
import { Button, Chip, ControlScope, IconButton, SelectField, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GateList } from './GateList';
import { gateCall, type GateRule, type RuleSet } from './api';
import { RulesToolbar } from './RulesToolbar';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

const SEVERITIES = ['block', 'warn', 'info'] as const;
const OWNERS = ['console', 'axf-molly'] as const;
const sevTone = (s: string) => (s === 'block' ? 'danger' : s === 'warn' ? 'warning' : undefined);
const KIND_LABEL: Record<string, string> = { ci: 'CI', tests: 'Tests', theme: 'Theme', controls: 'Controls', 'ui-review': 'UI Review', clash: 'Clash', custom: 'Policy' }; // rule kinds, axf-not-plugin:ui-review

/** A settings value as text for its field, and back. */
const toText = (v: unknown) => (Array.isArray(v) ? (v.every((x) => typeof x === 'string') ? (v as string[]).join(', ') : JSON.stringify(v)) : String(v ?? ''));
function fromText(prev: unknown, text: string): unknown {
  if (typeof prev === 'number') { const n = Number(text); return Number.isFinite(n) ? n : prev; }
  if (Array.isArray(prev) && prev.every((x) => typeof x === 'string')) return text.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(prev) || (prev && typeof prev === 'object')) { try { return JSON.parse(text); } catch { return prev; } }
  return text;
}

export function RulesTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const rows = useGridRows();
  const { data, error, reload } = usePoll<RuleSet>('rules', refreshSec);
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const rules = data?.rules ?? [];

  const save = async (id: string, patch: Record<string, unknown>, toggle = false) => {
    setBusy(id);
    try {
      const r = toggle ? await gateCall<{ rule: GateRule }>(`rules/${id}/toggle`, 'POST', patch) : await gateCall<{ rule: GateRule }>(`rules/${id}`, 'PUT', patch);
      rt.toast(`${r.rule.title || id}: ${r.rule.enabled ? 'on' : 'off'}, ${r.rule.severity}.`, 'success', 'Gate rules');
      await reload();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Gate rules'); } finally { setBusy(''); }
  };
  const toggleOpen = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  // console-control@1: every rule's fields, readable and settable without the UI
  const targets = useMemo<ControlTargetDef[]>(() => rules.flatMap((r) => [
    { address: `panel:${r.id}/setting:enabled`, kind: 'setting', label: `${r.title}: on / off`, keywords: ['gate', 'rule', r.id], get: () => r.enabled, set: (v: unknown) => save(r.id, { enabled: v === true || v === 'on' || v === 'true' }, true), open: () => toggleOpen(r.id) },
    { address: `panel:${r.id}/setting:severity`, kind: 'setting', label: `${r.title}: severity`, keywords: ['gate', 'rule', r.id], get: () => r.severity, set: (v: unknown) => save(r.id, { severity: String(v) }) },
    { address: `panel:${r.id}/setting:owner`, kind: 'setting', label: `${r.title}: run by`, keywords: ['gate', 'rule', r.id], get: () => r.owner, set: (v: unknown) => save(r.id, { owner: String(v) }) },
    ...Object.keys(r.settings).map((k): ControlTargetDef => ({ address: `panel:${r.id}/setting:${k}`, kind: 'setting', label: `${r.title}: ${k}`, keywords: ['gate', 'rule', r.id, k], get: () => r.settings[k], set: (v: unknown) => save(r.id, { settings: { [k]: typeof v === 'string' ? fromText(r.settings[k], v) : v } }) })),
  ]), [rules]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, rules.map((r) => `${r.id}:${r.enabled}:${r.severity}:${r.owner}:${JSON.stringify(r.settings)}`).join('|'));

  const columns: GridColumn<GateRule>[] = [
    { id: 'title', label: 'Rule', width: 'calc(var(--fx-space) * 80)', fixed: true, sortable: true, sortValue: (r) => r.title, render: (r) => (
      <span className="axp-gate__cell"><strong>{r.title || r.id}</strong>{rows === 2 && <span className="axp-gate__sub">{r.description}</span>}</span>
    ) },
    { id: 'kind', label: 'Checks', width: 'calc(var(--fx-space) * 24)', sortable: true, sortValue: (r) => r.kind, render: (r) => <span>{KIND_LABEL[r.kind] ?? r.kind}</span> },
    { id: 'severity', label: 'Severity', width: 'calc(var(--fx-space) * 22)', sortable: true, sortValue: (r) => SEVERITIES.indexOf(r.severity), render: (r) => <Chip tone={sevTone(r.severity)}>{r.severity}</Chip> },
    { id: 'owner', label: 'Run by', width: 'calc(var(--fx-space) * 24)', render: (r) => <span className="axp-gate__sub">{r.owner}</span> },
    { id: 'enabled', label: 'On', width: 'calc(var(--fx-space) * 24)', render: (r) => (
      <span className="axp-gate__cell axp-gate__cell--row">
        <Switch label={`${r.title}: on / off`} hideLabel checked={r.enabled} disabled={busy === r.id} onChange={(v) => void save(r.id, { enabled: v }, true)} />
        <IconButton icon="sliders" label={`${r.title} settings`} onClick={(e) => { e.stopPropagation(); toggleOpen(r.id); }} />
      </span>
    ) },
  ];

  return (
    <>
      <RulesToolbar onChanged={reload} />
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <GateList<GateRule>
        id="gate.rules" label="Gate rules" title={`Rules (${rules.length})`} rows={rules} columns={columns}
        rowId={(r) => r.id} rowLabel={(r) => r.title || r.id}
        expanded={open} onToggleExpand={toggleOpen} onRowClick={(r) => toggleOpen(r.id)}
        rowTone={(r) => (!r.enabled ? 'muted' : r.severity === 'block' ? 'accent' : r.severity === 'warn' ? 'warning' : 'info')}
        renderDetail={(r) => <ControlScope address={`panel:${r.id}`}><RuleSettings rule={r} busy={busy === r.id} onSave={(patch) => save(r.id, patch)} /></ControlScope>}
        empty={<p className="axp-gate__sub">{data ? 'No rules.' : 'Loading the rules…'}</p>}
      />
    </>
  );
}

/** One rule's settings, under its row: severity, who runs it, and every key of its settings, then Save. */
function RuleSettings({ rule, busy, onSave }: { rule: GateRule; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [severity, setSeverity] = useState<string>(rule.severity);
  const [owner, setOwner] = useState<string>(rule.owner);
  const [vals, setVals] = useState<Record<string, unknown>>(rule.settings);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rule.settings).filter(([, v]) => typeof v !== 'boolean').map(([k, v]) => [k, toText(v)])));
  const changed = severity !== rule.severity || owner !== rule.owner || Object.keys(texts).some((k) => texts[k] !== toText(rule.settings[k])) || Object.keys(vals).some((k) => typeof vals[k] === 'boolean' && vals[k] !== rule.settings[k]);
  const submit = () => {
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rule.settings)) settings[k] = typeof v === 'boolean' ? vals[k] : fromText(v, texts[k] ?? toText(v));
    onSave({ severity, owner, settings });
  };
  return (
    <div className="axp-gate__detail">
      <div className="axp-gate__fields">
        <p className="axp-gate__sub">{rule.description}</p>
        {rule.source && <p className="axp-gate__sub">Replaces: {rule.source}</p>}
        <SelectField label="Severity" value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s === 'block' ? 'Block: the PR waits' : s === 'warn' ? 'Warn: it lands, History says so' : 'Info: recorded only' }))} />
        <SelectField label="Run by" value={owner} onChange={setOwner} options={OWNERS.map((o) => ({ value: o, label: o === 'console' ? 'The console' : 'axf-molly' }))} />
      </div>
      <div className="axp-gate__fields">
        {Object.entries(rule.settings).map(([k, v]) => (typeof v === 'boolean'
          ? <Switch key={k} label={k} checked={vals[k] === true} onChange={(b) => setVals((s) => ({ ...s, [k]: b }))} />
          : <TextField key={k} label={k} value={texts[k] ?? ''} mono={typeof v === 'object'} rows={Array.isArray(v) && !v.every((x) => typeof x === 'string') ? 3 : undefined} onChange={(t) => setTexts((s) => ({ ...s, [k]: t }))} />))}
        <div className="axp-gate__bar"><Button tone="primary" icon="save" busy={busy} disabled={!changed} onClick={submit}>Save</Button></div>
      </div>
    </div>
  );
}
