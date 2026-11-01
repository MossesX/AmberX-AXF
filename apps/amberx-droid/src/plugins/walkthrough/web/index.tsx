/**
 * Walkthrough — the narrated AmberX walkthrough video (Nov 1 2026), the same kind of player as the demo.amberxai.com
 * walkthrough: the video with captions, the chapter now playing, Previous / Next chapter, a chapter bar you can tap,
 * playback speed presets and the chapter index (each chapter's scenes listed under it, every one a jump).
 *
 * Opens from the Home page's Walkthrough card, the AmberX menu and Help (`walkthrough.open`), or straight at one chapter
 * (`walkthrough.open:<chapterId>`, e.g. for a Help tooltip's "Watch how"). The video, captions and chapter index are
 * served by the AmberX server behind the hub's wall (`/api/walkthrough/*`); `walkthrough/rebuild.sh` records them.
 * Controls are the framework's; the look comes from theme tokens only (walkthrough.css).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, Segmented, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import type { AxfRuntime } from '../../../axf/core';
import { SPEEDS, WALKTHROUGH_BASE, chapterAt, clock, nextStart, parseIndex, previousStart, speedOf, type WalkthroughIndex } from './core';
import './walkthrough.css';

export const WALKTHROUGH_ID = 'ai.amberx.amberx.walkthrough';
const VIEW = 'walkthrough';
const K = { speed: 'amberx.walkthrough.speed' } as const;

/** A chapter asked for before the page was open (walkthrough.open:<id>); the page seeks there once it has the index. */
let pending: string | null = null;
const listeners = new Set<() => void>();
export function openWalkthrough(rt: AxfRuntime, chapter?: string) {
  pending = chapter || null;
  rt.navigate(VIEW);
  listeners.forEach((f) => f());
}

type Load = { phase: 'loading' } | { phase: 'ready'; index: WalkthroughIndex } | { phase: 'missing' } | { phase: 'error'; message: string };

function useIndex(): Load {
  const [s, set] = useState<Load>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(`${WALKTHROUGH_BASE}chapters.json`, { credentials: 'include', cache: 'no-cache' })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 404) return set({ phase: 'missing' });
        if (!r.ok) return set({ phase: 'error', message: r.status === 401 ? 'Sign in to axHub to watch it.' : `The server answered ${r.status}.` });
        const index = parseIndex(await r.json().catch(() => null));
        set(index ? { phase: 'ready', index } : { phase: 'error', message: 'The chapter list could not be read.' });
      })
      .catch(() => live && set({ phase: 'error', message: "Can't reach the AmberX server." }));
    return () => { live = false; };
  }, []);
  return s;
}

function Player({ index }: { index: WalkthroughIndex }) {
  const rt = useRuntime();
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(() => speedOf(rt.settings.get(K.speed)));
  const [open, setOpen] = useState<string | null>(null);
  const at = chapterAt(index, t);
  const ch = index.chapters[Math.max(0, at)]!;
  const seg = useMemo(() => [...ch.segments].reverse().find((s) => s.start <= t + 0.25), [ch, t]);

  const seek = (to: number, play = true) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = to;
    setT(to);
    if (play) void v.play().catch(() => undefined);
  };
  // walkthrough.open:<chapter> — now, and whenever it's asked again while the page is open
  useEffect(() => {
    const go = () => {
      if (!pending) return;
      const c = index.chapters.find((x) => x.id === pending);
      pending = null;
      if (c) { seek(c.start, false); setOpen(c.id); }
    };
    go();
    listeners.add(go);
    return () => { listeners.delete(go); };
  }, [index]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed]);
  useEffect(() => { setOpen((o) => o ?? ch.id); }, [ch.id]);

  return (
    <div className="axp-walkthrough__player">
      <div className="axp-walkthrough__stage">
        <video ref={video} className="axp-walkthrough__video" controls playsInline preload="metadata" controlsList="nodownload"
          poster={WALKTHROUGH_BASE + index.poster} src={WALKTHROUGH_BASE + index.video}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { e.currentTarget.playbackRate = speed; }}>
          <track kind="captions" srcLang="en" label="English" src={WALKTHROUGH_BASE + index.captions} default />
        </video>
      </div>
      <div className="fx-stack axp-walkthrough__side">
        <div className="axp-walkthrough__now" aria-live="polite">
          <Chip tone="accent">{at < 0 ? 'Ready' : `Chapter ${at + 1} of ${index.chapters.length}`}</Chip>
          <strong>{ch.title}</strong>
          {seg && <span className="fx-muted">{seg.title}</span>}
        </div>
        <div className="axp-walkthrough__bar" role="group" aria-label="Chapters on the timeline">
          <span className="axp-walkthrough__fill" style={{ width: `${Math.min(100, (t / Math.max(1, index.duration)) * 100)}%` }} />
          {index.chapters.map((c, i) => (
            <button key={c.id} type="button" data-fx-row className={`axp-walkthrough__tick${i === at ? ' is-on' : ''}`} title={`${clock(c.start)} ${c.title}`}
              aria-label={`Chapter ${i + 1}: ${c.title}`} style={{ left: `${(c.start / Math.max(1, index.duration)) * 100}%` }} onClick={() => seek(c.start)} />
          ))}
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="chevron-left" onClick={() => seek(previousStart(index, t))}>Previous</Button>
          <Button icon="chevron-right" disabled={nextStart(index, t) === null} onClick={() => { const n = nextStart(index, t); if (n !== null) seek(n); }}>Next chapter</Button>
          <span className="fx-muted axp-walkthrough__time">{clock(t)} / {clock(index.duration)}</span>
        </div>
        <Segmented size="sm" label="Playback speed" value={String(speed)} onChange={(v) => { const s = speedOf(v); setSpeed(s); rt.settings.set(K.speed, s); }}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} />
        <nav className="axp-walkthrough__index" aria-label="Chapters">
          {index.chapters.map((c, i) => (
            <div key={c.id} className={`axp-walkthrough__chapter${i === at ? ' is-on' : ''}`}>
              <div className="fx-row axp-walkthrough__chapterhead">
                <button type="button" data-fx-row className="axp-walkthrough__jump" onClick={() => seek(c.start)}>
                  <span className="fx-muted axp-walkthrough__stamp">{clock(c.start)}</span>
                  <span>{i + 1}. {c.title}</span>
                </button>
                {c.segments.length > 1 && (
                  <Button tone="quiet" size="sm" icon={open === c.id ? 'chevron-up' : 'chevron-down'} aria-expanded={open === c.id}
                    aria-label={`${open === c.id ? 'Hide' : 'Show'} what's in ${c.title}`} onClick={() => setOpen(open === c.id ? null : c.id)} />
                )}
              </div>
              {open === c.id && (
                <ol className="axp-walkthrough__segments">
                  {c.segments.map((s) => (
                    <li key={s.start}><button type="button" data-fx-row className="axp-walkthrough__jump" onClick={() => seek(s.start)}>
                      <span className="fx-muted axp-walkthrough__stamp">{clock(s.start)}</span><span>{s.title}</span>
                    </button></li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function WalkthroughPage() {
  const s = useIndex();
  return (
    <div className="fx-stack fx-stack--lg axp-walkthrough">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Help · Walkthrough</p>
          <h1>AmberX walkthrough</h1>
          <p className="fx-muted">
            Amber shows you every part of the app, narrated, with captions. Skip to any chapter
            {s.phase === 'ready' ? ` (${s.index.chapters.length} chapters, ${clock(s.index.duration)})` : ''}.
          </p>
        </div>
      </header>
      {s.phase === 'loading' && <div className="axp-walkthrough__skeleton" aria-busy="true" aria-label="Loading the walkthrough" />}
      {s.phase === 'missing' && <p className="fx-muted">The walkthrough hasn't been recorded on this server yet. An admin records it with <code>bash apps/amberx-droid/walkthrough/rebuild.sh</code> (or the Dev Console's Re-record button).</p>}
      {s.phase === 'error' && <p className="fx-muted" role="alert">{s.message}</p>}
      {s.phase === 'ready' && <Player index={s.index} />}
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: WALKTHROUGH_ID,
  label: 'Walkthrough',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-01' },
  views: { [VIEW]: { title: 'Walkthrough', icon: 'play', keywords: ['walkthrough', 'video', 'tour', 'help', 'how to'], render: () => <WalkthroughPage /> } },
  nav: { label: 'Help', items: [{ id: VIEW, label: 'Walkthrough', icon: 'play', view: VIEW }] },
  appMenu: [
    { id: 'amberx.walkthrough', menu: 'axhub', items: [{ id: 'walkthrough.open', label: 'Walkthrough', icon: 'play', action: 'walkthrough.open' }] },
    { id: 'amberx.walkthrough.help', menu: 'help', items: [{ id: 'walkthrough.help', label: 'Watch the walkthrough', icon: 'play', action: 'walkthrough.open' }] },
  ],
  register(rt) {
    // walkthrough.open — the player; walkthrough.open:<chapterId> — straight at one chapter
    rt.actions.register('walkthrough.open', ([chapter]) => openWalkthrough(rt, chapter), { label: 'Watch the walkthrough', params: true });
  },
};
