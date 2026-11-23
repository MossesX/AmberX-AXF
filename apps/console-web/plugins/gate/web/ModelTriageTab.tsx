/**
 * VPS Configuration → Model triage: the VPS gate that decides which model every step of every lane runs on
 * (model-triage@1; Brett, Nov 21 2026: "a VPS-level gate decides which model each build/step runs on"). The tab shows
 * what the VPS answers (GET model-triage: the rules in order, their settings, the defaults, the last decisions) and
 * sends each edit to it (POST model-triage). It holds no rule and checks nothing: labels, limits and reasons are the
 * VPS's, and a value the VPS refuses comes back as its message.
 * console-control@1: `tab:gate.tabs=model-triage`, `setting:vps.modelTriage.enabled | default | handRequest |
 * <rule>.enabled | <rule>.model | <rule>.<setting>` (modelTriageState.ts), buttons `button:vps-triage-refresh |
 * vps-triage-reset | vps-triage-<rule>-save | -up | -down`; actions `vps.model-triage.open | status | rule:<id>:on|off |
 * default:<model>`.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { cachedTriage, editTriage, loadTriage, modelLabel, onTriage, type Triage, type TriageDecision, type TriageEdit, type TriageRule } from './modelTriageState';

const shown = (v: number | boolean | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const HAND_LABELS: Record<string, string> = { floor: 'A floor: the gate may raise it, never lower it', pin: 'A pin: the launch decides', ignore: 'Ignored: the rules decide' };

function RuleRow({ t, rule, index, busy, send }: { t: Triage; rule: TriageRule; index: number; busy: boolean; send: (e: TriageEdit, done: string) => Promise<boolean> }) {
  const fields = t.registry.fields[rule.id] ?? [];
  const typed = fields.filter((f) => f.kind !== 'toggle');
  const saved = Object.fromEntries(typed.map((f) => [f.key, shown(rule.settings[f.key])]));
  const [draft, setDraft] = useState<Record<string, string>>(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setDraft(JSON.parse(savedKey) as Record<string, string>); }, [savedKey]);
  const changed = typed.filter((f) => draft[f.key] !== saved[f.key]);
  const address = `setting:vps.modelTriage.${rule.id}`;
  return (
    <li className="axp-gate__arule" data-rule={rule.id}>
      <span className="axp-gate__arule-n" aria-hidden="true">{index + 1}</span>
      <div className="axp-gate__arule-field">
        <strong>{rule.title}</strong>
        <p className="axp-gate__sub">{rule.text}</p>
      </div>
      <div className="axp-gate__arule-field" data-axf-target={`${address}.model`}>
        <SelectField label={`${rule.title}: runs on`} value={rule.model} options={t.registry.models} disabled={busy}
          onChange={(v) => void send({ op: 'rule', id: rule.id, model: v }, `${rule.title} runs on ${modelLabel(t, v)}.`)} />
      </div>
      <div className="axp-gate__arule-field" data-axf-target={`${address}.enabled`}>
        <Switch label={`${rule.title}: on`} checked={rule.enabled} disabled={busy} onChange={(v) => void send({ op: 'rule', id: rule.id, enabled: v }, `${rule.title} is ${v ? 'on' : 'off'}.`)} />
      </div>
      {fields.length > 0 && (
        <div className="axp-gate__triage axp-gate__arule-wide">
          {fields.map((f) => (
            <div key={f.key} className="axp-gate__stat" data-axf-target={`${address}.${f.key}`}>
              {f.kind === 'toggle'
                ? <Switch label={f.label} hint={f.hint} checked={rule.settings[f.key] === true} disabled={busy} onChange={(v) => void send({ op: 'rule', id: rule.id, settings: { [f.key]: v } }, `${rule.title} saved.`)} />
                : <TextField label={f.label} type={f.kind === 'number' ? 'number' : 'text'} value={draft[f.key] ?? ''} hint={f.kind === 'list' ? `${f.hint} Separate with commas.` : f.hint}
                    onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />}
            </div>
          ))}
        </div>
      )}
      <div className="axp-gate__arule-end">
        {t.registry.lanes.map((lane) => (
          <Switch key={lane} label={t.registry.laneLabels[lane] ?? lane} checked={rule.lanes.includes(lane)} disabled={busy}
            onChange={(v) => void send({ op: 'rule', id: rule.id, lanes: t.registry.lanes.filter((l) => (l === lane ? v : rule.lanes.includes(l))) }, `${rule.title}: lanes saved.`)} />
        ))}
      </div>
      <div className="axp-gate__arule-end">
        {typed.length > 0 && <Button id={`vps-triage-${rule.id}-save`} size="sm" tone="primary" icon="save" disabled={busy || !changed.length}
          onClick={() => void send({ op: 'rule', id: rule.id, settings: Object.fromEntries(changed.map((f) => [f.key, draft[f.key]])) }, `${rule.title} saved.`)}>Save</Button>}
        {changed.length > 0 && <Button id={`vps-triage-${rule.id}-undo`} size="sm" icon="undo" onClick={() => setDraft(saved)}>Undo edits</Button>}
        <Button id={`vps-triage-${rule.id}-up`} size="sm" icon="chevron-up" disabled={busy || index === 0} onClick={() => void send({ op: 'move', id: rule.id, to: index - 1 }, `${rule.title} moved up.`)}>Earlier</Button>
        <Button id={`vps-triage-${rule.id}-down`} size="sm" icon="chevron-down" disabled={busy || index === t.config.rules.length - 1} onClick={() => void send({ op: 'move', id: rule.id, to: index + 1 }, `${rule.title} moved down.`)}>Later</Button>
      </div>
    </li>
  );
}

function DecisionRow({ t, d }: { t: Triage; d: TriageDecision }) {
  const where = d.build ? `${d.build}${d.step ? ` / ${d.step}` : ''}` : d.name || d.title || 'A launch';
  return (
    <li className="axp-gate__arule" data-decision={`${d.build ?? d.name ?? ''}${d.step ? `.${d.step}` : ''}`}>
      <span className="axp-gate__arule-n" aria-hidden="true" />
      <div className="axp-gate__arule-field"><strong>{where}</strong><p className="axp-gate__sub">{t.registry.laneLabels[d.lane] ?? d.lane} · {d.at ? new Date(d.at).toLocaleString() : ''}</p></div>
      <div className="axp-gate__arule-field axp-gate__cell--row">
        <Chip tone={d.held ? 'warning' : 'accent'}>{d.model}</Chip>
        {d.held && d.wanted && <Chip tone="warning">Wanted {d.wanted}</Chip>}
        <Chip>{d.rule}</Chip>
      </div>
      <p className="axp-gate__arule-wide">{d.why}</p>
    </li>
  );
}

export function ModelTriageTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [cur, setCur] = useState<Triage | null>(cachedTriage);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  useEffect(() => onTriage(setCur), []);
  const reload = async () => { try { await loadTriage(); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { if (!document.hidden) void reload(); }, Math.max(5, refreshSec) * 1000);
    return () => window.clearInterval(timer);
  }, [refreshSec]);
  const send = async (edit: TriageEdit, done: string): Promise<boolean> => {
    setBusy('edit'); setError('');
    try { await editTriage(edit); rt.toast(done, 'success', 'Model triage'); return true; }
    catch (e) { setError((e as Error).message); rt.toast((e as Error).message, 'danger', 'Model triage'); return false; }
    finally { setBusy(''); }
  };
  const refresh = async () => { setBusy('refresh'); await reload(); setBusy(''); };

  if (!cur) return error ? <p className="axp-gate__err" role="alert">{error}</p> : <p className="axp-gate__sub">Loading the model triage rules…</p>;
  const c = cur.config;
  const locked = busy !== '';
  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Model triage" data-axf-toolbar="gate.model-triage">
        <Chip tone={c.enabled ? 'success' : 'warning'}>{c.enabled ? 'Gate on' : 'Gate off'}</Chip>
        <Chip>{c.rules.filter((r) => r.enabled).length} of {c.rules.length} rules on</Chip>
        <span className="axp-gate__sub">{cur.approvalRequired ? 'Fable upgrades wait for Brett.' : 'Fable upgrades run without waiting.'}{c.by ? ` Last change by ${c.by}.` : ''}</span>
        <span className="axp-gate__bar-end">
          <Button id="vps-triage-refresh" icon="refresh" busy={busy === 'refresh'} onClick={() => void refresh()}>Refresh</Button>
          <Button id="vps-triage-reset" icon="undo" disabled={locked || !cur.stored} onClick={() => setAsking(true)}>Reset to starting rules</Button>
        </span>
      </div>
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      {asking && (
        <div className="axp-gate__ask" role="alertdialog" aria-label="Reset the model triage rules">
          <p>Put every rule, number and list back to the starting values? The history keeps what they were.</p>
          <div className="axp-gate__bar">
            <Button id="vps-triage-reset-confirm" tone="danger" icon="undo" disabled={locked} onClick={() => { setAsking(false); void send({ op: 'reset' }, 'The starting rules are back.'); }}>Reset</Button>
            <Button id="vps-triage-reset-cancel" onClick={() => setAsking(false)}>Keep my rules</Button>
          </div>
        </div>
      )}
      <Container title="The gate" icon="shield">
        <p className="axp-gate__sub">Every build step, emergency build, hand build and lander fix session gets its model here, on the VPS. The orchestrator only sends the work.</p>
        <div className="axp-gate__triage">
          <div className="axp-gate__stat" data-axf-target="setting:vps.modelTriage.enabled">
            <Switch label="Model triage gate" checked={c.enabled} disabled={locked} hint="Off: every lane gets the default model. Explicit overrides still win."
              onChange={(v) => void send({ op: 'enabled', enabled: v }, `The gate is ${v ? 'on' : 'off'}.`)} />
          </div>
          <div className="axp-gate__stat" data-axf-target="setting:vps.modelTriage.default">
            <SelectField label="When no rule matches" value={c.defaults.model} options={cur.registry.models} disabled={locked} onChange={(v) => void send({ op: 'defaults', model: v }, `${modelLabel(cur, v)} when no rule matches.`)} />
          </div>
          <div className="axp-gate__stat" data-axf-target="setting:vps.modelTriage.handRequest">
            <SelectField label="The model a hand launch asks for is" value={c.defaults.handRequest} disabled={locked} options={cur.registry.handRequest.map((v) => ({ value: v, label: HAND_LABELS[v] ?? v }))}
              onChange={(v) => void send({ op: 'defaults', handRequest: v }, 'Saved.')} />
          </div>
          <div className="axp-gate__stat" data-axf-target="setting:vps.modelTriage.briefWords">
            <Switch label="A brief or step that names its model wins" checked={c.defaults.briefWords} disabled={locked} hint="“Model: Fable”, a leading [Opus], “run it on Fable”."
              onChange={(v) => void send({ op: 'defaults', briefWords: v }, 'Saved.')} />
          </div>
        </div>
        {cur.buildPin && <p className="axp-gate__note" role="status">Every build runs on {modelLabel(cur, cur.buildPin.model)} right now ({cur.buildPin.by}). That is an explicit override: the rules below do not decide while it is set.</p>}
      </Container>
      <Container title="Rules, in order" icon="list" actions={<Chip>First match decides</Chip>}>
        <p className="axp-gate__sub">An explicit override always comes first: a pin on the step, a brief that names its model, or the build-wide model in Claude settings. Then the first rule that is on, covers the lane and matches. Then the default.</p>
        <ol className="axp-gate__arule-list">
          {c.rules.map((r, i) => <RuleRow key={r.id} t={cur} rule={r} index={i} busy={locked} send={send} />)}
        </ol>
      </Container>
      <Container title="Last decisions" icon="clock" collapsible defaultOpen actions={<Chip>{cur.decisions.length}</Chip>}>
        {cur.decisions.length
          ? <ol className="axp-gate__arule-list">{cur.decisions.map((d, i) => <DecisionRow key={`${d.at}:${i}`} t={cur} d={d} />)}</ol>
          : <p className="axp-gate__sub">No decisions yet. Each one appears here with the rule that fired, and on its step in the build.</p>}
      </Container>
    </>
  );
}
