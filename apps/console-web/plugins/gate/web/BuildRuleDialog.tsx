/**
 * Add / edit a build rule (dialog gate.build-rule, props { id, onSaved }): framework fields only, on the dialog asset.
 * id '' = a new rule (POST build-rules), else the rule's edit (PUT build-rules/<id>); Delete is two-step
 * (POST build-rules/<id>/delete, confirm). The same routes as `axf gate build-rules add|edit|delete`, MCP
 * gate_build_rules_add / _edit / _delete and voice gate.build-rules.add. Who does a rule decides where it goes: a VPS rule
 * is run by the VPS and never reaches a brief; a session rule rides in the brief block it names.
 */
import { useEffect, useState } from 'react';
import { Button, ControlScope, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { confirmed, gateCall, type BuildRule, type BuildRuleEnums } from './api';
import { Bar, Err } from './ui';

export const BUILD_RULE_DIALOG = 'gate.build-rule';
type Draft = { id: string; title: string; text: string; doer: string; kind: string; phase: string; check: string; autofix: string; briefBlock: string; applies: string; keywords: string; uiOnly: string; note: string };
const EMPTY: Draft = { id: '', title: '', text: '', doer: 'session', kind: 'judgement', phase: 'dispatch', check: '', autofix: '', briefBlock: 'rules', applies: 'builds', keywords: '', uiOnly: '', note: '' };
const LABELS: Record<string, string> = { vps: 'The VPS does it', session: 'The build session does it', mechanical: 'Mechanical: a check or fixer can do it', judgement: 'Judgement: it needs reasoning', before: 'Before launch', dispatch: 'In the brief (dispatch)', after: 'After the build', gate: 'At the gate', look: 'Look', api: 'API', checkpoints: 'Checkpoints', rules: 'Rules for this job', builds: 'Build sessions', interactive: 'Sessions with Brett only', all: 'Both' };
const opts = (list: string[]) => list.map((v) => ({ value: v, label: LABELS[v] ?? v }));
const draftOf = (r: BuildRule): Draft => ({ id: r.id, title: r.title, text: r.text, doer: r.doer, kind: r.kind, phase: r.phase, check: r.check, autofix: r.autofix, briefBlock: r.briefBlock, applies: r.applies, keywords: (r.when?.keywords ?? []).join(', '), uiOnly: r.when?.ui === true ? 'ui' : r.when?.ui === false ? 'no-ui' : '', note: r.note ?? '' });
const ruleOf = (d: Draft) => ({
  title: d.title, text: d.text, doer: d.doer, kind: d.kind, phase: d.phase, check: d.check, autofix: d.autofix, briefBlock: d.briefBlock, applies: d.applies, note: d.note,
  when: { ...(d.uiOnly ? { ui: d.uiOnly === 'ui' } : {}), ...(d.keywords.trim() ? { keywords: d.keywords.split(',').map((k) => k.trim()).filter(Boolean) } : {}) },
});

export function BuildRuleDialog({ id, onSaved }: { id: string; onSaved?: () => void | Promise<void> }) {
  const rt = useRuntime();
  const [d, setD] = useState<Draft>(EMPTY);
  const [enabled, setEnabled] = useState(true);
  const [enums, setEnums] = useState<BuildRuleEnums | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNew = !id;
  useEffect(() => {
    void gateCall<{ enums: BuildRuleEnums }>('build-rules?q=%00').then((r) => setEnums(r.enums), () => { /* the lists below fall back */ });
    if (!isNew) void gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}`).then((r) => { setD(draftOf(r.rule)); setEnabled(r.rule.enabled); }, (e: Error) => setError(e.message));
  }, [id, isNew]);
  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));
  const e = enums ?? { doers: ['vps', 'session'], kinds: ['mechanical', 'judgement'], phases: ['before', 'dispatch', 'after', 'gate'], briefBlocks: ['look', 'api', 'checkpoints', 'rules'], applies: ['builds', 'interactive', 'all'], fixers: [] };
  const done = async (msg: string) => { rt.toast(msg, 'success', 'Build rules'); await onSaved?.(); rt.closeDialog(); };
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (isNew) { const r = await gateCall<{ rule: BuildRule }>('build-rules', 'POST', { rule: { id: d.id.trim(), enabled, ...ruleOf(d) }, reason: `Added in the Build rules tab` }); await done(`Added ${r.rule.id}.`); }
      else { const r = await gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}`, 'PUT', { patch: ruleOf(d), reason: `Edited in the Build rules tab` }); await done(`Saved ${r.rule.id} (rev ${r.rule.rev}).`); }
    } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await confirmed(`build-rules/${encodeURIComponent(id)}/delete`, { reason: 'Deleted in the Build rules tab' }); await done(`Deleted ${id}. History keeps it.`); }
    catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <ControlScope address={`panel:build-rule-${isNew ? 'new' : id}`}>
      <div className="axp-gate__form">
        <div className="axp-gate__fields">
          {isNew && <TextField label="Id" value={d.id} onChange={set('id')} mono required placeholder="short-prs" hint="Lower case, digits and dashes." />}
          <TextField label="Title" value={d.title} onChange={set('title')} required hint="The rule's name in the list." />
          <TextField label="The rule" value={d.text} onChange={set('text')} rows={5} required hint="What a session reads in its brief, or what the VPS enforces." />
          <TextField label="Note" value={d.note} onChange={set('note')} hint="Why the rule exists or who asked for it. Never sent to a session." />
          {isNew && <Switch label="On" checked={enabled} onChange={setEnabled} hint="Off: the rule is kept but nobody follows it." />}
        </div>
        <div className="axp-gate__fields">
          <SelectField label="Who does it" value={d.doer} onChange={set('doer')} options={opts(e.doers)} hint="A VPS rule is run by the VPS and never reaches a brief; a session rule rides in the brief." />
          <SelectField label="Kind" value={d.kind} onChange={set('kind')} options={opts(e.kinds)} hint="Mechanical rules can be checked or fixed by a script; judgement rules need reasoning." />
          <SelectField label="When" value={d.phase} onChange={set('phase')} options={opts(e.phases)} hint="The point of a build where the rule applies." />
          <TextField label="Check" value={d.check} onChange={set('check')} mono placeholder="node framework/cli/check-theme.mjs or fixer:home-card" hint="A command, a checker id, or empty." />
          {d.doer === 'vps' && <SelectField label="Fixer" value={d.autofix} onChange={set('autofix')} empty="None" options={opts(e.fixers)} hint="Runs when the check fails; then the check runs again." />}
          {d.doer === 'session' && <SelectField label="Brief block" value={d.briefBlock} onChange={set('briefBlock')} options={opts(e.briefBlocks)} hint="The part of the brief that carries the rule." />}
          {d.doer === 'session' && <SelectField label="Goes to" value={d.applies} onChange={set('applies')} options={opts(e.applies)} hint="Which sessions get the rule." />}
          {d.doer === 'session' && <SelectField label="Builds" value={d.uiOnly} onChange={set('uiOnly')} empty="Every build" options={[{ value: 'ui', label: 'Only builds that change UI' }, { value: 'no-ui', label: 'Only builds without UI' }]} hint="Limit the rule to builds that do or don't touch UI." />}
          {d.doer === 'session' && <TextField label="Only when the build mentions" value={d.keywords} onChange={set('keywords')} placeholder="android, kotlin" hint="Comma separated; empty = every build." />}
        </div>
      </div>
      <Err text={error} />
      <Bar id="gate.build-rule" label="Build rule"
        end={!isNew ? <Button tone="danger" icon="trash" busy={busy} confirm={`Delete the build rule ${id}? History keeps it.`} onClick={() => void remove()}>Delete</Button> : undefined}>
        <Button tone="primary" icon="save" busy={busy} disabled={!d.title.trim() || !d.text.trim() || (isNew && !d.id.trim())} onClick={() => void save()}>{isNew ? 'Add rule' : 'Save'}</Button>
        <Button icon="x" onClick={() => rt.closeDialog()}>Cancel</Button>
      </Bar>
    </ControlScope>
  );
}
