/**
 * Video panes: Preview (plays the compiled walkthrough — the browser's voice reads the narration line by line, captions
 * show, the cursor acts out the cues over the page), Timeline (the segments to scale; drag a piece to swap it and
 * recompile), Captions and Export.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Slider, Switch, useRuntime } from '../../axf/react';
import { at, toClaudeBrief, toEdl, toScript, toShotList, toSrt, toVtt, type Compiled, type Segment } from '../compiler';
import { fmtDur, moveItem, statusInfo } from '../model';
import { controllers, EXPORTS, exportNow } from '../commands';
import { registerZone, startDrag } from '../../axf/libs/dnd';
import { studio, useStudio } from '../store';
import { CursorLayer, type ReplayFrame } from './capture';
import { hush, speak } from './writing';

function useCompiled(): Compiled | null {
  const c = useStudio((s) => s.compiled);
  const p = useStudio((s) => s.project);
  useEffect(() => { if (!c && p) studio().compileNow(); }, [c, p]);
  return c;
}
const spot = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return { x: 0.15 + ((h % 1000) / 1000) * 0.7, y: 0.18 + (((h >> 10) % 1000) / 1000) * 0.64 }; };

/** cursor frame for a compiled segment at time t: cues with coordinates use them, others get a stable spot per target */
function segFrame(seg: Segment | null, t: number): ReplayFrame | null {
  if (!seg || seg.kind !== 'piece' || !seg.cues.length) return null;
  const pos = seg.cues.map((q) => (q.x != null ? { x: q.x, y: q.y! } : spot(q.target ?? q.text ?? q.kind)));
  let i = seg.cues.findIndex((q, k) => t >= q.start && (k === seg.cues.length - 1 || t < seg.cues[k + 1]!.start));
  if (i < 0) i = 0;
  const q = seg.cues[i]!; const from = pos[Math.max(0, i - 1)]!, to = pos[i]!;
  const k = Math.min(1, (t - q.start) / Math.max(0.2, Math.min(q.dur, 0.8)));
  const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k;
  const ripple = q.kind === 'click' && t - q.start < 0.5 ? (t - q.start) / 0.5 : null;
  const caption = q.kind === 'type' ? `⌨ ${q.text ?? ''}` : q.kind === 'highlight' ? `★ ${q.target ?? ''}` : q.kind === 'key' ? `⌨ ${q.text ?? ''}` : q.kind === 'click' ? q.target ?? null : null;
  return { x, y, ripple, caption };
}

export function PreviewPane() {
  const c = useCompiled();
  const prj = useStudio((s) => s.project)!;
  const [t, setT] = useState(0);
  const [run, setRun] = useState(false);
  const [voice, setVoice] = useState(true);
  const [frames, setFrames] = useState(true);
  const spoken = useRef<string>('');
  const t0 = useRef(0);
  const { seg, line } = c ? at(c, t) : { seg: null, line: null };

  useEffect(() => {
    controllers.player = { play: () => { setRun(true); }, stop: () => { setRun(false); hush(); } };
    return () => { controllers.player = undefined; hush(); };
  }, []);
  useEffect(() => {
    if (!run || !c) return;
    let raf = 0; t0.current = performance.now() - t * 1000;
    const tick = () => { const nt = (performance.now() - t0.current) / 1000; if (nt >= c.durationSec) { setRun(false); setT(0); studio().setPlaying(null); return; } setT(nt); studio().setPlaying({ at: nt, running: true }); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, c]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run || !voice || !line) return;
    const key = `${line.start}`;
    if (spoken.current === key) return;
    spoken.current = key; hush(); speak(line.text, prj.settings);
  }, [run, voice, line, prj.settings]);

  if (!c) return <p className="fx-muted ws-pad">Compiling…</p>;
  const idx = c.segments.indexOf(seg!);
  const jump = (s: Segment) => { setT(s.start + 0.01); spoken.current = ''; hush(); };
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <Button size="sm" tone="primary" icon={run ? 'pause' : 'play'} onClick={() => { if (run) hush(); setRun(!run); }}>{run ? 'Pause' : 'Play'}</Button>
        <IconButton icon="chevron-left" label="Previous segment" onClick={() => idx > 0 && jump(c.segments[idx - 1]!)} />
        <IconButton icon="chevron-right" label="Next segment" onClick={() => idx < c.segments.length - 1 && jump(c.segments[idx + 1]!)} />
        <span className="fx-mono fx-small">{fmtDur(t)} / {fmtDur(c.durationSec)}</span>
        <span className="fx-grow" />
        <Switch label="Voice" checked={voice} onChange={setVoice} />
        <Switch label="Pages" checked={frames} onChange={setFrames} />
      </div>
      <input className="ws-scrub" type="range" min={0} max={c.durationSec} step={0.1} value={t} onChange={(e) => { setT(Number(e.target.value)); spoken.current = ''; }} aria-label="Position" />
      <div className={`ws-stage ws-stage--${prj.settings.resolution === '1080x1920' ? 'tall' : 'wide'}`}>
        {seg?.kind !== 'piece' ? (
          <div className={`ws-card-title ws-tr--${prj.settings.transition}`} key={seg?.id}><Icon name={seg?.kind === 'title' ? 'play' : 'layers'} size={28} /><h2>{seg?.title ?? prj.name}</h2>{seg?.kind === 'title' && <p className="fx-muted">{prj.description}</p>}</div>
        ) : frames && seg.url ? (
          <iframe key={seg.url} className={`ws-stage__frame ws-tr--${prj.settings.transition}`} src={seg.url} title={seg.title} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
        ) : (
          <div className={`ws-card-title ws-tr--${prj.settings.transition}`} key={seg.id}><h3>{seg.title}</h3><p className="fx-small fx-muted">{seg.path.join(' › ')}</p></div>
        )}
        <CursorLayer frame={segFrame(seg, t)} kind={prj.settings.cursor} />
        {prj.settings.captions && line && <div className="ws-caption">{line.text}</div>}
        {seg?.kind === 'piece' && <span className={`ws-seg-badge ws-tone--${statusInfo(seg.status ?? 'planned').tone}`}>{seg.title}</span>}
      </div>
      <div className="ws-pane__scroll ws-seglist">
        {c.segments.map((s) => (
          <button key={s.id} type="button" data-fx-row className={`ws-seglist__row ${s === seg ? 'is-active' : ''}`} onClick={() => jump(s)}>
            <span className="fx-mono fx-small">{fmtDur(s.start)}</span><Icon name={s.kind === 'piece' ? 'file' : 'layers'} size={12} /><span className="ws-ellipsis ws-grow">{s.title}</span><span className="fx-small fx-muted">{fmtDur(s.end - s.start)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TimelinePane() {
  const rt = useRuntime();
  const c = useCompiled();
  const sel = useStudio((s) => s.selection.piece);
  const playing = useStudio((s) => s.playing);
  const [scale, setScale] = useState(6);
  useEffect(() => registerZone('timeline', {
    axis: 'x', accepts: (p, id) => p.kind === 'piece' && p.id !== id, positions: () => ['before', 'after'],
    drop: (p, id, pos) => { studio().edit('Swap pieces', (q) => moveItem(q, { kind: 'piece', id: p.id }, { kind: 'piece', id }, pos)); studio().compileNow(); },
  }), []);
  const dur = c?.durationSec ?? 0;
  const ticks = useMemo(() => Array.from({ length: Math.ceil(dur / 60) + 1 }, (_, i) => i * 60), [dur]);
  if (!c) return <p className="fx-muted ws-pad">Compiling…</p>;
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <Button size="sm" tone="primary" icon="package" onClick={() => rt.dispatch('ws.compile')}>Recompile</Button>
        <span className="fx-small">{fmtDur(c.durationSec)}{c.targetSec ? ` of ${fmtDur(c.targetSec)}` : ' · no length limit'} · {c.segments.length} segments · {c.reused} reused · {c.rebuilt} rebuilt · {c.skipped.length} left out</span>
        <span className="fx-grow" />
        <span className="ws-scale"><Slider label="Zoom" value={scale} min={1} max={30} unit=" px/s" onChange={setScale} /></span>
      </div>
      {c.warnings.length > 0 && <details className="ws-warn fx-small"><summary><Icon name="alert" size={12} /> {c.warnings.length} warnings</summary><ul>{c.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      <div className="ws-pane__scroll ws-tl">
        <div className="ws-tl__track" style={{ width: `${c.durationSec * scale + 40}px` }}>
          <div className="ws-tl__ruler">{ticks.map((s) => <span key={s} style={{ left: `${s * scale}px` }}>{fmtDur(s)}</span>)}</div>
          {c.targetSec > 0 && <div className="ws-tl__target" style={{ left: `${c.targetSec * scale}px` }} title="Target length" />}
          {playing && <div className="ws-tl__head" style={{ left: `${playing.at * scale}px` }} />}
          <div className="ws-tl__blocks">
            {c.segments.map((s) => (
              <div key={s.id} className={`ws-tl__block ws-tl__block--${s.kind} ${s.pieceId && s.pieceId === sel ? 'is-active' : ''} ${s.status ? `ws-tone-edge--${statusInfo(s.status).tone}` : ''} ${s.reused ? '' : 'is-fresh'}`}
                style={{ left: `${s.start * scale}px`, width: `${Math.max(3, (s.end - s.start) * scale)}px` }} title={`${s.title} · ${fmtDur(s.end - s.start)}${s.reused ? ' · reused' : ' · rebuilt'}`}
                data-axf-drop={s.pieceId ? 'timeline' : undefined} data-axf-drop-id={s.pieceId} data-fx-ctx-target={s.pieceId ? 'ws-piece' : undefined} data-fx-ctx-payload={s.pieceId}
                onPointerDown={(e) => s.pieceId && startDrag(e, { kind: 'piece', id: s.pieceId, label: s.title, icon: 'play', trashable: true })}
                onClick={() => s.pieceId && studio().select({ piece: s.pieceId, section: null })}>
                <span className="ws-ellipsis">{s.title}</span>
              </div>
            ))}
          </div>
          <div className="ws-tl__chapters">{c.chapters.map((ch) => <span key={ch.start} style={{ left: `${ch.start * scale}px` }}>{ch.title}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

export function CaptionsPane() {
  const c = useCompiled();
  const [q, setQ] = useState('');
  if (!c) return <p className="fx-muted ws-pad">Compiling…</p>;
  const lines = c.segments.flatMap((s) => s.lines.map((l) => ({ ...l, seg: s.title }))).filter((l) => !q || l.text.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools"><input className="fx-input ws-grow" placeholder="Find in captions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in captions" /><span className="fx-small fx-muted">{lines.length} lines</span></div>
      <div className="ws-pane__scroll"><table className="fx-table ws-table"><tbody>{lines.map((l, i) => <tr key={i}><td className="fx-mono fx-small">{fmtDur(l.start)}</td><td>{l.text}</td><td className="fx-small fx-muted ws-ellipsis">{l.seg}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function ExportPane() {
  const c = useCompiled();
  const prj = useStudio((s) => s.project)!;
  const [fmt, setFmt] = useState('script');
  if (!c) return <p className="fx-muted ws-pad">Compiling…</p>;
  const text = fmt === 'srt' ? toSrt(c) : fmt === 'vtt' ? toVtt(c) : fmt === 'script' ? toScript(c, prj) : fmt === 'shots' ? toShotList(c) : fmt === 'edl' ? toEdl(c, prj.settings.fps) : fmt === 'brief' ? toClaudeBrief(c, prj) : JSON.stringify(fmt === 'project' ? prj : c, null, 1);
  return (
    <div className="ws-pane">
      <div className="ws-pane__scroll ws-pad fx-stack">
        {EXPORTS.map((e) => (
          <div key={e.id} className={`ws-row ${fmt === e.id ? 'is-active' : ''}`}>
            <button type="button" data-fx-row className="ws-grow" onClick={() => setFmt(e.id)}>{e.label}</button>
            <Button size="sm" icon="download" onClick={() => exportNow(e.id)}>Save</Button>
          </div>
        ))}
        <Button size="sm" tone="quiet" icon="copy" onClick={() => void navigator.clipboard?.writeText(text)}>Copy this one</Button>
        <pre className="fx-code ws-pre">{text.slice(0, 60_000)}</pre>
      </div>
    </div>
  );
}
