import { useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import { AgentChat } from './chat';
import { ModelChip, fmtTime, statusText, type Act, type Agent, type SwarmState } from './ui-types';

/*
 * Crew: one card per agent (avatar, name, role, specialty, status, hire date, spend, jobs, success rate, failures,
 * avg cost per job, favourite model, last seen, catchphrase). Tap a card for the profile: bio, skill, spend cap,
 * status history and a feed of the latest runs with their cost. Everything is inside the console; no outside
 * social accounts.
 */

type Stats = { runs: number; done: number; failed: number; successRate: number | null; favoriteModel: string; lastSeen: string; feed: { jobId: string; buildId: string; at: string; status: string; model: string; usd: number; summary: string }[] };
const fmtDay = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | undefined> = { success: 'success', warning: 'warning', danger: 'danger', accent: 'accent' };

const HAIR = [
  'M14 22 Q32 4 50 22 L50 18 Q32 0 14 18 Z',
  'M12 26 Q14 8 32 8 Q50 8 52 26 Q44 14 32 14 Q20 14 12 26 Z',
  'M14 24 Q16 6 32 6 Q48 6 50 24 L46 16 L40 22 L34 14 L28 22 L22 14 L18 22 Z',
  'M10 34 Q8 6 32 6 Q56 6 54 34 Q50 16 32 14 Q14 16 10 34 Z',
  'M20 12 Q32 -2 44 12 Q38 8 32 10 Q26 8 20 12 Z',
  'M12 28 Q12 6 32 6 Q52 6 52 28 L52 40 Q48 20 32 16 Q16 20 12 40 Z',
];
/** A drawn face, unique per agent (face shape, hair, gear, colours), drawn only in theme colours. */
export function Avatar({ a, size = 56 }: { a: Agent; size?: number }) {
  const av = a.avatar; const col = core.avatarColors(av);
  const face = av.face === 'square' ? <rect x="16" y="14" width="32" height="32" rx="7" /> : av.face === 'tall' ? <ellipse cx="32" cy="30" rx="14" ry="18" /> : <circle cx="32" cy="30" r="16" />;
  return (
    <svg className="sw-avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${a.name}'s avatar`}>
      <circle cx="32" cy="32" r="32" className="sw-avatar__bg" />
      <path d="M8 64 Q10 46 32 46 Q54 46 56 64 Z" style={{ fill: `var(${col.shirt})` }} />
      <g className="sw-avatar__skin">{face}</g>
      <path d={HAIR[av.hair % HAIR.length]} style={{ fill: `var(${col.hair})` }} />
      <circle cx="26" cy="30" r="2" className="sw-avatar__ink" /><circle cx="38" cy="30" r="2" className="sw-avatar__ink" />
      <path d="M26 38 Q32 42 38 38" className="sw-avatar__line" />
      {av.gear === 'glasses' && <g className="sw-avatar__line"><circle cx="26" cy="30" r="5" /><circle cx="38" cy="30" r="5" /><path d="M31 30 L33 30" /></g>}
      {av.gear === 'shades' && <path d="M19 27 H45 V31 Q45 35 40 35 H36 Q33 35 32 31 Q31 35 28 35 H24 Q19 35 19 31 Z" className="sw-avatar__ink" />}
      {av.gear === 'cap' && <path d="M14 20 Q32 2 50 20 L58 22 L14 22 Z" style={{ fill: `var(${col.shirt})` }} />}
      {av.gear === 'beanie' && <path d="M14 22 Q14 4 32 4 Q50 4 50 22 Z" style={{ fill: `var(${col.shirt})` }} />}
      {av.gear === 'headphones' && <g><path d="M14 30 Q14 8 32 8 Q50 8 50 30" className="sw-avatar__line sw-avatar__thick" /><rect x="10" y="26" width="7" height="11" rx="3" className="sw-avatar__ink" /><rect x="47" y="26" width="7" height="11" rx="3" className="sw-avatar__ink" /></g>}
    </svg>
  );
}

export function CrewTab({ state, stats, act, onFeed }: { state: SwarmState; stats: Record<string, Stats>; act: Act; onFeed: (jobId: string) => void }) {
  const [open, setOpen] = useState<string>(() => consoleApi.readLocal('swarm-profile', ''));
  const pick = (id: string) => { setOpen(id); consoleApi.writeLocal('swarm-profile', id); };
  const a = state.roster.agents.find((x) => x.id === open);
  if (a) return <Profile a={a} state={state} st={stats[a.id]!} act={act} onBack={() => pick('')} onFeed={onFeed} />;
  return (
    <div className="sw-cards" role="list">
      {state.roster.agents.map((x) => <Card key={x.id} a={x} state={state} st={stats[x.id]!} act={act} onOpen={() => pick(x.id)} />)}
    </div>
  );
}

const BENCHED = ['quit', 'fired', 'suspended'];
function Card({ a, state, st, act, onOpen }: { a: Agent; state: SwarmState; st: Stats; act: Act; onOpen: () => void }) {
  const as = state.swarm.agents[a.id]!; const sp = state.spend[a.id]; const pay = state.pay[a.id];
  return (
    <article role="listitem" className={`sw-card ${as.status === 'fired' ? 'sw-gone' : ''}`}>
      <button className="sw-card__open" onClick={onOpen} aria-label={`${a.name}, open profile`}>
        <div className="sw-card__head">
          <Avatar a={a} />
          <div className="sw-card__who"><b>{a.name}</b><span className="fx-muted">{a.role}</span><Chip tone={TONE[state.statuses[as.status]?.tone ?? '']}>{statusText(as, state.statuses)}</Chip></div>
        </div>
        <p className="sw-card__line">{a.specialty}</p>
        <dl className="sw-card__stats">
          <div><dt>Hired</dt><dd>{fmtDay(a.hiredAt)}</dd></div>
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
        <p className="sw-card__quote">“{a.catchphrase}”</p>
      </button>
      {BENCHED.includes(as.status) && <div className="sw-bar"><Button size="sm" icon="refresh" onClick={() => void act({ action: 'rehire', agent: a.id })}>Rehire</Button>{as.note && <span className="fx-muted">{as.note}</span>}</div>}
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

function Profile({ a, state, st, act, onBack, onFeed }: { a: Agent; state: SwarmState; st: Stats; act: Act; onBack: () => void; onFeed: (jobId: string) => void }) {
  const as = state.swarm.agents[a.id]!; const skill = state.skills[a.skill];
  return (
    <div className="fx-stack">
      <div className="sw-bar"><Button icon="undo" onClick={onBack}>Crew</Button></div>
      <div className="sw-card sw-card--profile">
        <div className="sw-card__head">
          <Avatar a={a} size={88} />
          <div className="sw-card__who"><h2>{a.name}</h2><span className="fx-muted">{a.role} · hired {fmtDay(a.hiredAt)}</span><Chip tone={TONE[state.statuses[as.status]?.tone ?? '']}>{statusText(as, state.statuses)}</Chip></div>
        </div>
        <p>{a.bio}</p>
        <p className="sw-card__quote">“{a.catchphrase}”</p>
        <p className="fx-muted">Models {a.models.map((m) => core.MODEL_LABEL[m] ?? m).join(' · ')} · up to {a.maxTurns} turns · tools {a.tools.join(', ')}</p>
      </div>
      <section className="fx-stack">
        <h3 className="sw-wave">Skill: {skill?.title ?? a.skill}</h3>
        <pre className="sw-skill">{skill?.body ?? 'No skill file.'}</pre>
      </section>
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
          : <ul className="sw-feed">{st.feed.map((f, i) => <li key={i}><button className="sw-link" onClick={() => onFeed(f.jobId)}>{f.jobId}</button> <span className="fx-muted">{fmtTime(f.at)}</span> <ModelChip m={f.model} /> {f.status} · <b>{core.fmtUsd(f.usd)}</b>{f.summary ? ` · ${f.summary}` : ''}</li>)}</ul>}
      </section>
    </div>
  );
}
