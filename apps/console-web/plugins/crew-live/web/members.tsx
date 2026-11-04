/**
 * Crew members (crew-profile@1): one collapsible container per employee. Collapsed = avatar + name + status dot + job
 * title on one line; open = their crew card (job title, current task, live timer, cost, files) and their ID card
 * (the framework AgentCard, agent-card@1), plus the full profile with a tab per section (persona, role, skills, tools,
 * model, memory, safety, pay, stats). Working members stay on top (longest-running first) and the list reorders live,
 * but never while Brett is touching or scrolling it. Pay, tools, safety and job title save only from his own session.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AgentAvatar, AgentCard, Button, Icon, ModelBadge, Segmented, TextField, useRuntime } from '@console/axf/react';
import * as consoleApi from '@console/api';
import { pluginFetch } from '@console/plugins';
import {
  OWNER_ONLY, elapsed, isOpen, memberStatus, parseSkills, skillsText, sortMembers, stepLine, usd, workingSince,
  type ExpandDefault, type Member, type MemberSort, type MemberStatus, type Profile, type Run,
} from './core';

const FOLDER = 'crew-live';
/** Window event the crew.profile action sends (member id): the container opens on its Profile side. */
export const PROFILE_EVENT = 'axf-crew:profile';
export const SORT_KEY = 'crew-member-sort';
export const EXPAND_KEY = 'crew-member-expand-default';
const OPEN_KEY = 'crew-member-open';
const SIDE_KEY = 'crew-member-side';

const STATUS_TONE: Record<MemberStatus, string> = { owner: 'accent', working: 'success', queued: 'warning', idle: 'muted', off: 'muted' };
const STATUS_WORD: Record<MemberStatus, string> = { owner: 'Owner', working: 'Working', queued: 'Queued', idle: 'Idle', off: 'Off duty' };
type Side = 'crew' | 'id' | 'profile';
const SIDES: { value: Side; label: string }[] = [{ value: 'crew', label: 'Crew card' }, { value: 'id', label: 'ID card' }, { value: 'profile', label: 'Profile' }];
export const SORT_OPTS: { value: MemberSort; label: string }[] = [{ value: 'working', label: 'Working on top' }, { value: 'name', label: 'Name' }, { value: 'title', label: 'Job title' }];
export const EXPAND_OPTS: { value: ExpandDefault; label: string }[] = [{ value: 'working', label: 'Working open' }, { value: 'all', label: 'All open' }, { value: 'none', label: 'All closed' }];

/** Hold reorders while Brett's finger or mouse is on the list, or for a moment after he scrolled it. */
function useBusy(ref: React.RefObject<HTMLElement | null>): () => boolean {
  const until = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hold = () => { until.current = Date.now() + 1500; };
    const down = () => { until.current = Infinity; };
    const up = () => { until.current = Date.now() + 800; };
    el.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('scroll', hold, true);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('scroll', hold, true); };
  }, [ref]);
  return () => Date.now() < until.current;
}

/** The order on screen: follows `want`, animated (FLIP), held while busy. */
function useLiveOrder(want: string[], busy: () => boolean, list: React.RefObject<HTMLElement | null>): string[] {
  const [order, setOrder] = useState(want);
  const rects = useRef(new Map<string, number>());
  const key = want.join('|');
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      if (busy()) { t = setTimeout(apply, 500); return; }
      const el = list.current;
      rects.current = new Map([...(el?.querySelectorAll<HTMLElement>('[data-member]') ?? [])].map((n) => [n.dataset.member!, n.getBoundingClientRect().top]));
      setOrder(want);
    };
    apply();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !rects.current.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const n of el.querySelectorAll<HTMLElement>('[data-member]')) {
      const before = rects.current.get(n.dataset.member!);
      const dy = before === undefined ? 0 : before - n.getBoundingClientRect().top;
      if (dy) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'ease-out' });
    }
    rects.current.clear();
  }, [order]);
  return order;
}

function Dot({ s }: { s: MemberStatus }) {
  return <span className={`axp-crew__dot is-${STATUS_TONE[s]}`} role="img" aria-label={STATUS_WORD[s]} title={STATUS_WORD[s]} />;
}

function CrewCard({ m, runs, now }: { m: Member; runs: Run[]; now: number }) {
  const mine = runs.filter((r) => r.agent.id === m.id && r.status !== 'idle');
  const since = workingSince(m, runs);
  const task = mine[0] ? stepLine(mine[0].build) : m.running?.[0]?.summary || m.running?.[0]?.buildId || '';
  const files = mine.reduce((t, r) => t + (r.filesCount ?? 0), 0);
  const cost = mine.reduce((t, r) => t + r.costUsd, 0);
  return (
    <dl className="axp-crew__card">
      <div><dt>Job title</dt><dd>{m.jobTitle}{m.pronouns ? <span className="fx-muted"> · {m.pronouns}</span> : null}</dd></div>
      <div><dt>Doing now</dt><dd>{task || (m.kind === 'owner' ? 'Running the show' : 'Nothing right now')}{mine[0]?.now ? <span className="fx-small fx-muted axp-crew__cardNow">{mine[0].now}</span> : null}</dd></div>
      <div><dt>On the clock</dt><dd className="fx-mono">{since === null ? '—' : elapsed(new Date(since).toISOString(), now)}</dd></div>
      <div><dt>Cost</dt><dd className="fx-mono">{mine.length ? `${usd(cost)} now` : ''}{mine.length ? ' · ' : ''}{usd(m.stats?.costToday)} today</dd></div>
      <div><dt>Files</dt><dd className="fx-mono">{mine.length ? files : '—'}</dd></div>
      {m.kind !== 'owner' ? <div><dt>Pay</dt><dd className="fx-mono">{m.pay?.hourly == null ? '—' : `$${m.pay.hourly.toFixed(2)}/h`}</dd></div> : null}
      {m.reportsTo ? <div><dt>Reports to</dt><dd>{m.reportsTo}</dd></div> : null}
      {m.stats?.writeups.length ? <div><dt>Write-ups</dt><dd>{m.stats.writeups.length} on file</dd></div> : null}
    </dl>
  );
}

function IdCard({ m }: { m: Member }) {
  const s = m.stats;
  const runs = (s?.jobs ?? 0) + (s?.failed ?? 0);
  return (
    <AgentCard
      identity={{ id: m.id, name: m.name, role: m.jobTitle, specialty: m.role?.specialty ?? '', hiredAt: m.hiredAt ?? '', status: m.statusLabel ?? '', catchphrase: m.catchphrase ?? '', page: `axf://crew/${m.id}` }}
      stats={{ jobs: s?.jobs ?? 0, successRate: runs ? ((s?.jobs ?? 0) / runs) * 100 : undefined, spend: s?.costUsd ?? 0, favoriteModel: m.model === 'fable' ? 'Fable' : 'Opus' }}
      photo={<AgentAvatar info={{ id: m.id, name: m.name, role: m.jobTitle, avatar: m.avatar }} agent={m.id} size="large" />}
    />
  );
}

type Tab = 'persona' | 'role' | 'skills' | 'tools' | 'model' | 'memory' | 'safety' | 'pay' | 'stats';
const TABS: { value: Tab; label: string }[] = [
  { value: 'persona', label: 'Persona' }, { value: 'role', label: 'Role' }, { value: 'skills', label: 'Skills' }, { value: 'tools', label: 'Tools' },
  { value: 'model', label: 'Model' }, { value: 'memory', label: 'Memory' }, { value: 'safety', label: 'Safety' }, { value: 'pay', label: 'Pay' }, { value: 'stats', label: 'Stats' },
];
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
const OWNER_HINT = 'Brett only (his own click in the console)';

/** The full profile: a tab per section, each editable; saving sends only the section that changed. */
export function ProfileTabs({ id }: { id: string }) {
  const rt = useRuntime();
  const [p, setP] = useState<Profile | null | 'error'>(null);
  const [tab, setTab] = useState<Tab>('persona');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    pluginFetch(FOLDER, `members/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { member: Profile }) => alive && setP(j.member), () => alive && setP('error'));
    return () => { alive = false; };
  }, [id]);
  if (p === null) return <p className="fx-small fx-muted">Reading the profile…</p>;
  if (p === 'error') return <p className="fx-small fx-muted">The profile can't be read (is the Agent swarm on?).</p>;
  const v = <T,>(k: string, base: T): T => (k in draft ? (draft[k] as T) : base);
  const set = (k: string, val: unknown) => setDraft((d) => ({ ...d, [k]: val }));
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, `members/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await r.json().catch(() => ({})) as { member?: Profile; detail?: string };
      if (r.ok && j.member) { setP({ ...p, ...j.member }); setDraft({}); rt.toast(`${p.name}'s profile saved.`, 'success', 'Crew'); }
      else rt.toast(j.detail ?? 'Save failed', r.status === 403 ? 'warning' : 'danger', 'Crew');
    } finally { setBusy(false); }
  };
  const locked = (k: string) => (OWNER_ONLY as readonly string[]).includes(k);
  const pe = p.persona;
  const body = (() => {
    switch (tab) {
      case 'persona': return (
        <>
          <TextField label="Voice" rows={2} value={v('voice', pe.voice)} onChange={(x) => set('voice', x)} />
          <TextField label="Tone" value={v('tone', pe.tone)} onChange={(x) => set('tone', x)} />
          <Segmented size="sm" label="Slang level" value={String(v('slang', pe.slang))} onChange={(x) => set('slang', Number(x))} options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
          <TextField label="Catchphrases (one per line)" rows={2} value={v('catchphrases', pe.catchphrases.join('\n'))} onChange={(x) => set('catchphrases', x)} />
          <TextField label="In group chat" rows={2} value={v('groupChat', pe.groupChat)} onChange={(x) => set('groupChat', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ persona: { voice: v('voice', pe.voice), tone: v('tone', pe.tone), slang: v('slang', pe.slang), catchphrases: lines(v('catchphrases', pe.catchphrases.join('\n'))), groupChat: v('groupChat', pe.groupChat) } })}>Save persona</Button>
        </>
      );
      case 'role': return (
        <>
          <TextField label="Job title" hint={OWNER_HINT} value={v('jobTitle', p.jobTitle)} onChange={(x) => set('jobTitle', x)} disabled={p.kind === 'owner'} />
          <TextField label="Duties (one per line)" rows={3} value={v('duties', p.duties.join('\n'))} onChange={(x) => set('duties', x)} />
          <TextField label="Reports to (member id)" mono value={v('reportsTo', p.reportsTo ?? '')} onChange={(x) => set('reportsTo', x)} />
          <TextField label="Pronouns" value={v('pronouns', p.pronouns ?? '')} onChange={(x) => set('pronouns', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ duties: lines(v('duties', p.duties.join('\n'))), reportsTo: v('reportsTo', p.reportsTo ?? ''), pronouns: v('pronouns', p.pronouns ?? ''), ...('jobTitle' in draft ? { jobTitle: draft.jobTitle } : {}) })}>Save role</Button>
        </>
      );
      case 'skills': return (
        <>
          <TextField label="Skills (tag:level 1-5, comma separated)" rows={2} mono value={v('skills', skillsText(p.skills))} onChange={(x) => set('skills', x)} hint="e.g. merging/conflicts:5, ci:4, ui:3" />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ skills: parseSkills(v('skills', skillsText(p.skills))) })}>Save skills</Button>
        </>
      );
      case 'tools': return (
        <>
          <TextField label="Allowed tools (one per line)" hint={OWNER_HINT} rows={5} mono value={v('tools', p.tools.allow.join('\n'))} onChange={(x) => set('tools', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ tools: { allow: lines(v('tools', p.tools.allow.join('\n'))) } })}>Save tools</Button>
        </>
      );
      case 'model': return (
        <>
          <Segmented size="sm" label="Default model" value={v('model', p.model)} onChange={(x) => void save({ model: x })} options={[{ value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }]} />
          <p className="fx-small fx-muted">Opus or Fable only, never Sonnet or Haiku. A build step still runs on the model its orchestrator step names; an upgrade needs Brett.</p>
        </>
      );
      case 'memory': return (
        <>
          <TextField label="Memory scope" mono value={v('scope', p.memory.scope)} onChange={(x) => set('scope', x)} />
          <TextField label="Notes" rows={3} value={v('notes', p.memory.notes)} onChange={(x) => set('notes', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ memory: { scope: v('scope', p.memory.scope), notes: v('notes', p.memory.notes) } })}>Save memory</Button>
        </>
      );
      case 'safety': return (
        <>
          <TextField label="Safety limits (one per line)" hint={OWNER_HINT} rows={4} value={v('limits', p.safety.limits.join('\n'))} onChange={(x) => set('limits', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ safety: { limits: lines(v('limits', p.safety.limits.join('\n'))), dangerousTools: p.safety.dangerousTools } })}>Save safety</Button>
        </>
      );
      case 'pay': return p.kind === 'owner' ? <p className="fx-small fx-muted">The boss isn't on payroll.</p> : (
        <>
          <TextField label="Hourly pay (USD, at least 7.50)" hint={OWNER_HINT} type="number" mono value={v('hourly', String(p.pay?.hourly ?? 7.5))} onChange={(x) => set('hourly', x)} />
          <Button size="sm" tone="primary" busy={busy} onClick={() => void save({ pay: { hourly: Number(v('hourly', String(p.pay?.hourly ?? 7.5))) } })}>Save pay</Button>
        </>
      );
      case 'stats': return (
        <dl className="axp-crew__card">
          <div><dt>Jobs done</dt><dd className="fx-mono">{p.stats?.jobs ?? 0}</dd></div>
          <div><dt>Failed</dt><dd className="fx-mono">{p.stats?.failed ?? 0}</dd></div>
          <div><dt>Strikes</dt><dd className="fx-mono">{p.stats?.strikes ?? 0}</dd></div>
          <div><dt>Cost (all time)</dt><dd className="fx-mono">{usd(p.stats?.costUsd)}</dd></div>
          <div><dt>Write-ups</dt><dd>{p.stats?.writeups.length ? p.stats.writeups.map((w, i) => <span key={i} className="axp-crew__writeup"><b>{w.date}</b> {w.lines.join(' ')}</span>) : 'None on file'}</dd></div>
          {p.assistant ? <div><dt>Assistant</dt><dd>Runs the AI assistant as Agent manager agent <span className="fx-mono">{p.assistant.agentManager}</span></dd></div> : null}
        </dl>
      );
    }
  })();
  return (
    <div className="axp-crew__profile">
      <Segmented size="sm" label="Profile section" value={tab} onChange={(x) => { setTab(x); setDraft({}); }} options={TABS} />
      {locked(tab) ? <p className="fx-small fx-muted"><Icon name="lock" size={12} /> {OWNER_HINT}.</p> : null}
      <div className="axp-crew__profileBody">{body}</div>
    </div>
  );
}

function MemberBox({ m, runs, now, open, onToggle, side, onSide }: { m: Member; runs: Run[]; now: number; open: boolean; onToggle: () => void; side: Side; onSide: (s: Side) => void }) {
  const s = memberStatus(m, runs);
  const since = workingSince(m, runs);
  return (
    <li className={`axp-crew__member is-${s}${open ? ' is-open' : ''}`} data-member={m.id}>
      <button type="button" data-fx-row className="axp-crew__memberHead" aria-expanded={open} onClick={onToggle} data-axf-ctx-target={m.kind === 'owner' ? undefined : 'agent'} data-axf-ctx-payload={m.id}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <AgentAvatar info={{ id: m.id, name: m.name, role: m.jobTitle, avatar: m.avatar }} agent={m.id} size="small" />
        <span className="axp-crew__name"><Dot s={s} /> {m.name}</span>
        <span className="fx-small fx-muted axp-crew__role">{m.jobTitle}</span>
        {since !== null ? <span className="fx-small fx-mono axp-crew__memberTime">{elapsed(new Date(since).toISOString(), now)}</span> : null}
        {m.model ? <ModelBadge model={m.model} compact /> : null}
      </button>
      {open ? (
        <div className="axp-crew__memberBody">
          <Segmented size="sm" label={`${m.name}: card side`} value={side} onChange={onSide} options={SIDES} />
          {side === 'crew' ? <CrewCard m={m} runs={runs} now={now} /> : side === 'id' ? <IdCard m={m} /> : <ProfileTabs id={m.id} />}
        </div>
      ) : null}
    </li>
  );
}

/** Every member's container, working on top, expand / collapse all, per-member state remembered on this device. */
export function MemberList({ members, runs, now }: { members: Member[]; runs: Run[]; now: number }) {
  const [sort, setSort] = useState<MemberSort>(() => consoleApi.readLocal(SORT_KEY, 'working'));
  const [def, setDef] = useState<ExpandDefault>(() => consoleApi.readLocal(EXPAND_KEY, 'working'));
  const [open, setOpen] = useState<Record<string, boolean>>(() => consoleApi.readLocal(OPEN_KEY, {}));
  const [sides, setSides] = useState<Record<string, Side>>(() => consoleApi.readLocal(SIDE_KEY, {}));
  useEffect(() => { consoleApi.writeLocal(SORT_KEY, sort); consoleApi.writeLocal(EXPAND_KEY, def); }, [sort, def]);
  useEffect(() => { consoleApi.writeLocal(OPEN_KEY, open); consoleApi.writeLocal(SIDE_KEY, sides); }, [open, sides]);
  useEffect(() => {
    const on = (e: Event) => { const id = String((e as CustomEvent).detail ?? ''); if (id) { setOpen((o) => ({ ...o, [id]: true })); setSides((x) => ({ ...x, [id]: 'profile' })); } };
    window.addEventListener(PROFILE_EVENT, on);
    return () => window.removeEventListener(PROFILE_EVENT, on);
  }, []);
  const list = useRef<HTMLUListElement>(null);
  const busy = useBusy(list);
  const want = useMemo(() => sortMembers(members, runs, sort).map((m) => m.id), [members, runs, sort]);
  const order = useLiveOrder(want, busy, list);
  const by = new Map(members.map((m) => [m.id, m]));
  const shown = [...order.map((id) => by.get(id)).filter((m): m is Member => !!m), ...members.filter((m) => !order.includes(m.id))];
  const working = shown.filter((m) => memberStatus(m, runs) === 'working').length;
  return (
    <section className="axp-crew__members" aria-label="Crew members">
      <div className="axp-crew__tools-row" role="toolbar" aria-label="Crew members">
        <Segmented size="sm" label="Sort" value={sort} onChange={setSort} options={SORT_OPTS} />
        <Button size="sm" icon="chevron-down" onClick={() => setOpen(Object.fromEntries(shown.map((m) => [m.id, true])))}>Expand all</Button>
        <Button size="sm" icon="chevron-right" onClick={() => setOpen(Object.fromEntries(shown.map((m) => [m.id, false])))}>Collapse all</Button>
        <span className="fx-small fx-muted">{shown.length} on the roster · {working} working</span>
      </div>
      <ul ref={list} className="axp-crew__memberList">
        {shown.map((m) => (
          <MemberBox key={m.id} m={m} runs={runs} now={now} open={isOpen(m, runs, open, def)} side={sides[m.id] ?? 'crew'}
            onToggle={() => setOpen((o) => ({ ...o, [m.id]: !isOpen(m, runs, o, def) }))} onSide={(x) => setSides((o) => ({ ...o, [m.id]: x }))} />
        ))}
        {!shown.length ? <li className="fx-small fx-muted">The roster can't be read (is the Agent swarm on?).</li> : null}
      </ul>
      <p className="fx-small fx-muted">Default when opening: <Segmented size="sm" label="Open by default" value={def} onChange={(x) => { setDef(x); setOpen({}); }} options={EXPAND_OPTS} /></p>
    </section>
  );
}
