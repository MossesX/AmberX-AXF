/**
 * Approvals & veto: axHub's tool policy, live. Per service or per tool: allow, veto (with its hold) or confirm; the
 * longest pass; and Brett's default (hold only VPS writes and account switches) as a plan he applies with one click.
 * Reads come through the plugin's server with the hub token. Writes go from this browser straight to axHub on Brett's
 * own hub session: the console server cannot write policy, and neither can a session or a token.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Container, Note, SelectField, TextField } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { VETO_MAX, VETO_MIN, counts, groupChanges, groupDecision, planDefaults, putPolicy, secondsOk, type Decision, type PlanRow, type PolicyChange, type PolicyRules, type PolicyService, type PolicyTable, type PolicyTool } from './policy-core.mjs';

const FOLDER = 'claude-settings';
const POLL_MS = 30000;
const DECISION_OPTIONS = [{ value: 'allow', label: 'Allow' }, { value: 'veto', label: 'Veto' }, { value: 'confirm', label: 'Confirm' }];
const TOOL_OPTIONS = [{ value: '', label: 'Follow the service' }, ...DECISION_OPTIONS, { value: 'deny', label: 'Deny' }];

interface Live { available: boolean; hub: string; table?: PolicyTable; rules?: PolicyRules; message?: string }

function useApply(hub: string, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = useCallback(async (changes: PolicyChange[], reason: string) => {
    setBusy(true); setError('');
    const r = await putPolicy(hub, changes, reason);
    setBusy(false);
    if (!r.ok) setError(r.message ?? 'axHub refused.');
    refresh();
  }, [hub, refresh]);
  return { busy, error, apply };
}

function HoldField({ seconds, busy, onSave }: { seconds: number; busy: boolean; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState(String(seconds));
  useEffect(() => setDraft(String(seconds)), [seconds]);
  const n = Number(draft);
  return (
    <div className="axp-cs-row__edit">
      <TextField label="Hold (seconds)" type="number" value={draft} hint={`${VETO_MIN}-${VETO_MAX}`} onChange={setDraft} />
      {draft !== String(seconds) && <Button size="sm" tone="primary" icon="save" disabled={busy || !secondsOk(n)} onClick={() => onSave(n)}>Save</Button>}
    </div>
  );
}

function ToolRow({ service, tool, busy, apply }: { service: PolicyService; tool: PolicyTool; busy: boolean; apply: (c: PolicyChange[], why: string) => void }) {
  const a = tool.annotations ?? {};
  const note = a.destructive ? 'Destructive: the hub never lets it below confirm.' : a.explicitApproval ? 'Always a straight approval.' : a.ownerGrant ? 'An owner grant: never allow.' : a.readOnly ? 'A read.' : '';
  const raised = tool.explicit && tool.explicit !== tool.policy;
  return (
    <div className="axp-cs-row" data-tool={`${service.namespace}.${tool.name}`}>
      <div className="axp-cs-row__control">
        <SelectField label={tool.name} value={tool.explicit ?? ''} options={TOOL_OPTIONS} disabled={busy} hint={`Now: ${tool.policy}.${raised ? ' The hub raised it.' : ''} ${note}`} onChange={(v) => apply([{ service: service.namespace, tool: tool.name, policy: v ? (v as Decision) : null }], `${service.namespace}.${tool.name} to ${v || 'the service default'}`)} />
      </div>
      {tool.policy === 'veto' && <div className="axp-cs-row__badge"><HoldField seconds={tool.vetoSeconds ?? 90} busy={busy} onSave={(n) => apply([{ service: service.namespace, tool: tool.name, vetoSeconds: n }], `${service.namespace}.${tool.name} hold to ${n} s`)} /></div>}
    </div>
  );
}

function ServiceCard({ service, busy, apply, find }: { service: PolicyService; busy: boolean; apply: (c: PolicyChange[], why: string) => void; find: string }) {
  const [open, setOpen] = useState(false);
  const group = groupDecision(service);
  const q = find.trim().toLowerCase();
  const tools = q ? service.tools.filter((t) => `${service.namespace}.${t.name}`.toLowerCase().includes(q)) : service.tools;
  const held = service.tools.filter((t) => t.policy === 'veto').length;
  return (
    <Container title={service.namespace} icon="plug" collapsible defaultOpen={!!q}>
      <div className="fx-stack">
        <p className="axp-cs-group__desc">{service.tools.length} tools, {held} on a veto{service.enabled ? '' : ', service off'}{service.toolsStale ? ', list from cache' : ''}.</p>
        <SelectField label="Every tool here" value={group === 'mixed' ? '' : group} options={group === 'mixed' ? [{ value: '', label: 'Mixed' }, ...DECISION_OPTIONS] : DECISION_OPTIONS} disabled={busy} hint="Sets each tool. The hub's own rules still hold: destructive tools stay on confirm." onChange={(v) => { if (v) apply(groupChanges(service, v as Decision), `every ${service.namespace} tool to ${v}`); }} />
        {!open && !q ? <Button size="sm" tone="ghost" icon="chevron-down" onClick={() => setOpen(true)}>Show {service.tools.length} tools</Button>
          : tools.map((t) => <ToolRow key={t.name} service={service} tool={t} busy={busy} apply={apply} />)}
      </div>
    </Container>
  );
}

function DefaultPlan({ plan, busy, apply }: { plan: PlanRow[]; busy: boolean; apply: (c: PolicyChange[], why: string) => void }) {
  if (!plan.length) return <Note tone="success">The policy matches your default: only VPS writes and account switches hold.</Note>;
  const toAllow = plan.filter((p) => p.to === 'allow').length;
  return (
    <Container title="Your default" icon="zap" collapsible defaultOpen={false} actions={<Button size="sm" tone="primary" icon="check" disabled={busy} confirm={`Apply ${plan.length} changes on axHub?`} onClick={() => apply(plan.map((p) => ({ service: p.service, tool: p.tool, policy: p.to })), 'Default: hold only VPS writes and account switches')}>Apply {plan.length} changes</Button>}>
      <div className="fx-stack">
        <p className="axp-cs-group__desc">Holds only VPS writes and account switches. {toAllow} tools would stop holding. Destructive tools keep their confirm.</p>
        <ul className="axp-cs-plan">{plan.slice(0, 200).map((p) => <li key={`${p.service}.${p.tool}`}><code>{p.service}.{p.tool}</code> {p.from} → {p.to}: {p.why}</li>)}</ul>
        {plan.length > 200 && <p className="axp-cs-group__desc">And {plan.length - 200} more.</p>}
      </div>
    </Container>
  );
}

function LongestPass() {
  const [max, setMax] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void pluginFetch(FOLDER, 'passes').then((r) => r.json()).then((j: { maxMinutes?: number }) => { if (j.maxMinutes) { setMax(String(j.maxMinutes)); setSaved(String(j.maxMinutes)); } }).catch(() => undefined); }, []);
  const save = async () => {
    setError('');
    const r = await pluginFetch(FOLDER, 'passes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxMinutes: Number(max) }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; maxMinutes?: number; message?: string };
    if (j.ok && j.maxMinutes) { setMax(String(j.maxMinutes)); setSaved(String(j.maxMinutes)); } else setError(j.message ?? 'Not saved');
  };
  if (!saved) return null;
  return (
    <div className="axp-cs-row">
      <div className="axp-cs-row__control axp-cs-row__edit">
        <TextField label="Longest pass (minutes)" type="number" value={max} hint="1-240. No wait's Stay on for sits above." onChange={setMax} />
        {max !== saved && <Button size="sm" tone="primary" icon="save" onClick={() => void save()}>Save</Button>}
      </div>
      {error && <Note tone="danger">{error}</Note>}
    </div>
  );
}

export function ApprovalsPanel() {
  const [live, setLive] = useState<Live | null>(null);
  const [find, setFind] = useState('');
  const refresh = useCallback(() => { void pluginFetch(FOLDER, 'policy').then((r) => r.json()).then((j: Live) => setLive(j)).catch(() => setLive({ available: false, hub: '', message: 'The console could not ask axHub.' })); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  const { busy, error, apply } = useApply(live?.hub ?? '', refresh);
  const plan = useMemo(() => (live?.table ? planDefaults(live.table, live.rules) : []), [live]);
  const n = counts(live?.table);
  return (
    <div className="fx-stack">
      <LongestPass />
      {!live ? <p className="axp-cs-group__desc">Reading axHub's policy…</p>
        : !live.available || !live.table ? <Note tone="warning">Tool policy can't be shown: {live.message}</Note> : (
          <>
            <p className="axp-cs-group__desc" role="status">{n.allow} run at once, {n.veto} on a veto, {n.confirm} need your confirm, {n.deny} denied. Changes go to axHub from your own hub session.</p>
            {error && <Note tone="danger">{error}</Note>}
            <DefaultPlan plan={plan} busy={busy} apply={(c, w) => void apply(c, w)} />
            <TextField label="Find a tool" value={find} onChange={setFind} />
            {live.table.services.map((s) => <ServiceCard key={s.namespace} service={s} busy={busy} find={find} apply={(c, w) => void apply(c, w)} />)}
          </>
        )}
    </div>
  );
}
