/**
 * Gates tab (gate-rules@1): every gate rule a PR must pass before it lands, grouped by what it guards, each a row you
 * tap into (`grid:gate.rules`, a row `grid:gate.rules/row:<rule>`). The row's switch turns the rule on or off; its
 * detail holds severity, who runs it, every setting with its help line and default, Save and Reset this rule.
 * console-control@1: `panel:<rule>/setting:enabled | severity | owner | <settings key>` (state = the value, set = change it).
 * Every change is PUT rules/<id>, POST rules/<id>/toggle or POST rules/reset: the routes the CLI and MCP use. Values
 * typed as text are sent as typed; the server turns them into the rule's own types and answers what is wrong.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, ControlScope, SelectField, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import { confirmed, gateCall, type GateRule, type RuleSet } from './api';
import { CHECK_PR_DIALOG } from './CheckPrDialog';
import { Bar, Err, Fold, RowList, when, type Tone } from './ui';
import { useAct } from './useAct';
import { usePoll } from './usePoll';

const sevTone = (s: string): Tone => (s === 'block' ? 'danger' : s === 'warn' ? 'warning' : undefined);
const SEVERITY_LABEL: Record<string, string> = { block: 'Block: the PR waits', warn: 'Warn: it lands, History says so', info: 'Info: recorded only' };
const OWNER_LABEL: Record<string, string> = { console: 'The console', 'axf-molly': 'axf-molly' };

/** The sections of the list: which rule kinds each holds (the kinds come from the server). */
const GROUPS: { id: string; title: string; icon: string; kinds: string[] }[] = [
  { id: 'checks', title: 'Checks', icon: 'check-circle', kinds: ['ci', 'tests'] },
  { id: 'ui', title: 'UI standards', icon: 'palette', kinds: ['theme', 'controls'] },
  { id: 'approvals', title: 'Approvals', icon: 'eye', kinds: ['ui-review'] }, // axf-not-plugin:ui-review (a rule kind)
  { id: 'landing', title: 'Landing policy', icon: 'branch', kinds: ['clash', 'custom'] },
];

/** Help for the settings the default rules carry; any other key gets the general line. */
const SETTING_HELP: Record<string, string> = {
  mode: 'How the merge queue lands PRs while its switch is on: serial (one at a time) or stack.',
  autoLand: 'The merge queue lands ready PRs by itself.',
  directMerge: 'Allow a merge outside the lander. Keep it off: only the lander merges.',
  depth: 'How many PRs the merge queue stacks at once.',
  batchSize: 'How many PRs one merge queue batch may carry.',
  on: 'Which commit must be green: head (the PR head) or the queue commit built on main.',
  redJoins: 'Let a PR with red CI join the line anyway.',
  noRunMin: 'Minutes without any CI run before the rule says CI never started.',
  commands: 'The quick test commands run after the lander resolved generated files (a JSON list).',
  check: 'The script that checks this rule.',
  holdOn: 'The UI Review states that hold a PR, comma separated.',
  autoResolve: 'The file kinds the lander resolves by itself, comma separated.',
  fileFix: 'File a fix when code clashes with main.',
  enabled: 'The server lander fixes and lands by itself.',
  maxAttempts: 'Attempts of one kind before the build is flagged.',
  backoffMin: 'Minutes to wait between attempts.',
  fix: 'Start a fix session when CI is red.',
};
const text = (v: unknown): string => (Array.isArray(v) ? (v.every((x) => typeof x === 'string') ? (v as string[]).join(', ') : JSON.stringify(v)) : v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

export function GatesTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [show, setShow] = useState('');
  const { data, error, reload } = usePoll<RuleSet>(`rules${show ? `?enabled=${show}` : ''}`, refreshSec);
  const [open, setOpen] = useState<string | null>(null);
  const [pr, setPr] = useState('');
  const { busy, act } = useAct('Gates', reload);
  const rules = data?.rules ?? [];

  const save = (id: string, patch: Record<string, unknown>) => act(id, () => gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}`, 'PUT', patch), (r) => `${r.rule.title || id}: saved.`);
  const toggle = (id: string, enabled: boolean) => act(id, () => gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}/toggle`, 'POST', { enabled }), (r) => `${r.rule.title || id} is ${r.rule.enabled ? 'on' : 'off'}.`);
  const reset = (id = '') => act(`reset-${id}`, () => confirmed<{ rules: RuleSet }>('rules/reset', { ...(id ? { id } : {}), reason: id ? `Reset ${id} from the Gates tab` : 'Reset to defaults from the Gates tab' }), id ? `${id} is back to its default.` : 'Every gate rule is back to its default.');

  // console-control@1: every rule's fields, readable and settable without the screen
  const targets = useMemo<ControlTargetDef[]>(() => rules.flatMap((r) => [
    { address: `panel:${r.id}/setting:enabled`, kind: 'setting', label: `${r.title}: on / off`, keywords: ['gate', 'rule', r.id], get: () => r.enabled, set: (v: unknown) => toggle(r.id, v === true || v === 'on' || v === 'true'), open: () => setOpen(r.id) },
    { address: `panel:${r.id}/setting:severity`, kind: 'setting', label: `${r.title}: severity`, keywords: ['gate', 'rule', r.id], get: () => r.severity, set: (v: unknown) => save(r.id, { severity: String(v) }) },
    { address: `panel:${r.id}/setting:owner`, kind: 'setting', label: `${r.title}: run by`, keywords: ['gate', 'rule', r.id], get: () => r.owner, set: (v: unknown) => save(r.id, { owner: String(v) }) },
    ...Object.keys(r.settings).map((k): ControlTargetDef => ({ address: `panel:${r.id}/setting:${k}`, kind: 'setting', label: `${r.title}: ${k}`, keywords: ['gate', 'rule', r.id, k], get: () => r.settings[k], set: (v: unknown) => save(r.id, { settings: { [k]: v } }) })),
  ]), [rules]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, rules.map((r) => `${r.id}:${r.enabled}:${r.severity}:${r.owner}:${JSON.stringify(r.settings)}`).join('|'));

  const known = GROUPS.flatMap((g) => g.kinds);
  const groups = GROUPS.map((g) => ({ ...g, rows: rules.filter((r) => g.kinds.includes(r.kind) || (g.id === 'landing' && !known.includes(r.kind))) }));

  return (
    <>
      <Bar id="gate.rules" label="Gates"
        end={<Button tone="danger" icon="undo" busy={busy === 'reset-'} confirm="Reset every gate rule to its default? Your changes are replaced (History keeps them)." onClick={() => void reset()}>Reset to defaults</Button>}>
        <SelectField label="Show" value={show} onChange={setShow} empty="Every rule" options={[{ value: 'true', label: 'Rules that are on' }, { value: 'false', label: 'Rules that are off' }]} />
        <TextField label="PR" value={pr} onChange={setPr} placeholder="705" />
        <Button icon="search" disabled={!pr.trim()} onClick={() => rt.openDialog(CHECK_PR_DIALOG, { pr: pr.trim() })}>Check a PR</Button>
      </Bar>
      {data?.counts && <p className="axp-gate__sub">{data.counts.on} of {data.counts.total} rules on · {data.counts.blocking} block a PR until they pass</p>}
      <Err text={error} />
      {!data && !error && <p className="axp-gate__sub">Loading the gate rules…</p>}
      {groups.filter((g) => g.rows.length).map((g) => (
        <Fold key={g.id} title={g.title} icon={g.icon} count={g.rows.length}>
          <RowList<GateRule>
            id="gate.rules" label={`${g.title} rules`} rows={g.rows} rowId={(r) => r.id}
            title={(r) => r.title || r.id} sub={(r) => r.description}
            chips={(r) => <Chip tone={r.enabled ? sevTone(r.severity) : undefined}>{r.enabled ? r.severity : 'off'}</Chip>}
            end={(r) => <Switch label={`${r.title}: on / off`} hideLabel checked={r.enabled} disabled={busy === r.id} onChange={(v) => void toggle(r.id, v)} />}
            tone={(r) => (!r.enabled ? 'muted' : sevTone(r.severity))}
            open={open} onOpen={setOpen}
            detail={(r) => <ControlScope address={`panel:${r.id}`}><RuleEditor key={`${r.id}:${r.updatedAt ?? ''}`} rule={r} enums={data?.enums} busy={busy} onSave={(patch) => void save(r.id, patch)} onReset={() => void reset(r.id)} /></ControlScope>}
            empty="No rules here."
          />
        </Fold>
      ))}
      <Fold title="Add a policy" icon="plus" open={false}>
        <NewRule busy={busy === 'new'} onAdd={(id, patch) => act('new', () => gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}`, 'PUT', patch), (r) => `Added ${r.rule.title || id}.`)} />
      </Fold>
    </>
  );
}

/** One rule's detail: what it is, severity, who runs it, every setting, Save and Reset this rule. */
function RuleEditor({ rule, enums, busy, onSave, onReset }: { rule: GateRule; enums?: RuleSet['enums']; busy: string; onSave: (patch: Record<string, unknown>) => void; onReset: () => void }) {
  const [severity, setSeverity] = useState<string>(rule.severity);
  const [owner, setOwner] = useState<string>(rule.owner);
  const [title, setTitle] = useState(rule.title);
  const [description, setDescription] = useState(rule.description);
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => Object.fromEntries(Object.entries(rule.settings).map(([k, v]) => [k, typeof v === 'boolean' ? v : text(v)])));
  const [def, setDef] = useState<GateRule | null>(null);
  useEffect(() => { void gateCall<{ default: GateRule | null }>(`rules/${encodeURIComponent(rule.id)}`).then((r) => setDef(r.default), () => { /* no default: a custom rule */ }); }, [rule.id]);
  const changedKeys = Object.keys(vals).filter((k) => vals[k] !== (typeof rule.settings[k] === 'boolean' ? rule.settings[k] : text(rule.settings[k])));
  const changed = severity !== rule.severity || owner !== rule.owner || title !== rule.title || description !== rule.description || changedKeys.length > 0;
  const submit = () => onSave({
    ...(severity !== rule.severity ? { severity } : {}), ...(owner !== rule.owner ? { owner } : {}),
    ...(title !== rule.title ? { title } : {}), ...(description !== rule.description ? { description } : {}),
    ...(changedKeys.length ? { settings: Object.fromEntries(changedKeys.map((k) => [k, vals[k]])) } : {}),
  });
  const hint = (k: string) => `${SETTING_HELP[k] ?? 'A setting of this rule.'}${def && k in def.settings ? ` Default: ${text(def.settings[k]) || 'empty'}.` : ''}`;
  return (
    <div className="axp-gate__form">
      <div className="axp-gate__fields">
        <TextField label="Title" value={title} onChange={setTitle} hint="The rule's name in every list." />
        <TextField label="What it checks" value={description} onChange={setDescription} rows={3} hint="Shown under the rule's name and in a held PR's reason." />
        <SelectField label="Severity" value={severity} onChange={setSeverity} options={(enums?.severities ?? Object.keys(SEVERITY_LABEL)).map((s) => ({ value: s, label: SEVERITY_LABEL[s] ?? s }))} hint="Block holds the PR until the rule passes; warn lets it land and notes it; info only records it." />
        <SelectField label="Run by" value={owner} onChange={setOwner} options={(enums?.owners ?? Object.keys(OWNER_LABEL)).map((o) => ({ value: o, label: OWNER_LABEL[o] ?? o }))} hint="Who evaluates the rule. A rule is never run by both." />
      </div>
      <div className="axp-gate__fields">
        {Object.entries(rule.settings).map(([k, v]) => (typeof v === 'boolean'
          ? <Switch key={k} label={k} checked={vals[k] === true} onChange={(b) => setVals((s) => ({ ...s, [k]: b }))} hint={hint(k)} />
          : <TextField key={k} label={k} value={String(vals[k] ?? '')} mono={typeof v === 'object'} rows={Array.isArray(v) && !v.every((x) => typeof x === 'string') ? 3 : undefined} onChange={(t) => setVals((s) => ({ ...s, [k]: t }))} hint={hint(k)} />))}
        {!Object.keys(rule.settings).length && <p className="axp-gate__sub">This rule has no settings of its own.</p>}
        <p className="axp-gate__sub">{rule.source ? `Replaces: ${rule.source}. ` : ''}{rule.updatedAt ? `Last changed ${when(rule.updatedAt)}${rule.updatedBy ? ` by ${rule.updatedBy}` : ''}.` : ''}</p>
        <Bar id="gate.rule" label={`${rule.title}: actions`}
          end={def ? <Button icon="undo" busy={busy === `reset-${rule.id}`} confirm={`Reset ${rule.title} to its default? Your changes to it are replaced (History keeps them).`} onClick={onReset}>Reset this rule</Button> : undefined}>
          <Button tone="primary" icon="save" busy={busy === rule.id} disabled={!changed} onClick={submit}>Save</Button>
        </Bar>
      </div>
    </div>
  );
}

/** A new custom rule (a policy the gate records and applies by its severity). */
function NewRule({ busy, onAdd }: { busy: boolean; onAdd: (id: string, patch: Record<string, unknown>) => Promise<unknown> }) {
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('warn');
  const add = () => void onAdd(id.trim(), { title, description, severity }).then((r) => { if (r) { setId(''); setTitle(''); setDescription(''); } });
  return (
    <div className="axp-gate__fields">
      <TextField label="Id" value={id} onChange={setId} mono required placeholder="no-friday-lands" hint="Lower case, digits and dashes. It can't be changed later." />
      <TextField label="Title" value={title} onChange={setTitle} required hint="The rule's name in every list." />
      <TextField label="What it checks" value={description} onChange={setDescription} rows={2} hint="Shown under the rule's name and in a held PR's reason." />
      <SelectField label="Severity" value={severity} onChange={setSeverity} options={Object.entries(SEVERITY_LABEL).map(([value, label]) => ({ value, label }))} hint="Block holds the PR until the rule passes; warn lets it land and notes it; info only records it." />
      <Bar id="gate.rule-new" label="Add a policy"><Button tone="primary" icon="plus" busy={busy} disabled={!id.trim() || !title.trim()} onClick={add}>Add policy</Button></Bar>
    </div>
  );
}
