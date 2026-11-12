import { useEffect, useState } from 'react';
import { Chip, Icon } from '@console/axf/react';
import { api, fmtTime, type Res } from './ui-types';

/*
 * Settings → Plugins → Agent swarm → Section owners (crew-sections@1): every section of the system that acts on its own
 * (the orchestrator, the dispatcher, the watchdog, landing, the merge queue, deploys, backups, the systems check,
 * notification rules) and the employee who owns it. The owner posts the section's key events in the group chat. Brett
 * picks another owner here; the pick is saved in the plugin's data folder and announced in the chat.
 */

type Section = { id: string; label: string; group: string; owner: string; current: string; name: string; reassigned: boolean; about: string; events: string[]; where: string };
type Board = { sections: Section[]; groups: string[]; events: string[]; history: { at: string; section: string; from: string; to: string; by: string; note: string }[]; crew: { id: string; name: string; role: string }[] };

const EVENT_WORD: Record<string, string> = { start: 'starts', done: 'done', failed: 'failed', blocked: 'blocked', waiting: 'waiting for you' };

export function SectionOwnersPanel() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => {
    try { const r = await api.call<Res<{ board: Board }>>('sections'); if (!r.ok) throw new Error(r.error); setBoard(r.board); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const assign = async (section: string, agent: string) => {
    setBusy(section);
    try { const r = await api.post<Res<{ board: Board }>>('sections/assign', { section, agent }); if (!r.ok) throw new Error(r.error); setBoard(r.board); setError(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  if (!board) return <p className="fx-small fx-muted" style={{ margin: 0 }}>{error || 'Loading the section owners…'}</p>;
  const nameOf = (id: string) => board.crew.find((a) => a.id === id)?.name ?? id;
  return (
    <div className="fx-stack sw-sections">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Each section that runs on its own has one owner. The owner posts its key moments in the group chat: starts, done, failed, blocked, waiting for you. Nothing is posted while the chat is off.</p>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      {board.groups.map((g) => (
        <section key={g} data-fx-focus-key={g} className="fx-stack sw-sections__group" aria-label={g}>
          <h4 className="fx-small fx-muted sw-sections__head">{g}</h4>
          {board.sections.filter((s) => s.group === g).map((s) => (
            <div key={s.id} data-fx-focus-key={s.id} className="sw-sections__row" data-section={s.id}>
              <div className="sw-sections__what">
                <strong>{s.label}</strong>{s.reassigned && <Chip tone="accent">reassigned</Chip>}
                <div className="fx-small fx-muted">{s.about}</div>
                <div className="fx-small fx-muted">Posts: {s.events.map((e) => EVENT_WORD[e] ?? e).join(', ')}{s.where ? ` · ${s.where}` : ''}</div>
              </div>
              <select className="fx-input sw-bar__pick" aria-label={`Owner of ${s.label}`} value={s.current} disabled={busy === s.id} onChange={(e) => void assign(s.id, e.target.value)}>
                {board.crew.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === s.owner ? ' (default)' : ''}</option>)}
              </select>
            </div>
          ))}
        </section>
      ))}
      {board.history.length > 0 && (
        <details className="sw-sections__history">
          <summary className="fx-small">Reassignments ({board.history.length})</summary>
          <ul className="fx-small fx-muted">{board.history.map((h, i) => <li key={`${h.at}-${i}`} data-fx-focus-key={`${h.at}-${i}`}>{fmtTime(h.at)} · {board.sections.find((s) => s.id === h.section)?.label ?? h.section}: {nameOf(h.from)} → {nameOf(h.to)} ({h.by}){h.note ? ` · ${h.note}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
