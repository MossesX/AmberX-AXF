/**
 * Live caption bar (slot `app.frame.cover`, mounted once): while a demo run plays it floats just above the thing to
 * watch (the act's focus selector; docked at the top when that isn't on screen) and shows what is about to happen, the
 * act number (n/N), the state, a countdown to the next act, and Next / Pause / Skip / Stop on a toolbar. When the run
 * ends it opens the summary once. Nothing is drawn while no run is live.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, useRuntime } from '@console/axf/react';
import { DIALOG_SUMMARY, TERMINAL, act, demo, isLive, useDemoState, type Caption } from './api';
import './orchestrator-demo.css';

const STATE_TEXT: Record<string, string> = {
  overlay: 'Ready to start',
  focusing: 'Bringing you to it',
  captioned: 'About to happen',
  running: 'Running now',
  'waiting-next': 'Done: press Next when you have seen it',
  cooldown: 'Next act in',
};

/** Where the bar goes: just above the focused element when it is on screen, else docked (null). */
function placeFor(selector: string, bar: HTMLElement | null): { top: number; left: number } | null {
  if (!selector) return null;
  let el: Element | null = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el || !bar) return null;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || r.width === 0) return null;
  const b = bar.getBoundingClientRect();
  const gap = 8;
  const top = r.top - b.height - gap >= gap ? r.top - b.height - gap : Math.min(innerHeight - b.height - gap, r.bottom + gap);
  const left = Math.max(gap, Math.min(innerWidth - b.width - gap, r.left));
  return { top, left };
}

export function CaptionBar() {
  const rt = useRuntime();
  const { state, error, setState } = useDemoState(1000, 5000);
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const cap: Caption | null = state?.caption ?? null;
  const run = state?.run ?? null;
  const live = isLive(state) && run?.state !== 'overlay';

  // bring the focused element into view when a new act takes the stage
  useEffect(() => {
    if (!cap?.focus.selector) return;
    try { document.querySelector(cap.focus.selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* a selector the page can't read */ }
  }, [cap?.actId, cap?.focus.selector]);

  // follow the target on every poll, scroll and resize
  useLayoutEffect(() => {
    if (!live) return;
    const upd = () => setPlace(placeFor(cap?.focus.selector ?? '', bar.current));
    upd();
    addEventListener('scroll', upd, true); addEventListener('resize', upd);
    return () => { removeEventListener('scroll', upd, true); removeEventListener('resize', upd); };
  }, [live, cap?.focus.selector, state]);

  // the run just ended: show the summary once
  const seenEnd = useRef('');
  useEffect(() => {
    if (run && TERMINAL.includes(run.state) && seenEnd.current !== run.id) {
      if (seenEnd.current !== '' || run.state === 'done') rt.openDialog(DIALOG_SUMMARY);
      seenEnd.current = run.id;
    } else if (run && !TERMINAL.includes(run.state)) seenEnd.current = 'live';
  }, [run, rt]);

  if (!live || !run) return null;
  const allowed = new Set(state?.allowed ?? []);
  const go = async (fn: () => Promise<{ state?: typeof state }>) => { setBusy(true); setMsg(await act(fn, setState)); setBusy(false); };
  const secs = cap && cap.state === 'cooldown' ? Math.ceil(cap.countdownMs / 1000) : null;
  const held = !!state?.held;

  return (
    <div
      ref={bar}
      className={`axp-orchestrator-demo__caption${place ? ' is-anchored' : ''}${held ? ' is-held' : ''}`}
      style={place ? { top: place.top, left: place.left } : undefined}
      role="region"
      aria-label="Orchestrator demo caption"
      aria-live="polite"
      data-axf-target="view:orchestrator-demo/caption"
    >
      <div className="axp-orchestrator-demo__caption-head">
        <span className="axp-orchestrator-demo__count">{cap ? `${cap.n}/${cap.of}` : '–'}</span>
        <span className="axp-orchestrator-demo__caption-title">{cap?.title ?? run.title}</span>
        <span className="axp-orchestrator-demo__state">{held ? 'Paused' : `${STATE_TEXT[cap?.state ?? run.state] ?? run.state}${secs !== null ? ` ${secs} s` : ''}`}</span>
      </div>
      {cap?.text && <p className="axp-orchestrator-demo__caption-text">{cap.text}</p>}
      {(msg || error) && <p className="axp-orchestrator-demo__error" role="alert">{msg || error}</p>}
      <div className="axp-orchestrator-demo__toolbar is-compact" role="toolbar" aria-label="Orchestrator demo controls">
        <Button size="sm" tone="primary" icon="chevron-right" disabled={busy || !allowed.has('next')} onClick={() => void go(demo.next)}>Next</Button>
        {held
          ? <Button size="sm" icon="play" disabled={busy} onClick={() => void go(demo.resume)}>Resume</Button>
          : <Button size="sm" icon="pause" disabled={busy} onClick={() => void go(demo.pause)}>Pause</Button>}
        <Button size="sm" icon="arrow-right" disabled={busy || !allowed.has('skip')} onClick={() => void go(demo.skip)}>Skip</Button>
        <span className="axp-orchestrator-demo__spacer" />
        <Button size="sm" tone="danger" icon="x-circle" disabled={busy} onClick={() => void go(demo.stop)}>Stop</Button>
      </div>
    </div>
  );
}
