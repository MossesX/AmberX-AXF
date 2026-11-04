import { createElement, useState } from 'react';
import { Button, Chip, Slot } from '@console/axf/react';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import { AgentChat } from './chat';
import { CardSection } from './idcards';
import { ModelChip, fmtTime, statusText, type Act, type Agent, type SwarmState } from './ui-types';

/*
 * Crew: one card per agent (avatar, name, role, specialty, status, hire date, spend, jobs, success rate, failures,
 * avg cost per job, favourite model, last seen, catchphrase, salary, spent, left, bonuses), its skills (every agent on the
 * job crew is an all-rounder since Nov 3 2026), home job and current job; a strip on top shows who's free and who's on
 * what. Slot `swarm.agent.actions` ({agentId, name, where}) under each card and on the profile's bar takes other plugins'
 * buttons (e.g. Assign to Claude). Tap a card for the profile: bio, skill, pay,
 * status history and a feed of the latest runs with their cost. Everything is inside the console; no outside
 * social accounts.
 */

type Stats = { runs: number; done: number; failed: number; successRate: number | null; favoriteModel: string; lastSeen: string; feed: { jobId: string; buildId: string; at: string; status: string; model: string; usd: number; summary: string }[] };
const fmtDay = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | undefined> = { success: 'success', warning: 'warning', danger: 'danger', accent: 'accent' };

/** Paint roles → the avatar classes in swarm.css (theme tokens only); `hair` and `shirt` take the model's tokens. */
const PAINT_CLASS: Record<string, string> = { bg: 'sw-avatar__bg', skin: 'sw-avatar__skin', ink: 'sw-avatar__ink', line: 'sw-avatar__line', 'line-thick': 'sw-avatar__line sw-avatar__thick' };
/**
 * A drawn face, unique per agent, rendered from the card rules' avatar model (framework/core/engines/agent-card-rules.mjs:
 * face shape, hair, gear and the theme tokens its hue picks). Nothing is drawn here that the model does not list.
 */
export function Avatar({ a, size = 56 }: { a: Agent; size?: number }) {
  const m = core.avatarModel(a.avatar);
  return (
    <svg className="sw-avatar" width={size} height={size} viewBox={`0 0 ${m.box} ${m.box}`} role="img" aria-label={`${a.name}'s avatar`}>
      {m.parts.map((p) => createElement(p.tag, { key: p.id, ...p.attrs, className: PAINT_CLASS[p.paint], style: p.paint === 'hair' || p.paint === 'shirt' ? { fill: `var(${m.tokens[p.paint]})` } : undefined }))}
    </svg>
  );
}

type JobRef = { id: string; name: string; home?: boolean };
/** What an agent is on now: its running runs, named by build (headless builds) or job type. */
const currentOf = (state: SwarmState, id: string) => state.runs.filter((r) => r.agent === id && r.status === 'running').map((r) => r.build || r.jobType || r.buildId || r.jobId);
/** The skills an agent works: every skill the job types need for an all-rounder ("*"), else its own list. */
const skillsOf = (a: Agent, all: string[]) => ((a.skills ?? []).includes('*') ? all : [...new Set([a.skill, ...(a.skills ?? [])])]);
const skillName = (state: SwarmState, id: string) => state.skills[id]?.title ?? id;
const homeName = (a: Agent, jobs: JobRef[]) => jobs.find((j) => j.home)?.name ?? a.home ?? '';

export function CrewTab({ state, stats, act, jobsBy = {}, allSkills = [], onFeed }: { state: SwarmState; stats: Record<string, Stats>; act: Act; jobsBy?: Record<string, JobRef[]>; allSkills?: string[]; onFeed: (jobId: string) => void }) {
  const [open, setOpen] = useState<string>(() => consoleApi.readLocal('swarm-profile', ''));
  const pick = (id: string) => { setOpen(id); consoleApi.writeLocal('swarm-profile', id); };
  const a = state.roster.agents.find((x) => x.id === open);
  if (a) return <Profile a={a} state={state} st={stats[a.id]!} act={act} jobs={jobsBy[a.id] ?? []} allSkills={allSkills} onBack={() => pick('')} onFeed={onFeed} />;
  return (
    <div className="fx-stack">
      <WhosFree state={state} onOpen={pick} />
      <div className="sw-cards" role="list">
        {state.roster.agents.map((x) => <Card key={x.id} a={x} state={state} st={stats[x.id]!} act={act} jobs={jobsBy[x.id] ?? []} allSkills={allSkills} onOpen={() => pick(x.id)} />)}
      </div>
    </div>
  );
}

/** The job crew at a glance: who is free for the next job, and who is on what. */
function WhosFree({ state, onOpen }: { state: SwarmState; onOpen: (id: string) => void }) {
  const crew = state.roster.agents.filter((x) => x.jobsOnly);
  if (!crew.length) return null;
  const works = (id: string) => state.statuses[state.swarm.agents[id]?.status ?? '']?.works !== false && !state.pay[id]?.broke;
  const free = crew.filter((x) => works(x.id) && !currentOf(state, x.id).length);
  const busy = crew.filter((x) => currentOf(state, x.id).length);
  const out = crew.filter((x) => !works(x.id) && !currentOf(state, x.id).length);
  return (
    <section className="sw-roster" aria-label="Who's free">
      <div className="sw-bar"><b>Free</b>{free.length ? free.map((x) => <Button key={x.id} size="sm" tone="quiet" onClick={() => onOpen(x.id)}>{x.name}</Button>) : <span className="fx-muted">nobody: the next job waits for the least busy</span>}</div>
      {busy.length > 0 && <div className="sw-bar"><b>On a job</b>{busy.map((x) => <Button key={x.id} size="sm" tone="quiet" onClick={() => onOpen(x.id)}>{x.name} · {currentOf(state, x.id).join(', ')}</Button>)}</div>}
      {out.length > 0 && <div className="sw-bar"><b>Off</b>{out.map((x) => <Chip key={x.id}>{x.name} · {state.pay[x.id]?.broke ? 'broke' : statusText(state.swarm.agents[x.id]!, state.statuses)}</Chip>)}</div>}
    </section>
  );
}

/** Skills, home job and current job: the lines every card and profile shows. */
function WorkLines({ a, state, jobs, allSkills }: { a: Agent; state: SwarmState; jobs: JobRef[]; allSkills: string[] }) {
  const sk = skillsOf(a, allSkills); const now = currentOf(state, a.id); const home = homeName(a, jobs);
  return (
    <>
      <p className="sw-card__jobs"><span className="fx-muted">Now</span> {now.length ? now.join(', ') : 'free'}</p>
      {home && <p className="sw-card__jobs"><span className="fx-muted">Home job</span> {home}</p>}
      {sk.length > 0 && <p className="sw-card__jobs"><span className="fx-muted">{(a.skills ?? []).includes('*') ? `All-rounder · ${sk.length} skills` : 'Skills'}</span> {sk.map((k) => skillName(state, k)).join(' · ')}</p>}
    </>
  );
}

const BENCHED = ['quit', 'fired', 'suspended'];
/** On-duty agents in roster order: the agent cap (agent-slots plugin) shows "waiting for a desk" past the free slots. */
const onDutyIds = (state: SwarmState) => state.roster.agents.filter((x) => state.swarm.agents[x.id]?.status === 'on-duty').map((x) => x.id);
function DeskSlot({ id, state }: { id: string; state: SwarmState }) {
  return <Slot name="swarm.agent.status" props={{ agentId: id, status: state.swarm.agents[id]?.status ?? '', onDuty: onDutyIds(state) }} />;
}
function Card({ a, state, st, act, jobs, allSkills, onOpen }: { a: Agent; state: SwarmState; st: Stats; act: Act; jobs: JobRef[]; allSkills: string[]; onOpen: () => void }) {
  const as = state.swarm.agents[a.id]!; const sp = state.spend[a.id]; const pay = state.pay[a.id]; const idn = core.cardIdentity(a, as);
  return (
    <article role="listitem" className={`sw-card ${as.status === 'fired' ? 'sw-gone' : ''}`}>
      <button type="button" data-fx-row className="sw-card__open" onClick={onOpen} aria-label={`${idn.name}, open profile`}>
        <div className="sw-card__head">
          <Avatar a={a} />
          <div className="sw-card__who"><b>{idn.name}</b><span className="fx-muted">{idn.role}</span><Chip tone={TONE[state.statuses[as.status]?.tone ?? '']}>{statusText(as, state.statuses)}</Chip><DeskSlot id={a.id} state={state} /></div>
        </div>
        <p className="sw-card__line">{idn.specialty}</p>
        <WorkLines a={a} state={state} jobs={jobs} allSkills={allSkills} />
        <dl className="sw-card__stats">
          <div><dt>Hired</dt><dd>{fmtDay(idn.hiredAt)}</dd></div>
          <div><dt>Salary</dt><dd>{core.fmtUsd(pay?.salary ?? a.salary)}/wk</dd></div>
          <div><dt>Spent (week)</dt><dd>{core.fmtUsd(pay?.spent ?? 0)}</dd></div>
          <div><dt>Left</dt><dd className={pay?.broke ? 'sw-warn' : ''}>{pay?.broke ? 'broke' : core.fmtUsd(pay?.left ?? a.salary)}</dd></div>
          <div><dt>Bonuses</dt><dd>{core.fmtUsd(pay?.bonus ?? 0)}</dd></div>
          <div><dt>All time</dt><dd>{core.fmtUsd(sp?.all.usd ?? 0)}</dd></div>
          <div><dt>Week</dt><dd>{core.fmtUsd(sp?.week.usd ?? 0)}</dd></div>
          <div><dt>Today</dt><dd>{core.fmtUsd(sp?.today.usd ?? 0)}</dd></div>
          <div><dt>Jobs done</dt><dd>{st.done}</dd></div>
          <div><dt>Success</dt><dd>{st.successRate == null ? '—' : `${Math.round(st.successRate * 100)}%`}</dd></div>
          <div><dt>Failures</dt><dd>{st.failed}</dd></div>
          <div><dt>Avg / job</dt><dd>{sp?.jobs ? core.fmtUsd(sp.avgPerJob) : '—'}</dd></div>
          <div><dt>Favourite</dt><dd>{st.favoriteModel ? <ModelChip m={st.favoriteModel} /> : <ModelChip m={a.models[0]!} />}</dd></div>
          <div><dt>Last seen</dt><dd>{st.lastSeen ? fmtTime(st.lastSeen) : 'never'}</dd></div>
        </dl>
        <p className="sw-card__quote">“{idn.catchphrase}”</p>
      </button>
      {BENCHED.includes(as.status) && <div className="sw-bar"><Button size="sm" icon="refresh" onClick={() => void act({ action: 'rehire', agent: a.id })}>Rehire</Button>{as.note && <span className="fx-muted">{as.note}</span>}</div>}
      <Slot name="swarm.agent.actions" props={{ agentId: a.id, name: idn.name, where: 'card' }} />
    </article>
  );
}

function PaySection({ a, state, act }: { a: Agent; state: SwarmState; act: Act }) {
  const as = state.swarm.agents[a.id]!; const pay = state.pay[a.id];
  const [salary, setSalary] = useState(String(pay?.salary ?? a.salary));
  const [note, setNote] = useState('');
  const [top, setTop] = useState('5');
  const next = Number(salary);
  return (
    <section className="fx-stack">
      <h3 className="sw-wave">Pay</h3>
      <p className="fx-muted">Salary {core.fmtUsd(pay?.salary ?? a.salary)} a week is the agent's budget. This week: spent {core.fmtUsd(pay?.spent ?? 0)}{pay?.topups ? `, topped up ${core.fmtUsd(pay.topups)}` : ''}, {pay?.broke ? <b className="sw-warn">broke till {fmtDay(pay.payday)}</b> : `${core.fmtUsd(pay?.left ?? 0)} left`}. Payday {pay ? fmtDay(pay.payday) : '—'}.</p>
      <form className="sw-bar" onSubmit={(e) => { e.preventDefault(); void act({ action: 'salary', agent: a.id, usd: next, note }).then((l) => { if (l) setNote(''); }); }}>
        <label className="fx-muted" htmlFor={`sal-${a.id}`}>New salary ($/week)</label>
        <input id={`sal-${a.id}`} className="fx-input sw-num" type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} />
        <input className="fx-input sw-grow" aria-label="Why" placeholder="Why (posted in the chat)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" disabled={!Number.isFinite(next) || next === (pay?.salary ?? a.salary)}>{next > (pay?.salary ?? a.salary) ? 'Give raise' : 'Dock pay'}</Button>
      </form>
      <form className="sw-bar" onSubmit={(e) => { e.preventDefault(); void act({ action: 'topup', agent: a.id, usd: Number(top) }); }}>
        <label className="fx-muted" htmlFor={`top-${a.id}`}>Top up this week ($)</label>
        <input id={`top-${a.id}`} className="fx-input sw-num" type="number" min={1} value={top} onChange={(e) => setTop(e.target.value)} />
        <Button type="submit" disabled={!(Number(top) > 0)}>Top up</Button>
      </form>
      {as.bonuses.length > 0 && <p>Bonuses (bragging rights, not real money): <b>{core.fmtUsd(pay?.bonus ?? 0)}</b> over {as.bonuses.length} jobs; this week {core.fmtUsd(pay?.bonusWeek ?? 0)}.</p>}
      {as.pay.length > 0 && <ul className="sw-feed">{[...as.pay].reverse().slice(0, 10).map((p, i) => <li key={i}><span className="fx-muted">{fmtTime(p.at)}</span> {p.kind === 'raise' ? 'Raise' : 'Docked'} {core.fmtUsd(p.from)} → <b>{core.fmtUsd(p.to)}</b>{p.note ? ` · ${p.note}` : ''}</li>)}</ul>}
    </section>
  );
}

const DURATIONS = [{ h: 1, label: '1 hour' }, { h: 4, label: '4 hours' }, { h: 24, label: '1 day' }, { h: 72, label: '3 days' }, { h: 168, label: '1 week' }];
function Discipline({ a, state, act }: { a: Agent; state: SwarmState; act: Act }) {
  const as = state.swarm.agents[a.id]!;
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState('');
  return (
    <section className="fx-stack">
      <h3 className="sw-wave">Discipline</h3>
      <p className="fx-muted">Failed jobs in a row: {as.failStreak} of {state.swarm.rules.rageQuitAfter} before a rage-quit.</p>
      {BENCHED.includes(as.status) ? <div className="sw-bar"><Button icon="refresh" onClick={() => void act({ action: 'rehire', agent: a.id })}>Rehire</Button><span className="fx-muted">{statusText(as, state.statuses)}{as.until ? ` until ${fmtTime(as.until)}` : ''}{as.note ? ` · ${as.note}` : ''}</span></div>
        : <form className="sw-bar" onSubmit={(e) => { e.preventDefault(); void act({ action: 'suspend', agent: a.id, until: new Date(Date.now() + hours * 3600e3).toISOString(), reason }).then((l) => { if (l) setReason(''); }); }}>
          <select className="fx-input sw-bar__pick" aria-label="Suspend for" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d.h} value={d.h}>{d.label}</option>)}</select>
          <input className="fx-input sw-grow" aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" disabled={!reason.trim()}>Suspend</Button>
        </form>}
    </section>
  );
}

function Profile({ a, state, st, act, jobs, allSkills, onBack, onFeed }: { a: Agent; state: SwarmState; st: Stats; act: Act; jobs: JobRef[]; allSkills: string[]; onBack: () => void; onFeed: (jobId: string) => void }) {
  const as = state.swarm.agents[a.id]!; const skill = state.skills[a.skill]; const idn = core.cardIdentity(a, as);
  return (
    <div className="fx-stack">
      <div className="sw-bar"><Button icon="undo" onClick={onBack}>Crew</Button><Slot name="swarm.agent.actions" props={{ agentId: a.id, name: idn.name, where: 'profile' }} /></div>
      <div className="sw-card sw-card--profile">
        <div className="sw-card__head">
          <Avatar a={a} size={88} />
          <div className="sw-card__who"><h2>{idn.name}</h2><span className="fx-muted">{idn.role} · {idn.specialty} · hired {fmtDay(idn.hiredAt)}</span><Chip tone={TONE[state.statuses[as.status]?.tone ?? '']}>{statusText(as, state.statuses)}</Chip><DeskSlot id={a.id} state={state} /></div>
        </div>
        <p>{a.bio}</p>
        <p className="sw-card__quote">“{idn.catchphrase}”</p>
        <WorkLines a={a} state={state} jobs={jobs} allSkills={allSkills} />
        {jobs.length > 0 && <p className="sw-card__jobs"><span className="fx-muted">Can take</span> {jobs.map((j) => j.name).join(' · ')}</p>}
        <p className="fx-muted">Models {a.models.map((m) => core.MODEL_LABEL[m] ?? m).join(' · ')} · up to {a.maxTurns} turns · tools {a.tools.join(', ')}</p>
      </div>
      <section className="fx-stack">
        <h3 className="sw-wave">Home skill: {skill?.title ?? a.skill}</h3>
        <pre className="sw-skill">{skill?.body ?? 'No skill file.'}</pre>
      </section>
      <CardSection state={state} a={a} st={st} act={act} photo={<Avatar a={a} size={120} />} />
      <PaySection a={a} state={state} act={act} />
      <Discipline a={a} state={state} act={act} />
      <section className="fx-stack">
        <h3 className="sw-wave">Status history</h3>
        {as.history.length === 0 ? <p className="fx-muted">On duty since hiring.</p>
          : <ul className="sw-feed">{[...as.history].reverse().slice(0, 20).map((h, i) => <li key={i}><span className="fx-muted">{fmtTime(h.at)}</span> {h.from} → <b>{h.to}</b>{h.note ? ` · ${h.note}` : ''} <span className="fx-muted">({h.by})</span></li>)}</ul>}
      </section>
      <section className="fx-stack">
        <h3 className="sw-wave">In the group chat</h3>
        <AgentChat a={a} state={state} />
      </section>
      <section className="fx-stack">
        <h3 className="sw-wave">Latest runs</h3>
        {st.feed.length === 0 ? <p className="fx-muted">No runs yet.</p>
          : <ul className="sw-feed">{st.feed.map((f, i) => <li key={i}><button type="button" className="fx-btn fx-btn--sm fx-btn--quiet" onClick={() => onFeed(f.jobId)}>{f.jobId}</button> <span className="fx-muted">{fmtTime(f.at)}</span> <ModelChip m={f.model} /> {f.status} · <b>{core.fmtUsd(f.usd)}</b>{f.summary ? ` · ${f.summary}` : ''}</li>)}</ul>}
      </section>
    </div>
  );
}
