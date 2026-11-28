import { useEffect, useState } from 'react';
import { Button, Icon, Slot, useRuntime } from '@console/axf/react';
import { BUILD_STATUSES } from './status-table-core.mjs';
import { pluginApi } from '@console/plugins';
import * as core from './orchestrator-core.mjs';
import { PipelineTab } from './pipeline';
import { GroupsBoard } from './groups';
import { WatchdogTab } from './watchdog';
import { StatusTable, setTableFilter, type Filters } from './StatusTable';
import { SlotsStrip } from './SlotsStrip';
import { readSlotsLayout } from './Settings';
import * as consoleApi from '@console/api';
import './orchestrator.css';

/*
 * Build orchestrator page (Pipeline 2.0, Brett, Nov 18-19 2026): ONE table driven only by status (StatusTable.tsx).
 * Builds are rows that expand to their steps. The page has two lists (Nov 28 2026): Builds shows only sent builds
 * (queued, building, built) plus landed, and Pending keeps its own tab. Every former tab is a filter on the table's
 * toolbar (openTab maps the old tab ids onto a list and a filter, so deep links and voice commands keep working). The merge queue is the
 * same table filtered to merging-pr through merging-main (slot builds.merge-queue, which the merge-queue@2 view renders). What used to be the non-build tabs
 * (Accounts, Watchdog, Groups, Approvals, Rules) are panels of Settings → Plugins → Build orchestrator.
 * Deep link: nav:build-orchestrator, or action build-orchestrator.focus:<build | status | old tab id>.
 */

export const FOLDER = 'build-orchestrator';
const api = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Step = { id: string; text: string; model: 'Fable' | 'Opus'; why: string; phase: string; group: string; estimate: string; files: string[]; checks: string[]; session: 'same' | 'new'; agent: boolean; done: boolean; doneAt: string; note: string };
type Build = { id: string; title: string; category: string; detail: string; status: string; hidden: boolean; source: string; pendingId: string; branch: string; pr: string; createdAt: string; updatedAt: string; builtAt: string; notes: { text: string; at: string }[]; approvals: { phase: number; from: string; to: string; at: string; by?: string; via?: string; kind?: string; selfApproved?: boolean }[]; upgradeRequests?: { id: string; phase: number; from: string; to: string; at: string; by: string; state: string }[]; origin?: unknown; steps: Step[] };
type Rules = { sameSession: boolean; subAgents: boolean; approveModelSwitch: boolean; maxStepMinutes: number };
type State = { updatedAt: string; rules: Rules; builds: Build[] };
type Res = { ok: boolean; error?: string; state?: State; log?: string[]; upgradePolicy?: { approvalRequired: boolean; source: string } };
type Act = (c: Record<string, unknown>) => Promise<boolean>;

/**
 * The old tab ids (Pending, Queue, Active …) and what each now is: a filter on the one table. Kept so every deep link,
 * console command and voice phrase that names a tab still lands somewhere sensible.
 */
export const TABS = [
  { id: 'pending', label: 'Pending', filter: {} }, { id: 'queue', label: 'Ready', filter: { status: 'ready' } },
  { id: 'active', label: 'Building', filter: { status: 'building' } }, { id: 'incomplete', label: 'Failed', filter: { status: 'failed' } },
  { id: 'errors', label: 'Failed', filter: { status: 'failed' } }, { id: 'complete', label: 'Landed', filter: { status: 'landed', landed: true } },
  { id: 'merge-queue', label: 'Merge queue', filter: { status: 'merging-pr' } }, { id: 'builds', label: 'All builds', filter: {} },
  { id: 'archive', label: 'All builds', filter: {} }, { id: 'deleted', label: 'All builds', filter: {} },
] as const satisfies readonly { id: string; label: string; filter: Partial<Filters> }[];
/** Old tab ids that name a list rather than a status. */
const LIST_OF_TAB: Record<string, 'sent' | 'pending'> = { pending: 'pending', builds: 'sent', archive: 'sent', deleted: 'sent' };
/** Settings panels that used to be tabs: a deep link to one opens Settings → Plugins → Build orchestrator. */
export const SETTINGS_TABS = ['accounts', 'watchdog', 'groups', 'approvals', 'rules'] as const;

/** A tab id from before Pipeline 2.0, or a contract status: the table takes it as its filter. */
export function openTab(t: string) {
  const tab = TABS.find((x) => x.id === t);
  if (tab) { setTableFilter({ status: '', account: '', model: '', date: '', text: '', ...tab.filter }, LIST_OF_TAB[tab.id]); return true; }
  if ((BUILD_STATUSES as readonly string[]).includes(t)) { setTableFilter({ status: t, ...(t === 'landed' ? { landed: true } : {}) }); return true; }
  return false;
}

export function OrchestratorPage() {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · Pipeline 2.0</p>
          <h1>Builds</h1>
          <p className="fx-muted">Sent builds (queued, building, built) and landed ones, with their steps, live from the builds store. Pending builds wait in their own tab; one is queued at a time and the next moves up by itself.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Slot name="builds.toolbar" props={{ page: 'build-orchestrator' }} /></div>
      </header>
      <SlotsStrip api={api} layout={readSlotsLayout()} />
      <StatusTable api={api} />
    </div>
  );
}

/** The orchestrator state for the settings panels that need it (rules, approvals). */
function useOrchState() {
  const rt = useRuntime();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void api.call<Res>('state').then((r) => { if (!r.ok) throw new Error(r.error); if (r.upgradePolicy) core.setUpgradePolicy(r.upgradePolicy); setState(r.state!); }).catch((e: Error) => setError(e.message)); }, []);
  const act: Act = async (change) => {
    setBusy(true);
    try {
      const r = await api.post<Res>('act', change);
      if (!r.ok) { rt.toast(r.error ?? 'Change failed', 'danger'); return false; }
      for (const l of r.log ?? []) rt.terminal.log('orchestrator', l, 'ok');
      if (r.state) setState(r.state);
      return true;
    } catch (e) { rt.toast((e as Error).message, 'danger'); return false; }
    finally { setBusy(false); }
  };
  return { state, busy, error, act };
}

export function RulesPanel() {
  const { state, busy, error, act } = useOrchState();
  if (!state) return <div className="fx-empty">{error || 'Loading the rules…'}</div>;
  return <RulesTab rules={state.rules} busy={busy} act={act} />;
}
export function ApprovalsPanel() {
  const { state, busy, error, act } = useOrchState();
  if (!state) return <div className="fx-empty">{error || 'Loading the approvals…'}</div>;
  return <ApprovalsTab state={state} busy={busy} act={act} />;
}
export function AccountsPanel() {
  const rt = useRuntime();
  return <PipelineTab api={api} log={(t, l = 'info') => rt.terminal.log('orchestrator', t, l)} view="accounts" />;
}
export function GroupsPanel() {
  const rt = useRuntime();
  return <GroupsBoard api={api} log={(t, l = 'info') => rt.terminal.log('orchestrator', t, l)} />;
}
export function WatchdogStatusPanel() {
  return <WatchdogTab focus={consoleApi.readLocal<string>('orch-watchdog-build', '')} />;
}

/** Who gave an approval, as one plain line (old records carry no name). */
function approvalBy(b: Build, p: core.Phase): string {
  const a = [...b.approvals].reverse().find((x) => x.phase === p.index && x.to === p.model);
  if (!a) return '';
  if (a.selfApproved) return `Self-approved by ${a.by || 'a session'}, not you: doesn't count`;
  if (a.kind === 'downgrade') return 'Recorded by itself';
  if (a.via === 'policy') return `Upgraded by itself (Fable upgrades need my approval was off) · ${a.at.slice(0, 16).replace('T', ' ')}`;
  return a.via ? `Approved by ${a.by} (${a.via === 'axhub' ? 'axHub' : 'console'})` : 'Approved before Nov 3 2026 (approver not recorded)';
}

function ApprovalsTab({ state, busy, act }: { state: State; busy: boolean; act: Act }) {
  const gates = state.builds.flatMap((b) => core.phases(b).filter((p) => p.gate).map((p) => ({ b, p })));
  if (!gates.length) return <div className="fx-empty">No model switches in any build.</div>;
  return (
    <div className="pd-list" role="list">
      <p className="fx-small fx-muted">{core.upgradePolicy().approvalRequired
        ? 'Upgrades (Opus → Fable) wait for you: your click here, or the axHub approval a session asks for. A downgrade (Fable → Opus) goes on by itself.'
        : 'Fable upgrades need my approval is off (Settings → Plugins → Claude): a phase that needs Fable runs on Fable by itself and is logged here. A downgrade goes on by itself too.'}</p>
      {gates.map(({ b, p }) => {
        const down = p.kind === 'downgrade';
        const req = (b.upgradeRequests ?? []).find((x) => x.phase === p.index && x.state === 'open');
        const by = approvalBy(b, p);
        return (
          <article key={`${b.id}-${p.index}`} className={`pd-card ${p.approved ? 'is-complete' : 'is-pending'}`} role="listitem">
            <div className="pd-card__top">
              <h2 className="pd-card__title">{b.title}<span className="fx-muted fx-small"> · phase {p.index + 1}</span></h2>
              <span className={`pd-badge oc-badge is-${p.approved ? 'complete' : 'waiting'}`}>{down ? 'Downgrade' : p.approved ? (b.approvals.some((a) => a.phase === p.index && a.via !== 'policy') || core.upgradePolicy().approvalRequired ? 'Upgrade approved' : 'Upgrade: automatic') : 'Upgrade: needs you'}</span>
            </div>
            <div className="pd-meta"><span className={`oc-model is-${p.from.toLowerCase()}`}>{p.from}</span><Icon name="chevron-right" size={13} /><span className={`oc-model is-${p.model.toLowerCase()}`}>{p.model}</span><span>{p.steps.length} steps · {core.formatMinutes(p.minutesLeft) || 'done'}</span></div>
            {by && <p className="fx-small fx-muted">{by}</p>}
            {req && <p className="fx-small">Asked by {req.by || 'a session'} · {req.at.slice(0, 16).replace('T', ' ')}</p>}
            {!p.approved && <div><Button tone="primary" icon="check" disabled={busy} onClick={() => act({ action: 'approve', id: b.id, phase: p.index })}>Approve upgrade to {p.model}</Button></div>}
          </article>
        );
      })}
    </div>
  );
}

function RulesTab({ rules, busy, act }: { rules: Rules; busy: boolean; act: Act }) {
  const [r, setR] = useState(rules);
  useEffect(() => setR(rules), [rules]);
  const flip = (k: keyof Rules) => setR((x) => ({ ...x, [k]: !x[k] }));
  return (
    <div className="fx-stack">
      <article className="pd-card">
        <h2 className="pd-card__title">Token rules</h2>
        <label className="fx-row"><input type="checkbox" checked={r.sameSession} onChange={() => flip('sameSession')} />Stay in one session (a step can still ask for a new one)</label>
        <label className="fx-row"><input type="checkbox" checked={r.subAgents} onChange={() => flip('subAgents')} />Allow sub-agents (off = only steps marked “sub-agent ok”)</label>
        <p className="fx-small fx-muted">Model switches: an upgrade always waits for your approval; a downgrade goes on by itself (Nov 3 2026, not a setting).</p>
        <label className="pd-field">Largest step (minutes, {core.STEP_MINUTES} at most)<input className="fx-input" type="number" min={1} max={core.STEP_MINUTES} value={core.maxStep(r)} onChange={(e) => setR((x) => ({ ...x, maxStepMinutes: Number(e.target.value) }))} /></label>
        <p className="fx-small fx-muted">Steps are checkpoints inside one session: it commits and ticks each one as it goes, with no new prompt or launch per step.</p>
        <div><Button tone="primary" icon="save" disabled={busy} onClick={() => act({ action: 'rules', rules: r })}>Save rules</Button></div>
      </article>
      <article className="pd-card">
        <h2 className="pd-card__title">Which model a step gets</h2>
        {core.MODELS.map((m) => <p key={m}><span className={`oc-model is-${m.toLowerCase()}`}>{m}</span> {(core.MODEL_GUIDE as Record<string, string>)[m]}</p>)}
        <p className="fx-small fx-muted">Any session: <span className="fx-mono">node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next</span> then <span className="fx-mono">brief &lt;id&gt;</span>.</p>
      </article>
    </div>
  );
}
