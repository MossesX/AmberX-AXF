import { useEffect, useState } from 'react';
import { AgentAvatar, Button, Chip, Icon, SelectField, useRuntime } from '@console/axf/react';
import { api, fmtTime, type Agent, type Res, type SwarmState } from './ui-types';

/*
 * Who does what (crew-roles@1, roles-core.mjs; Brett, Nov 9 2026: "Assign employees to every single type of action and
 * app, so I can understand easily what's what … And I need a way to see who has which job"). The board lists every role
 * (the orchestrator, the dispatcher, each app, each kind of action) with the employee who holds it and a picker to
 * reassign it; an employee's profile lists the roles they hold and their whole Activity Monitor history.
 * Same data from REST (GET roles, POST roles/assign, GET agents/{id}/history), the CLI (swarm.mjs roles | assign |
 * history), the console MCP / voice (plugin commands) and the deep link agent-swarm.roles.
 */

export type RoleRow = { id: string; label: string; group: string; about: string; holder: string; holderName: string; holderTitle: string; isDefault: boolean; defaultHolder: string };
export type Board = { groups: string[]; roles: RoleRow[]; jobs: Record<string, string[]>; history: { at: string; role: string; from: string; to: string; by: string; note: string }[]; problems: string[] };
type LogLine = { at: string; agent: string; roleId: string; id: string; state: string; source: string; kind: string; title: string; url: string };
type History = { jobs: RoleRow[]; activity: LogLine[]; reassignments: Board['history'] };

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { const r = await api.call<Res<{ board: Board }>>('roles'); if (!r.ok) throw new Error(r.error); setBoard(r.board); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const assign = async (role: string, agent: string) => {
    try { const r = await api.post<Res<{ board: Board }>>('roles/assign', { role, agent }); if (!r.ok) throw new Error(r.error); setBoard(r.board); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  return { board, error, load, assign };
}

const face = (a: Agent | undefined, id: string, name: string) => ({ id, name, role: a?.role, avatar: a?.avatar ?? null });

/** The board: one row per role, grouped (Orchestrator, Apps, Actions); the holder's face opens their profile. */
export function WhoDoesWhatTab({ state, onAgent }: { state: SwarmState; onAgent: (id: string) => void }) {
  const { board, error, load, assign } = useBoard();
  const byId = Object.fromEntries(state.roster.agents.map((a) => [a.id, a]));
  const options = state.roster.agents.map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }));
  if (!board) return <div className="fx-empty">{error || 'Loading who does what…'}</div>;
  const nameOf = (id: string) => byId[id]?.name ?? id;
  return (
    <div className="fx-stack">
      <div className="sw-bar">
        <p className="fx-muted sw-grow">Every job in the system and the employee who holds it. Their face is on every Activity Monitor entry of that kind; tap a face for their profile. Pick someone else to reassign a job.</p>
        <Button icon="refresh" onClick={() => void load()}>Reload</Button>
      </div>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      {board.problems.length > 0 && <div className="pl-note is-warn"><Icon name="alert" size={14} />{board.problems.join(' · ')}</div>}
      {board.groups.map((g) => (
        <section key={g} className="fx-stack" aria-label={g}>
          <h3 className="sw-wave">{g}</h3>
          <ul className="sw-roles">
            {board.roles.filter((r) => r.group === g).map((r) => (
              <li key={r.id} className="sw-roles__row">
                <button type="button" data-fx-row className="sw-roles__who" aria-label={`${r.holderName}: open their profile`} onClick={() => onAgent(r.holder)}>
                  <AgentAvatar info={face(byId[r.holder], r.holder, r.holderName)} label />
                </button>
                <div className="sw-roles__job">
                  <b>{r.label}</b>{!r.isDefault && <> <Chip tone="accent">reassigned</Chip></>}
                  <span className="fx-muted fx-small">{r.about}</span>
                </div>
                <SelectField className="sw-roles__pick" label={`Who holds ${r.label}`} value={r.holder} options={options} onChange={(v) => void assign(r.id, v)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {board.history.length > 0 && (
        <section className="fx-stack">
          <h3 className="sw-wave">Reassignments</h3>
          <ul className="sw-feed">{board.history.slice(0, 20).map((h, i) => <li key={i}><span className="fx-muted">{fmtTime(h.at)}</span> {board.roles.find((r) => r.id === h.role)?.label ?? h.role}: {nameOf(h.from)} → <b>{nameOf(h.to)}</b>{h.note ? ` · ${h.note}` : ''} <span className="fx-muted">({h.by})</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

const STATE_WORD: Record<string, string> = { queued: 'queued', running: 'started', waiting: 'waiting', held: 'on hold', done: 'done', failed: 'failed', cancelled: 'cancelled', stale: 'went quiet' };

/** On an employee's profile: the jobs they hold and everything they did in the Activity Monitor, newest first. */
export function ProfileJobs({ a, onRoles }: { a: Agent; onRoles: () => void }) {
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.call<Res<History>>(`agents/${encodeURIComponent(a.id)}/history?limit=200`).then((r) => { if (!live) return; if (!r.ok) throw new Error(r.error); setH(r); setError(''); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [a.id]);
  return (
    <>
      <section className="fx-stack">
        <h3 className="sw-wave">Jobs</h3>
        {error && <p className="fx-muted">{error}</p>}
        {h && (h.jobs.length === 0 ? <p className="fx-muted">No standing job. Give them one in Who does what.</p>
          : <ul className="sw-feed">{h.jobs.map((j) => <li key={j.id}><b>{j.label}</b> <span className="fx-muted">· {j.group} · {j.about}</span></li>)}</ul>)}
        <div className="sw-bar"><Button icon="user" onClick={onRoles}>Who does what</Button></div>
      </section>
      <section className="fx-stack">
        <h3 className="sw-wave">Activity history</h3>
        {h && (h.activity.length === 0 ? <p className="fx-muted">Nothing in the Activity Monitor yet.</p>
          : <ul className="sw-feed">{h.activity.map((l, i) => <li key={`${l.id}-${l.state}-${i}`}><span className="fx-muted">{fmtTime(l.at)}</span> <b>{STATE_WORD[l.state] ?? l.state}</b> · {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.title || l.id}</a> : l.title || l.id}</li>)}</ul>)}
        {h && h.reassignments.length > 0 && <p className="fx-muted fx-small">{h.reassignments.length} reassignment(s) involve them (Who does what → Reassignments).</p>}
      </section>
    </>
  );
}

/**
 * The Builds pages' toolbar (slot builds.toolbar): who runs the orchestrator, with their face (Brett, Nov 9 2026: "The
 * orchestrator has somebody who runs it, one of my employees"). Tap: their profile.
 */
export function OrchestratorChip() {
  const rt = useRuntime();
  const { board } = useBoard();
  const onAgent = (id: string) => void rt.actions.dispatch(`agent-swarm.profile:${id}`, { runtime: rt });
  const r = board?.roles.find((x) => x.id === 'orchestrator');
  if (!r) return null;
  return (
    <Button title={`${r.holderName} runs the orchestrator: open their profile`} onClick={() => onAgent(r.holder)}>
      <AgentAvatar info={{ id: r.holder, name: r.holderName, role: r.holderTitle }} size="small" noMenu /> Run by {r.holderName}
    </Button>
  );
}
