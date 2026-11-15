/**
 * The Claude plugin's screens (agent-pick@1): the agent picker (a dialog: one row per crew agent, tap to expand every
 * stat and the links to the agent's card, history, Session browser, Terminal and group chat; one tap on Pick picks),
 * the settings panel (Claude agent, Ask me every session, Ask for headless too), the "Assign to Claude" button for the
 * crew cards (slot swarm.agent.actions) and the persona / voice notes editor on an agent's profile.
 *
 * Polls GET /asks every 5 s while the console is visible: a waiting ask opens the picker for that session (the
 * console pop-up; the same ask is also an axHub approval). Nothing here calls a model.
 */
import { createElement, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { avatarModel } from '../../../../../framework/core/engines/agent-card-rules.mjs';

export const FOLDER = 'claude-session';
export const PICKER = 'claude.picker';
const POLL_MS = 5_000;
export const api = pluginApi(FOLDER, 'Claude sessions', { unavailable: 'The Claude sessions plugin is switched off or its server part is not running.' });

type Avatar = { face: string; hair: number; gear: string; hue: number } | null | undefined;
type Run = { jobId: string; buildId: string; at: string; status: string; model: string; usd: number; summary: string };
type Pay = { at: string; kind: string; from: number; to: number; note?: string };
type Writeup = { at: string; from: string; to: string; note?: string; by?: string };
export interface Row {
  id: string; name: string; role: string; avatar: Avatar; status: string; statusLabel: string; works: boolean; working: boolean; currentJob: string;
  todayUsd: number; hoursToday: number; hoursWeek: number; salary: number | null; hourly: number | null; payLeft: number | null; broke: boolean; rating: number | null;
  sessions: { session: string; client: string; summary: string; startedAt: string }[];
  details: { stats: { runs?: number; done?: number; failed?: number; successRate?: number | null; favoriteModel?: string; lastSeen?: string }; spend: { today?: number; week?: number; all?: number; avgPerJob?: number };
    minutes: { today?: number; week?: number; avgPerJob?: number }; feed: Run[]; raises: Pay[]; writeups: Writeup[]; bonuses: number; specialty: string; catchphrase: string; bio: string; persona: string; voice: string };
}
export interface Settings { defaultAgent: string; askEverySession: boolean; askHeadless: boolean }
interface AgentCard { id: string; name: string; persona: string; voice: string; intro: string }
export interface SessionRecording { state: string; name: string; group: string; message?: string }
export interface SessionView { session: string; client: string; summary: string; status: string; source: string; startedAt: string; answeredBy: string; asking: boolean; agent: AgentCard; ticket?: string; hub?: string; recording?: SessionRecording }
interface Picker { settings: Settings; default: string; crew: boolean; rows: Row[]; sessions: SessionView[] }

const usd = (v: number | null | undefined) => `$${(Number(v) || 0) < 10 ? (Number(v) || 0).toFixed(2) : Math.round(Number(v) || 0)}`;
const when = (iso?: string) => { const d = new Date(iso ?? ''); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const CLIENT: Record<string, string> = { voice: 'Voice Amber', chat: 'Chat Amber', code: 'Claude Code', headless: 'Headless build' };

/* ---------------- one shared read of the picker ---------------- */

let st: { data: Picker | null; error: string } = { data: null, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export async function loadPicker() {
  try { set({ data: await api.call<Picker>('picker'), error: '' }); } catch (e) { set({ error: (e as Error).message }); }
}
function usePicker() {
  return useSyncExternalStore((f) => { subs.add(f); if (!st.data) void loadPicker(); return () => { subs.delete(f); }; }, () => st);
}

/* ---------------- the avatar (framework card rules, theme tokens only) ---------------- */

const PAINT: Record<string, string> = { bg: 'axp-claude-session__av-bg', skin: 'axp-claude-session__av-skin', ink: 'axp-claude-session__av-ink', line: 'axp-claude-session__av-line', 'line-thick': 'axp-claude-session__av-line axp-claude-session__av-thick' };
/** The agent's face (agent-card rules' avatar model); right-click / long-press = the agent menu (context target `agent`). */
export function Face({ id, name, avatar, size = 40 }: { id: string; name: string; avatar: Avatar; size?: number }) {
  if (!avatar) return <span className="axp-claude-session__initials" data-fx-ctx-target="agent" data-fx-ctx-payload={id} aria-label={`${name}'s avatar`}>{name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>;
  const m = avatarModel(avatar);
  return (
    <svg className="axp-claude-session__av" width={size} height={size} viewBox={`0 0 ${m.box} ${m.box}`} role="img" aria-label={`${name}'s avatar`} data-fx-ctx-target="agent" data-fx-ctx-payload={id}>
      {m.parts.map((p) => createElement(p.tag, { key: p.id, ...p.attrs, className: PAINT[p.paint], style: p.paint === 'hair' || p.paint === 'shirt' ? { fill: `var(${m.tokens[p.paint as 'hair' | 'shirt']})` } : undefined }))}
    </svg>
  );
}

const Stars = ({ v }: { v: number | null }) => (v == null ? <span className="fx-muted">no rating</span> : <span className="axp-claude-session__stars" aria-label={`Rating ${v} of 5`}>{'★'.repeat(Math.round(v))}{'☆'.repeat(5 - Math.round(v))} <span className="fx-muted">{v.toFixed(1)}</span></span>);

/* ---------------- hooks to the rest of the console ---------------- */

/** Run an action when some plugin provides it, else the fallback (plugins never name each other's folders). */
function go(rt: ReturnType<typeof useRuntime>, spec: string, fallback: () => void) { if (!rt.dispatch(spec)) fallback(); }
function openCard(rt: ReturnType<typeof useRuntime>, id: string) { go(rt, `agent-swarm.profile:${id}`, () => { consoleApi.writeLocal('swarm-profile', id); rt.dispatch('nav:agent-swarm'); }); }

/* ---------------- one row ---------------- */

function RowView({ r, isDefault, current, onPick, busy }: { r: Row; isDefault: boolean; current: boolean; onPick: (id: string) => void; busy: boolean }) {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const d = r.details; const s = d.stats;
  const [persona, setPersona] = useState(d.persona); const [voice, setVoice] = useState(d.voice);
  useEffect(() => { setPersona(d.persona); setVoice(d.voice); }, [d.persona, d.voice]);
  const savePersona = async () => { try { await api.put('persona', { agent: r.id, persona, voice }); rt.toast(`Saved ${r.name}'s persona`, 'success'); void loadPicker(); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  return (
    <li className={`axp-claude-session__row${current ? ' is-current' : ''}${r.works ? '' : ' is-off'}`}>
      <div className="axp-claude-session__line">
        <button type="button" className="axp-claude-session__open" data-fx-row aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`${r.name}: ${open ? 'hide' : 'show'} details`}>
          <Face id={r.id} name={r.name} avatar={r.avatar} />
          <span className="axp-claude-session__who">
            <b>{r.name}</b>
            <span className="fx-small fx-muted">{r.role}</span>
            <span className="axp-claude-session__chips">
              <Chip tone={r.working ? 'success' : undefined}>{r.working ? 'Working' : 'Idle'}</Chip>
              {r.status !== 'on-duty' && <Chip tone="warning">{r.statusLabel}</Chip>}
              {isDefault && <Chip tone="accent">Default</Chip>}
              {current && <Chip tone="accent">This session</Chip>}
            </span>
            {r.currentJob && <span className="fx-small axp-claude-session__job"><Icon name="play" size={12} /> {r.currentJob}</span>}
          </span>
          <dl className="axp-claude-session__nums">
            <div><dt>Today</dt><dd>{usd(r.todayUsd)}</dd></div>
            <div><dt>Hours</dt><dd>{r.hoursToday} h</dd></div>
            <div><dt>Pay</dt><dd>{r.hourly != null ? `${usd(r.hourly)}/h` : r.salary != null ? `${usd(r.salary)}/wk` : '—'}</dd></div>
            <div><dt>Rating</dt><dd><Stars v={r.rating} /></dd></div>
          </dl>
        </button>
        <Button tone={current ? 'quiet' : 'primary'} disabled={busy || current} onClick={() => onPick(r.id)}>{current ? 'Picked' : 'Pick'}</Button>
      </div>
      {open && (
        <div className="axp-claude-session__details">
          <dl className="axp-claude-session__grid">
            <div><dt>Jobs done</dt><dd>{s.done ?? 0}</dd></div>
            <div><dt>Success / fail</dt><dd>{s.done ?? 0} / {s.failed ?? 0}{s.successRate != null ? ` (${Math.round((s.successRate ?? 0) * 100)}%)` : ''}</dd></div>
            <div><dt>Avg cost</dt><dd>{usd(d.spend.avgPerJob)}</dd></div>
            <div><dt>Avg time</dt><dd>{d.minutes.avgPerJob ?? 0} min</dd></div>
            <div><dt>Week</dt><dd>{usd(d.spend.week)} · {r.hoursWeek} h</dd></div>
            <div><dt>All time</dt><dd>{usd(d.spend.all)}</dd></div>
            <div><dt>Pay left</dt><dd className={r.broke ? 'axp-claude-session__warn' : ''}>{r.broke ? 'broke' : usd(r.payLeft)}</dd></div>
            <div><dt>Bonuses</dt><dd>{d.bonuses}</dd></div>
            <div><dt>Favourite model</dt><dd>{s.favoriteModel || '—'}</dd></div>
            <div><dt>Last seen</dt><dd>{s.lastSeen ? when(s.lastSeen) : 'never'}</dd></div>
          </dl>
          {d.specialty && <p className="fx-small">{d.specialty}</p>}
          {d.catchphrase && <p className="fx-small fx-muted axp-claude-session__quote">“{d.catchphrase}”</p>}
          <section><h4 className="axp-claude-session__h">Recent runs</h4>
            {d.feed.length ? <ul className="axp-claude-session__feed">{d.feed.slice(0, 6).map((f) => <li key={f.jobId + f.at}><span className="fx-muted">{when(f.at)}</span> {f.jobId} · {f.status} · <b>{usd(f.usd)}</b>{f.summary ? ` · ${f.summary}` : ''}</li>)}</ul> : <p className="fx-small fx-muted">No runs yet.</p>}
          </section>
          <section><h4 className="axp-claude-session__h">Write-ups</h4>
            {d.writeups.length ? <ul className="axp-claude-session__feed">{d.writeups.map((w, i) => <li key={i}><span className="fx-muted">{when(w.at)}</span> {w.from} → <b>{w.to}</b>{w.note ? ` · ${w.note}` : ''}</li>)}</ul> : <p className="fx-small fx-muted">Clean record.</p>}
          </section>
          <section><h4 className="axp-claude-session__h">Raises</h4>
            {d.raises.length ? <ul className="axp-claude-session__feed">{d.raises.map((p, i) => <li key={i}><span className="fx-muted">{when(p.at)}</span> {p.kind === 'raise' ? 'Raise' : 'Docked'} {usd(p.from)} → <b>{usd(p.to)}</b>{p.note ? ` · ${p.note}` : ''}</li>)}</ul> : <p className="fx-small fx-muted">None yet.</p>}
          </section>
          <section className="axp-claude-session__persona"><h4 className="axp-claude-session__h">Persona / voice (how a Claude session talks as {r.name})</h4>
            <TextField label="Persona" value={persona} onChange={setPersona} rows={3} placeholder="e.g. Quick, dry, says what he shot and moves on." />
            <TextField label="Voice" value={voice} onChange={setVoice} placeholder="e.g. low, calm, Boston" />
            <div className="axp-claude-session__bar"><Button size="sm" icon="check" disabled={persona === d.persona && voice === d.voice} onClick={() => void savePersona()}>Save persona</Button></div>
          </section>
          <div className="axp-claude-session__bar" role="group" aria-label={`${r.name}: open`}>
            <Button size="sm" icon="user" onClick={() => openCard(rt, r.id)}>Card</Button>
            <Button size="sm" icon="clock" onClick={() => go(rt, `crew.history:${r.id}`, () => openCard(rt, r.id))}>History</Button>
            <Button size="sm" icon="list" onClick={() => go(rt, `crew.session:${r.id}`, () => go(rt, 'nav:session-browser', () => rt.dispatch('nav:agent-swarm')))}>Session browser</Button>
            <Button size="sm" icon="terminal" onClick={() => go(rt, `crew.terminal:${r.id}`, () => go(rt, 'terminal.new', () => rt.toast('No terminal plugin is on', 'warning')))}>Terminal</Button>
            <Button size="sm" icon="bell" onClick={() => go(rt, 'crew.chat', () => rt.dispatch('nav:agent-swarm'))}>Group chat</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------------- the picker ---------------- */

/** The agent picker. With `ask` (a waiting session), Pick answers that session; without, Pick assigns the default agent. */
export function PickerView({ ask, close }: { ask?: SessionView | null; close?: () => void }) {
  const rt = useRuntime();
  const { data, error } = usePicker();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { void loadPicker(); }, []);
  const pick = async (id: string) => {
    setBusy(true);
    try {
      if (ask) { await api.post('answer', { session: ask.session, agent: id, ticket: ask.ticket ?? '' }); rt.toast(`${CLIENT[ask.client] ?? 'The session'} works as ${data?.rows.find((r) => r.id === id)?.name ?? id}`, 'success'); }
      else { const r = await api.post<{ name: string }>('assign', { agent: id }); rt.toast(`${r.name} is Claude's agent now`, 'success'); }
      await loadPicker(); close?.();
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  const current = ask ? ask.agent.id : data?.default ?? '';
  const rows = (data?.rows ?? []).filter((r) => !q || `${r.name} ${r.role} ${r.currentJob}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="axp-claude-session">
      {ask ? (
        <p className="axp-claude-session__ask"><Icon name="sparkles" size={14} /> <b>{CLIENT[ask.client] ?? ask.client}</b> started{ask.summary ? `: ${ask.summary}` : ''}. It works as <b>{ask.agent.name}</b> until you pick.{ask.hub ? <span className="fx-small fx-muted"> ({ask.hub})</span> : null}</p>
      ) : <p className="fx-small fx-muted">Pick the agent every new Claude session works as. Its costs and commits go on that agent's card.</p>}
      {error && <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {error}</p>}
      {!data && !error && <p className="fx-small fx-muted">Loading the crew…</p>}
      {data && !data.crew && <p className="fx-small" role="alert"><Icon name="alert" size={14} /> The Agent swarm is off, so there is no crew to pick from.</p>}
      <TextField label="Find an agent" value={q} onChange={setQ} placeholder="name, role or job" />
      <ul className="axp-claude-session__list" aria-label="Agents">
        {rows.map((r) => <RowView key={r.id} r={r} isDefault={r.id === data?.default} current={r.id === current} onPick={(id) => void pick(id)} busy={busy} />)}
      </ul>
    </div>
  );
}

/** Watches for asks and opens the picker for the first one (the console pop-up). Mounted once in the app frame. */
export function AskWatcher() {
  const rt = useRuntime();
  useEffect(() => {
    const seen = new Set<string>();
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const r = await api.call<{ asks: SessionView[]; brett: boolean }>('asks');
        const next = r.asks.find((a) => !seen.has(a.session));
        if (next && r.brett) { seen.add(next.session); rt.openDialog(PICKER, { ask: next }); }
      } catch { /* the plugin may be off: nothing to show */ }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [rt]);
  return null;
}

/* ---------------- settings ---------------- */

const RECORDING: Record<string, string> = { asked: 'recording asked for', joined: 'recorded', 'phone-offline': 'not recorded: phone offline', failed: 'not recorded' };

/** A session's recording: its state, and a way to its transcripts (the recorder page searches by the session's group). */
function RecordingLink({ rec }: { rec: SessionRecording }) {
  const rt = useRuntime();
  const open = () => { rt.settings.set('axf.output-recorder.find', rec.group); rt.dispatch('nav:output-recorder'); };
  return <> · <span title={rec.message}>{RECORDING[rec.state] ?? rec.state}</span>{(rec.state === 'asked' || rec.state === 'joined') && <Button size="sm" tone="quiet" icon="file" onClick={open}>Transcript</Button>}</>;
}

export function SettingsPanel() {
  const rt = useRuntime();
  const { data, error } = usePicker();
  const save = async (patch: Partial<Settings>) => { try { await api.put('agent-settings', patch); await loadPicker(); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  if (!data) return <p className="fx-small fx-muted">{error || 'Loading…'}</p>;
  const s = data.settings;
  return (
    <div className="axp-claude-session fx-stack">
      <SelectField label="Claude agent" hint="The agent every new Claude session works as until you pick another (and the one used when you don't answer)."
        value={s.defaultAgent || data.default} options={data.rows.map((r) => ({ value: r.id, label: `${r.name} · ${r.role}` }))} onChange={(v) => void save({ defaultAgent: v })} />
      <Switch label="Ask me every session" checked={s.askEverySession} onChange={(v) => void save({ askEverySession: v })} hint="Each new voice, chat or Claude Code session pops the agent picker here and sends an axHub approval to your phone." />
      <Switch label="Ask for headless too" checked={s.askHeadless} disabled={!s.askEverySession} onChange={(v) => void save({ askHeadless: v })} hint="Off: headless builds keep the agent their brief names, no prompt." />
      <div className="axp-claude-session__bar"><Button icon="user" onClick={() => rt.openDialog(PICKER, {})}>Choose Claude's agent…</Button></div>
      {data.sessions.length > 0 && (
        <details><summary className="fx-small">Recent sessions ({data.sessions.length})</summary>
          <ul className="axp-claude-session__feed">{data.sessions.map((x) => <li key={x.session}><span className="fx-muted">{when(x.startedAt)}</span> {CLIENT[x.client] ?? x.client} as <b>{x.agent.name}</b> · {x.status}{x.answeredBy ? ` (${x.answeredBy})` : ''}{x.summary ? ` · ${x.summary}` : ''}{x.recording && <RecordingLink rec={x.recording} />}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/* ---------------- crew cards: Assign to Claude ---------------- */

export function AssignButton({ agentId, name }: { agentId: string; name: string }) {
  const rt = useRuntime();
  const { data } = usePicker();
  const on = data?.default === agentId;
  const assign = async () => { try { await api.post('assign', { agent: agentId }); rt.toast(`${name} is Claude's agent now`, 'success'); await loadPicker(); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  return <div className="axp-claude-session__bar"><Button size="sm" icon={on ? 'check' : 'user'} tone={on ? 'quiet' : undefined} disabled={on} onClick={() => void assign()}>{on ? "Claude's agent" : 'Assign to Claude'}</Button></div>;
}
