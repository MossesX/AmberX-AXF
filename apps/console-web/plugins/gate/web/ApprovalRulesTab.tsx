/**
 * VPS Configuration → Approval rules: axHub's match-pattern policy rules, live. Per service an ordered list Brett adds
 * to, edits, reorders and removes from: which tools (a name or a pattern with `*`), the decision (allow, veto, confirm,
 * deny) and how long a veto holds. The first matching rule wins; a tool's own entry beats every rule until 'Let the
 * rules decide' clears it.
 *
 * Every edit is staged in a draft (the same draft REST, MCP, the CLI and voice stage into) and nothing changes on
 * axHub until Save. Save and Apply the default take Brett's own click: they are sent from this browser on his own hub
 * session, and a remote press of the button is refused (approvalRulesState.ts → saveApprovals).
 *
 * The question before a save is asked on the tab itself, never with the browser's confirm(): the console app's
 * overlay WebView cannot draw that dialog and answers "no" without showing anything. The first press opens the
 * question, and the answer (`vps-approvals-confirm`) is the click that saves. Without his axHub session the tab says so
 * and offers Sign in; every failed save shows its reason on the tab.
 * console-control@1: `tab:gate.tabs=approvals`; `setting:vps.approvals.<service>.rules | clearOwn | <n>.match |
 * <n>.policy | <n>.vetoSeconds`; buttons `button:vps-approvals-refresh | discard | save | default | confirm | cancel | signin` and, per service,
 * `vps-approvals-<service>-add | <n>-update | <n>-up | <n>-down | <n>-remove`; actions `vps.approvals.open | status |
 * add | edit | remove | move | clear-own | discard`.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { ApprovalRuleView, ApprovalRules, ApprovalService, Decision, StageOp } from './approval-core.mjs';
import { DEFAULT, ruleProblem } from './approval-core.mjs';
import { OWNER_ONLY, SaveError, cachedApprovals, hubSignInUrl, loadApprovals, onApprovals, saveApprovals, stageApproval } from './approvalRulesState';

const T = 'VPS Configuration';
const DECISION_LABEL: Record<Decision, string> = { allow: 'Allow: runs at once', veto: 'Veto: runs after the hold unless denied', confirm: 'Confirm: waits for Brett', deny: 'Deny: never runs' };
const DECISION_OPTIONS = (Object.keys(DECISION_LABEL) as Decision[]).map((value) => ({ value, label: DECISION_LABEL[value] }));
const RULE_OPTIONS = [...DECISION_OPTIONS, { value: '', label: 'Hold length only' }];
const TONE: Record<Decision, 'success' | 'warning' | 'accent' | 'danger'> = { allow: 'success', veto: 'warning', confirm: 'accent', deny: 'danger' };

/** The rule a row's fields describe, as the hub takes it; `problem` says what is wrong in plain words. */
function draftRule(match: string, policy: string, seconds: string) {
  const rule = { match: match.trim(), ...(policy ? { policy } : {}), ...(seconds.trim() ? { vetoSeconds: /^\d+$/.test(seconds.trim()) ? Number(seconds.trim()) : seconds.trim() } : {}) };
  return { rule, problem: ruleProblem(rule) };
}

function RuleRow({ service, rule, index, last, hold, busy, stage }: { service: ApprovalService; rule: ApprovalRuleView; index: number; last: boolean; hold: ApprovalRules['hold']; busy: boolean; stage: (op: StageOp, done?: string) => void }) {
  const [match, setMatch] = useState(rule.match);
  const [seconds, setSeconds] = useState(rule.vetoSeconds ? String(rule.vetoSeconds) : '');
  useEffect(() => { setMatch(rule.match); setSeconds(rule.vetoSeconds ? String(rule.vetoSeconds) : ''); }, [rule.match, rule.vetoSeconds]);
  const edited = match.trim() !== rule.match || seconds.trim() !== (rule.vetoSeconds ? String(rule.vetoSeconds) : '');
  const { problem } = draftRule(match, rule.policy ?? '', seconds);
  const id = `vps-approvals-${service.service}-${index + 1}`;
  const address = `setting:vps.approvals.${service.service}.${index + 1}`;
  const n = index + 1;
  return (
    <li className="axp-gate__arule" data-rule={`${service.service}.${n}`}>
      <span className="axp-gate__arule-n" aria-hidden="true">{n}</span>
      <div className="axp-gate__arule-field" data-axf-target={`${address}.match`}>
        <TextField label={`Rule ${n}: tools`} mono value={match} onChange={setMatch} hint="A name, or a pattern: * is anything." error={edited && problem ? problem : undefined} />
      </div>
      <div className="axp-gate__arule-field" data-axf-target={`${address}.policy`}>
        <SelectField label={`Rule ${n}: decision`} value={rule.policy ?? ''} options={RULE_OPTIONS} disabled={busy}
          onChange={(v) => stage({ op: 'edit', service: service.service, index, rule: { policy: v || null } })} />
      </div>
      <div className="axp-gate__arule-field axp-gate__arule-field--hold" data-axf-target={`${address}.vetoSeconds`}>
        <TextField label={`Rule ${n}: hold (seconds)`} type="number" value={seconds} onChange={setSeconds} placeholder={String(hold.default)} hint={`${hold.min}-${hold.max}. Empty: ${hold.default}.`} />
      </div>
      <div className="axp-gate__arule-end">
        <Chip tone={rule.decides ? (rule.policy ? TONE[rule.policy] : undefined) : 'warning'}>{rule.policy ? `Decides ${rule.decides} tool${rule.decides === 1 ? '' : 's'}` : 'Hold only'}</Chip>
        {edited && <Button id={`${id}-update`} size="sm" tone="primary" icon="check" disabled={busy || !!problem} onClick={() => stage({ op: 'edit', service: service.service, index, rule: { match: match.trim(), vetoSeconds: seconds.trim() || null } })}>Update rule {n}</Button>}
        <Button id={`${id}-up`} size="sm" tone="ghost" icon="chevron-up" disabled={busy || index === 0} onClick={() => stage({ op: 'move', service: service.service, index, to: index - 1 })}>Move rule {n} up</Button>
        <Button id={`${id}-down`} size="sm" tone="ghost" icon="chevron-down" disabled={busy || last} onClick={() => stage({ op: 'move', service: service.service, index, to: index + 1 })}>Move rule {n} down</Button>
        <Button id={`${id}-remove`} size="sm" tone="ghost" icon="trash" disabled={busy} onClick={() => stage({ op: 'remove', service: service.service, index }, `Rule ${n} removed from the draft.`)}>Remove rule {n}</Button>
      </div>
      {rule.policy && rule.decides === 0 && <p className="axp-gate__note axp-gate__arule-wide">Decides no tool right now: nothing matches, an earlier rule wins, or the matching tools have their own entry.</p>}
      {rule.sample.length > 0 && <p className="axp-gate__sub axp-gate__arule-wide">{rule.sample.join(', ')}{rule.decides > rule.sample.length ? ` and ${rule.decides - rule.sample.length} more` : ''}</p>}
    </li>
  );
}

function AddRule({ service, hold, busy, stage }: { service: ApprovalService; hold: ApprovalRules['hold']; busy: boolean; stage: (op: StageOp, done?: string) => void }) {
  const [match, setMatch] = useState('');
  const [policy, setPolicy] = useState<string>('veto');
  const [seconds, setSeconds] = useState('');
  const { rule, problem } = draftRule(match, policy, seconds);
  const add = () => { stage({ op: 'add', service: service.service, rule }, `Rule added to the ${service.displayName} draft.`); setMatch(''); setSeconds(''); };
  return (
    <div className="axp-gate__arule axp-gate__arule--add">
      <span className="axp-gate__arule-n" aria-hidden="true">+</span>
      <div className="axp-gate__arule-field"><TextField label={`New ${service.displayName} rule: tools`} mono value={match} onChange={setMatch} placeholder="build_*" hint="A name, or a pattern: * is anything." error={match && problem ? problem : undefined} /></div>
      <div className="axp-gate__arule-field"><SelectField label={`New ${service.displayName} rule: decision`} value={policy} options={RULE_OPTIONS} onChange={setPolicy} /></div>
      <div className="axp-gate__arule-field axp-gate__arule-field--hold"><TextField label={`New ${service.displayName} rule: hold (seconds)`} type="number" value={seconds} onChange={setSeconds} placeholder={String(hold.default)} hint={`${hold.min}-${hold.max}. Empty: ${hold.default}.`} /></div>
      <div className="axp-gate__arule-end"><Button id={`vps-approvals-${service.service}-add`} size="sm" tone="primary" icon="plus" disabled={busy || !match.trim() || !!problem} onClick={add}>Add rule to {service.displayName}</Button></div>
    </div>
  );
}

function ServiceRules({ service, hold, busy, stage }: { service: ApprovalService; hold: ApprovalRules['hold']; busy: boolean; stage: (op: StageOp, done?: string) => void }) {
  const c = service.counts;
  return (
    <Container title={service.displayName} icon="shield" collapsible defaultOpen={service.rules.length > 0 || service.changed}
      actions={<span className="axp-gate__bar">{service.changed && <Chip tone="warning">Unsaved</Chip>}<Chip>{service.rules.length} rule{service.rules.length === 1 ? '' : 's'}</Chip></span>}>
      <div className="axp-gate__arules" data-service={service.service}>
        <p className="axp-gate__sub">{service.tools} tools now: {c.allow} run at once, {c.veto} on a veto, {c.confirm} wait for a confirm, {c.deny} denied.{service.enabled ? '' : ' The service is off.'} The first rule that matches a tool decides it.</p>
        {service.rules.length > 0
          ? <ol className="axp-gate__arule-list">{service.rules.map((r, i) => <RuleRow key={`${i}:${r.match}`} service={service} rule={r} index={i} last={i === service.rules.length - 1} hold={hold} busy={busy} stage={stage} />)}</ol>
          : <p className="axp-gate__sub">No rules: every tool follows its own entry or the service.</p>}
        <AddRule service={service} hold={hold} busy={busy} stage={stage} />
        {(service.own > 0 || service.clearOwn) && (
          <div data-axf-target={`setting:vps.approvals.${service.service}.clearOwn`}>
            <Switch label={`Let the rules decide for ${service.displayName}`} checked={service.clearOwn} disabled={busy}
              hint={`${service.own} tool${service.own === 1 ? ' has' : 's have'} an entry of ${service.own === 1 ? 'its' : 'their'} own, which beats every rule. On: Save clears them. Denied tools and deletes keep theirs.`}
              onChange={(on) => stage({ op: 'clear-own', service: service.service, on })} />
          </div>
        )}
      </div>
    </Container>
  );
}

type Ask = '' | 'save' | 'default';

export function ApprovalRulesTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const [cur, setCur] = useState<ApprovalRules | null>(cachedApprovals);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<Ask>('');
  const [needSignIn, setNeedSignIn] = useState(false);
  useEffect(() => onApprovals(setCur), []);
  const reload = async () => { try { await loadApprovals(); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => {
    void reload();
    const t = window.setInterval(() => { if (!document.hidden) void reload(); }, Math.max(5, refreshSec) * 1000);
    return () => window.clearInterval(t);
  }, [refreshSec]);
  const run = async (what: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(what); setError(''); setNeedSignIn(false);
    try { await work(); if (done) rt.toast(done, 'success', T); }
    catch (e) {
      const message = (e as Error).message || 'It failed, and the console gave no reason.';
      setError(message); setNeedSignIn(e instanceof SaveError && e.code === 'signin');
      if (what === 'save' || what === 'default') rt.toast(message, 'danger', T);
    } finally { setBusy(''); }
  };
  const stage = (op: StageOp, done?: string) => void run('stage', () => stageApproval(op), done);
  // the answer to the question is the click that saves: it must be Brett's own (saveApprovals refuses anything else)
  const answer = (e: MouseEvent<HTMLButtonElement>) => {
    const what = ask;
    setAsk('');
    if (what === 'save') void run('save', () => saveApprovals(e), 'Approval rules saved on axHub.');
    if (what === 'default') void run('default', async () => { await stageApproval({ op: 'default' }); await saveApprovals(e, DEFAULT.reason); }, 'The default is applied: only VPS shell commands hold.');
  };

  if (!cur) return error ? <p className="axp-gate__err" role="alert">{error}</p> : <p className="axp-gate__sub">Reading the approval rules from axHub…</p>;
  const locked = !cur.canSave;
  const b = !!busy;
  const signIn = (
    <Button id="vps-approvals-signin" tone="primary" icon="key" disabled={!cur.hub} onClick={() => { if (cur.hub) globalThis.location?.assign(hubSignInUrl(cur.hub)); }}>Sign in to axHub</Button>
  );
  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Approval rules" data-axf-toolbar="gate.approvals">
        {cur.available && <Chip tone={cur.default.applied ? 'success' : 'warning'}>{cur.default.applied ? 'Default applied' : 'Default not applied'}</Chip>}
        {cur.pending > 0 && <Chip tone="warning">{cur.pending} unsaved</Chip>}
        <span className="axp-gate__bar-end">
          <Button id="vps-approvals-refresh" icon="refresh" busy={busy === 'refresh'} onClick={() => void run('refresh', reload)}>Refresh</Button>
          <Button id="vps-approvals-discard" icon="undo" disabled={b || !cur.pending} onClick={() => stage({ op: 'discard' }, 'Draft dropped. axHub was never changed.')}>Discard draft</Button>
          <Button id="vps-approvals-default" icon="zap" busy={busy === 'default'} disabled={b || locked || !cur.available || (cur.default.applied && !cur.pending)} title={locked ? OWNER_ONLY : undefined}
            aria-expanded={ask === 'default'} onClick={() => { setError(''); setAsk('default'); }}>Apply the default</Button>
          <Button id="vps-approvals-save" tone="primary" icon="save" busy={busy === 'save'} disabled={b || locked || !cur.save} title={locked ? OWNER_ONLY : undefined}
            aria-expanded={ask === 'save'} onClick={() => { setError(''); setAsk('save'); }}>Save</Button>
        </span>
      </div>
      {ask && !locked && (
        <Note tone="warning">
          <div className="axp-gate__ask" data-ask={ask}>
            <span>{ask === 'default' ? `Apply the default on axHub now? ${DEFAULT.summary}` : `Save the approval rules on axHub? ${cur.pending} service${cur.pending === 1 ? '' : 's'} change${cur.pending === 1 ? 's' : ''}.`}</span>
            <span className="axp-gate__bar">
              <Button id="vps-approvals-confirm" tone="primary" icon="check" disabled={b} onClick={answer}>{ask === 'default' ? 'Yes, apply the default' : 'Yes, save'}</Button>
              <Button id="vps-approvals-cancel" icon="x" onClick={() => setAsk('')}>Cancel</Button>
            </span>
          </div>
        </Note>
      )}
      {error && (
        <Note tone="danger">
          <div className="axp-gate__ask">
            <span className="axp-gate__err">{error}</span>
            {needSignIn && <span className="axp-gate__bar">{signIn}</span>}
          </div>
        </Note>
      )}
      {locked && !needSignIn && (
        <Note tone="warning">
          <div className="axp-gate__ask" data-locked="">
            <span><strong>Save and Apply the default are off here.</strong> This page is not on your axHub sign-in, so it can only stage edits as a draft. {OWNER_ONLY}</span>
            <span className="axp-gate__bar">{signIn}</span>
          </div>
        </Note>
      )}
      {!cur.available ? <Note tone="warning">Approval rules can't be shown: {cur.message}</Note> : (
        <>
          <Note tone={cur.default.applied ? 'success' : 'info'}><strong>The default.</strong> {DEFAULT.summary}{cur.default.applied ? ' It is applied.' : ' Apply the default sets it in one go.'}</Note>
          {cur.draft && <Note tone="warning">Unsaved changes{cur.draft.by ? `, last staged by ${cur.draft.by}` : ''}{cur.draft.at ? ` on ${new Date(cur.draft.at).toLocaleString()}` : ''}. Nothing changes on axHub until Save.</Note>}
          {cur.services.map((s) => <ServiceRules key={s.service} service={s} hold={cur.hold} busy={b} stage={stage} />)}
        </>
      )}
    </>
  );
}
