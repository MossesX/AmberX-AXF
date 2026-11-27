import { useEffect, useRef, useState } from 'react';
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
import { LoadMore, PAGE_SIZE, addPage, pageOf, pageQuery, readWindow, type Paged } from './paging';
import * as consoleApi from '@console/api';
import './orchestrator.css';

/*
 * Build orchestrator page (Pipeline 2.0, Brett, Nov 18-19 2026): ONE table driven only by status (StatusTable.tsx).
 * No tabs: builds are rows that expand to their steps, and every former tab is a filter on the table's toolbar
 * (openTab maps the old tab ids onto filters, so deep links and voice commands keep working). The merge queue is the
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
type Res = Paged & { ok: boolean; error?: string; state?: State; log?: string[]; upgradePolicy?: { approvalRequired: boolean; source: string } };
type Act = (c: Record<string, unknown>) => Promise<boolean>;

/**
 * The old tab ids (Pending, Queue, Active …) and what each now is: a filter on the one table. Kept so every deep link,
 * console command and voice phrase that names a tab still lands somewhere sensible.
 */
export const TABS = [
  { id: 'pending', label: 'Pending', filter: { status: 'pending' } }, { id: 'queue', label: 'Ready', filter: { status: 'ready' } },
  { id: 'active', label: 'Building', filter: { status: 'building' } }, { id: 'incomplete', label: 'Failed', filter: { status: 'failed' } },
  { id: 'errors', label: 'Failed', filter: { status: 'failed' } }, { id: 'complete', label: 'Landed', filter: { status: 'landed', landed: true } },
  { id: 'merge-queue', label: 'Merge queue', filter: { status: 'merging-pr' } }, { id: 'builds', label: 'All builds', filter: {} },
  { id: 'archive', label: 'All builds', filter: {} }, { id: 'deleted', label: 'All builds', filter: {} },
] as const satisfies readonly { id: string; label: string; filter: Partial<Filters> }[];
/** Settings panels that used to be tabs: a deep link to one opens Settings → Plugins → Build orchestrator. */
export const SETTINGS_TABS = ['accounts', 'watchdog', 'groups', 'approvals', 'rules'] as const;

/** A tab id from before Pipeline 2.0, or a contract status: the table takes it as its filter. */
export function openTab(t: string) {
  const tab = TABS.find((x) => x.id === t);
  if (tab) { setTableFilter({ status: '', account: '', model: '', date: '', text: '', ...tab.filter }); return true; }
  if ((BUILD_STATUSES as readonly string[]).includes(t)) { setTableFilter({ status: t, landed: t === 'landed' }); return true; }
  return false;
}

export function OrchestratorPage() {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · Pipeline 2.0</p>
          <h1>Builds</h1>
          <p className="fx-muted">Every build and its steps, by status, live from the builds store. One build is active at a time; a ready build starts by itself.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Slot name="builds.toolbar" props={{ page: 'build-orchestrator' }} /></div>
      </header>
      <SlotsStrip api={api} layout={readSlotsLayout()} />
      <StatusTable api={api} />
    </div>
  );
}

/**
 * The orchestrator state for the settings panels that need it, one page of its builds at a time (GET /state?limit=&
 * offset=: the builds still being worked on come first). `pageSize` 0 asks for the rules alone, with no builds; `more`
 * adds the next page. Never every build (Brett, Nov 25 2026: no whole-set reads).
 */
function useOrchState(pageSize: number) {
  const rt = useRuntime();
  const [state, setState] = useState<State | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState('');
  const held = useRef<Build[]>([]);
  const read = async (limit: number, offset: number) => {
    const q = { limit, offset };
    const r = await api.call<Res>(pageQuery('state', q));
    if (!r.ok || !r.state) throw new Error(r.error ?? 'the orchestrator state did not load');
    if (r.upgradePolicy) core.setUpgradePolicy(r.upgradePolicy);
    return { head: r.state, page: pageOf(r, r.state.builds, q) };
  };
  /** The rules and the pages already on screen, read again. */
  const load = async () => {
    let head: State | null = null;
    if (!pageSize) { head = (await read(0, 0)).head; held.current = []; setTotal(0); }
    else {
      const w = await readWindow<Build>(Math.max(held.current.length, pageSize), async (limit, offset) => { const r = await read(limit, offset); head = r.head; return r.page; });
      held.current = w.rows; setTotal(Math.max(w.total, w.rows.length));
    }
    if (head) setState({ ...(head as State), builds: held.current });
  };
  const more = async () => {
    if (moreBusy || held.current.length >= total) return;
    setMoreBusy(true);
    try {
      const offset = held.current.length;
      const { page } = await read(pageSize, offset);
      held.current = addPage(held.current, page.rows);
      setTotal(held.current.length > offset ? Math.max(page.total, held.current.length) : held.current.length);
      setState((x) => (x ? { ...x, builds: held.current } : x));
    } catch (e) { setError((e as Error).message); }
    finally { setMoreBusy(false); }
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, []);
  const act: Act = async (change) => {
    setBusy(true);
    try {
      const r = await api.post<Res>('act', change);
      if (!r.ok) { rt.toast(r.error ?? 'Change failed', 'danger'); return false; }
      for (const l of r.log ?? []) rt.terminal.log('orchestrator', l, 'ok');
      // the answer's own build list is not kept: the rules are taken from it, the pages on screen are read again
      const rules = r.state?.rules;
      if (rules) setState((x) => (x ? { ...x, rules } : x));
      await load().catch(() => undefined);
      return true;
    } catch (e) { rt.toast((e as Error).message, 'danger'); return false; }
    finally { setBusy(false); }
  };
  return { state, total, busy, moreBusy, more, error, act };
}

export function RulesPanel() {
  const { state, busy, error, act } = useOrchState(0);
  if (!state) return <div className="fx-empty">{error || 'Loading the rules…'}</div>;
  return <RulesTab rules={state.rules} busy={busy} act={act} />;
}
export function ApprovalsPanel() {
  const { state, total, busy, moreBusy, more, error, act } = useOrchState(PAGE_SIZE);
  if (!state) return <div className="fx-empty">{error || 'Loading the approvals…'}</div>;
  return (
    <div className="fx-stack">
      <ApprovalsTab state={state} busy={busy} act={act} more={state.builds.length < total} />
      <LoadMore shown={state.builds.length} total={total} busy={moreBusy} onMore={() => void more()} />
    </div>
  );
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

function ApprovalsTab({ state, busy, act, more = false }: { state: State; busy: boolean; act: Act; more?: boolean }) {
  const gates = state.builds.flatMap((b) => core.phases(b).filter((p) => p.gate).map((p) => ({ b, p })));
  if (!gates.length) return <div className="fx-empty">{more ? 'No model switches in the builds loaded so far.' : 'No model switches in any build.'}</div>;
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
