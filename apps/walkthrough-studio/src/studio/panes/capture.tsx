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
import { fmtDur, orderedPieces, uid, updatePiece, type Cue, type Project, type RecEvent, type Recording } from '../model';
import { controllers, download, EXPORTS } from '../commands';
import { compile, toSrt, toVtt, toScript, toShotList, toEdl, toClaudeBrief } from '../compiler';
import { getBlob, putBlob } from '../../axf/libs/docstore';
import { CaptureLayer, Replay, recorderConfig, toCues, useRecorder } from '../../axf/libs/recorder';
import { studio, useStudio } from '../store';

/* ---------- the cursor replay (lib-recorder), kept under the names the preview uses ---------- */

export { CursorLayer, frameAt, type ReplayFrame } from '../../axf/libs/recorder';
/** events → the studio's cue track (lib-recorder's rules, with the installed wait threshold) */
export const eventsToCues = (events: RecEvent[]): Cue[] => toCues(events);

/* ---------- Live browser ---------- */

export function BrowserPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const selId = useStudio((s) => s.selection.piece);
  const piece = selId ? project.pieces[selId] : undefined;
  const [url, setUrl] = useState(piece?.url || 'about:blank');
  const [shown, setShown] = useState(piece?.url || 'about:blank');
  const [hist, setHist] = useState<string[]>([]);
  const [mode, setMode] = useState<'interact' | 'capture'>('capture');
  const [video, setVideo] = useState(false);
  const [replay, setReplay] = useState<Recording | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pieceRef = useRef(piece); pieceRef.current = piece;

  const rec = useRecorder({
    stage, frame, ignoreKeysIn: '.ws-browser__bar', onError: (m) => rt.toast(m, 'warning'),
    onDone: (r, blob) => void (async () => {
      const pc = pieceRef.current;
      let videoKey: string | undefined;
      if (blob) { videoKey = uid('vid'); try { await putBlob(videoKey, blob); } catch { videoKey = undefined; rt.toast('The screen video could not be kept on this device.', 'warning'); } }
      const recd: Recording = { ...r, name: `${pc?.title ?? 'Recording'} · ${new Date().toLocaleTimeString()}`, videoKey, pieceId: pc?.id };
      studio().edit('Record', (q) => {
        let next: Project = { ...q, recordings: [recd, ...q.recordings] };
        if (pc) next = updatePiece(next, pc.id, { recordingId: recd.id, clipSec: +r.duration.toFixed(1), status: pc.status === 'planned' ? 'partial' : pc.status });
        return next;
      });
      studio().setRecording(null);
      studio().log(`Recorded ${r.events.length} events in ${fmtDur(r.duration)}${pc ? `, attached to "${pc.title}"` : ''}.`, 'ok');
      rt.toast(`${r.events.length} events, ${fmtDur(r.duration)}${videoKey ? ', with screen video' : ''}.`, 'success', 'Recording saved');
    })(),
  });
  useEffect(() => { if (piece?.url && !rec.recording) { setUrl(piece.url); setShown(piece.url); } }, [piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { studio().setRecording(rec.recording); }, [rec.recording]);

  const go = (u: string) => { const v = /^[a-z]+:/i.test(u) ? u : `https://${u}`; setHist((h) => [...h, shown].slice(-30)); setShown(v); setUrl(v); rec.push({ type: 'nav', text: v }); };
  const start = () => { void rec.start({ url: shown, video }); studio().log(`Recording started on ${shown}${video ? ' with screen video' : ''}.`); };
  useEffect(() => {
    controllers.recorder = { toggle: () => (rec.recording ? void rec.stop() : start()), start, stop: () => void rec.stop(), mark: () => rec.mark() };
    return () => { controllers.recorder = undefined; };
  });

  const lastRec = project.recordings.find((r) => r.id === piece?.recordingId) ?? project.recordings[0];
  const recording = rec.recording;
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
        <IconButton icon="star" label="Drop a marker" disabled={!recording} onClick={() => rec.mark()} />
        {recorderConfig().captureLayer && recorderConfig().sameSite && <Segmented size="sm" label="Mode" value={mode} onChange={setMode} options={[{ value: 'interact', label: 'Interact', icon: 'monitor', title: 'Use the page; records its events when it is from this site' }, { value: 'capture', label: 'Capture layer', icon: 'layers', title: 'Records every move and click anywhere; the page does not get them' }]} />}
        {rec.canVideo && <Switch label="Screen video" checked={video} onChange={setVideo} disabled={!!recording} />}
        <span className="fx-grow" />
        {lastRec && recorderConfig().replay && <Button size="sm" tone="quiet" icon={replay ? 'pause' : 'play'} onClick={() => setReplay(replay ? null : lastRec)}>{replay ? 'Stop replay' : 'Replay'}</Button>}
      </div>
      <div className={`ws-stage ${recording ? 'is-recording' : ''}`} ref={stage}>
        <iframe ref={frame} className="ws-stage__frame" src={shown} title="Live browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
        {(mode === 'capture' || !recorderConfig().sameSite) && <CaptureLayer rec={rec} />}
        {recording && <span className="ws-rec-badge"><span className="ws-rec-dot" /> REC {fmtDur((performance.now() - recording.startedAt) / 1000)}</span>}
        {replay && <Replay recording={replay} kind={project.settings.cursor} onEnd={() => setReplay(null)} />}
      </div>
      <p className="fx-small fx-muted ws-pad">Some sites refuse to be shown in a frame; open them in a new tab. Recordings attach to the selected piece and set its clip length.</p>
    </div>
  );
}

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
              {r.videoKey && <Button size="sm" tone="quiet" icon="download" onClick={() => void getBlob(r.videoKey!).then((b) => { if (!b) return rt.toast('The video is not on this device.', 'warning'); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${r.name}.webm`; a.click(); })}>Video</Button>}
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
        { name: 'recordings', kind: 'dir', children: project.recordings.flatMap((r) => [exp(`${r.id}.json`, () => JSON.stringify(r, null, 1)), ...(r.videoKey ? [{ name: `${r.id}.webm`, kind: 'file' as const, read: async () => (await getBlob(r.videoKey!)) ?? '' }] : [])]) },
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
