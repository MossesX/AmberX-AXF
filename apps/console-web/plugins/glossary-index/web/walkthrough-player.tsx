/**
 * The walkthrough player: plays a saved glossary walkthrough (glossary-walkthrough@1) against the live console with no
 * model. Each step moves the console (its `do` action), highlights its target and is read out loud; every feature has
 * its docs card (headline, points, API, where, related) beside the steps; a "try" step waits for the viewer to tap the
 * highlighted control themselves (or Show me / Next). Features are chapters: jump to any of them.
 *
 * Driven by buttons, arrows / Escape, the console actions walkthrough.play:<id> / walkthrough.next / walkthrough.prev /
 * walkthrough.repeat / walkthrough.stop, and on load by `?axf-walkthrough=<id>` (from this console's store) or
 * `?axf-walkthrough-src=<same-origin path>` (an exported file, for a demo sandbox with no API).
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Icon, SelectField, useRuntime } from '@console/axf/react';
import { EmptyState } from '@console/emptyState';
import { featureStarts, normalizeBundle, playSteps, safeSrc, tryHit, type Bundle, type PlayStep } from '../walkthrough-rules.mjs';
import { DEMO_KEYS, targetSelectors } from './demos-core';
import { clearHighlight, highlight, highlighted, hush, speak } from './player';
import { WT_KEYS, getBundle } from './walkthroughs-core';

export const WT_PLAYER_TAB = 'glossary-index.walkthrough-player';

type TryState = 'none' | 'waiting' | 'done' | 'missing';
interface State { bundle: Bundle | null; steps: PlayStep[]; starts: number[]; at: number; windowId: string | null; error: string; tried: TryState; docs: boolean }
let st: State = { bundle: null, steps: [], starts: [], at: 0, windowId: null, error: '', tried: 'none', docs: true };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useWalkPlayer = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
let runtime: AxfRuntime | null = null;
let advanceTimer: ReturnType<typeof setTimeout> | null = null;

const setting = (key: string, d: boolean) => { const v = runtime?.settings.get(key); return v === undefined || v === null || v === '' ? d : v !== false; };

/* ---------------- try it: a tap on the highlighted control counts ---------------- */

function onDocClick(e: Event) {
  const step = st.steps[st.at];
  if (st.tried !== 'waiting' || !step) return;
  const on = highlighted();
  const hit = (!!on && e.target instanceof Node && on.contains(e.target)) || tryHit(step, e.target, targetSelectors, (el, sel) => !!(el as Element | null)?.closest?.(sel));
  if (!hit) return;
  set({ tried: 'done' });
  speak('Nice, that is it.', () => { if (setting(DEMO_KEYS.auto, true)) schedule(st.at + 1, 900); });
}
let listening = false;
function listenTaps(on: boolean) {
  if (typeof document === 'undefined' || on === listening) return;
  if (on) document.addEventListener('click', onDocClick, true); else document.removeEventListener('click', onDocClick, true);
  listening = on;
}

/* ---------------- playing ---------------- */

function schedule(i: number, ms: number) {
  if (advanceTimer) clearTimeout(advanceTimer);
  const from = st.at;
  advanceTimer = setTimeout(() => { if (st.bundle && st.at === from && i < st.steps.length) show(i); }, ms);
}

export function show(i: number) {
  if (!st.bundle || !runtime || !st.steps.length) return;
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  const at = Math.max(0, Math.min(st.steps.length - 1, i));
  const step = st.steps[at]!;
  const isTry = step.kind === 'try';
  const waits = isTry && setting(WT_KEYS.tryWait, true);
  set({ at, tried: isTry ? 'waiting' : 'none' });
  listenTaps(isTry && !!step.target);
  if (step.do && setting(DEMO_KEYS.run, true)) { try { runtime.dispatch(step.do); } catch { /* an action this app doesn't have: still explain the step */ } }
  setTimeout(() => {
    if (!step.target) { clearHighlight(); return; }
    const el = highlight(step.target, step.highlight || step.title);
    if (el) setTimeout(() => dodge(el), 400);
    else if (isTry && st.at === at) set({ tried: 'missing' });
  }, 350);
  speak(step.say, () => {
    if (waits || !setting(DEMO_KEYS.auto, true) || at >= st.steps.length - 1) return;
    schedule(at + 1, 600 + step.wait);
  });
}

/** Keep the player off the control it highlights: move the floating window to the side (or end) with the most room. */
function dodge(el: Element) {
  if (!runtime || !st.windowId || typeof globalThis.innerWidth !== 'number') return;
  const w = runtime.windows.state.windows.find((x) => x.id === st.windowId) as { x?: number; y?: number; width?: number; height?: number; type?: string } | undefined;
  if (!w || typeof w.x !== 'number' || typeof w.y !== 'number' || !w.width || !w.height) return;
  const r = el.getBoundingClientRect();
  const overlaps = r.left < w.x + w.width && r.right > w.x && r.top < w.y + w.height && r.bottom > w.y;
  if (!overlaps) return;
  const vw = globalThis.innerWidth; const vh = globalThis.innerHeight;
  const gap = Math.round(Math.min(vw, vh) / 50);
  const right = vw - r.right; const left = r.left; const below = vh - r.bottom;
  if (Math.max(right, left) >= w.width + gap * 2) runtime.windows.moveTo(st.windowId, right >= left ? vw - w.width - gap : gap, w.y);
  else if (below >= w.height + gap) runtime.windows.moveTo(st.windowId, w.x, vh - w.height - gap);
  else runtime.windows.moveTo(st.windowId, w.x, gap);
}

function openWindow() {
  if (!runtime) return;
  const wm = runtime.windows;
  if (st.windowId && wm.state.windows.some((w) => w.id === st.windowId)) return;
  // fits a phone: never wider than the screen, a little under half its height
  const vw = typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth : 1280;
  const vh = typeof globalThis.innerHeight === 'number' ? globalThis.innerHeight : 800;
  const width = Math.min(460, Math.round(vw * 0.96)); const height = Math.min(440, Math.round(vh * 0.48));
  const id = wm.openFloating([{ id: `glossary-walkthrough-${Date.now()}`, title: 'Walkthrough', kind: WT_PLAYER_TAB, payload: '', icon: 'play' }], 'Walkthrough', 'floating', width, height, vw < 600 ? Math.round((vw - width) / 2) : undefined, vw < 600 ? Math.round(vh - height - vh * 0.02) : undefined);
  set({ windowId: id });
}

/** Play a walkthrough (glossary-walkthrough@1 or its export file) from step `from`. */
export function playBundle(raw: unknown, from = 0) {
  const src = (raw as { $axf?: string; walkthrough?: unknown })?.$axf === 'glossary-walkthrough-export@1' ? (raw as { walkthrough: unknown }).walkthrough : raw;
  const bundle = normalizeBundle(src);
  const steps = playSteps(bundle);
  if (!steps.length) { set({ error: 'This walkthrough has no steps.' }); openWindow(); return; }
  set({ bundle, steps, starts: featureStarts(bundle), at: 0, error: '', docs: setting(WT_KEYS.docsOpen, true) });
  openWindow();
  show(from);
}

/** Play a saved walkthrough by id (from this console's store). */
export async function playWalkthroughId(id: string, from = 0) {
  try { playBundle(await getBundle(id), from); } catch (e) { set({ error: (e as Error).message, bundle: null }); openWindow(); }
}

export function stopWalkthrough() {
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  hush(); clearHighlight(); listenTaps(false); set({ bundle: null, steps: [], at: 0, tried: 'none' });
}

export function registerWalkthroughPlayer(rt: AxfRuntime) {
  runtime = rt;
  rt.actions.register('walkthrough.play', ([id, step]) => { if (id) void playWalkthroughId(decodeURIComponent(id), Number(step) || 0); else if (st.bundle) show(0); else rt.navigate('walkthrough-generator'); }, { label: 'Play a glossary walkthrough', params: true });
  rt.actions.register('walkthrough.next', () => show(st.at + 1), { label: 'Walkthrough: next step', searchable: false });
  rt.actions.register('walkthrough.prev', () => show(st.at - 1), { label: 'Walkthrough: previous step', searchable: false });
  rt.actions.register('walkthrough.repeat', () => show(st.at), { label: 'Walkthrough: say it again', searchable: false });
  rt.actions.register('walkthrough.stop', () => stopWalkthrough(), { label: 'Walkthrough: stop', searchable: false });
  // the demo sandbox opens the console with ?axf-walkthrough=<id> (or ?axf-walkthrough-src=<file.json>) and it plays at once
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    const id = q.get('axf-walkthrough'); const src = safeSrc(q.get('axf-walkthrough-src') ?? ''); const from = Number(q.get('axf-walkthrough-step')) || 0;
    if (id && /^[a-z0-9][a-z0-9-]{1,47}$/.test(id)) setTimeout(() => void playWalkthroughId(id, from), 600);
    else if (src) setTimeout(() => { fetch(src).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${src}: ${r.status}`)))).then((j) => playBundle(j, from), (e: Error) => { set({ error: e.message }); openWindow(); }); }, 600);
  } catch { /* no window */ }
}

/* ---------------- the window ---------------- */

export function WalkthroughPlayerWindow() {
  const g = useWalkPlayer();
  const rt = useRuntime();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!st.bundle || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') show(st.at + 1);
      if (e.key === 'ArrowLeft') show(st.at - 1);
      if (e.key === 'Escape') stopWalkthrough();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);
  useEffect(() => () => { stopWalkthrough(); set({ windowId: null }); }, []);
  if (!g.bundle) {
    return (
      <div className="fx-stack axp-glossary-index__player" data-axp-player>
        <EmptyState compact icon="play">{g.error || 'Nothing is playing. Pick a walkthrough in the Walkthrough Generator, or generate one from glossary entries.'}</EmptyState>
        <div className="fx-row"><Button size="sm" icon="list" onClick={() => rt.navigate('walkthrough-generator')}>Walkthrough Generator</Button></div>
      </div>
    );
  }
  const step = g.steps[g.at]!;
  const feature = step.feature >= 0 ? g.bundle.features[step.feature] : null;
  const first = g.at === 0; const last = g.at === g.steps.length - 1;
  const chapters = [{ value: '-1', label: 'Introduction' }, ...g.bundle.features.map((f, i) => ({ value: String(i), label: `${i + 1}. ${f.term}` }))];
  const docs = feature?.docs;
  return (
    <div className="fx-stack axp-glossary-index__player axp-glossary-index__wt-player" aria-live="polite" data-axp-player>
      <p className="fx-eyebrow">{g.bundle.name} · v{g.bundle.version} · Step {g.at + 1} of {g.steps.length}</p>
      <SelectField label="Part" value={String(step.feature)} options={chapters} onChange={(v) => { const n = Number(v); show(n < 0 ? 0 : g.starts[n] ?? 0); }} />
      {feature && <p className="fx-muted axp-glossary-index__player-meta">Part {step.feature + 1} of {g.bundle.features.length} · {step.part + 1}/{step.parts}</p>}
      {step.title && <h3 className="axp-glossary-index__player-title">{step.title}</h3>}
      <p className="axp-glossary-index__player-say">{step.say}</p>
      {step.kind === 'try' && (
        <p className="axp-glossary-index__wt-try" data-state={g.tried} role="status">
          <Icon name={g.tried === 'done' ? 'check' : 'zap'} size={14} />{' '}
          {g.tried === 'done' ? 'You did it.' : g.tried === 'missing' ? `${step.highlight || 'It'} is not on this screen right now: tap Show me, or try it your way and tap Next.` : step.target ? `Your turn: tap ${step.highlight || 'the highlighted control'}.` : 'Your turn: try it, then tap Next.'}
        </p>
      )}
      <div className="axp-glossary-index__player-bar" role="toolbar" aria-label="Walkthrough player">
        <Button size="sm" icon="arrow-left" disabled={first} onClick={() => show(g.at - 1)}>Back</Button>
        <Button size="sm" icon="refresh" onClick={() => show(g.at)}>{step.kind === 'try' ? 'Show me' : 'Repeat'}</Button>
        <Button size="sm" tone="primary" icon="arrow-right" disabled={last} onClick={() => show(g.at + 1)}>Next</Button>
        <Button size="sm" icon={g.docs ? 'minus' : 'file'} onClick={() => set({ docs: !g.docs })}>{g.docs ? 'Hide docs' : 'Docs'}</Button>
        <Button size="sm" icon="x" onClick={stopWalkthrough}>Stop</Button>
      </div>
      {g.docs && docs && feature && (
        <section className="axp-glossary-index__wt-docs" aria-label={`About ${feature.term}`}>
          <p className="fx-eyebrow">{feature.kind} · {feature.category}</p>
          <h4 className="axp-glossary-index__player-title">{feature.term}</h4>
          {docs.headline && <p className="axp-glossary-index__summary">{docs.headline}</p>}
          {docs.summary && docs.summary !== docs.headline && <p className="fx-muted">{docs.summary}</p>}
          {!!docs.points.length && <ul className="axp-glossary-index__wt-points">{docs.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {!!docs.api.length && <p className="fx-mono fx-muted axp-glossary-index__player-meta">{docs.api.map((a) => `${a.kind.toUpperCase()} ${a.name}`).join(' · ')}</p>}
          {!!docs.where.length && <p className="fx-muted axp-glossary-index__player-meta">Appears in {docs.where.join(', ')}</p>}
          {!!docs.related.length && <p className="fx-muted axp-glossary-index__player-meta">Related: {docs.related.map((r) => r.term).join(', ')}</p>}
        </section>
      )}
      {g.error && <p className="fx-muted axp-glossary-index__player-meta"><Icon name="info" size={12} /> {g.error}</p>}
    </div>
  );
}
