import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, Container, Icon, IconButton, Note, Segmented, SelectField, Switch, TextField } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridSort } from '@console/axf/libs/datagrid';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as core from './core';
import type { AudioExport, Hit, Job, Message, Row, SyncReport, Version } from './core';

export const FOLDER = 'chat-viewer';
const api = pluginApi(FOLDER, 'The Chat viewer');
const enc = encodeURIComponent;
const W = (n: number) => `calc(var(--fx-space) * ${n})`;

/** A phone-width screen: fewer columns by default (the title shows the source icon anyway). */
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
function readLocal<T>(k: string, d: T): T { try { const v = localStorage.getItem(`axf.chat-viewer.${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function writeLocal(k: string, v: unknown) { try { localStorage.setItem(`axf.chat-viewer.${k}`, JSON.stringify(v)); } catch { /* private mode */ } }

type Status = { counts: { sessions: number; messages: number; unseen: number; bySource: Record<string, number> }; last: SyncReport | null; syncing: boolean; step: string; intervalMin: number;
  sources: { claudeDirs: { path: string; label: string; exists: boolean }[]; logGlobs: string[]; hubDrop: { path: string; exists: boolean }; hub: string }; audioDir: string };

/* ------------------------------------------------------------------ the page */

export function ChatViewer() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ id: string; seq?: number } | null>(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<string>(() => readLocal('only', 'all'));
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [sort, setSort] = useState<GridSort>(() => readLocal('sort', { col: 'updated', dir: -1 }));
  const [hidden, setHidden] = useState<string[]>(() => readLocal('hidden', narrow() ? ['started', 'project', 'source'] : ['started', 'project']));
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState('');

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([api.call<{ sessions: Row[] }>('sessions'), api.call<Status>('status')]);
    setRows(l.sessions); setStatus(s);
  }, []);
  const check = useCallback(async () => {
    setChecking(true); setError('');
    try { setReport(await api.post<SyncReport>('sync', {})); await load(); } catch (e) { setError((e as Error).message); } finally { setChecking(false); }
  }, [load]);
  // On load: show what's stored at once, then check every source for updates.
  useEffect(() => { load().catch((e) => setError((e as Error).message)).finally(() => { void check(); }); }, [load, check]);
  useEffect(() => { writeLocal('only', only); }, [only]);
  useEffect(() => { writeLocal('sort', sort); }, [sort]);
  useEffect(() => { writeLocal('hidden', hidden); }, [hidden]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => { api.call<{ hits: Hit[] }>(`search?q=${enc(q.trim())}${only !== 'all' ? `&source=${only}` : ''}`).then((r) => setHits(r.hits), () => setHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q, only]);

  const importFile = async (f: File) => {
    setImporting(`Reading ${f.name} (${core.fmtBytes(f.size)})…`); setError('');
    try {
      const r = await api.fetch(`import?name=${enc(f.name)}`, { method: 'POST', body: f, headers: { 'content-type': f.type || 'application/octet-stream' } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `import failed (${r.status})`);
      setReport({ ...j, kind: 'import' }); await load();
    } catch (e) { setError((e as Error).message); } finally { setImporting(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (open) return <SessionView id={open.id} seq={open.seq} onBack={() => { setOpen(null); void load(); }} />;

  const shown = (rows ?? []).filter((r) => (only === 'all' || r.source === only || (only === 'updated' && !r.seen)) && core.matches(r, hits ? '' : q));
  const cols: GridColumn<Row>[] = [
    { id: 'title', label: 'Session', width: 'minmax(0, 4fr)', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => <TitleCell r={r} /> },
    { id: 'source', label: 'Source', width: W(12), sortable: true, sortValue: (r) => r.source, render: (r) => <SourceChip s={r.source} /> },
    { id: 'updated', label: 'Updated', width: W(12), sortable: true, sortValue: (r) => r.updatedAt, render: (r) => <span className="axp-chat-viewer-when" title={core.fmtWhen(r.updatedAt)}>{core.fmtShort(r.updatedAt)}</span> },
    { id: 'started', label: 'Started', width: W(15), sortable: true, sortValue: (r) => r.startedAt, render: (r) => <span className="axp-chat-viewer-when" title={core.fmtWhen(r.startedAt)}>{core.fmtShort(r.startedAt)}</span> },
    { id: 'messages', label: 'Msgs', width: W(6), align: 'end', sortable: true, sortValue: (r) => r.messageCount, render: (r) => r.messageCount },
    { id: 'project', label: 'Project', width: W(12), sortable: true, sortValue: (r) => r.project, render: (r) => r.project || '—' },
  ];
  const by = status?.counts.bySource ?? {};
  const unseen = (rows ?? []).filter((r) => !r.seen).length;
  const filters = [{ value: 'all', label: `All ${rows?.length ?? ''}` }, ...(unseen ? [{ value: 'updated', label: `New ${unseen}` }] : []),
    ...core.SOURCES.filter((s) => by[s.id]).map((s) => ({ value: s.id, label: `${s.short} ${by[s.id]}` }))];

  return (
    <div className="fx-stack axp-chat-viewer">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Every session</p><h1>Chats</h1><p className="fx-muted axp-chat-viewer-lede">claude.ai, Claude Code and build sessions in one place: search them, read them, listen to them.</p></div>
        <div className="fx-row axp-chat-viewer-acts">
          <Button icon="refresh" busy={checking} onClick={() => void check()}>Check for updates</Button>
          <Button icon="upload" busy={!!importing} onClick={() => fileRef.current?.click()}>Import export</Button>
          <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
        </div>
      </header>
      <UpdateNote report={report} checking={checking} importing={importing} status={status} />
      {error && <Note tone="danger" icon="alert">{error}</Note>}
      <div className="fx-row axp-chat-viewer-bar">
        <input className="fx-input axp-chat-viewer-search" type="search" aria-label="Search every session" placeholder="Search every message" value={q} onChange={(e) => setQ(e.target.value)} />
        {unseen > 0 && <Button size="sm" icon="check" onClick={() => void api.post('seen-all', {}).then(load)}>Mark all read</Button>}
      </div>
      <div className="axp-chat-viewer-filters"><Segmented label="Source" size="sm" value={only} options={filters} onChange={setOnly} /></div>
      {hits ? <Hits hits={hits} q={q} onOpen={(h) => setOpen({ id: h.sessionId, seq: h.seq >= 0 ? h.seq : undefined })} />
        : rows === null ? <LoadingSkeleton rows={6} label="Loading sessions" />
        : !rows.length ? <EmptyState icon="list" action={{ label: 'Import your claude.ai export', icon: 'upload', onClick: () => fileRef.current?.click() }}>No sessions yet. Claude Code and build sessions appear after the first check; claude.ai chats come from your data export (claude.ai → Settings → Privacy → Export data) or when a chat syncs them to the hub.</EmptyState>
        : <div className="axp-chat-viewer-grid">
            <DataGrid<Row> id="chat-viewer-sessions" label="Sessions" compact
              groups={[{ id: 'all', title: `Sessions (${shown.length})`, icon: 'list', rows: sortRows(shown, sort, cols), groups: [], fixed: true }]}
              columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title} rowTone={(r) => (core.badge(r) ? 'accent' : 'muted')}
              sort={sort} onSort={(c) => setSort(sortFor(sort, c))} hidden={hidden}
              onToggleColumn={(c, show) => setHidden(show === true || (show === undefined && hidden.includes(c)) ? hidden.filter((x) => x !== c) : [...hidden, c])} onShowAll={() => setHidden([])}
              onRowClick={(r) => setOpen({ id: r.id })} empty="No session matches." />
          </div>}
    </div>
  );
}

function sortFor(sort: GridSort, col: string | null): GridSort {
  if (!col) return null;
  return sort?.col === col ? (sort.dir === 1 ? { col, dir: -1 } : null) : { col, dir: col === 'updated' || col === 'started' || col === 'messages' ? -1 : 1 };
}
function sortRows(rows: Row[], sort: GridSort, cols: GridColumn<Row>[]): Row[] {
  const c = sort && cols.find((x) => x.id === sort.col);
  if (!c || !c.sortValue || !sort) return rows;
  const v = c.sortValue;
  return [...rows].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
}

function SourceChip({ s }: { s: string }) {
  const src = core.sourceOf(s);
  return <span className="axp-chat-viewer-src" title={src.label}><Icon name={src.icon} size={12} />{src.short}</span>;
}
function TitleCell({ r }: { r: Row }) {
  const b = core.badge(r);
  return (
    <span className="axp-chat-viewer-title">
      <Icon name={core.sourceOf(r.source).icon} size={12} />
      <span className="axp-chat-viewer-title__text">{r.title}</span>
      {b && <Chip tone={b === 'new' ? 'success' : 'accent'}>{b === 'new' ? 'New' : r.change === 'changed' ? 'Changed' : 'Updated'}</Chip>}
    </span>
  );
}

function UpdateNote({ report, checking, importing, status }: { report: SyncReport | null; checking: boolean; importing: string; status: Status | null }) {
  if (importing) return <Note tone="info" icon="upload">{importing}</Note>;
  if (checking && !report) return <Note tone="info" icon="refresh">Checking every source for new, continued and changed sessions…</Note>;
  const r = report ?? status?.last ?? null;
  if (!r) return null;
  return (
    <Note tone={r.errors?.length ? 'warning' : r.new || r.continued || r.changed ? 'success' : 'info'} icon={r.kind === 'import' ? 'upload' : 'check-circle'}>
      <b>{r.kind === 'import' ? 'Export imported' : 'Checked'} {core.fmtWhen(r.at)}:</b> {core.summary(r)}{r.took !== undefined ? ` (${r.took} s)` : ''}
      {!!r.errors?.length && <details className="axp-chat-viewer-errs"><summary>{r.errors.length} problem{r.errors.length > 1 ? 's' : ''}</summary><ul>{r.errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul></details>}
    </Note>
  );
}

function Snippet({ s }: { s: string }) {
  return <>{core.snippetParts(s).map((p, i) => (p.hit ? <mark key={i} className="axp-chat-viewer-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

function Hits({ hits, q, onOpen }: { hits: Hit[]; q: string; onOpen: (h: Hit) => void }) {
  if (!hits.length) return <EmptyState icon="search" compact>Nothing in any session says “{q}”.</EmptyState>;
  return (
    <div className="fx-stack axp-chat-viewer-hits" role="list" aria-label="Search hits">
      <p className="fx-muted axp-chat-viewer-lede">{hits.length} hit{hits.length > 1 ? 's' : ''}{hits.length >= 100 ? ' (first 100)' : ''} — tap one to jump there</p>
      {hits.map((h) => (
        <button key={`${h.sessionId}:${h.seq}`} type="button" role="listitem" data-fx-row className="axp-chat-viewer-hit" onClick={() => onOpen(h)}>
          <span className="axp-chat-viewer-hit__head"><SourceChip s={h.source} /><b className="axp-chat-viewer-title__text">{h.title}</b><span className="axp-chat-viewer-when">{core.fmtWhen(h.updatedAt)}</span></span>
          <span className="axp-chat-viewer-hit__snip">{h.seq < 0 ? 'in the title' : <Snippet s={h.snippet} />}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ one session */

type Detail = { session: { id: string; title: string; source: string; startedAt: string; updatedAt: string; project: string; messages: Message[]; model?: string; branch?: string; host?: string };
  row: Row; versions: Version[]; audio: AudioExport[] };
const PAGE = 400;

function SessionView({ id, seq, onBack }: { id: string; seq?: number; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [old, setOld] = useState<Message[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [showTools, setShowTools] = useState<boolean>(() => readLocal('tools', true));
  const [audioOpen, setAudioOpen] = useState(false);
  const [flash, setFlash] = useState<number | null>(seq ?? null);
  const [note, setNote] = useState('');

  const load = useCallback(() => api.call<Detail>(`sessions/${enc(id)}`).then(setD, (e) => setError((e as Error).message)), [id]);
  useEffect(() => { void load(); void api.post(`sessions/${enc(id)}/seen`, {}).catch(() => {}); }, [id, load]);
  useEffect(() => { writeLocal('tools', showTools); }, [showTools]);
  useEffect(() => {
    if (version === null || !d || version === d.row.version) { setOld(null); return; }
    api.call<{ messages: Message[] }>(`sessions/${enc(id)}/versions/${version}`).then((r) => setOld(r.messages), (e) => setError((e as Error).message));
  }, [version, d, id]);
  // jump to a search hit: make sure it is rendered, then scroll it into view and flash it
  useEffect(() => {
    if (seq === undefined || !d) return;
    if (seq >= limit) setLimit(seq + 50);
    const t = setTimeout(() => { document.getElementById(`axp-cv-m-${seq}`)?.scrollIntoView({ block: 'center' }); setTimeout(() => setFlash(null), 2500); }, 60);
    return () => clearTimeout(t);
  }, [seq, d, limit]);

  if (error) return <div className="fx-stack"><Button icon="arrow-left" onClick={onBack}>Back</Button><Note tone="danger" icon="alert">{error}</Note></div>;
  if (!d) return <LoadingSkeleton rows={8} label="Loading the session" />;
  const s = d.session;
  const msgs = old ?? s.messages;
  const all = core.lines(msgs);
  const visible = all.filter((l) => l.seq < limit);
  const copy = async () => { await navigator.clipboard.writeText(core.transcript(s.title, msgs)); setNote('Copied the transcript'); setTimeout(() => setNote(''), 2000); };
  const share = async () => {
    const text = core.transcript(s.title, msgs);
    if (navigator.share) { try { await navigator.share({ title: s.title, text }); return; } catch { /* cancelled */ } }
    await copy();
  };
  const src = core.sourceOf(s.source);

  return (
    <div className="fx-stack axp-chat-viewer axp-chat-viewer-session">
      <header className="fx-pagehead">
        <div className="axp-chat-viewer-head">
          <p className="fx-eyebrow"><IconButton icon="arrow-left" label="Back to every session" onClick={onBack} /> <SourceChip s={s.source} /> {src.label}</p>
          <h1 className="axp-chat-viewer-h">{s.title}</h1>
          <p className="fx-muted axp-chat-viewer-lede">
            {core.fmtWhen(s.startedAt)} → {core.fmtWhen(s.updatedAt)} · {s.messages.length} messages{s.project ? ` · ${s.project}` : ''}{s.branch ? ` · ${s.branch}` : ''}{s.model ? ` · ${s.model}` : ''}
          </p>
        </div>
        <div className="fx-row axp-chat-viewer-acts">
          <IconButton icon="copy" label="Copy the transcript" onClick={() => void copy()} />
          <IconButton icon="external" label="Share" onClick={() => void share()} />
          <IconButton icon="download" label="Export as Markdown" onClick={() => void api.download(`sessions/${enc(id)}/export?format=md`, `${s.title.slice(0, 60)}.md`)} />
          <IconButton icon="file" label="Export as text" onClick={() => void api.download(`sessions/${enc(id)}/export?format=txt`, `${s.title.slice(0, 60)}.txt`)} />
          <Button icon="play" tone={audioOpen ? 'primary' : 'neutral'} onClick={() => setAudioOpen((v) => !v)}>Audio</Button>
        </div>
      </header>
      {note && <Note tone="success" icon="check">{note}</Note>}
      <div className="fx-row axp-chat-viewer-bar">
        <Switch label="Tool calls" checked={showTools} onChange={setShowTools} />
        {d.versions.length > 1 && (
          <SelectField label="Version" value={String(version ?? d.row.version)} onChange={(v) => setVersion(Number(v))}
            options={[...d.versions].reverse().map((v) => ({ value: String(v.version), label: `v${v.version} · ${v.change} · ${v.messageCount} msgs · ${core.fmtWhen(v.updatedAt)}${v.version === d.row.version ? ' (current)' : ''}` }))} />
        )}
      </div>
      {old && <Note tone="warning" icon="clock">An older version ({old.length} messages). Pick the current one to go back.</Note>}
      {audioOpen && <AudioPanel d={d} reload={load} />}
      <div className="axp-chat-viewer-chat" role="log" aria-label={`Transcript of ${s.title}`}>
        {visible.map((l) => (l.kind === 'msg'
          ? <Bubble key={l.seq} seq={l.seq} m={l.m} flash={flash === l.seq} />
          : showTools ? <Tools key={l.seq} items={l.items} flash={flash} /> : null))}
        {!visible.length && <EmptyState icon="list" compact>This session has no messages yet.</EmptyState>}
      </div>
      {all.length > visible.length && <Button icon="chevron-down" onClick={() => setLimit(limit + PAGE)}>Show more ({msgs.length - limit} left)</Button>}
    </div>
  );
}

function Bubble({ seq, m, flash }: { seq: number; m: Message; flash: boolean }) {
  return (
    <div id={`axp-cv-m-${seq}`} className={`axp-chat-viewer-msg is-${m.role === 'user' ? 'brett' : 'amber'}${flash ? ' is-active' : ''}`}>
      <div className="axp-chat-viewer-bubble">
        <span className="axp-chat-viewer-who">{core.WHO[m.role]}{m.kind === 'speech' && <Icon name="mic" size={11} />}{m.at && <time dateTime={m.at}>{core.fmtWhen(m.at)}</time>}</span>
        <div className="axp-chat-viewer-text">{m.text}</div>
      </div>
    </div>
  );
}

function Tools({ items, flash }: { items: { seq: number; m: Message }[]; flash: number | null }) {
  const has = flash !== null && items.some((i) => i.seq === flash);
  const names = [...new Set(items.map((i) => i.m.toolName || 'tool'))].slice(0, 4).join(', ');
  return (
    <details className="axp-chat-viewer-tools" open={has}>
      <summary><Icon name="terminal" size={12} />{items.length} tool {items.length > 1 ? 'steps' : 'step'} · {names}</summary>
      {items.map((i) => (
        <div key={i.seq} id={`axp-cv-m-${i.seq}`} className={`axp-chat-viewer-tool${flash === i.seq ? ' is-active' : ''}`}>
          <b>{i.m.toolName || 'Tool'}</b>{i.m.at && <time dateTime={i.m.at}> {core.fmtWhen(i.m.at)}</time>}
          <pre className="axp-chat-viewer-pre">{i.m.text}</pre>
        </div>
      ))}
    </details>
  );
}

/* ------------------------------------------------------------------ audio */

type Tts = { piper: { ready: boolean; voices: string[] }; catalog: { id: string; label: string }[]; openaiVoices: string[]; keys: Record<string, boolean>; jobs: Job[] };
type AudioSettings = { engine: string; pauseMs: number; format: string; voices: Record<string, { user: string; assistant: string }> };

function AudioPanel({ d, reload }: { d: Detail; reload: () => void }) {
  const [tts, setTts] = useState<Tts | null>(null);
  const [cfg, setCfg] = useState<AudioSettings | null>(null);
  const [engine, setEngine] = useState('piper');
  const [voices, setVoices] = useState<{ user: string; assistant: string }>({ user: '', assistant: '' });
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(d.session.messages.length));
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api.call<Tts>('tts'), api.call<{ settings: { audio: AudioSettings } }>('settings')]).then(([t, s]) => {
      setTts(t); setCfg(s.settings.audio); setEngine(s.settings.audio.engine); setVoices(s.settings.audio.voices[s.settings.audio.engine] ?? { user: '', assistant: '' });
    }, (e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!job || job.state === 'done' || job.state === 'failed') return;
    const t = setTimeout(() => { api.call<Job>(`jobs/${job.id}`).then((j) => { setJob(j); if (j.state === 'done') reload(); if (j.state === 'done' && j.kind === 'setup') void api.call<Tts>('tts').then(setTts); }, () => {}); }, 1200);
    return () => clearTimeout(t);
  }, [job, reload]);
  const n = d.session.messages.length;
  const f = Math.max(1, Math.min(n, Number(from) || 1)), t = Math.max(f, Math.min(n, Number(to) || n));
  const turns = core.spoken(d.session.messages, f - 1, t);
  const make = async () => {
    setError('');
    try { setJob(await api.post<Job>('audio', { sessionId: d.session.id, engine, voices, from: f - 1, to: t })); } catch (e) { setError((e as Error).message); }
  };
  const voiceOpts = engine === 'piper' ? (tts?.catalog ?? []).map((v) => ({ value: v.id, label: `${v.label}${tts?.piper.voices.includes(v.id) ? '' : ' (not downloaded)'}` }))
    : engine === 'openai' ? (tts?.openaiVoices ?? []).map((v) => ({ value: v, label: v })) : null;
  const needsSetup = engine === 'piper' && tts && (!tts.piper.ready || ![voices.user, voices.assistant].every((v) => tts.piper.voices.includes(v)));
  const needsKey = (engine === 'openai' || engine === 'elevenlabs') && tts && !tts.keys[engine];
  return (
    <Container title="Audio export — two voices" icon="play">
      <div className="fx-stack">
        {!tts || !cfg ? <LoadingSkeleton rows={2} label="Loading voices" /> : <>
          <div className="axp-chat-viewer-form">
            <SelectField label="Voices from" value={engine} onChange={(v) => { setEngine(v); setVoices(cfg.voices[v] ?? { user: '', assistant: '' }); }}
              options={[{ value: 'piper', label: 'Piper (free, on the VPS)' }, { value: 'openai', label: `OpenAI${tts.keys.openai ? '' : ' (no key)'}` }, { value: 'elevenlabs', label: `ElevenLabs${tts.keys.elevenlabs ? '' : ' (no key)'}` }]} />
            {voiceOpts ? <>
              <SelectField label="Brett's voice" value={voices.user} options={voiceOpts} onChange={(v) => setVoices({ ...voices, user: v })} />
              <SelectField label="Amber's voice" value={voices.assistant} options={voiceOpts} onChange={(v) => setVoices({ ...voices, assistant: v })} />
            </> : <>
              <TextField label="Brett's voice id" value={voices.user} onChange={(v) => setVoices({ ...voices, user: v })} />
              <TextField label="Amber's voice id" value={voices.assistant} onChange={(v) => setVoices({ ...voices, assistant: v })} />
            </>}
            <TextField label="From message" type="number" value={from} onChange={setFrom} />
            <TextField label="To message" type="number" value={to} onChange={setTo} />
          </div>
          <p className="fx-muted axp-chat-viewer-lede">{turns} turns will be read (tool calls skipped), with a short pause between turns and a chapter every hour.</p>
          {needsSetup && <Note tone="warning" icon="download">Piper or one of these voices isn't installed yet. <Button size="sm" icon="download" onClick={() => void api.post<Job>('tts/setup', { voices: [voices.user, voices.assistant] }).then(setJob, (e) => setError((e as Error).message))}>Set up free voices</Button></Note>}
          {needsKey && <Note tone="warning" icon="key">No {engine} key saved: add it in Settings → Plugins → Chat viewer.</Note>}
          <div className="fx-row"><Button tone="primary" icon="play" disabled={!turns || !!needsSetup || !!needsKey || (job?.state === 'running' && job.kind === 'render')} onClick={() => void make()}>Make audio</Button></div>
        </>}
        {job && <JobLine job={job} />}
        {error && <Note tone="danger" icon="alert">{error}</Note>}
        {d.audio.map((a) => <Player key={a.file} a={a} onRemove={() => void api.del(`audio/file/${a.file}`).then(reload)} />)}
      </div>
    </Container>
  );
}

function JobLine({ job }: { job: Job }) {
  const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
  if (job.state === 'failed') return <Note tone="danger" icon="alert">{job.kind === 'setup' ? 'Setup' : 'Audio'} failed: {job.error}</Note>;
  if (job.state === 'done') return <Note tone="success" icon="check">{job.kind === 'setup' ? 'Free voices are ready.' : 'Audio ready below.'}</Note>;
  return (
    <div className="axp-chat-viewer-job" role="status">
      <span>{job.kind === 'setup' ? job.message || 'Setting up Piper' : `Reading ${job.progress} of ${job.total} turns`} {pct ? `${pct}%` : ''}</span>
      <progress className="axp-chat-viewer-progress" max={100} value={pct} />
    </div>
  );
}

function Player({ a, onRemove }: { a: AudioExport; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  const ref = useRef<HTMLAudioElement>(null);
  const load = async () => { const r = await api.fetch(`audio/file/${a.file}`); setUrl(URL.createObjectURL(await r.blob())); };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const seek = (s: number) => { if (ref.current) { ref.current.currentTime = s; void ref.current.play(); } };
  return (
    <div className="axp-chat-viewer-player">
      <div className="fx-row axp-chat-viewer-player__head">
        <b>{core.fmtDuration(a.duration)}</b>
        <span className="fx-muted">{a.engine} · Brett: {a.voices.user} · Amber: {a.voices.assistant} · {a.turns} turns · {core.fmtBytes(a.bytes)} · {core.fmtWhen(a.createdAt)}</span>
        <span className="axp-chat-viewer-grow" />
        <IconButton icon="download" label="Download" onClick={() => void api.download(`audio/file/${a.file}`, a.file)} />
        <IconButton icon="trash" label="Delete this audio" onClick={onRemove} />
      </div>
      {url ? <audio ref={ref} className="axp-chat-viewer-audio" controls src={url} /> : <Button size="sm" icon="play" onClick={() => void load()}>Load player</Button>}
      {a.chapters.length > 1 && url && (
        <div className="fx-row axp-chat-viewer-chapters" aria-label="Chapters">
          {a.chapters.map((c) => <Button key={c.start} size="sm" icon="clock" onClick={() => seek(c.start)}>{c.title} · {core.fmtDuration(c.start)}</Button>)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ settings tab */

type Settings = { intervalMin: number; claudeDirs: { path: string; label: string }[]; logGlobs: string[]; hubDrop: string; audio: AudioSettings };

export function ChatViewerSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [tts, setTts] = useState<Tts | null>(null);
  const [msg, setMsg] = useState('');
  const [keyIn, setKeyIn] = useState<Record<string, string>>({});
  const [job, setJob] = useState<Job | null>(null);
  const reload = useCallback(() => Promise.all([api.call<{ settings: Settings }>('settings'), api.call<Status>('status'), api.call<Tts>('tts')]).then(([a, b, c]) => { setS(a.settings); setStatus(b); setTts(c); }, (e) => setMsg((e as Error).message)), []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!job || job.state === 'done' || job.state === 'failed') return;
    const t = setTimeout(() => { api.call<Job>(`jobs/${job.id}`).then((j) => { setJob(j); if (j.state === 'done') void reload(); }, () => {}); }, 1500);
    return () => clearTimeout(t);
  }, [job, reload]);
  const save = async (patch: Partial<Settings>) => { try { const r = await api.put<{ settings: Settings }>('settings', patch); setS(r.settings); setMsg('Saved'); setTimeout(() => setMsg(''), 1500); } catch (e) { setMsg((e as Error).message); } };
  const [draft, setDraft] = useState<{ interval: string; dirs: string; globs: string; drop: string; pause: string } | null>(null);
  useEffect(() => { if (s) setDraft({ interval: String(s.intervalMin), dirs: s.claudeDirs.map((d) => `${d.path}${d.label ? ` | ${d.label}` : ''}`).join('\n'), globs: s.logGlobs.join('\n'), drop: s.hubDrop, pause: String(s.audio.pauseMs) }); }, [s]);
  if (!s || !tts || !draft) return <LoadingSkeleton rows={4} label="Loading Chat viewer settings" />;
  const saveSources = () => void save({
    intervalMin: Number(draft.interval) || 0, hubDrop: draft.drop.trim(), logGlobs: draft.globs.split('\n').map((x) => x.trim()).filter(Boolean),
    claudeDirs: draft.dirs.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map(([path, label]) => ({ path: path ?? '', label: label ?? '' })),
  }).then(reload);
  const a = s.audio;
  const setVoice = (engine: string, role: 'user' | 'assistant', v: string) => void save({ audio: { ...a, voices: { ...a.voices, [engine]: { user: '', assistant: '', ...a.voices[engine], [role]: v } } } });
  const pv = tts.catalog.map((v) => ({ value: v.id, label: `${v.label}${tts.piper.voices.includes(v.id) ? ' ✓' : ''}` }));
  return (
    <div className="fx-stack">
      {msg && <Note tone="info" icon="info">{msg}</Note>}
      <Container title="Checking for updates" icon="refresh">
        <div className="axp-chat-viewer-form">
          <TextField label="Check every (minutes, 0 = only on load)" type="number" value={draft.interval} onChange={(v) => setDraft({ ...draft, interval: v })} />
        </div>
        <TextField label="Claude Code session folders (one per line: path | label)" rows={4} mono value={draft.dirs} onChange={(v) => setDraft({ ...draft, dirs: v })} />
        <TextField label="Headless build logs (one glob per line)" rows={4} mono value={draft.globs} onChange={(v) => setDraft({ ...draft, globs: v })} />
        <TextField label="Hub drop folder (empty = the hub's sessions/claude-ai)" mono value={draft.drop} placeholder={status?.sources.hubDrop.path} onChange={(v) => setDraft({ ...draft, drop: v })} />
        <div className="fx-row"><Button icon="save" onClick={saveSources}>Save sources</Button><Button icon="undo" onClick={() => void save({ reset: true } as Partial<Settings>).then(reload)}>Back to defaults</Button></div>
        {status && <ul className="axp-chat-viewer-srcs">
          {status.sources.claudeDirs.map((d) => <li key={d.path}><Icon name={d.exists ? 'check-circle' : 'x-circle'} size={12} /> {d.path} {d.exists ? '' : '(not on this machine)'}</li>)}
          <li><Icon name={status.sources.hubDrop.exists ? 'check-circle' : 'x-circle'} size={12} /> drop folder {status.sources.hubDrop.path || '(no hub mounted)'}</li>
          <li><Icon name="folder" size={12} /> audio files go to {status.audioDir}</li>
        </ul>}
      </Container>
      <Container title="Audio voices" icon="play">
        <div className="axp-chat-viewer-form">
          <SelectField label="Default voices from" value={a.engine} onChange={(v) => void save({ audio: { ...a, engine: v } })}
            options={[{ value: 'piper', label: 'Piper (free, on the VPS)' }, { value: 'openai', label: 'OpenAI' }, { value: 'elevenlabs', label: 'ElevenLabs' }]} />
          <SelectField label="Brett (Piper)" value={a.voices.piper?.user ?? ''} options={pv} onChange={(v) => setVoice('piper', 'user', v)} />
          <SelectField label="Amber (Piper)" value={a.voices.piper?.assistant ?? ''} options={pv} onChange={(v) => setVoice('piper', 'assistant', v)} />
          <SelectField label="Brett (OpenAI)" value={a.voices.openai?.user ?? ''} options={tts.openaiVoices.map((v) => ({ value: v, label: v }))} onChange={(v) => setVoice('openai', 'user', v)} />
          <SelectField label="Amber (OpenAI)" value={a.voices.openai?.assistant ?? ''} options={tts.openaiVoices.map((v) => ({ value: v, label: v }))} onChange={(v) => setVoice('openai', 'assistant', v)} />
          <TextField label="Brett (ElevenLabs voice id)" value={a.voices.elevenlabs?.user ?? ''} onChange={(v) => setVoice('elevenlabs', 'user', v)} />
          <TextField label="Amber (ElevenLabs voice id)" value={a.voices.elevenlabs?.assistant ?? ''} onChange={(v) => setVoice('elevenlabs', 'assistant', v)} />
          <TextField label="Pause between turns (ms)" type="number" value={draft.pause} onChange={(v) => setDraft({ ...draft, pause: v })} />
          <SelectField label="File type" value={a.format} options={[{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }]} onChange={(v) => void save({ audio: { ...a, format: v } })} />
        </div>
        <div className="fx-row">
          <Button icon="save" onClick={() => void save({ audio: { ...a, pauseMs: Number(draft.pause) || 0 } })}>Save pause</Button>
          <Button icon="download" disabled={job?.state === 'running'} onClick={() => void api.post<Job>('tts/setup', {}).then(setJob, (e) => setMsg((e as Error).message))}>{tts.piper.ready ? 'Download the picked Piper voices' : 'Set up free voices (Piper)'}</Button>
          <span className="fx-muted">{tts.piper.ready ? `Piper ready · ${tts.piper.voices.length} voices` : 'Piper not installed'}</span>
        </div>
        {job && <JobLine job={job} />}
        {(['openai', 'elevenlabs'] as const).map((p) => (
          <div key={p} className="fx-row axp-chat-viewer-key">
            <TextField label={`${p === 'openai' ? 'OpenAI' : 'ElevenLabs'} key ${tts.keys[p] ? '(saved)' : ''}`} type="password" value={keyIn[p] ?? ''} onChange={(v) => setKeyIn({ ...keyIn, [p]: v })} />
            <Button size="sm" icon="save" disabled={!keyIn[p]} onClick={() => void api.put(`tts/keys/${p}`, { key: keyIn[p] }).then(() => { setKeyIn({ ...keyIn, [p]: '' }); void reload(); })}>Save</Button>
            {tts.keys[p] && <Button size="sm" icon="trash" onClick={() => void api.del(`tts/keys/${p}`).then(reload)}>Remove</Button>}
          </div>
        ))}
      </Container>
    </div>
  );
}
