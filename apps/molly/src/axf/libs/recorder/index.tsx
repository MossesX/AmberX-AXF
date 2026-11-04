/**
 * lib-recorder — record what a person does over a stage and replay it (library@1 `ai.amberx.axf.recorder`).
 *
 *   const rec = useRecorder({ stage: stageRef, frame: frameRef, onDone: (r) => … });
 *   rec.start({ url, video }) / rec.stop() / rec.mark() / rec.push(event)
 *   <CaptureLayer rec={rec} />           // inside the stage while recording (capture-layer part)
 *   <CursorLayer frame={frameAt(events, t)} />  or  <Replay recording={r} />
 *
 * Parts (installed config `libraries.recorder.parts`): capture-layer, same-site, keys, screen-video, replay {cursor,
 * ripples}, cues {waitAfter}. Video goes to `onVideo` (the app stores it, e.g. lib-docstore's blob store).
 */
import { useEffect, useRef, useState, type RefObject, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import { describeElement, eventsToCues, frameAt, type RecCue, type RecEvent, type Recording, type ReplayFrame } from './engine';
import spec from './library.json';
import './recorder.css';

export * from './engine';
export const RECORDER_LIBRARY_ID = 'ai.amberx.axf.recorder';
const PARTS = (spec as { parts: LibraryPart[] }).parts;
export interface RecorderConfig { captureLayer: boolean; sameSite: boolean; keys: boolean; screenVideo: boolean; replay: false | { cursor: 'arrow' | 'dot' | 'ring'; ripples: boolean }; cues: false | { waitAfter: number } }
let config: RecorderConfig = { captureLayer: true, sameSite: true, keys: true, screenVideo: false, replay: { cursor: 'arrow', ripples: true }, cues: { waitAfter: 1.5 } };
export function configureRecorder(installed: { parts?: Record<string, unknown> } | null | undefined): RecorderConfig {
  const on = (id: string) => partOn(installed, id, PARTS);
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  config = {
    captureLayer: on('capture-layer'), sameSite: on('same-site'), keys: on('keys'), screenVideo: on('screen-video'),
    replay: on('replay') ? { cursor: (pp('replay').cursor as 'arrow') ?? 'arrow', ripples: pp('replay').ripples !== false } : false,
    cues: on('cues') ? { waitAfter: Number(pp('cues').waitAfter ?? 1.5) } : false,
  };
  return config;
}
export const recorderConfig = () => config;
/** events → cues with the installed wait threshold ([] when the cues part is off) */
export const toCues = (events: readonly RecEvent[]): RecCue[] => (config.cues ? eventsToCues(events, config.cues.waitAfter) : []);

export interface RecorderHandle {
  recording: { startedAt: number; events: number } | null;
  start: (o: { url?: string; video?: boolean }) => Promise<void>;
  stop: () => Promise<Recording | null>;
  mark: (text?: string) => void;
  push: (e: Omit<RecEvent, 't'>) => void;
  /** pointer handlers for a capture layer over the stage */
  layer: { onPointerMove: (e: RPointerEvent) => void; onPointerDown: (e: RPointerEvent) => void; onPointerUp: (e: RPointerEvent) => void; onClick: (e: RMouseEvent) => void; onWheel: (e: RWheelEvent) => void };
  /** may the screen also be recorded here (part on + the browser can) */
  canVideo: boolean;
}
interface Live { start: number; url: string; events: RecEvent[]; media?: MediaRecorder; chunks: Blob[]; stream?: MediaStream; lastMove: number; detach?: () => void }

export function useRecorder(o: { stage: RefObject<HTMLElement | null>; frame?: RefObject<HTMLIFrameElement | null>; onDone?: (r: Recording, video: Blob | null) => void; onError?: (msg: string) => void; ignoreKeysIn?: string }): RecorderHandle {
  const live = useRef<Live | null>(null);
  const [state, setState] = useState<RecorderHandle['recording']>(null);
  const rel = (cx: number, cy: number) => { const r = o.stage.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) }; };
  const push = (e: Omit<RecEvent, 't'>) => { const l = live.current; if (!l) return; l.events.push({ ...e, t: (performance.now() - l.start) / 1000 }); if (l.events.length % 10 === 0) setState({ startedAt: l.start, events: l.events.length }); };
  const move = (cx: number, cy: number) => { const l = live.current; if (!l) return; const t = performance.now(); if (t - l.lastMove < 33) return; l.lastMove = t; push({ type: 'move', ...rel(cx, cy) }); };

  useEffect(() => {
    if (!config.keys) return;
    const key = (e: KeyboardEvent) => { if (live.current && !(o.ignoreKeysIn && (e.target as Element)?.closest?.(o.ignoreKeysIn))) push({ type: 'key', key: e.key }); };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  });

  const start = async ({ url = '', video = false }: { url?: string; video?: boolean }) => {
    if (live.current) return;
    const l: Live = { start: performance.now(), url, events: [], chunks: [], lastMove: 0 };
    if (video && config.screenVideo && navigator.mediaDevices?.getDisplayMedia) {
      try {
        l.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        l.media = new MediaRecorder(l.stream); l.media.ondataavailable = (ev) => ev.data.size && l.chunks.push(ev.data); l.media.start(1000);
      } catch { o.onError?.('Screen capture was not allowed; recording the mouse and keys only.'); }
    }
    l.start = performance.now();
    live.current = l;
    if (config.sameSite) {
      try {
        const doc = o.frame?.current?.contentDocument;
        if (doc) {
          const fr = o.frame!.current!.getBoundingClientRect();
          const mv = (e: MouseEvent) => move(e.clientX + fr.left, e.clientY + fr.top);
          const ck = (e: MouseEvent) => push({ type: 'click', ...rel(e.clientX + fr.left, e.clientY + fr.top), target: describeElement(e.target as Element) });
          const ky = (e: KeyboardEvent) => config.keys && push({ type: 'key', key: e.key });
          doc.addEventListener('mousemove', mv); doc.addEventListener('click', ck, true); doc.addEventListener('keydown', ky, true);
          l.detach = () => { doc.removeEventListener('mousemove', mv); doc.removeEventListener('click', ck, true); doc.removeEventListener('keydown', ky, true); };
        }
      } catch { /* another site: the capture layer hears it */ }
    }
    if (url) push({ type: 'nav', text: url });
    setState({ startedAt: l.start, events: l.events.length });
  };
  const stop = async (): Promise<Recording | null> => {
    const l = live.current; if (!l) return null;
    live.current = null; l.detach?.();
    const duration = (performance.now() - l.start) / 1000;
    let video: Blob | null = null;
    if (l.media) {
      await new Promise<void>((res) => { l.media!.onstop = () => res(); l.media!.stop(); });
      l.stream?.getTracks().forEach((t) => t.stop());
      video = new Blob(l.chunks, { type: l.media.mimeType || 'video/webm' });
    }
    const r: Recording = { id: `rec-${Date.now().toString(36)}`, name: `Recording · ${new Date().toLocaleTimeString()}`, url: l.url, createdAt: new Date().toISOString(), duration, events: l.events };
    setState(null);
    o.onDone?.(r, video);
    return r;
  };
  return {
    recording: state, start, stop, push,
    mark: (text = 'marker') => push({ type: 'mark', x: 0.5, y: 0.5, text }),
    canVideo: config.screenVideo && !!globalThis.navigator?.mediaDevices?.getDisplayMedia,
    layer: {
      onPointerMove: (e) => move(e.clientX, e.clientY),
      onPointerDown: (e) => push({ type: 'down', ...rel(e.clientX, e.clientY) }),
      onPointerUp: (e) => push({ type: 'up', ...rel(e.clientX, e.clientY) }),
      onClick: (e) => push({ type: 'click', ...rel(e.clientX, e.clientY) }),
      onWheel: (e) => push({ type: 'scroll', ...rel(e.clientX, e.clientY), text: String(Math.round(e.deltaY)) }),
    },
  };
}

/** the transparent layer that records every move and click over the stage (capture-layer part) */
export function CaptureLayer({ rec }: { rec: RecorderHandle }) {
  if (!config.captureLayer || !rec.recording) return null;
  return <div className="axf-rec-capture" {...rec.layer} />;
}

/** the replayed cursor, its click ripple and caption; `kind` defaults to the installed cursor */
export function CursorLayer({ frame, kind }: { frame: ReplayFrame | null; kind?: 'arrow' | 'dot' | 'ring' }) {
  if (!frame || !config.replay) return null;
  const k = kind ?? config.replay.cursor;
  return (
    <div className="axf-rec-layer" aria-hidden="true">
      <div className={`axf-rec-cursor axf-rec-cursor--${k}`} style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%` }}>
        {k === 'arrow' && <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 4 19 9 14.5 12.5 22 15.5 20.5 12 13.5 19 13.5z" /></svg>}
      </div>
      {config.replay.ripples && frame.ripple != null && <div className="axf-rec-ripple" style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, transform: `translate(-50%, -50%) scale(${0.4 + frame.ripple * 1.6})`, opacity: 1 - frame.ripple }} />}
      {frame.caption && <div className="axf-rec-caption">{frame.caption}</div>}
    </div>
  );
}

/** play a recording back over the stage it sits in; `onEnd` when it finishes */
export function Replay({ recording, kind, onEnd }: { recording: Recording; kind?: 'arrow' | 'dot' | 'ring'; onEnd?: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = () => { const nt = (performance.now() - t0) / 1000; if (nt > recording.duration) { onEnd?.(); return; } setT(nt); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CursorLayer frame={frameAt(recording.events, t)} kind={kind} />;
}

export const library: AxfWebLibrary = {
  id: RECORDER_LIBRARY_ID,
  label: 'Screen recorder',
  version: '0.1.0',
  provides: ['axf.recorder'],
  register(rt) { configureRecorder((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.recorder); },
};
