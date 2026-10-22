/**
 * Capture panes: the Live browser (open any page, record the mouse, clicks and keys over it — and optionally the screen
 * as video — then replay the recording as the narrated cursor), Recordings, the Event track and Files.
 *
 * What a browser allows: a page from another site in a frame can't be read by this one, so its own clicks can't be
 * heard. Two ways around it: "Interact" mode records the frame's events when the page is from this site (the studio
 * itself, framework apps served alongside it), and "Capture layer" mode lays a transparent layer over the frame that
 * records every move and click anywhere (the page under it doesn't get them; you act out the walkthrough). Screen video
 * uses the browser's screen-share prompt (getDisplayMedia) and stays on this device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Segmented, Switch, useRuntime } from '../../axf/react';
import { fmtDur, now, orderedPieces, uid, updatePiece, type Cue, type Project, type RecEvent, type Recording } from '../model';
import { controllers, download, EXPORTS } from '../commands';
import { compile, toSrt, toVtt, toScript, toShotList, toEdl, toClaudeBrief } from '../compiler';
import { getVideo, putVideo } from '../persist';
import { studio, useStudio } from '../store';

/* ---------- events → cues (what Claude or you then refine) ---------- */

export function eventsToCues(events: RecEvent[]): Cue[] {
  const out: Cue[] = [];
  let last = 0, typed = '', typedAt = 0;
  const flushTyped = () => { if (typed) { out.push({ id: uid('c'), kind: 'type', text: typed, target: 'focused field', dur: Math.max(0.8, typed.length * 0.07) }); typed = ''; } };
  for (const e of events) {
    const gap = e.t - last;
    if (gap > 1.5 && e.type !== 'move') { flushTyped(); out.push({ id: uid('c'), kind: 'wait', dur: +Math.min(gap, 5).toFixed(1) }); }
    if (e.type === 'click') { flushTyped(); out.push({ id: uid('c'), kind: 'move', x: e.x, y: e.y, target: e.target, dur: 0.6 }, { id: uid('c'), kind: 'click', x: e.x, y: e.y, target: e.target, dur: 0.3 }); last = e.t; }
    if (e.type === 'key') { if (e.key && e.key.length === 1) { if (!typed) typedAt = e.t; typed += e.key; } else if (e.key && ['Enter', 'Tab', 'Escape'].includes(e.key)) { flushTyped(); out.push({ id: uid('c'), kind: 'key', text: e.key, dur: 0.3 }); } last = e.t; }
    if (e.type === 'scroll') { flushTyped(); if (out[out.length - 1]?.kind !== 'scroll') out.push({ id: uid('c'), kind: 'scroll', target: e.target ?? 'page', dur: 0.8 }); last = e.t; }
    if (e.type === 'nav') { flushTyped(); out.push({ id: uid('c'), kind: 'navigate', text: e.text, dur: 1.5 }); last = e.t; }
    if (e.type === 'mark') { flushTyped(); out.push({ id: uid('c'), kind: 'highlight', x: e.x, y: e.y, target: e.text ?? 'marker', dur: 1.2 }); last = e.t; }
  }
  void typedAt; flushTyped();
  return out;
}

/* ---------- the cursor replay over a stage ---------- */

export interface ReplayFrame { x: number; y: number; ripple: number | null; caption: string | null }
/** cursor position, ripple and caption at time t for a recording's events */
export function frameAt(events: RecEvent[], t: number): ReplayFrame {
  let a: RecEvent | null = null, b: RecEvent | null = null;
  for (const e of events) { if (e.x == null) continue; if (e.t <= t) a = e; else { b = e; break; } }
  const k = a && b ? (t - a.t) / Math.max(0.001, b.t - a.t) : 0;
  const x = a ? (b ? a.x! + (b.x! - a.x!) * k : a.x!) : 0.5, y = a ? (b ? a.y! + (b.y! - a.y!) * k : a.y!) : 0.5;
  const click = [...events].reverse().find((e) => e.type === 'click' && e.t <= t && t - e.t < 0.5);
  const cap = [...events].reverse().find((e) => (e.type === 'key' || e.type === 'mark' || e.type === 'nav') && e.t <= t && t - e.t < 1.2);
  return { x, y, ripple: click ? (t - click.t) / 0.5 : null, caption: cap ? (cap.type === 'key' ? `⌨ ${cap.key}` : cap.text ?? null) : null };
}

export function CursorLayer({ frame, kind }: { frame: ReplayFrame | null; kind: 'arrow' | 'dot' | 'ring' }) {
  if (!frame) return null;
  return (
    <div className="ws-cursor-layer" aria-hidden="true">
      <div className={`ws-cursor ws-cursor--${kind}`} style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%` }}>
        {kind === 'arrow' && <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 4 19 9 14.5 12.5 22 15.5 20.5 12 13.5 19 13.5z" /></svg>}
      </div>
      {frame.ripple != null && <div className="ws-ripple" style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, transform: `translate(-50%, -50%) scale(${0.4 + frame.ripple * 1.6})`, opacity: 1 - frame.ripple }} />}
      {frame.caption && <div className="ws-replay-cap">{frame.caption}</div>}
    </div>
  );
}

/* ---------- Live browser ---------- */

interface Rec { start: number; events: RecEvent[]; media?: MediaRecorder; chunks: Blob[]; stream?: MediaStream; lastMove: number; detach?: () => void }

export function BrowserPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const selId = useStudio((s) => s.selection.piece);
  const recording = useStudio((s) => s.recording);
  const piece = selId ? project.pieces[selId] : undefined;
  const [url, setUrl] = useState(piece?.url || 'about:blank');
  const [shown, setShown] = useState(piece?.url || 'about:blank');
  const [hist, setHist] = useState<string[]>([]);
  const [mode, setMode] = useState<'interact' | 'capture'>('capture');
  const [video, setVideo] = useState(false);
  const [replay, setReplay] = useState<{ rec: Recording; t: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const rec = useRef<Rec | null>(null);

  useEffect(() => { if (piece?.url && !recording) { setUrl(piece.url); setShown(piece.url); } }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (u: string) => { const v = /^[a-z]+:/i.test(u) ? u : `https://${u}`; setHist((h) => [...h, shown].slice(-30)); setShown(v); setUrl(v); push({ type: 'nav', text: v }); };
  const rel = (cx: number, cy: number) => { const r = stage.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) }; };
  const push = (e: Omit<RecEvent, 't'>) => { const r = rec.current; if (!r) return; r.events.push({ ...e, t: (performance.now() - r.start) / 1000 }); if (r.events.length % 10 === 0) studio().setRecording({ startedAt: r.start, events: r.events.length }); };

  const start = async () => {
    if (rec.current) return;
    const r: Rec = { start: performance.now(), events: [], chunks: [], lastMove: 0 };
    if (video && navigator.mediaDevices?.getDisplayMedia) {
      try {
        r.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        r.media = new MediaRecorder(r.stream); r.media.ondataavailable = (ev) => ev.data.size && r.chunks.push(ev.data); r.media.start(1000);
      } catch { rt.toast('Screen capture was not allowed; recording the mouse and keys only.', 'warning'); }
    }
    r.start = performance.now();
    rec.current = r;
    // same-site pages: hear the frame's own events too
    try {
      const doc = frame.current?.contentDocument;
      if (doc) {
        const fr = frame.current!.getBoundingClientRect();
        const mv = (e: MouseEvent) => onMove(e.clientX + fr.left, e.clientY + fr.top);
        const ck = (e: MouseEvent) => { const p = rel(e.clientX + fr.left, e.clientY + fr.top); push({ type: 'click', ...p, target: describeEl(e.target as Element) }); };
        const ky = (e: KeyboardEvent) => push({ type: 'key', key: e.key });
        doc.addEventListener('mousemove', mv); doc.addEventListener('click', ck, true); doc.addEventListener('keydown', ky, true);
        r.detach = () => { doc.removeEventListener('mousemove', mv); doc.removeEventListener('click', ck, true); doc.removeEventListener('keydown', ky, true); };
      }
    } catch { /* another site: the capture layer hears it instead */ }
    push({ type: 'nav', text: shown });
    studio().setRecording({ startedAt: r.start, events: 1 });
    studio().log(`Recording started on ${shown}${r.media ? ' with screen video' : ''}.`);
  };
  const stop = async () => {
    const r = rec.current; if (!r) return;
    rec.current = null; r.detach?.();
    const duration = (performance.now() - r.start) / 1000;
    let videoKey: string | undefined;
    if (r.media) {
      await new Promise<void>((res) => { r.media!.onstop = () => res(); r.media!.stop(); });
      r.stream?.getTracks().forEach((t) => t.stop());
      videoKey = uid('vid');
      try { await putVideo(videoKey, new Blob(r.chunks, { type: r.media.mimeType || 'video/webm' })); } catch { videoKey = undefined; rt.toast('The screen video could not be kept on this device.', 'warning'); }
    }
    const recd: Recording = { id: uid('rec'), name: `${piece?.title ?? 'Recording'} · ${new Date().toLocaleTimeString()}`, url: shown, createdAt: now(), duration, events: r.events, videoKey, pieceId: piece?.id };
    studio().edit('Record', (q) => {
      let next: Project = { ...q, recordings: [recd, ...q.recordings] };
      if (piece) next = updatePiece(next, piece.id, { recordingId: recd.id, clipSec: +duration.toFixed(1), status: piece.status === 'planned' ? 'partial' : piece.status });
      return next;
    });
    studio().setRecording(null);
    studio().log(`Recorded ${r.events.length} events in ${fmtDur(duration)}${piece ? `, attached to "${piece.title}"` : ''}.`, 'ok');
    rt.toast(`${r.events.length} events, ${fmtDur(duration)}${videoKey ? ', with screen video' : ''}.`, 'success', 'Recording saved');
  };
  const onMove = (cx: number, cy: number) => { const r = rec.current; if (!r) return; const t = performance.now(); if (t - r.lastMove < 33) return; r.lastMove = t; push({ type: 'move', ...rel(cx, cy) }); };
  useEffect(() => {
    controllers.recorder = { toggle: () => void (rec.current ? stop() : start()), start: () => void start(), stop: () => void stop(), mark: () => push({ type: 'mark', x: 0.5, y: 0.5, text: 'marker' }) };
    const key = (e: KeyboardEvent) => { if (rec.current && !(e.target as Element)?.closest?.('.ws-browser__bar')) push({ type: 'key', key: e.key }); };
    window.addEventListener('keydown', key, true);
    return () => { controllers.recorder = undefined; window.removeEventListener('keydown', key, true); };
  });

  // replay loop
  useEffect(() => {
    if (!replay) return;
    let raf = 0; const t0 = performance.now() - replay.t * 1000;
    const tick = () => { const t = (performance.now() - t0) / 1000; if (t > replay.rec.duration) { setReplay(null); return; } setReplay((r) => (r ? { ...r, t } : r)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay?.rec.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastRec = project.recordings.find((r) => r.id === piece?.recordingId) ?? project.recordings[0];
  const capture = mode === 'capture' && !!recording;
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools ws-browser__bar">
        <IconButton icon="arrow-left" label="Back" disabled={!hist.length} onClick={() => { const h = [...hist]; const prev = h.pop(); if (prev) { setHist(h); setShown(prev); setUrl(prev); } }} />
        <IconButton icon="refresh" label="Reload" onClick={() => { const s = shown; setShown('about:blank'); setTimeout(() => setShown(s), 30); }} />
        <form className="ws-grow fx-row" onSubmit={(e) => { e.preventDefault(); go(url); }}>
          <input className="fx-input fx-mono ws-grow" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" placeholder="https://console.amberxai.com" />
        </form>
        {piece?.url && piece.url !== shown && <Button size="sm" tone="quiet" icon="file" onClick={() => go(piece.url)}>Piece page</Button>}
        <IconButton icon="external" label="Open in a new tab" onClick={() => window.open(shown, '_blank', 'noopener,noreferrer')} />
      </div>
      <div className="ws-pane__tools">
        <Button size="sm" tone={recording ? 'danger' : 'primary'} icon={recording ? 'pause' : 'play'} onClick={() => controllers.recorder?.toggle()}>{recording ? `Stop · ${recording.events}` : 'Record'}</Button>
        <IconButton icon="star" label="Drop a marker" disabled={!recording} onClick={() => controllers.recorder?.mark()} />
        <Segmented size="sm" label="Mode" value={mode} onChange={setMode} options={[{ value: 'interact', label: 'Interact', icon: 'monitor', title: 'Use the page; records its events when it is from this site' }, { value: 'capture', label: 'Capture layer', icon: 'layers', title: 'Records every move and click anywhere; the page does not get them' }]} />
        <Switch label="Screen video" checked={video} onChange={setVideo} disabled={!!recording} />
        <span className="fx-grow" />
        {lastRec && <Button size="sm" tone="quiet" icon={replay ? 'pause' : 'play'} onClick={() => setReplay(replay ? null : { rec: lastRec, t: 0 })}>{replay ? 'Stop replay' : 'Replay'}</Button>}
      </div>
      <div className={`ws-stage ${recording ? 'is-recording' : ''}`} ref={stage}>
        <iframe ref={frame} className="ws-stage__frame" src={shown} title="Live browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
        {capture && (
          <div className="ws-capture" onPointerMove={(e) => onMove(e.clientX, e.clientY)} onPointerDown={(e) => push({ type: 'down', ...rel(e.clientX, e.clientY) })}
            onPointerUp={(e) => push({ type: 'up', ...rel(e.clientX, e.clientY) })} onClick={(e) => push({ type: 'click', ...rel(e.clientX, e.clientY) })}
            onWheel={(e) => push({ type: 'scroll', ...rel(e.clientX, e.clientY), text: String(Math.round(e.deltaY)) })} />
        )}
        {recording && <span className="ws-rec-badge"><span className="ws-rec-dot" /> REC {fmtDur((performance.now() - recording.startedAt) / 1000)}</span>}
        {replay && <CursorLayer frame={frameAt(replay.rec.events, replay.t)} kind={project.settings.cursor} />}
      </div>
      <p className="fx-small fx-muted ws-pad">Some sites refuse to be shown in a frame; open them in a new tab. Recordings attach to the selected piece and set its clip length.</p>
    </div>
  );
}
const describeEl = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.textContent?.trim() ? ` “${el.textContent.trim().slice(0, 30)}”` : ''}` : '');

/* ---------- Recordings ---------- */

export function RecordingsPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const selId = useStudio((s) => s.selection.piece);
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      {!project.recordings.length && <p className="fx-muted">No recordings yet. Open the Live browser and press Record.</p>}
      {project.recordings.map((r) => {
        const pc = r.pieceId ? project.pieces[r.pieceId] : undefined;
        return (
          <div key={r.id} className={`ws-card ${focus === r.id ? 'is-active' : ''}`} data-fx-ctx-target="ws-recording" data-fx-ctx-payload={r.id}>
            <button type="button" data-fx-row className="ws-col" onClick={() => { setFocus(r.id); selectedRecording = r.id; studio().log(`Event track: ${r.name}`); }}>
              <strong className="ws-ellipsis">{r.name}</strong>
              <span className="fx-small fx-muted">{fmtDur(r.duration)} · {r.events.length} events · {r.url}{pc ? ` · on “${pc.title}”` : ''}{r.processed ? ' · processed by Claude' : ''}</span>
            </button>
            <div className="fx-row fx-row--wrap">
              {selId && selId !== r.pieceId && <Button size="sm" icon="check" onClick={() => studio().edit('Attach', (q) => updatePiece({ ...q, recordings: q.recordings.map((x) => (x.id === r.id ? { ...x, pieceId: selId } : x)) }, selId, { recordingId: r.id, clipSec: +r.duration.toFixed(1) }))}>Attach to selected</Button>}
              <Button size="sm" tone="quiet" icon="list" onClick={() => { if (!r.pieceId) return rt.toast('Attach it to a piece first.', 'info'); studio().edit('Cues from recording', (q) => updatePiece(q, r.pieceId!, { cues: eventsToCues(r.events) })); rt.toast('Cue track rebuilt from the recording.', 'success'); }}>Make cues</Button>
              <Button size="sm" tone="quiet" icon="sparkles" onClick={() => rt.dispatch(`ws.recording.process:${r.id}`)}>Process with Claude</Button>
              {r.videoKey && <Button size="sm" tone="quiet" icon="download" onClick={() => void getVideo(r.videoKey!).then((b) => { if (!b) return rt.toast('The video is not on this device.', 'warning'); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${r.name}.webm`; a.click(); })}>Video</Button>}
              <Button size="sm" tone="quiet" icon="download" onClick={() => download(`${r.id}.json`, JSON.stringify(r, null, 1), 'application/json')}>Events</Button>
              <IconButton icon="trash" label="Delete recording" onClick={() => studio().edit('Delete recording', (q) => ({ ...q, recordings: q.recordings.filter((x) => x.id !== r.id) }))} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
let selectedRecording: string | null = null;

/* ---------- Event track ---------- */

export function EventsPane() {
  const project = useStudio((s) => s.project)!;
  useStudio((s) => s.log.length);
  const rec = project.recordings.find((r) => r.id === selectedRecording) ?? project.recordings[0];
  const [type, setType] = useState('all');
  if (!rec) return <p className="fx-muted ws-pad">Record something first; its events show here.</p>;
  const pts = rec.events.filter((e) => e.x != null);
  const path = pts.map((e, i) => `${i ? 'L' : 'M'}${(e.x! * 100).toFixed(1)} ${(e.y! * 60).toFixed(1)}`).join(' ');
  const list = rec.events.filter((e) => type === 'all' || e.type === type);
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools"><strong className="ws-ellipsis ws-grow">{rec.name}</strong>
        <select className="fx-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">{['all', 'move', 'click', 'key', 'scroll', 'nav', 'mark'].map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <svg className="ws-pathmap" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Cursor path">
        <path d={path} />
        {rec.events.filter((e) => e.type === 'click').map((e, i) => <circle key={i} cx={e.x! * 100} cy={e.y! * 60} r={1.2} />)}
      </svg>
      <div className="ws-pane__scroll">
        <table className="fx-table ws-table"><thead><tr><th>Time</th><th>Type</th><th>Where</th><th>What</th></tr></thead>
          <tbody>{list.slice(0, 2000).map((e, i) => <tr key={i}><td className="fx-mono">{e.t.toFixed(2)}</td><td>{e.type}</td><td className="fx-mono">{e.x != null ? `${Math.round(e.x * 100)}%, ${Math.round(e.y! * 100)}%` : ''}</td><td className="ws-ellipsis">{e.key ?? e.text ?? e.target ?? ''}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Files ---------- */

interface FileNode { name: string; kind: 'dir' | 'file'; children?: FileNode[]; read?: () => Promise<string | Blob> }

export function FilesPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const selId = useStudio((s) => s.selection.piece);
  const [device, setDevice] = useState<FileNode | null>(null);
  const [open, setOpen] = useState<string[]>(['project', 'project/exports']);
  const [view, setView] = useState<{ path: string; text?: string; url?: string; type?: string } | null>(null);
  const tree = useMemo<FileNode>(() => {
    const exp = (name: string, make: () => string) => ({ name, kind: 'file' as const, read: async () => make() });
    const c = () => compile(project);
    return {
      name: 'project', kind: 'dir', children: [
        exp('project.walkthrough.json', () => JSON.stringify(project, null, 1)),
        { name: 'exports', kind: 'dir', children: [exp('timeline.json', () => JSON.stringify(c(), null, 1)), exp('captions.srt', () => toSrt(c())), exp('captions.vtt', () => toVtt(c())), exp('script.md', () => toScript(c(), project)), exp('shots.csv', () => toShotList(c())), exp('video.edl', () => toEdl(c(), project.settings.fps)), exp('claude-brief.txt', () => toClaudeBrief(c(), project))] },
        { name: 'pieces', kind: 'dir', children: orderedPieces(project).map((p) => exp(`${p.title.replace(/[^\w.-]+/g, '-').slice(0, 40)}.md`, () => `# ${p.title}\n\n${p.narration}\n\n${p.effect ? `> Show: ${p.effect}\n\n` : ''}${p.cues.map((q) => `- ${q.kind} ${q.target ?? ''} ${q.text ?? ''} (${q.dur}s)`).join('\n')}`)) },
        { name: 'recordings', kind: 'dir', children: project.recordings.flatMap((r) => [exp(`${r.id}.json`, () => JSON.stringify(r, null, 1)), ...(r.videoKey ? [{ name: `${r.id}.webm`, kind: 'file' as const, read: async () => (await getVideo(r.videoKey!)) ?? '' }] : [])]) },
      ],
    };
  }, [project]);

  const pickFolder = async () => {
    const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
    if (w.showDirectoryPicker) {
      try {
        const h = await w.showDirectoryPicker();
        const walk = async (d: FileSystemDirectoryHandle, depth: number): Promise<FileNode> => {
          const kids: FileNode[] = [];
          for await (const [name, e] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
            if (name.startsWith('.') || name === 'node_modules') continue;
            if (e.kind === 'directory') { if (depth < 4) kids.push(await walk(e as FileSystemDirectoryHandle, depth + 1)); }
            else kids.push({ name, kind: 'file', read: async () => (e as FileSystemFileHandle).getFile() });
            if (kids.length > 400) break;
          }
          return { name: d.name, kind: 'dir', children: kids.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)) };
        };
        setDevice(await walk(h, 0)); setOpen((o) => [...o, h.name]);
      } catch { /* cancelled */ }
      return;
    }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; (inp as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    inp.onchange = () => { const files = [...(inp.files ?? [])].slice(0, 400); setDevice({ name: 'device', kind: 'dir', children: files.map((f) => ({ name: (f as unknown as { webkitRelativePath: string }).webkitRelativePath || f.name, kind: 'file', read: async () => f })) }); setOpen((o) => [...o, 'device']); };
    inp.click();
  };

  const show = async (path: string, n: FileNode) => {
    const d = await n.read!();
    if (typeof d === 'string') return setView({ path, text: d });
    if (/^(image|video)\//.test(d.type) || /\.webm$/.test(n.name)) return setView({ path, url: URL.createObjectURL(d), type: d.type || 'video/webm' });
    if (d.size > 2_000_000) return setView({ path, text: `(${Math.round(d.size / 1024)} KB — too big to show)` });
    setView({ path, text: await d.text() });
  };
  const render = (n: FileNode, path: string, depth: number) => {
    const p = path ? `${path}/${n.name}` : n.name;
    if (n.kind === 'dir') {
      const o = open.includes(p);
      return (
        <li key={p}>
          <button type="button" data-fx-row className="ws-tree__row" style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.6 + 0.5})` }} onClick={() => setOpen((x) => (o ? x.filter((y) => y !== p) : [...x, p]))}>
            <Icon name={o ? 'chevron-down' : 'chevron-right'} size={12} /><Icon name="folder" size={14} /> {n.name} <span className="fx-small fx-muted">{n.children?.length ?? 0}</span>
          </button>
          {o && <ul>{n.children?.map((c) => render(c, p, depth + 1))}</ul>}
        </li>
      );
    }
    return <li key={p}><button type="button" data-fx-row className={`ws-tree__row ${view?.path === p ? 'is-active' : ''}`} style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.6 + 2})` }} onClick={() => void show(p, n)}><Icon name="file" size={13} /> {n.name}</button></li>;
  };
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools"><Button size="sm" icon="folder" onClick={() => void pickFolder()}>Open a folder on this device</Button></div>
      <div className="ws-files">
        <ul className="ws-tree ws-files__tree">{render(tree, '', 0)}{device && render(device, '', 0)}</ul>
        <div className="ws-files__view">
          {!view && <p className="fx-muted ws-pad">Pick a file to see it.</p>}
          {view && (
            <div className="fx-stack ws-pad">
              <div className="fx-row fx-row--wrap"><strong className="fx-mono ws-ellipsis ws-grow">{view.path}</strong>
                {view.text != null && <Button size="sm" tone="quiet" icon="download" onClick={() => download(view.path.split('/').pop()!, view.text!)}>Download</Button>}
                {view.text != null && selId && /\.(md|txt)$/i.test(view.path) && <Button size="sm" icon="type" onClick={() => { studio().edit('Narration from file', (q) => updatePiece(q, selId, { narration: view.text!.replace(/^#.*\n/, '').trim() })); rt.toast('Narration replaced from the file.', 'success'); }}>Use as narration</Button>}
              </div>
              {view.url && (view.type?.startsWith('image/') ? <img className="ws-media" src={view.url} alt={view.path} /> : <video className="ws-media" src={view.url} controls />)}
              {view.text != null && <pre className="fx-code ws-pre">{view.text.slice(0, 200_000)}</pre>}
            </div>
          )}
        </div>
      </div>
      <p className="fx-small fx-muted ws-pad">{EXPORTS.length} exports are made fresh from the project when opened.</p>
    </div>
  );
}
