/**
 * The demonstration player: a floating window that plays any walkthrough@1 (a demonstration, a whole book, a clip's
 * transcript) against the live UI: each step moves the console (its `do` action), highlights its target, is read out
 * loud, and advances by itself when the voice finishes (setting). Next / Previous / Repeat / Stop by button, keyboard
 * (arrows, Escape), the console actions demo.next / demo.prev / demo.repeat / demo.stop (voice through AmberX), or the
 * browser's own speech recognition when Voice control is on ("next", "back", "repeat", "stop").
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime, Walkthrough } from '@console/axf/core';
import { Button, Icon, Switch, useRuntime } from '@console/axf/react';
import { EmptyState } from '@console/emptyState';
import { DEMO_KEYS, type DemoType, targetSelectors, voiceMove, walkthroughOf } from './demos-core';

export const PLAYER_TAB = 'glossary-index.player';
const HIGHLIGHT = 'axp-glossary-index-target';

interface State { walk: Walkthrough | null; at: number; windowId: string | null; listening: boolean; error: string; speaking: boolean }
let st: State = { walk: null, at: 0, windowId: null, listening: false, error: '', speaking: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const usePlayer = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
let runtime: AxfRuntime | null = null;
let last: Walkthrough | null = null;

/* ---------------- speaking, highlighting, listening ---------------- */

function speak(text: string, onEnd?: () => void) {
  if (!runtime || runtime.settings.get(DEMO_KEYS.speak) === false || !text) { onEnd?.(); return; }
  try {
    const s = globalThis.speechSynthesis;
    if (!s) { onEnd?.(); return; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => { set({ speaking: false }); onEnd?.(); };
    u.onerror = () => set({ speaking: false });
    set({ speaking: true });
    s.speak(u);
  } catch { set({ speaking: false }); onEnd?.(); }
}
const hush = () => { try { globalThis.speechSynthesis?.cancel(); } catch { /* fine */ } set({ speaking: false }); };

function clearHighlight() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`.${HIGHLIGHT}`).forEach((el) => { el.classList.remove(HIGHLIGHT); el.removeAttribute('data-axp-highlight'); });
}
function highlight(target: string, label = '') {
  clearHighlight();
  if (typeof document === 'undefined' || !target) return;
  for (const sel of targetSelectors(target)) {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { continue; }
    if (el) { el.classList.add(HIGHLIGHT); if (label) el.setAttribute('data-axp-highlight', label); el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return; }
  }
}

type Recognizer = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
let recognizer: Recognizer | null = null;
const recognizerCtor = (): (new () => Recognizer) | null => {
  const g = globalThis as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
};
export const canListen = () => !!recognizerCtor();

function listen(on: boolean) {
  if (!on) { try { recognizer?.stop(); } catch { /* fine */ } recognizer = null; set({ listening: false }); return; }
  const Ctor = recognizerCtor();
  if (!Ctor) { set({ error: 'This browser has no speech recognition; use the buttons or say it to AmberX.' }); return; }
  try {
    const r = new Ctor();
    r.continuous = true; r.interimResults = false; r.lang = 'en-US';
    r.onresult = (e) => { const res = e.results[e.resultIndex]; const heard = res?.[0]?.transcript ?? ''; const m = voiceMove(heard); if (m === 'next') show(st.at + 1); else if (m === 'prev') show(st.at - 1); else if (m === 'repeat') show(st.at); else if (m === 'close') stop(); };
    r.onend = () => { if (st.listening && recognizer === r) { try { r.start(); } catch { set({ listening: false }); } } };
    r.onerror = () => set({ listening: false });
    recognizer = r; r.start(); set({ listening: true, error: '' });
  } catch { set({ listening: false, error: 'Speech recognition would not start (microphone permission?).' }); }
}

/* ---------------- playing ---------------- */

function show(i: number) {
  if (!st.walk || !runtime) return;
  const at = Math.max(0, Math.min(st.walk.steps.length - 1, i));
  const step = st.walk.steps[at]!;
  set({ at });
  if (step.do && runtime.settings.get(DEMO_KEYS.run) !== false) { try { runtime.dispatch(step.do); } catch { /* an action that isn't here: still explain the step */ } }
  setTimeout(() => highlight(step.target, (step as { highlight?: string }).highlight ?? ''), 350);
  speak(step.say, () => { if (runtime?.settings.get(DEMO_KEYS.auto) !== false && st.walk && at < st.walk.steps.length - 1) setTimeout(() => { if (st.walk && st.at === at) show(at + 1); }, 600); });
}

function openWindow() {
  if (!runtime) return;
  const wm = runtime.windows;
  if (st.windowId && wm.state.windows.some((w) => w.id === st.windowId)) return;
  const id = wm.openFloating([{ id: `glossary-demo-${Date.now()}`, title: 'Demonstration', kind: PLAYER_TAB, payload: '', icon: 'play' }], 'Demonstration', 'floating', 400, 320);
  set({ windowId: id });
}

/** Play a walkthrough@1 in the floating player. */
export function playWalkthrough(w: Walkthrough) {
  last = w;
  set({ walk: w, at: 0, error: '' });
  openWindow();
  if (runtime?.settings.get(DEMO_KEYS.voice) === true && !st.listening) listen(true);
  show(0);
}
/** Play a stored demonstration, book or clip by id. */
export async function playAsset(type: DemoType, id: string) {
  try { playWalkthrough(await walkthroughOf(type, id)); } catch (e) { set({ error: (e as Error).message }); openWindow(); }
}
/** Play a single step (the designer's "play this step"). */
export function playStep(w: Walkthrough, i: number) { last = w; set({ walk: w, error: '' }); openWindow(); show(i); }
export function stop() { hush(); clearHighlight(); listen(false); set({ walk: null, at: 0 }); }

export function registerPlayer(rt: AxfRuntime) {
  runtime = rt;
  rt.actions.register('demo.play', ([type, id]) => { if (type && id) void playAsset(type as DemoType, id); else if (last) playWalkthrough(last); else openWindow(); }, { label: 'Play a demonstration, clip or book (demo.play:<type>:<id>)', params: true, effect: 'navigate' });
  rt.actions.register('demo.replay', () => { if (last) playWalkthrough(last); else openWindow(); }, { label: 'Replay the last demonstration' });
  rt.actions.register('demo.next', () => show(st.at + 1), { label: 'Demonstration: next step', searchable: false });
  rt.actions.register('demo.prev', () => show(st.at - 1), { label: 'Demonstration: previous step', searchable: false });
  rt.actions.register('demo.repeat', () => show(st.at), { label: 'Demonstration: say it again', searchable: false });
  rt.actions.register('demo.stop', () => stop(), { label: 'Demonstration: stop', searchable: false });
  rt.actions.register('demo.listen', ([on]) => listen(on !== 'off' && on !== 'false'), { label: 'Demonstration: voice control on or off (demo.listen:on|off)', params: true, searchable: false });
}

/* ---------------- the window ---------------- */

export function PlayerWindow() {
  const g = usePlayer();
  const rt = useRuntime();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!st.walk || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') show(st.at + 1);
      if (e.key === 'ArrowLeft') show(st.at - 1);
      if (e.key === 'Escape') stop();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);
  useEffect(() => () => { hush(); clearHighlight(); listen(false); set({ windowId: null }); }, []);
  if (!g.walk) {
    return (
      <div className="fx-stack axp-glossary-index__player">
        <EmptyState compact icon="play">{g.error || 'Nothing is playing. Pick a demonstration in the Demonstration Designer, or Generate one from any glossary entry.'}</EmptyState>
        <div className="fx-row">
          <Button size="sm" icon="list" onClick={() => rt.navigate('demo-designer')}>Demonstration Designer</Button>
          {last && <Button size="sm" icon="play" onClick={() => playWalkthrough(last!)}>Replay</Button>}
        </div>
      </div>
    );
  }
  const step = g.walk.steps[g.at]!;
  const first = g.at === 0; const lastStep = g.at === g.walk.steps.length - 1;
  return (
    <div className="fx-stack axp-glossary-index__player" aria-live="polite">
      <p className="fx-eyebrow">{g.walk.title} · Step {g.at + 1} of {g.walk.steps.length}{g.speaking ? ' · speaking' : ''}</p>
      {(step as { title?: string }).title && <h3 className="axp-glossary-index__player-title">{(step as { title?: string }).title}</h3>}
      <p className="axp-glossary-index__player-say">{step.say}</p>
      {(step.do || step.target) && <p className="fx-muted fx-mono axp-glossary-index__player-meta">{[step.do && `do ${step.do}`, step.target && `target ${step.target}`].filter(Boolean).join(' · ')}</p>}
      <div className="axp-glossary-index__player-bar" role="toolbar" aria-label="Demonstration player">
        <Button size="sm" icon="arrow-left" disabled={first} onClick={() => show(g.at - 1)}>Back</Button>
        <Button size="sm" icon="refresh" onClick={() => show(g.at)}>Repeat</Button>
        <Button size="sm" tone="primary" icon="arrow-right" disabled={lastStep} onClick={() => show(g.at + 1)}>Next</Button>
        <Button size="sm" icon="x" onClick={stop}>Stop</Button>
      </div>
      <div className="fx-row fx-row--wrap">
        <Switch label="Voice control" checked={g.listening} onChange={(v) => listen(v)} hint={canListen() ? 'Say next, back, repeat or stop' : 'No speech recognition in this browser'} />
        {g.error && <span className="fx-muted axp-glossary-index__player-meta"><Icon name="info" size={12} /> {g.error}</span>}
      </div>
    </div>
  );
}
