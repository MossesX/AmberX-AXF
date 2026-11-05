/**
 * Session sync UI: the Sessions panel (who is on, claims, offers / assigned work, the Breakroom's Sessions channel),
 * the join dialog (what's going on, what to jump into), Send to helper, Add widgets…, the settings tab and the
 * join watcher. Framework controls and tokens only.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AgentAvatar, Button, Checkbox, Chip, Container, Icon, Note, SelectField, SelectionBar, Switch, TabGroup, TextField, useIsPhone, useMultiSelect, useRuntime } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { DIALOG_SEND, DIALOG_WIDGETS, FOLDER, KEYS, VIEW, actions, addWidget, call, post, attachableWidgets, getStore, hostLabel, loadMessages, loadSnapshot, loadState, openWindows, removeWidget, savedWidgets, subscribe, type AccountV, type AssignmentV, type MessageV, type OfferV, type SessionV, type SnapshotV, type StateV } from './core';

export const useSync = () => useSyncExternalStore(subscribe, getStore, getStore);
const ago = (iso: string) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const fmtTime = (iso: string) => (iso ? iso.slice(11, 16) : '');
const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { working: 'success', idle: undefined, lunch: 'warning', offline: undefined, ended: undefined, pending: 'warning' };

function LiveDot() {
  const { live } = useSync();
  return <span className="axp-session-sync__live" title={live === 'live' ? 'Live: every change arrives at once' : live === 'reconnecting' ? 'Reconnecting to the event stream' : live === 'polling' ? 'Stream down: checking every 30 s' : 'Not connected'}><span className={`axp-session-sync__dot is-${live}`} aria-hidden="true" />{live === 'live' ? 'live' : live === 'off' ? 'off' : 'reconnecting'}</span>;
}

/* ---------------- the Sessions panel ---------------- */

export function SessionsPage() {
  const { state, error, loading } = useSync();
  const rt = useRuntime();
  useEffect(() => { void loadState(); void loadMessages(); }, []);
  const me = state?.me;
  const primary = me?.role === 'primary';
  return (
    <div className="fx-stack fx-stack--lg" data-help="view:session-sync">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Builds</p><h1>Sessions</h1><p className="fx-muted">{state ? `${state.project} · you are ${me?.agent || me?.session} (${me?.account}, ${me?.role})${state.scoped ? ' · managed by orchestrator' : ''}` : 'Every Claude session on this project, side by side.'}</p></div>
        <div className="fx-row" role="toolbar" aria-label="Sessions" data-axf-toolbar="session-sync">
          <LiveDot />
          <Button icon="refresh" busy={loading} onClick={() => void actions.sync()} data-help="sync-session">Sync session</Button>
          <Button icon="log-in" onClick={() => rt.openDialog('session-sync.join', {})}>What's going on?</Button>
          {me?.role === 'secondary' && <RequestWorkButton />}
          {primary && <Button icon="shuffle" onClick={async () => { const r = await actions.replan(true); if (r) rt.toast(r.summary.length ? r.summary.join('; ') : 'Nothing to move', 'info', 'Re-plan preview'); }} data-help="replan">Re-plan (preview)</Button>}
          <Button icon="log-out" tone="danger" confirm="End pairing? Your claims are released and your assigned work goes back to the orchestrator." onClick={() => void actions.end('ended from the console')} data-help="end-pairing">End pairing</Button>
        </div>
      </header>
      {error && <Note tone="warning">{error}</Note>}
      {state?.settings.enforce === false && <Note tone="warning">Claims are not enforced (Settings → Plugins → Session sync): builds run unrestricted.</Note>}
      {!state && !error && <p className="fx-muted">Loading…</p>}
      {state && (
        <div className="axp-session-sync__grid">
          <div className="fx-stack fx-stack--lg">
            <Container title="Who is on" icon="users"><Roster state={state} /></Container>
            <Container title="Claims" icon="lock"><Claims state={state} /></Container>
            <Container title={primary ? 'Offers and assigned work' : 'Offered to you / your work'} icon="package"><Work state={state} /></Container>
            <Container title="Helpers" icon="activity"><Stats state={state} /></Container>
          </div>
          <Container title="Sessions channel (Breakroom)" icon="message-circle"><Channel /></Container>
        </div>
      )}
    </div>
  );
}

function Roster({ state }: { state: StateV }) {
  const rt = useRuntime();
  const brett = state.me.session.startsWith('console-') && state.me.role === 'primary';
  return (
    <ul className="axp-session-sync__rows">
      {state.sessions.filter((s) => !s.endedAt || Date.now() - Date.parse(s.endedAt) < 3600e3).map((s) => (
        <li key={s.id} className={`axp-session-sync__row is-${s.role} is-${s.status}`} data-fx-row>
          <AgentAvatar agent={s.agent || null} label />
          <span className="axp-session-sync__grow">
            <b>{s.agent || s.id}</b> <span className="fx-muted">({s.account}, {s.client})</span>{s.role === 'primary' && <> <Chip tone="accent">primary</Chip></>}{s.approved === false && <> <Chip tone="warning">waiting for approval</Chip></>}
            <div className="axp-session-sync__doing">{s.doing.build ? `${s.doing.build}${s.doing.step ? ` ${s.doing.step}` : ''}${s.doing.note ? ` — ${s.doing.note}` : ''}` : s.helper.tooltip}{s.branch ? ` · ${s.branch}` : ''} · seen {ago(s.lastSeenAt) || 'never'}</div>
          </span>
          <Chip tone={STATUS_TONE[s.status]}>{s.status}</Chip>
          {s.approved === false && brett && <Button size="sm" icon="check" onClick={() => void actions.approveAccount(s.account)} data-help="approve-account">Approve account</Button>}
          {brett && s.role !== 'primary' && !s.endedAt && <Button size="sm" icon="star" onClick={() => void actions.makePrimary(s.id)}>Make primary</Button>}
          <Button size="sm" icon="message-circle" onClick={() => rt.openDialog(DIALOG_SEND, { to: s.agent || s.id })}>Message</Button>
        </li>
      ))}
      {!state.sessions.length && <li className="fx-muted">Nobody yet. Run /sync in a Claude session, or press Sync session.</li>}
    </ul>
  );
}

function Claims({ state }: { state: StateV }) {
  const [kind, setKind] = useState<'area' | 'path'>('area');
  const [what, setWhat] = useState('');
  const [reason, setReason] = useState('');
  const names = new Map(state.sessions.map((s) => [s.id, s.agent || s.id]));
  const areas = ['terminal', 'banner', 'kernel', 'plugins', 'builds', 'spec', 'console'];
  return (
    <div className="fx-stack">
      <ul className="axp-session-sync__rows">
        {state.claims.map((c) => (
          <li key={c.id} className="axp-session-sync__row" data-fx-row>
            <span className="axp-session-sync__grow"><b>{names.get(c.session) ?? c.session}</b> holds {c.kind === 'area' ? <Chip tone="accent">area {c.area}</Chip> : <code>{c.paths.join(', ')}</code>}{c.build ? <span className="fx-muted"> for {c.build}{c.step ? ` ${c.step}` : ''}</span> : ''}{c.reason ? <span className="fx-muted"> — {c.reason}</span> : ''}<div className="axp-session-sync__doing">until {fmtTime(c.expiresAt)}</div></span>
            {c.session === state.me.session && <Button size="sm" icon="unlock" onClick={() => void actions.release(c.id)}>Release</Button>}
          </li>
        ))}
        {!state.claims.length && <li className="fx-muted">No claims. A session claims an area before it edits there.</li>}
      </ul>
      <div className="axp-session-sync__bar">
        <SelectField label="Kind" value={kind} onChange={(v) => setKind(v as 'area' | 'path')} options={[{ value: 'area', label: 'Area' }, { value: 'path', label: 'Paths' }]} />
        {kind === 'area' ? <SelectField label="Area" value={what} onChange={setWhat} options={[{ value: '', label: 'pick…' }, ...areas.map((a) => ({ value: a, label: a }))]} /> : <TextField label="Paths (globs, comma separated)" value={what} onChange={setWhat} placeholder="apps/console-web/plugins/foo/**" />}
        <TextField label="Why" value={reason} onChange={setReason} placeholder="what you are doing there" />
        <Button icon="lock" disabled={!what} onClick={() => { void actions.claim(kind, what, reason); setWhat(''); }}>Claim</Button>
      </div>
    </div>
  );
}

function Work({ state }: { state: StateV }) {
  const rt = useRuntime();
  const primary = state.me.role === 'primary';
  const names = new Map(state.sessions.map((s) => [s.id, s.agent || s.id]));
  const live = state.assignments.filter((a) => ['queued', 'working', 'held', 'blocked'].includes(a.status));
  return (
    <div className="fx-stack">
      {state.offers.map((o) => <OfferRow key={o.id} o={o} mine={!primary} names={names} />)}
      {live.map((a) => (
        <div key={a.id} className="axp-session-sync__row" data-fx-row data-fx-ctx-target="axf-build" data-fx-ctx-payload={a.build}>
          <AgentAvatar agent={a.agent || null} />
          <span className="axp-session-sync__grow"><b>{a.build}</b>{a.steps ? <span className="fx-muted"> steps {a.steps.join(', ')}</span> : <span className="fx-muted"> (whole build)</span>}{a.parent ? <span className="fx-muted"> from {a.parent}</span> : ''} · {names.get(a.session) ?? a.session}<div className="axp-session-sync__doing">{a.status}{a.reason ? `: ${a.reason}` : ''}{a.backAt ? ` · back ${fmtTime(a.backAt)}` : ''} · since {ago(a.since)}</div></span>
          <Chip tone={a.status === 'working' ? 'success' : a.status === 'queued' ? 'accent' : 'warning'}>{a.status}</Chip>
          {!primary && a.session === state.me.session && a.status !== 'held' && <Button size="sm" icon="pause" onClick={() => { const reason = window.prompt('Why on hold?') ?? ''; if (reason) void actions.respond(a.id, 'hold', reason); }} data-help="hold">Hold</Button>}
          {!primary && a.session === state.me.session && <Button size="sm" icon="rotate-ccw" onClick={() => void actions.respond(a.id, 'release', 'released from the console')} data-help="release">Release</Button>}
          {primary && <Button size="sm" icon="rotate-ccw" tone={a.status === 'working' ? 'danger' : 'neutral'} confirm={a.status === 'working' ? 'The helper is working on it. Take it back anyway? Its work in progress stays on its branch.' : undefined} onClick={() => void actions.takeBack(a.id, null, a.status === 'working', 'taken back from the console')} data-help="take-back">Take back</Button>}
          {primary && <Button size="sm" icon="send" onClick={() => rt.openDialog(DIALOG_SEND, { build: a.build })}>Send…</Button>}
        </div>
      ))}
      {!state.offers.length && !live.length && <p className="fx-muted">{primary ? 'Nothing handed over. Right-click any build or step → Send to helper, or wait for a helper to ask for work.' : 'Nothing offered to you yet. Press Request work.'}</p>}
    </div>
  );
}
function OfferRow({ o, mine, names }: { o: OfferV; mine: boolean; names: Map<string, string> }) {
  return (
    <div className="axp-session-sync__offer" data-fx-row data-fx-ctx-target="axf-build" data-fx-ctx-payload={o.build}>
      <Icon name="package" />
      <span className="axp-session-sync__grow"><b>{o.build}</b>{o.steps ? <span className="fx-muted"> steps {o.steps.join(', ')} as {o.childBuild}</span> : <span className="fx-muted"> (whole build)</span>} → {o.to ? names.get(o.to) ?? o.to : 'any helper'}<div className="axp-session-sync__doing">{o.reason} · until {fmtTime(o.expiresAt)}</div></span>
      {mine && <Button size="sm" tone="primary" icon="check" onClick={() => void actions.respond(o.id, 'accept')} data-help="accept">Accept</Button>}
      {mine && <Button size="sm" icon="x" onClick={() => { const reason = window.prompt('Why not?') ?? ''; if (reason) void actions.respond(o.id, 'reject', reason); }} data-help="reject">Reject</Button>}
      {mine && <Button size="sm" icon="pause" onClick={() => { const reason = window.prompt('Why on hold?') ?? ''; if (reason) void actions.respond(o.id, 'hold', reason); }} data-help="hold">Hold</Button>}
    </div>
  );
}
function RequestWorkButton() {
  const [minutes, setMinutes] = useState('60');
  return <span className="axp-session-sync__bar"><TextField label="Minutes" value={minutes} onChange={setMinutes} /><Button icon="hand" tone="primary" onClick={() => void actions.requestWork(Number(minutes) || 60, [], '')} data-help="request-work">Request work</Button></span>;
}
function Stats({ state }: { state: StateV }) {
  const rows = Object.entries(state.stats);
  return (
    <div className="fx-stack">
      <p className="fx-muted">Agent cap split: {Object.entries(state.caps).map(([k, v]) => `${state.sessions.find((s) => s.id === k)?.agent || k} ${v}`).join(' · ') || 'nobody'}</p>
      {rows.map(([acct, s]) => <p key={acct}><b>{acct}</b>: <span className="axp-session-sync__stat"><b>{s.accepts}</b> accepts</span> · <span className="axp-session-sync__stat"><b>{s.rejects}</b> rejects</span> · <span className="axp-session-sync__stat"><b>{s.holds}</b> holds</span> · <span className="axp-session-sync__stat"><b>{s.released}</b> released</span> · <span className="axp-session-sync__stat"><b>{s.stepsDone}</b> steps done</span>{s.msPerStep.length ? ` · ~${Math.round(s.msPerStep.reduce((a, b) => a + b, 0) / s.msPerStep.length / 60000)} min a step` : ''}</p>)}
      {!rows.length && <p className="fx-muted">No helper stats yet.</p>}
    </div>
  );
}

/* ---------------- the Sessions channel ---------------- */

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'handovers', label: 'Handovers' }, { id: 'blockers', label: 'Blockers' }, { id: 'mine', label: 'My steps' }];
export function Channel({ compact = false }: { compact?: boolean }) {
  const { messages, filter } = useSync();
  const [text, setText] = useState('');
  useEffect(() => { void loadMessages(); }, []);
  return (
    <div className="fx-stack">
      <TabGroup id="session-sync.channel-filter" label="Channel filter" size="sm" value={filter} onChange={(v) => void loadMessages(v)} tabs={FILTERS.map((f) => ({ value: f.id, label: f.label }))} />
      <div className="axp-session-sync__chat" style={compact ? { maxHeight: '30vh' } : undefined}>
        {messages.length === 0 && <p className="fx-empty">Quiet. Lines show up as sessions join, claim, hand over and finish steps.</p>}
        {messages.map((m) => <Message key={m.id} m={m} />)}
      </div>
      <form className="axp-session-sync__bar" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void actions.send(text).then(() => setText('')); }}>
        <input className="fx-input" aria-label="Say something to the other session" placeholder="Say something in the Sessions channel…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" icon="send" disabled={!text.trim()}>Send</Button>
      </form>
    </div>
  );
}
function Message({ m }: { m: MessageV }) {
  return (
    <div className={`axp-session-sync__msg is-${m.kind}`} data-fx-ctx-target={m.jobId ? 'axf-build' : undefined} data-fx-ctx-payload={m.jobId ? m.jobId.split('.')[0] : undefined}>
      <AgentAvatar agent={m.from === 'boss' || m.from === 'brett' ? null : m.from} inText={m.from === 'boss' ? 'Orchestrator' : m.from === 'brett' ? 'Brett' : undefined} />
      <div><div className="axp-session-sync__msghead"><b>{m.from === 'boss' ? 'Orchestrator' : m.from === 'brett' ? 'Brett' : m.from}</b> · {fmtTime(m.at)} · {m.kind}{m.jobId ? ` · ${m.jobId}` : ''}</div><p>{m.text}</p></div>
    </div>
  );
}

/* ---------------- the join dialog ---------------- */

export function JoinDialog({ close }: { close: () => void }) {
  const { snapshot, state } = useSync();
  const rt = useRuntime();
  useEffect(() => { void loadSnapshot(); void loadState(); rt.settings.set(KEYS.joinSeen, new Date().toISOString().slice(0, 10)); }, [rt]);
  const offers = snapshot?.offers ?? [];
  const ids = useMemo(() => offers.map((o) => o.id), [offers]);
  const sel = useMultiSelect(ids);
  if (!snapshot) return <p className="fx-muted">Loading what's going on…</p>;
  const secondary = snapshot.me.role === 'secondary';
  const bar = (p: { done: number; total: number } | null) => p && p.total ? <span className="axp-session-sync__progress" title={`${p.done}/${p.total}`}><span style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></span> : null;
  return (
    <div className="axp-session-sync__join" data-help="dialog:session-sync.join">
      <Note tone="info">You are <b>{snapshot.me.agent || snapshot.me.session}</b> ({snapshot.me.account}), <b>{snapshot.me.role}</b>{secondary ? `: your lists show only what ${snapshot.primary?.agent || 'the primary'} hands you (Managed by orchestrator). Pick what to jump into below, or ask for work.` : ': you own the orchestrator.'} Agent cap split: {Object.entries(snapshot.caps).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}.</Note>
      <div className="axp-session-sync__cols">
        <Container title="Actively working on" icon="activity">
          {snapshot.working.filter((w) => w.build || w.status === 'working').map((w) => <div key={w.session} className="axp-session-sync__row"><AgentAvatar agent={w.agent || null} label /><span className="axp-session-sync__grow"><b>{w.build || 'nothing yet'}</b> {w.step}{w.model ? <Chip>{w.model}</Chip> : null}<div className="axp-session-sync__doing">{w.note || w.status} · {w.role} · since {ago(w.since)} · last seen {ago(w.lastSeenAt)}{w.branch ? ` · ${w.branch}` : ''}</div>{bar(w.progress)}</span></div>)}
          {snapshot.running.map((b) => <div key={b.id} className="axp-session-sync__row" data-fx-ctx-target="axf-build" data-fx-ctx-payload={b.id}><span className="axp-session-sync__grow"><b>{b.id}</b> {b.title}<div className="axp-session-sync__doing">{b.progress.done}/{b.progress.total} steps{b.progress.next ? ` · next ${b.progress.next}` : ''}{b.pr ? ` · ${b.pr}` : ''}{b.assignedTo ? ` · ${b.assignedTo.text}` : ''}</div>{bar(b.progress)}</span></div>)}
          {!snapshot.working.length && !snapshot.running.length && <p className="fx-muted">Nothing running.</p>}
        </Container>
        <Container title="Done so far today" icon="check">
          {snapshot.done.map((d) => <div key={d.id} className="axp-session-sync__row" data-fx-ctx-target="axf-build" data-fx-ctx-payload={d.id}><span className="axp-session-sync__grow"><b>{d.id}</b> {d.title} <Chip tone="success">{d.status}</Chip>{d.pr ? <span className="fx-muted"> · {d.pr}</span> : ''}</span>{d.report && <Button size="sm" icon="file-text" onClick={() => rt.dispatch(`open:${d.report}`)}>Report</Button>}</div>)}
          {snapshot.decisions.length > 0 && <p className="fx-muted">Decisions: {snapshot.decisions.map((d) => d.text).join(' · ')}</p>}
          {!snapshot.done.length && <p className="fx-muted">Nothing merged or finished yet today.</p>}
        </Container>
        <Container title="Needs attention" icon="alert-triangle">
          {snapshot.attention.map((a, i) => <div key={i} className="axp-session-sync__row"><Chip tone={a.kind === 'red' || a.kind === 'failed' || a.kind === 'blocked' ? 'danger' : 'warning'}>{a.kind}</Chip><span className="axp-session-sync__grow">{a.ref ? <b>{a.ref} </b> : null}{a.text}</span></div>)}
          {!snapshot.attention.length && <p className="fx-muted">Nothing red.</p>}
        </Container>
      </div>
      <Container title={secondary ? 'What do you want to jump into? (what the orchestrator offers you)' : 'Queued jobs'} icon="package">
        {secondary && offers.length > 0 && <SelectionBar sel={sel} label="Offers" actions={[{ id: 'accept', label: 'Add to my list', icon: 'plus', tone: 'primary', run: async (picked) => { for (const id of picked) await actions.respond(id, 'accept'); await loadSnapshot(); } }]} />}
        {secondary && offers.map((o) => <label key={o.id} className="axp-session-sync__pick" {...sel.rowProps(o.id)}><Checkbox label="" checked={sel.isSelected(o.id)} onChange={(v) => sel.toggle(o.id, v)} /><span className="axp-session-sync__grow"><b>{o.build}</b>{o.steps ? ` steps ${o.steps.join(', ')}` : ' (whole build)'}<div className="axp-session-sync__doing">{o.reason}</div></span></label>)}
        {secondary && !offers.length && <p className="fx-muted">Nothing offered yet. <Button size="sm" icon="hand" onClick={() => void actions.requestWork(60, [], '').then(() => loadSnapshot())}>Request work</Button></p>}
        {!secondary && snapshot.queued.map((q) => <div key={q.id} className="axp-session-sync__row" data-fx-ctx-target="axf-build" data-fx-ctx-payload={q.id}><span className="axp-session-sync__grow"><b>{q.id}</b> {q.title}<div className="axp-session-sync__doing">{q.steps} steps{q.estimate ? ` · ${q.estimate}` : ''}{q.touches.length ? ` · touches ${q.touches.join(', ')}` : ''}</div></span><Button size="sm" icon="send" onClick={() => rt.openDialog(DIALOG_SEND, { build: q.id })}>Send to helper</Button></div>)}
        {!secondary && !snapshot.queued.length && <p className="fx-muted">Queue empty.</p>}
      </Container>
      <div className="fx-row"><Button icon="users" onClick={() => { close(); rt.navigate(VIEW); }}>Open the Sessions panel</Button><Button onClick={close}>Close</Button></div>
      {state?.scoped && <p className="fx-muted" data-help="managed-by-orchestrator">Managed by orchestrator: {snapshot.primary?.agent || snapshot.primary?.session} ({snapshot.primary?.account}).</p>}
    </div>
  );
}

/** Opens the join dialog once a day on a helper's console (reopen from the chip, the panel or the menu). */
export function JoinWatcher() {
  const { state } = useSync();
  const rt = useRuntime();
  useEffect(() => {
    if (!state || state.me.role !== 'secondary') return;
    const today = new Date().toISOString().slice(0, 10);
    if (rt.settings.get(KEYS.joinSeen) === today) return;
    rt.openDialog('session-sync.join', {});
  }, [state, rt]);
  return null;
}

/* ---------------- Send to helper ---------------- */

export function SendDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const { state } = useSync();
  const rt = useRuntime();
  const build = String(props.build ?? '');
  const steps = (Array.isArray(props.steps) ? props.steps : []).map(String);
  const toName = String(props.to ?? '');
  const helpers = (state?.sessions ?? []).filter((s) => s.role === 'secondary' && !s.endedAt && s.status !== 'offline');
  const remembered = String(rt.settings.get(KEYS.sendDefault) ?? 'ask');
  const [mode, setMode] = useState<'whole' | 'steps'>(steps.length && remembered === 'steps' ? 'steps' : 'whole');
  const [to, setTo] = useState(helpers[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [remember, setRemember] = useState(rt.settings.get(KEYS.askOnSend) === false);
  const [text, setText] = useState('');
  if (toName && !build) { // a plain message to a session
    return <div className="fx-stack"><TextField label={`Message to ${toName}`} value={text} onChange={setText} /><div className="fx-row"><Button tone="primary" icon="send" disabled={!text.trim()} onClick={() => { void actions.send(`@${toName} ${text}`); close(); }}>Send</Button><Button onClick={close}>Cancel</Button></div></div>;
  }
  if (!helpers.length) return <div className="fx-stack"><Note tone="warning">No helper is connected. A second session joins with /sync; then it shows here.</Note><Button onClick={close}>Close</Button></div>;
  const send = async () => {
    if (remember) { rt.settings.set(KEYS.sendDefault, mode); rt.settings.set(KEYS.askOnSend, false); }
    await actions.offer(build, mode === 'steps' && steps.length ? steps : null, to, reason || (mode === 'steps' ? `steps ${steps.join(', ')} sent from the console` : 'sent from the console'));
    close();
  };
  return (
    <div className="fx-stack" data-help="dialog:session-sync.send">
      <p><b>{build}</b>{steps.length ? <span className="fx-muted"> · steps {steps.join(', ')}</span> : null}</p>
      {steps.length > 0 && (
        <div className="fx-stack">
          <label className="axp-session-sync__pick"><input type="radio" name="ss-mode" checked={mode === 'whole'} onChange={() => setMode('whole')} /> <span><b>Send the whole build</b><div className="axp-session-sync__doing">The helper gets {build} with every open step.</div></span></label>
          <label className="axp-session-sync__pick"><input type="radio" name="ss-mode" checked={mode === 'steps'} onChange={() => setMode('steps')} /> <span><b>Send just these steps as a new build</b><div className="axp-session-sync__doing">A child build with {steps.join(', ')} linked to {build}; the parent shows them as “with helper”.</div></span></label>
        </div>
      )}
      <SelectField label="Helper" value={to} onChange={setTo} options={helpers.map((h) => ({ value: h.id, label: `${h.agent || h.id} (${h.account}, ${h.status})` }))} />
      <TextField label="Why (one line, posted in the channel)" value={reason} onChange={setReason} />
      {steps.length > 0 && <Switch label="Remember this choice, don't ask again" checked={remember} onChange={setRemember} hint="Changeable in Settings → Plugins → Session sync." />}
      <div className="fx-row"><Button tone="primary" icon="send" onClick={() => void send()}>Send to helper</Button><Button onClick={close}>Cancel</Button></div>
    </div>
  );
}

/* ---------------- Add widgets… ---------------- */

export function WidgetsDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const [host, setHost] = useState(String(props.host ?? 'banner'));
  const [, bump] = useState(0);
  const list = attachableWidgets(rt);
  const mine = savedWidgets(rt);
  const windows = openWindows(rt);
  const hosts = [{ value: 'banner', label: 'Banner' }, { value: 'toolbar', label: 'Toolbar' }, ...windows.map((w) => ({ value: `window:${w.id}`, label: `Window: ${w.title}` }))];
  return (
    <div className="fx-stack" data-help="dialog:session-sync.widgets">
      <SelectField label="Put it on" value={host} onChange={setHost} options={hosts} />
      <ul className="axp-session-sync__widgets">
        {list.map((w) => { const on = mine.some((m) => m.host === host && m.type === w.type && m.id === w.id); return (
          <li key={`${w.type}:${w.id}`} data-fx-row><span className="axp-session-sync__kind">{w.type}</span><span className="axp-session-sync__grow"><b>{w.name}</b>{w.mine ? <Chip tone="accent">helper</Chip> : null}<div className="axp-session-sync__doing">{w.description}</div></span>{on ? <Button size="sm" icon="x" onClick={() => { removeWidget(rt, host, w.type, w.id); bump((n) => n + 1); }}>Remove</Button> : <Button size="sm" icon="plus" onClick={() => { addWidget(rt, host, w.type, w.id); bump((n) => n + 1); }}>Add</Button>}</li>
        ); })}
        {!list.length && <li className="fx-muted">No widget assets registered.</li>}
      </ul>
      {mine.length > 0 && <p className="fx-muted">Placed: {mine.map((m) => `${m.type}:${m.id} on ${hostLabel(m.host, rt)}`).join(' · ')}</p>}
      <div className="fx-row"><Button onClick={close}>Done</Button></div>
    </div>
  );
}

/* ---------------- settings ---------------- */

export function SettingsPanel() {
  const { state } = useSync();
  const rt = useRuntime();
  const [, bump] = useState(0);
  useEffect(() => { void loadState(); }, []);
  const s = state?.settings ?? {};
  const num = (k: string, d: number) => Number(s[k] ?? d);
  const setNum = (k: string) => (v: string) => void actions.settings({ [k]: Number(v) || 0 });
  const brett = state?.me.session.startsWith('console-') && state?.me.role === 'primary';
  return (
    <div className="fx-stack fx-stack--lg" data-help="session-sync">
      <Logins />
      <Container title="Helper desk" icon="users">
        <p className="fx-muted">{state?.desk?.name ?? 'Brownie'} runs the helpers: offers, bounces, reassignments, take backs and the timers below (times the step's estimate).</p>
        <SelectField label="Brownie's sass" value={String(s.sass ?? 'spicy')} onChange={(v) => void actions.settings({ sass: v })} options={[{ value: 'mild', label: 'Mild' }, { value: 'spicy', label: 'Spicy' }, { value: 'savage', label: 'Savage' }]} />
        <div className="axp-session-sync__bar"><TextField label="Nudge at (× estimate)" value={String(num('nudgeAt', 2))} onChange={setNum('nudgeAt')} /><TextField label="Whip-crack at" value={String(num('whipAt', 3))} onChange={setNum('whipAt')} /><TextField label="Yank at" value={String(num('yankAt', 4))} onChange={setNum('yankAt')} /><TextField label="Missed heartbeat (s)" value={String(num('missedHeartbeatSec', 900))} onChange={setNum('missedHeartbeatSec')} /></div>
      </Container>
      <Container title="Account fallback" icon="refresh">
        <Switch label="Switch account when one runs out" checked={s.fallbackAuto === true} disabled={!brett} onChange={(v) => void actions.settings({ fallbackAuto: v })} hint={brett ? 'Only when a run stops on a limit, never mid-step, and never for a helper job. A step goes only to an account that can run its model.' : 'Only Brett changes this.'} />
        <TextField label="Order, first to last" value={Array.isArray(s.fallbackOrder) ? (s.fallbackOrder as string[]).join(', ') : ''} disabled={!brett} onChange={(v) => void actions.settings({ fallbackOrder: v.split(',').map((x) => x.trim()).filter(Boolean) })} hint="Saved account names, e.g. main, account-2" />
      </Container>
      <Container title="Claims" icon="lock">
        <Switch label="Enforce claims" checked={s.enforce !== false} disabled={!brett} onChange={(v) => void actions.settings({ enforce: v })} hint={brett ? 'Off: builds run unrestricted, with a warning in the banner, the hook and the systems check.' : "Owner-only: Brett's own click changes it."} />
        <div className="axp-session-sync__bar"><TextField label="Claim lease (s)" value={String(num('claimTtlSec', 1200))} onChange={setNum('claimTtlSec')} /><TextField label="Heartbeat (s)" value={String(num('heartbeatSec', 60))} onChange={setNum('heartbeatSec')} /><TextField label="Idle after (s)" value={String(num('idleSec', 600))} onChange={setNum('idleSec')} /><TextField label="Lunch after (s)" value={String(num('lunchSec', 1800))} onChange={setNum('lunchSec')} /><TextField label="Offline after (s)" value={String(num('offlineSec', 3600))} onChange={setNum('offlineSec')} /></div>
        <Switch label="New accounts need Brett's approval" checked={s.approveNewAccounts !== false} disabled={!brett} onChange={(v) => void actions.settings({ approveNewAccounts: v })} />
      </Container>
      <Container title="Helper widget and chip" icon="activity">
        <Switch label="Sessions chip in the banner" checked={rt.settings.get(KEYS.chip) !== false} onChange={(v) => { rt.settings.set(KEYS.chip, v); void loadState(); }} />
        <SelectField label="Helper status widgets on" value={String(rt.settings.get(KEYS.widgetHost) ?? 'banner')} onChange={(v) => { rt.settings.set(KEYS.widgetHost, v); void loadState(); }} options={[{ value: 'banner', label: 'Banner' }, { value: 'toolbar', label: 'Toolbar' }, { value: 'both', label: 'Banner and toolbar' }, { value: 'none', label: 'Only where I added them (Add widgets…)' }]} />
        <Switch label="Hide disconnected helpers" checked={rt.settings.get(KEYS.hideDisconnected) === true} onChange={(v) => { rt.settings.set(KEYS.hideDisconnected, v); void loadState(); }} />
        <Button icon="layout" onClick={() => rt.openDialog(DIALOG_WIDGETS, {})}>Add widgets…</Button>
      </Container>
      <Container title="Send to helper" icon="send">
        <SelectField label="When steps are selected" value={String(rt.settings.get(KEYS.sendDefault) ?? 'ask')} onChange={(v) => { rt.settings.set(KEYS.sendDefault, v); rt.settings.set(KEYS.askOnSend, v === 'ask'); bump((n) => n + 1); }} options={[{ value: 'ask', label: 'Ask: whole build or just these steps' }, { value: 'whole', label: 'Always send the whole build' }, { value: 'steps', label: 'Always send just the steps as a new build' }]} />
      </Container>
      <Container title="Claude Code hook and /sync" icon="terminal">
        <p className="fx-muted">Once per machine: <code>node apps/console-web/plugins/{FOLDER}/sync.mjs hooks install</code> delivers the Sessions channel at every step and refuses edits outside your claims. <code>/sync</code> is installed by the plugin's installer (repo and ~/.claude/commands).</p>
        <Button icon="check" onClick={() => void actions.consistency()}>Check every store agrees with the link</Button>
      </Container>
      <PluginLifecyclePanel folder={FOLDER} />
    </div>
  );
}

const fmtWhen = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

/** The multi-token manager: every helper account, labels only. A token is never shown; Revoke / Replace are Brett's. */
export function Logins() {
  const [rows, setRows] = useState<AccountV[] | null>(null);
  const [canSeal, setCanSeal] = useState(true);
  const [link, setLink] = useState('');
  const { state } = useSync();
  const rt = useRuntime();
  const brett = state?.me.session.startsWith('console-') && state?.me.role === 'primary';
  const load = () => { void call<{ accounts: AccountV[]; canSeal: boolean }>('accounts').then((r) => { setRows(r.accounts); setCanSeal(r.canSeal); }).catch(() => setRows([])); };
  useEffect(load, [state?.rev]);
  return (
    <Container title="Helper logins" icon="lock">
      <p className="fx-muted">Every helper runs on its own Claude subscription. A job on a helper never moves to the main account by itself: with no login it waits, and only Take back moves it.</p>
      {!canSeal && <Note tone="warning">The VPS has no sealing key yet, so no helper can connect. Run <code>session-sync creds-init</code> on the host.</Note>}
      {rows?.length === 0 && <p className="fx-muted">No helper account has connected yet.</p>}
      <ul className="axp-session-sync__logins">
        {rows?.map((x) => (
          <li key={x.id} data-account={x.id}>
            <span className="axp-session-sync__login-head"><b>{x.label}</b> <span>{x.credential.email || x.id}</span> <Chip tone={x.problem ? 'warning' : x.credential.state === 'ok' ? 'success' : undefined}>{x.problem ? x.problem.text : x.credential.state}</Chip>{x.expiringSoon && <Chip tone="warning">expires soon</Chip>}</span>
            <span className="fx-small fx-muted">{x.credential.last4 ? `····${x.credential.last4}` : 'no token'}{x.credential.plan ? ` · ${x.credential.plan}` : ''}{x.credential.expiresAt ? ` · expires ${fmtWhen(x.credential.expiresAt)}` : ''}{x.credential.resetsAt ? ` · resets ${fmtWhen(x.credential.resetsAt)}` : ''}{x.credential.usagePct >= 0 ? ` · usage ${x.credential.usagePct}%` : ''}</span>
            <span className="fx-small fx-muted">Models: {Object.entries(x.models.can).map(([m, ok]) => `${m} ${ok ? 'yes' : 'no'}`).join(', ') || 'not checked yet'}</span>
            {x.writeups?.map((w) => <span key={`${w.at}${w.line}`} className="fx-small fx-muted">Write-up: {w.line}</span>)}
            {brett && <span className="axp-session-sync__bar"><Button icon="refresh" onClick={() => void actions.replaceLink(x.id).then((r) => setLink(r.url)).catch((e: Error) => rt.toast(e.message, 'danger', 'Session sync'))}>Replace</Button><Button icon="x" confirm={`Revoke ${x.label}'s login? Its jobs wait until it connects again or you take them back.`} onClick={() => void actions.revokeLogin(x.id).then(load)}>Revoke</Button></span>}
          </li>
        ))}
      </ul>
      {link && <Note tone="info">One-time link, good for 10 minutes: <code>{link}</code></Note>}
    </Container>
  );
}

/** The one place a token is typed. It goes to the console once over HTTPS, is checked, sealed for the VPS, and the box is cleared. */
export function PairDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const code = String(props.code ?? '');
  const [who, setWho] = useState<{ account: string; agent: string; label: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ credential: { email: string; plan: string }; models: Record<string, boolean> } | null>(null);
  useEffect(() => { void post<{ ok: boolean; account: string; agent: string; label: string; expiresAt: string; message?: string }>('pair/peek', { code }).then((r) => { if (r.ok) setWho(r); else setErr(r.message ?? 'This pairing link has expired or was already used.'); }).catch((e: Error) => setErr(e.message)); }, [code]);
  const send = () => { setBusy(true); setErr(''); void post<{ credential: { email: string; plan: string }; models: Record<string, boolean> }>('pair/redeem', { code, token }).then((r) => { setDone(r); void loadState(); }).catch((e: Error) => setErr(e.message)).finally(() => { setToken(''); setBusy(false); }); };
  if (done) return <div className="fx-stack"><Note tone="success">Connected: {done.credential.email || who?.account}. Models: {Object.entries(done.models).map(([m, ok]) => `${m} ${ok ? 'yes' : 'no'}`).join(', ')}.</Note><Button tone="primary" onClick={close}>Done</Button></div>;
  return (
    <div className="fx-stack" data-help="session-sync">
      {err && <Note tone="danger">{err}</Note>}
      {who && <>
        <p>Connecting <b>{who.label}</b> ({who.account}). Run <code>claude setup-token</code> in that account and paste what it prints here. Never paste it in a chat.</p>
        <TextField label="Subscription token" type="password" value={token} onChange={setToken} autoComplete="off" />
        <div className="axp-session-sync__bar"><Button tone="primary" icon="lock" disabled={busy || !token} onClick={send}>{busy ? 'Checking…' : 'Connect'}</Button><Button onClick={close}>Cancel</Button></div>
      </>}
    </div>
  );
}

export function PhoneHint({ children }: { children: ReactNode }) { const phone = useIsPhone(); return phone ? <>{children}</> : null; }
export type { AssignmentV, SessionV, SnapshotV };
