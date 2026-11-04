/**
 * Live sessions views: the grid / list of every Claude session (live from the plugin's server-sent events), the Watch
 * live panel (text for every session, voice only on human ones), the Session browser with its real-time player, and the
 * settings panels (recording, storage targets, watch log). Framework controls and theme tokens only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AgentAvatar, Button, Checkbox, Chip, Icon, IconButton, ModelBadge, Note, Segmented, SelectField, Slider, Switch, TextField, useRuntime,
} from '@console/axf/react';
import { followSse, sseJson } from '@console/axf/core/sse';
import { pluginFetch } from '@console/plugins';
import {
  CLIENT_LABEL, EVENT_LABEL, FOLDER, KIND_ICON, KIND_LABEL, NO_FILTERS, SPEEDS, bytes, clock, dur, eventLine, filterRows, isSnapshot, nextSpeech,
  partAt, tokensAt, upTo, usd,
  type AudioPart, type Counts, type Event, type Filters, type Recording, type Row, type Snapshot, type Timeline,
} from './core';

// ---------------------------------------------------------------- one live feed per console

let last: Snapshot | null = null;
const subs = new Set<(s: Snapshot) => void>();
let stopLive: (() => void) | null = null;
export const onCounts = new Set<(c: Counts) => void>();

function publish(s: Snapshot) {
  last = s;
  for (const f of subs) f(s);
  for (const f of onCounts) f(s.counts);
}

export async function refresh(): Promise<Snapshot | null> {
  const j = await pluginFetch(FOLDER, 'sessions?ended=true').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (isSnapshot(j)) publish({ rows: j.rows, counts: j.counts, at: Date.now() });
  if (j && typeof j === 'object') meta = { ...meta, ...(j as Partial<Meta>) };
  return last;
}

interface Meta { viewer: { owner: boolean; name: string }; accounts: string[]; agents: string[]; crew: Row['agent'][] }
let meta: Meta = { viewer: { owner: false, name: '' }, accounts: [], agents: [], crew: [] };

export function useSessions(): { snap: Snapshot | null; meta: Meta } {
  const [snap, setSnap] = useState<Snapshot | null>(last);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = (s: Snapshot) => { setSnap(s); bump((n) => n + 1); };
    subs.add(on);
    if (!stopLive) {
      void refresh().then(() => bump((n) => n + 1));
      stopLive = followSse((signal) => pluginFetch(FOLDER, 'live', { signal }), (f) => {
        const j = sseJson(f);
        if (f.event === 'sessions' && isSnapshot(j)) publish(j);
      });
    }
    return () => { subs.delete(on); if (!subs.size && stopLive) { stopLive(); stopLive = null; } };
  }, []);
  return { snap, meta };
}

function useNow(every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await pluginFetch(FOLDER, path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = (j as { detail?: unknown }).detail;
    throw Object.assign(new Error(typeof d === 'string' ? d : (d as { error?: string })?.error ?? `HTTP ${r.status}`), { detail: d, status: r.status });
  }
  return j as T;
}

// ---------------------------------------------------------------- bits

function KindBadge({ r }: { r: Pick<Row, 'kind'> }) {
  return <span className={`axp-live__kind is-${r.kind}`}><Icon name={KIND_ICON[r.kind]} size={12} /> {KIND_LABEL[r.kind]}</span>;
}

function Who({ a, sub }: { a: Row['agent'] | Partial<Row['agent']>; sub?: ReactNode }) {
  const known = !!a.known;
  return (
    <span className="axp-live__who">
      <AgentAvatar info={known ? { id: a.id ?? '', name: a.name ?? '', role: a.title ?? '', avatar: a.avatar as never } : null} agent={a.id || a.name || ''} />
      <span className="axp-live__whoText">
        <strong className="axp-live__name">{a.name || 'Unassigned'}</strong>
        <span className="fx-small fx-muted axp-live__ellipsis">{sub ?? a.title ?? ''}</span>
      </span>
    </span>
  );
}

function Notices({ r }: { r: Row }) {
  return (
    <>
      {r.watchers.length > 0 && <Chip tone="warning"><Icon name="eye" size={11} /> Watched by {[...new Set(r.watchers.map((w) => w.by))].join(', ')}</Chip>}
      {r.kind === 'human' && r.recording && <Chip tone="danger"><Icon name="save" size={11} /> Recording</Chip>}
    </>
  );
}

const WATCH_DIALOG = 'live-sessions.watch';

// ---------------------------------------------------------------- grid / list

function Card({ r, now, owner, collapsed, onCollapse }: { r: Row; now: number; owner: boolean; collapsed: boolean; onCollapse: () => void }) {
  const rt = useRuntime();
  const end = r.status === 'ended' ? r.lastAt : now;
  return (
    <article className={`axp-live__card is-${r.status} is-${r.kind}${collapsed ? ' is-collapsed' : ''}`} aria-label={`${r.agent.name}: ${r.title || CLIENT_LABEL[r.client]}`}>
      <header className="axp-live__cardHead">
        <Who a={r.agent} sub={collapsed ? undefined : r.agent.title || (r.agent.known ? '' : 'No agent picked')} />
        <span className={`axp-live__pulse is-${r.status}`} role="img" aria-label={r.status === 'live' ? 'Working' : r.status === 'idle' ? 'Idle' : 'Ended'} />
        <IconButton icon={collapsed ? 'chevron-down' : 'chevron-up'} label={collapsed ? 'Expand' : 'Collapse'} onClick={onCollapse} />
      </header>
      {!collapsed && (
        <>
          <div className="axp-live__chips">
            <KindBadge r={r} />
            <Chip>{CLIENT_LABEL[r.client] ?? r.app}</Chip>
            {r.mode === 'voice' && <Chip tone="accent"><Icon name="mic" size={11} /> Voice</Chip>}
            {!r.primary && <Chip>{r.account}</Chip>}
            {r.model && <ModelBadge model={r.model} />}
            <Notices r={r} />
          </div>
          <p className="axp-live__title">{r.title || r.build || CLIENT_LABEL[r.client]}</p>
          {(r.doing || r.step) && <p className="fx-small fx-muted axp-live__ellipsis">{r.step ? `${r.step} · ` : ''}{r.doing}</p>}
          {r.progress != null && <progress className="axp-live__progress" max={1} value={r.progress} aria-label="Progress" />}
          <p className="fx-small fx-muted axp-live__meta">
            {[r.device, r.app].filter(Boolean).join(' · ')}{r.startedAt ? ` · ${dur(end - r.startedAt)}` : ''} · {usd(r.costUsd)}{r.thinking ? ` · ${r.thinking}` : ''}
          </p>
          <div className="axp-live__actions" role="toolbar" aria-label={`Session ${r.id} actions`}>
            <Button size="sm" tone="primary" icon="eye" disabled={!owner} title={owner ? 'Watch this session live' : 'Only Brett can watch'}
              onClick={() => rt.openDialog(WATCH_DIALOG, { id: r.id })}>Watch live</Button>
            {owner && r.kind === 'human' && <AgentPick r={r} />}
            {r.url && <a className="fx-btn fx-btn--neutral fx-btn--sm" href={r.url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Open</a>}
          </div>
        </>
      )}
    </article>
  );
}

function AgentPick({ r }: { r: Row }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const crew = meta.crew;
  const pick = async (agent: string, force = false) => {
    setBusy(true);
    try {
      await api(`sessions/${encodeURIComponent(r.id)}/agent`, { method: 'POST', body: JSON.stringify({ agent, force }) });
      await refresh();
    } catch (e) {
      const d = (e as { detail?: { clash?: { agent: string }; free?: Row['agent'][] } }).detail;
      if (d?.clash) {
        const other = d.free?.[0];
        rt.toast(`${(e as Error).message}${other ? ` ${other.name} is free.` : ''}`, 'warning', 'Live sessions');
      } else rt.toast((e as Error).message, 'danger', 'Live sessions');
    } finally { setBusy(false); }
  };
  return (
    <SelectField label="Who's running this session?" value={r.agent.id} disabled={busy} className="axp-live__pick"
      options={[{ value: '', label: 'Pick an agent…' }, ...crew.map((a) => ({ value: a.id, label: `${a.name}${a.title ? ` (${a.title})` : ''}` })), { value: 'assistant', label: 'Assistant' }]}
      onChange={(v) => { if (v) void pick(v); }} />
  );
}

export function SessionsView() {
  const { snap } = useSessions();
  const now = useNow();
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [shut, setShut] = useState<Set<string>>(new Set());
  const rows = useMemo(() => filterRows(snap?.rows ?? [], f), [snap, f]);
  const owner = meta.viewer.owner;
  useEffect(() => { // pop-out windows open on #live-sessions:watch:<id>
    const m = /^#live-sessions:watch:(.+)$/.exec(location.hash);
    if (m) setTimeout(() => window.dispatchEvent(new CustomEvent('axf-live:watch', { detail: decodeURIComponent(m[1]!) })), 50);
  }, []);
  return (
    <section className="axp-live" aria-label="Live sessions">
      <div className="axp-live__bar" role="toolbar" aria-label="Live sessions filters">
        <span className="axp-live__total"><b>{snap?.counts.label ?? 'Loading…'}</b>{snap?.counts.watched ? ` · ${snap.counts.watched} watched` : ''}</span>
        <Segmented label="Kind" size="sm" value={f.kind} onChange={(kind) => setF({ ...f, kind })}
          options={[{ value: 'all', label: 'All' }, { value: 'human', label: 'Human', icon: 'user' }, { value: 'headless', label: 'Headless', icon: 'terminal' }]} />
        <Segmented label="Layout" size="sm" value={layout} onChange={setLayout} options={[{ value: 'grid', label: 'Grid', icon: 'grid' }, { value: 'list', label: 'List', icon: 'list' }]} />
        <Switch label="Ended too" checked={f.ended} onChange={(ended) => setF({ ...f, ended })} />
      </div>
      <div className="axp-live__filters">
        <TextField label="Search" value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="agent, build, device…" />
        <SelectField label="Account" value={f.account} onChange={(account) => setF({ ...f, account })} options={[{ value: '', label: 'All accounts' }, ...meta.accounts.map((a) => ({ value: a, label: a === 'main' ? 'main (Brett)' : a }))]} />
        <SelectField label="Agent" value={f.agent} onChange={(agent) => setF({ ...f, agent })} options={[{ value: '', label: 'Every agent' }, ...meta.agents.map((a) => ({ value: a, label: a }))]} />
      </div>
      {!owner && <Note>Helpers see the list; only Brett can watch a session.</Note>}
      {!rows.length && <p className="fx-muted">{snap ? 'No sessions match.' : 'Reading sessions…'}</p>}
      <div className={layout === 'grid' ? 'axp-live__grid' : 'axp-live__list'}>
        {rows.map((r) => (
          <Card key={r.id} r={r} now={now} owner={owner} collapsed={layout === 'list' ? false : shut.has(r.id)}
            onCollapse={() => setShut((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- watch live

async function blobUrl(path: string): Promise<string> {
  const r = await pluginFetch(FOLDER, path);
  if (!r.ok) throw new Error(`audio ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

/** Plays voice segments in arrival order on one element (mic and Claude share the queue: they're one conversation). */
function useVoiceQueue(sid: string, on: boolean) {
  const el = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<string[]>([]);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const playNext = useCallback(async () => {
    const a = el.current;
    if (!a || !a.paused || !queue.current.length || !playing) return;
    const f = queue.current.shift()!;
    try { a.src = await blobUrl(`sessions/${encodeURIComponent(sid)}/audio/${f}`); await a.play(); } catch { void playNext(); }
  }, [sid, playing]);
  useEffect(() => { if (el.current) { el.current.muted = muted; el.current.volume = volume / 100; } }, [muted, volume]);
  useEffect(() => { if (playing) void playNext(); else el.current?.pause(); }, [playing, playNext]);
  const push = (file: string) => { if (on) { queue.current.push(file); void playNext(); } };
  const live = () => { queue.current = queue.current.slice(-1); el.current?.pause(); void playNext(); };
  const audio = on ? <audio ref={el} onEnded={() => void playNext()} aria-label="Session voice" /> : null;
  return { audio, push, playing, setPlaying, muted, setMuted, volume, setVolume, live, behind: queue.current.length };
}

export function WatchPanel({ id, close }: { id: string; close: () => void }) {
  const row0 = last?.rows.find((r) => r.id === id) ?? null;
  const [row, setRow] = useState<Row | null>(row0);
  const [events, setEvents] = useState<Event[]>([]);
  const [err, setErr] = useState('');
  const [wid, setWid] = useState('');
  const [follow, setFollow] = useState(true);
  const wantVoice = !!row0 && row0.kind === 'human' && row0.voice.ok;
  const voice = useVoiceQueue(id, wantVoice);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true, w = '', stop: (() => void) | null = null, beat: ReturnType<typeof setInterval> | null = null;
    api<{ watcher: string; beatEveryS: number; session: Row }>(`sessions/${encodeURIComponent(id)}/watch`, { method: 'POST', body: JSON.stringify({ voice: wantVoice }) })
      .then((j) => {
        if (!alive) { void pluginFetch(FOLDER, `sessions/${encodeURIComponent(id)}/watch/${j.watcher}`, { method: 'DELETE' }); return; }
        w = j.watcher; setWid(w); setRow(j.session);
        beat = setInterval(() => void pluginFetch(FOLDER, `sessions/${encodeURIComponent(id)}/watch/${w}/beat`, { method: 'POST' }), j.beatEveryS * 1000);
        stop = followSse((signal) => pluginFetch(FOLDER, `sessions/${encodeURIComponent(id)}/stream?watcher=${w}`, { signal }), (f) => {
          const d = sseJson(f) as never;
          if (f.event === 'event') setEvents((x) => [...x.slice(-1500), d]);
          else if (f.event === 'status') setRow(d);
          else if (f.event === 'audio') voice.push((d as { file: string }).file);
        });
      }, (e: Error) => setErr(e.message));
    return () => {
      alive = false; stop?.(); if (beat) clearInterval(beat);
      if (w) void pluginFetch(FOLDER, `sessions/${encodeURIComponent(id)}/watch/${w}`, { method: 'DELETE' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [events, follow]);

  const popOut = () => {
    window.open(`${location.pathname}#live-sessions:watch:${encodeURIComponent(id)}`, `axf-watch-${id}`, 'popup,width=520,height=760');
    close();
  };
  if (err) return <div className="axp-live__watch"><Note tone="warning">{err}</Note></div>;
  return (
    <div className="axp-live__watch">
      {row && (
        <div className="axp-live__watchHead">
          <Who a={row.agent} sub={`${CLIENT_LABEL[row.client] ?? row.app}${row.device ? ` · ${row.device}` : ''}`} />
          <KindBadge r={row} />
          <Notices r={row} />
        </div>
      )}
      <div className="axp-live__bar" role="toolbar" aria-label="Watch controls">
        {wantVoice && (
          <>
            <IconButton icon={voice.playing ? 'pause' : 'play'} label={voice.playing ? 'Pause' : 'Play'} onClick={() => voice.setPlaying(!voice.playing)} />
            <IconButton icon={voice.muted ? 'x-circle' : 'mic'} label={voice.muted ? 'Unmute' : 'Mute'} onClick={() => voice.setMuted(!voice.muted)} />
            <span className="axp-live__vol"><Slider label="Volume" value={voice.volume} onChange={voice.setVolume} unit="%" /></span>
          </>
        )}
        <Button size="sm" icon="chevron-right" onClick={() => { setFollow(true); voice.live(); }}>Jump to live</Button>
        <Button size="sm" icon="external" onClick={popOut}>Pop out</Button>
        <span className="fx-small fx-muted">{wid ? 'Live' : 'Connecting…'}</span>
      </div>
      {row && row.kind === 'human' && !row.voice.ok && (
        <Note>
          {row.voice.why} Text only for now. To hear both sides: install AmberX on that phone, sign in to axHub, then AmberX → Media → Audio out → turn on
          <b> Record my mic too</b>, and keep the session's voice going through that phone.
        </Note>
      )}
      {row?.kind === 'headless' && <p className="fx-small fx-muted">Headless: its build log and tool calls stream here. Nobody is on the other end, so the watch is only logged.</p>}
      <div className="axp-live__events" ref={box} onScroll={(e) => { const el = e.currentTarget; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}
        aria-live="polite" aria-label="Session output">
        {!events.length && <p className="fx-muted">Waiting for output…</p>}
        {events.map((e) => <EventRow key={`${e.seq}-${e.t}`} e={e} />)}
      </div>
      {voice.audio}
      {!wantVoice && row?.kind === 'human' && row.mode === 'voice' && <p className="fx-small fx-muted">The live transcript shows under the voice once AmberX sends it.</p>}
    </div>
  );
}

function EventRow({ e, onJump }: { e: Event; onJump?: (t: number) => void }) {
  const [open, setOpen] = useState(false);
  const long = (e.kind === 'tool' || e.kind === 'result');
  return (
    <div className={`axp-live__ev is-${e.kind}${e.error ? ' is-error' : ''}`}>
      <span className="axp-live__evHead">
        <span className="fx-small fx-mono fx-muted">{clock(e.t)}</span>
        <b className="fx-small">{EVENT_LABEL[e.kind] ?? e.kind}{e.tool && e.kind !== 'tool' ? ` · ${e.tool}` : ''}</b>
        {onJump && <IconButton icon="play" label="Play from here" onClick={() => onJump(e.t)} />}
        {long && <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Less' : 'More'} onClick={() => setOpen(!open)} />}
      </span>
      <span className={`axp-live__evText${long && !open ? ' is-clipped' : ''}`}>{long && open ? (e.kind === 'tool' ? `${e.tool} ${JSON.stringify(e.args, null, 1)}` : e.result) : eventLine(e)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- session browser + player

export function RecordingsView() {
  const rt = useRuntime();
  const [q, setQ] = useState('');
  const [fav, setFav] = useState(false);
  const [items, setItems] = useState<Recording[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState('');
  const load = useCallback(() => {
    api<{ items: Recording[] }>(`recordings?q=${encodeURIComponent(q)}&favourites=${fav}`).then((j) => { setItems(j.items); setErr(''); }, (e: Error) => setErr(e.message));
  }, [q, fav]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const on = (e: Event | CustomEvent) => setOpen(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('axf-live:play', on as never);
    return () => window.removeEventListener('axf-live:play', on as never);
  }, []);
  if (open) return <Player id={open} back={() => { setOpen(''); load(); }} />;
  return (
    <section className="axp-live" aria-label="Session recordings">
      <div className="axp-live__bar" role="toolbar" aria-label="Recordings filters">
        <span className="axp-live__total"><b>{items ? `${items.length} recorded session${items.length === 1 ? '' : 's'}` : 'Loading…'}</b></span>
        <Switch label="Favourites" checked={fav} onChange={setFav} />
        <Button size="sm" icon="refresh" onClick={load}>Refresh</Button>
      </div>
      <TextField label="Search every transcript" value={q} onChange={setQ} placeholder="what was said, a build, a tool…" />
      {err && <Note tone="warning">{err}</Note>}
      <div className="axp-live__grid">
        {(items ?? []).map((m) => (
          <article key={m.id} className="axp-live__card" aria-label={`Recording ${m.title || m.id}`}>
            <header className="axp-live__cardHead"><Who a={m.agent} sub={`${CLIENT_LABEL[m.client] ?? m.app ?? ''}${m.device ? ` · ${m.device}` : ''}`} />
              {m.favourite && <Icon name="star" size={14} />}{m.pinned && <Icon name="lock" size={14} />}</header>
            <p className="axp-live__title">{m.title || m.id}</p>
            <p className="fx-small fx-muted axp-live__meta">{new Date(m.startMs).toLocaleString()} · {dur(m.lengthMs)} · {m.events} events · {usd(m.costUsd)} · {bytes(m.bytes)}
              {m.savedBytes ? ` · ${bytes(m.savedBytes)} silence cut` : ''}</p>
            {m.topics.length > 0 && <div className="axp-live__chips">{m.topics.slice(0, 5).map((t) => <Chip key={t}>{t}</Chip>)}</div>}
            <div className="axp-live__actions" role="toolbar" aria-label={`Recording ${m.id} actions`}>
              <Button size="sm" tone="primary" icon="play" onClick={() => setOpen(m.id)}>Play</Button>
              <Button size="sm" icon="star" onClick={() => void api(`recordings/${encodeURIComponent(m.id)}/flags`, { method: 'POST', body: JSON.stringify({ favourite: !m.favourite }) }).then(load)}>{m.favourite ? 'Unfavourite' : 'Favourite'}</Button>
              <Button size="sm" icon="lock" onClick={() => void api(`recordings/${encodeURIComponent(m.id)}/flags`, { method: 'POST', body: JSON.stringify({ pinned: !m.pinned }) }).then(load)}>{m.pinned ? 'Unpin' : 'Keep forever'}</Button>
              <Button size="sm" tone="danger" icon="trash" confirm={`Delete the recording of ${m.title || m.id} for good?`}
                onClick={() => void api(`recordings/${encodeURIComponent(m.id)}`, { method: 'DELETE' }).then(() => { rt.toast('Recording deleted.', 'success', 'Live sessions'); load(); })}>Delete</Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

interface Played { recording: Recording; timeline: Timeline; events: Event[]; audio: AudioPart[]; compaction: { savedBytes: number; verified: boolean; codec: string } | null }

function Player({ id, back }: { id: string; back: () => void }) {
  const [d, setD] = useState<Played | null>(null);
  const [err, setErr] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<string>('1');
  const [skip, setSkip] = useState(false);
  const [ctx, setCtx] = useState<{ tokens: number; compacted: number; summary: string; events: Event[] } | null>(null);
  const mic = useRef<HTMLAudioElement>(null);
  const tts = useRef<HTMLAudioElement>(null);
  const loaded = useRef<Record<string, string>>({});
  const lens = useRef<Record<string, number>>({});
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { api<Played>(`recordings/${encodeURIComponent(id)}`).then(setD, (e: Error) => setErr(e.message)); }, [id]);
  const total = d?.timeline.durationMs ?? 0;

  // the clock: real time × speed; skip silence jumps gaps
  useEffect(() => {
    if (!playing || !d) return;
    let prev = performance.now(), raf = 0;
    const tick = (now: number) => {
      setT((x) => {
        let n = x + (now - prev) * Number(speed);
        if (skip) n = nextSpeech(d.timeline.speech, n);
        if (n >= total) { setPlaying(false); return total; }
        return n;
      });
      prev = now; raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, skip, d, total]);

  // audio follows the clock: the part under t on each track plays from its offset; gaps are silence (no bytes)
  useEffect(() => {
    if (!d) return;
    for (const [track, ref] of [['mic', mic], ['tts', tts]] as const) {
      const el = ref.current;
      if (!el) continue;
      const hit = partAt(d.audio, track, t, (p) => lens.current[p.file] ?? 0);
      if (!hit || !playing) { if (!el.paused) el.pause(); continue; }
      el.playbackRate = Number(speed);
      const want = hit.part.file;
      if (el.dataset.file !== want) {
        el.dataset.file = want;
        const go = (url: string) => { el.src = url; el.onloadedmetadata = () => { lens.current[want] = el.duration * 1000; el.currentTime = hit.offsetMs / 1000; void el.play().catch(() => undefined); }; };
        if (loaded.current[want]) go(loaded.current[want]!);
        else void blobUrl(`sessions/${encodeURIComponent(id)}/audio/${want}`).then((u) => { loaded.current[want] = u; go(u); }).catch(() => undefined);
      } else if (el.paused) { el.currentTime = hit.offsetMs / 1000; void el.play().catch(() => undefined); }
      else if (Math.abs(el.currentTime * 1000 - hit.offsetMs) > 600) el.currentTime = hit.offsetMs / 1000;
    }
  }, [t, playing, speed, d, id]);
  useEffect(() => () => { for (const u of Object.values(loaded.current)) URL.revokeObjectURL(u); }, []);

  const shown = useMemo(() => (d ? upTo(d.events, t) : []), [d, t]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length]);
  const showContext = () => void api<NonNullable<typeof ctx>>(`recordings/${encodeURIComponent(id)}/context?t=${Math.round(t)}`).then(setCtx);
  const exportIt = async () => {
    const r = await pluginFetch(FOLDER, `recordings/${encodeURIComponent(id)}/export`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob()); a.download = `session-${id.replace(/:/g, '_')}.zip`; a.click();
  };
  if (err) return <section className="axp-live"><Button icon="chevron-left" onClick={back}>Back</Button><Note tone="warning">{err}</Note></section>;
  if (!d) return <section className="axp-live"><p className="fx-muted">Loading the recording…</p></section>;
  const pct = total ? (t / total) * 100 : 0;
  return (
    <section className="axp-live" aria-label="Session player">
      <div className="axp-live__watchHead">
        <Button size="sm" icon="chevron-left" onClick={back}>Sessions</Button>
        <Who a={d.recording.agent} sub={`${new Date(d.recording.startMs).toLocaleString()} · ${dur(d.recording.lengthMs)}`} />
        {d.compaction && <Chip>{bytes(d.compaction.savedBytes)} of silence cut{d.compaction.verified ? '' : ' (not verified)'}</Chip>}
      </div>
      <div className="axp-live__bar" role="toolbar" aria-label="Player controls">
        <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => { if (t >= total) setT(0); setPlaying(!playing); }} />
        <span className="fx-mono fx-small">{clock(t)} / {clock(total)}</span>
        <Segmented label="Speed" size="sm" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
        <Switch label="Skip silence" checked={skip} onChange={setSkip} />
        <Button size="sm" icon="layers" onClick={showContext}>In context now</Button>
        <Button size="sm" icon="download" onClick={() => void exportIt()}>Export</Button>
      </div>
      <div className="axp-live__scrub">
        <Slider label="Position" value={Math.round(pct * 10) / 10} min={0} max={100} step={0.1} onChange={(v) => setT((v / 100) * total)} unit="%" />
        <div className="axp-live__markers" role="toolbar" aria-label="Timeline markers">
          {d.timeline.markers.slice(0, 80).map((m, i) => (
            <Button key={i} size="sm" tone="quiet" className={`axp-live__marker is-${m.kind}`} title={`${clock(m.t)} ${m.label}`} onClick={() => setT(m.t)}>
              {clock(m.t)} {EVENT_LABEL[m.kind] ?? m.kind}
            </Button>
          ))}
        </div>
      </div>
      <p className="fx-small fx-muted">Context now: ~{tokensAt(d.timeline, t).toLocaleString()} tokens · {shown.length} of {d.events.length} events · speech {dur(d.timeline.durationMs - d.timeline.silenceMs)}</p>
      {ctx && (
        <Note>
          At {clock(t)}: ~{ctx.tokens.toLocaleString()} tokens in context; {ctx.compacted} earlier events had been compacted{ctx.summary ? ` (summary: ${ctx.summary.slice(0, 200)}…)` : ''}.
          {' '}<Button size="sm" tone="ghost" onClick={() => setCtx(null)}>Close</Button>
        </Note>
      )}
      <div className="axp-live__events" ref={box} aria-label="Context window">
        {shown.map((e) => <EventRow key={e.seq} e={e} onJump={(x) => setT(x)} />)}
      </div>
      <audio ref={mic} aria-label="Human (mic)" />
      <audio ref={tts} aria-label="Claude (voice)" />
    </section>
  );
}

// ---------------------------------------------------------------- settings panels

interface SettingsReply { settings: Record<string, number | boolean>; usedBytes: number; savedBytes: number; ffmpeg: boolean; cap: { level: string; pct: number } }
interface Target { id: string; kind: string; label: string; path: string; container: string; repo: string; branch: string; folder: string; allowPublic: boolean; keepDays: number; capMb: number }
interface StorageReply {
  storage: { primary: string; mirrors: string[]; targets: Target[] }; status: Record<string, { state: string; usedBytes: number; error?: string; path?: string }>;
  containers: { id: string; name: string }[]; repos: { repo: string; private: boolean }[]; reposWhy: string; kinds: string[];
}

export function RecordingSettings() {
  const rt = useRuntime();
  const [s, setS] = useState<SettingsReply | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<SettingsReply>('settings').then(setS, (e: Error) => setErr(e.message)); }, []);
  const save = (patch: Record<string, unknown>) => api<{ settings: SettingsReply['settings'] }>('settings', { method: 'PUT', body: JSON.stringify(patch) })
    .then((j) => setS((x) => (x ? { ...x, settings: j.settings } : x)), (e: Error) => rt.toast(e.message, 'danger', 'Live sessions'));
  if (err) return <Note tone="warning">{err}</Note>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const num = (k: string, label: string, hint: string) => (
    <TextField label={label} hint={hint} value={String(s.settings[k] ?? '')} onChange={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) void save({ [k]: n }); }} />
  );
  return (
    <div className="fx-stack">
      <Switch label="Record every human session" checked={!!s.settings.record} onChange={(record) => void save({ record })}
        hint="Context-window log and both sides of the voice. On by default. The watched side always sees 'Recording' while it's on." />
      {num('keepDays', 'Keep recordings (days)', '0 = forever. Pinned recordings are always kept.')}
      {num('capMb', 'Size cap (MB)', 'Alert at 80 % and 100 %. 0 = no cap.')}
      {num('keepRawHours', 'Keep raw audio after compaction (hours)', 'The silence-cut copy is verified first.')}
      {num('padMs', 'Speech padding (ms)', 'Kept before and after each stretch of speech.')}
      <p className="fx-small fx-muted">Used: {bytes(s.usedBytes)} ({s.cap.pct}% of the cap) · saved by cutting silence: {bytes(s.savedBytes)}</p>
      {!s.ffmpeg && <Note tone="warning">ffmpeg isn't in the console image yet, so compaction keeps WAV only and other audio waits. The image adds it on the next redeploy.</Note>}
      <Note>"You're being watched" can't be switched off: it always shows on a human session while anyone watches.</Note>
    </div>
  );
}

export function StorageSettings() {
  const rt = useRuntime();
  const [s, setS] = useState<StorageReply | null>(null);
  const [draft, setDraft] = useState<StorageReply['storage'] | null>(null);
  const [err, setErr] = useState('');
  const [movePath, setMovePath] = useState('');
  const [movePlan, setMovePlan] = useState('');
  const load = () => api<StorageReply>('storage').then((j) => { setS(j); setDraft(j.storage); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  if (err) return <Note tone="warning">{err}</Note>;
  if (!s || !draft) return <p className="fx-muted">Loading…</p>;
  const set = (i: number, patch: Partial<Target>) => setDraft({ ...draft, targets: draft.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const add = (kind: string) => setDraft({ ...draft, targets: [...draft.targets, { ...draft.targets[0]!, id: `${kind}-${draft.targets.length + 1}`, kind, label: '', path: '', container: '', repo: '', allowPublic: false }], mirrors: [...draft.mirrors, `${kind}-${draft.targets.length + 1}`] });
  const save = () => api('storage', { method: 'PUT', body: JSON.stringify(draft) }).then(() => { rt.toast('Storage saved; mirrors sync in the background.', 'success', 'Live sessions'); void load(); }, (e: Error) => rt.toast(e.message, 'danger', 'Live sessions'));
  const KIND: Record<string, string> = { 'own-container': 'Its own container', 'vps-container': 'VPS container', repo: 'Repo (Git LFS)', local: 'Local (this device, synced)' };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">The primary is its own container: the working store live sessions are written to. Add others as mirrors; recordings only grow, so syncing never conflicts.</p>
      {draft.targets.map((t, i) => {
        const st = s.status[t.id];
        const repo = s.repos.find((r) => r.repo === t.repo);
        return (
          <div key={t.id} className="axp-live__target">
            <div className="axp-live__chips">
              <b>{KIND[t.kind] ?? t.kind}</b>
              <Chip tone={draft.primary === t.id ? 'accent' : undefined}>{draft.primary === t.id ? 'Primary' : draft.mirrors.includes(t.id) ? 'Mirror' : 'Off'}</Chip>
              {st && <Chip tone={st.state === 'synced' ? 'success' : st.state === 'error' ? 'danger' : 'warning'}>{st.state}</Chip>}
              {st && <span className="fx-small fx-muted">{bytes(st.usedBytes)}{st.path ? ` · ${st.path}` : ''}</span>}
            </div>
            {st?.error && <Note tone="danger">{st.error}</Note>}
            {t.kind === 'vps-container' && (
              <>
                <SelectField label="Container" value={t.container} onChange={(container) => set(i, { container })} options={[{ value: '', label: 'Pick a container…' }, ...s.containers.map((c) => ({ value: c.name, label: c.name }))]} />
                <TextField label="Path inside it" value={t.path} onChange={(path) => set(i, { path })} placeholder="/data/axf-recordings" />
              </>
            )}
            {t.kind === 'repo' && (
              <>
                <SelectField label="Repo" value={t.repo} onChange={(r) => set(i, { repo: r, allowPublic: false })}
                  options={[{ value: '', label: s.reposWhy || 'Pick a repo…' }, ...s.repos.map((r) => ({ value: r.repo, label: `${r.repo}${r.private ? ' (private)' : ' (PUBLIC)'}` }))]} />
                <TextField label="Branch" value={t.branch} onChange={(branch) => set(i, { branch })} />
                {repo && !repo.private && (
                  <Note tone="danger">
                    {repo.repo} is PUBLIC: voice recordings there would be world-readable by anyone. Use a private repo.
                    <Checkbox label="I understand, store them there anyway" checked={t.allowPublic} onChange={(allowPublic) => set(i, { allowPublic })} />
                  </Note>
                )}
              </>
            )}
            {t.kind === 'local' && <p className="fx-small fx-muted">A device (AmberX, a browser) keeps a copy and reports what it holds; status follows its report.</p>}
            {draft.primary !== t.id && (
              <div className="axp-live__actions" role="toolbar" aria-label={`Target ${t.id} actions`}>
                <Switch label="Mirror" checked={draft.mirrors.includes(t.id)} onChange={(on) => setDraft({ ...draft, mirrors: on ? [...draft.mirrors, t.id] : draft.mirrors.filter((m) => m !== t.id) })} />
                <Button size="sm" tone="ghost" icon="trash" onClick={() => setDraft({ ...draft, targets: draft.targets.filter((x) => x.id !== t.id), mirrors: draft.mirrors.filter((m) => m !== t.id) })}>Remove</Button>
              </div>
            )}
          </div>
        );
      })}
      <div className="axp-live__actions" role="toolbar" aria-label="Storage actions">
        <Button size="sm" icon="plus" onClick={() => add('vps-container')}>VPS container</Button>
        <Button size="sm" icon="plus" onClick={() => add('repo')}>Repo</Button>
        <Button size="sm" icon="plus" onClick={() => add('local')}>Local</Button>
        <Button size="sm" tone="primary" icon="check" onClick={() => void save()}>Save storage</Button>
      </div>
      <TextField label="Move the working store to" value={movePath} onChange={setMovePath} placeholder="/data/axf-recordings" hint="Preview first; then every file is copied, its hash checked there, and only then deleted here." />
      <div className="axp-live__actions" role="toolbar" aria-label="Move recordings">
        <Button size="sm" icon="search" disabled={!movePath} onClick={() => void api<{ files: number; bytes: number; copy: number }>('storage/move', { method: 'POST', body: JSON.stringify({ path: movePath, dryRun: true }) })
          .then((p) => setMovePlan(`${p.files} files, ${bytes(p.bytes)} (${p.copy} to copy)`), (e: Error) => setMovePlan(e.message))}>Preview</Button>
        <Button size="sm" tone="danger" icon="arrow-right" disabled={!movePlan} confirm={`Move every recording to ${movePath}?`}
          onClick={() => void api('storage/move', { method: 'POST', body: JSON.stringify({ path: movePath, dryRun: false }) }).then(() => { rt.toast('Recordings moved and verified.', 'success', 'Live sessions'); setMovePlan(''); void load(); }, (e: Error) => rt.toast(e.message, 'danger', 'Live sessions'))}>Move</Button>
        {movePlan && <span className="fx-small fx-muted">{movePlan}</span>}
      </div>
    </div>
  );
}

export function WatchLog() {
  const [items, setItems] = useState<{ at: number; op: string; by: string; session?: string; voice?: boolean; why?: string }[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ items: NonNullable<typeof items> }>('audit?limit=100').then((j) => setItems(j.items), (e: Error) => setErr(e.message)); }, []);
  if (err) return <Note tone="warning">{err}</Note>;
  return (
    <ul className="axp-live__log">
      {(items ?? []).map((a, i) => (
        <li key={i} className="fx-small"><span className="fx-mono fx-muted">{new Date(a.at).toLocaleString()}</span> <b>{a.op}</b> {a.by}{a.session ? ` · ${a.session}` : ''}{a.voice ? ' · voice' : ''}{a.why ? ` · ${a.why}` : ''}</li>
      ))}
      {items && !items.length && <li className="fx-muted">Nobody has watched anything yet.</li>}
    </ul>
  );
}
