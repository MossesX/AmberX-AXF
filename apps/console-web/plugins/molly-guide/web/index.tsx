/**
 * Molly guide console plugin (ai.amberx.axf.console.molly-guide), Oct 28 2026.
 *
 * Brett: "if you ask how to set this option to that it will open up a floating window in the console and display the
 * walkthrough … a small overlay with next previous buttons that are narrated while she shows you step by step".
 *
 * - Ask: Help → "Ask Molly to show me…" (or `molly.ask`) opens the window with a question box; the question goes to
 *   this plugin's server (POST /api/plugins/molly-guide/ask), which hands it to Molly through axf.agents@1. Her answer
 *   is spoken; when it holds a walkthrough@1, the window plays it.
 * - From AmberX: AmberX's server asks Molly through the same route, so the walkthrough is kept here; this plugin polls
 *   GET …/walkthroughs?after=<seq> every few seconds while the console is visible and opens new ones by itself.
 * - Each step: runs its `do` (a console action spec), highlights its `target` (outline from theme tokens), and reads its
 *   `say` aloud (speech synthesis, switchable). Next / Previous / Repeat / Close, and the arrow keys.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, IconButton, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { cleanWalkthrough, stepAt, targetSelector, type Walkthrough } from './walkthrough';
import './molly-guide.css';

const ID = 'ai.amberx.axf.console.molly-guide';
const FOLDER = 'molly-guide';
const KIND = 'molly.walkthrough';
const POLL_MS = 4000;
const K = { speak: 'molly-guide.speak', auto: 'molly-guide.autoOpen', run: 'molly-guide.runSteps' } as const;
const HIGHLIGHT = 'axp-molly-guide-target';

interface State { walk: Walkthrough | null; at: number; asking: boolean; answer: string; error: string; lastSeq: number; windowId: string | null }
let st: State = { walk: null, at: 0, asking: false, answer: '', error: '', lastSeq: -1, windowId: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useGuide = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
let runtime: AxfRuntime | null = null;

/* ---------------------------------------------------------------- speaking + highlighting */

function speak(text: string) {
  if (!runtime || runtime.settings.get(K.speak) === false || !text) return;
  try {
    const s = globalThis.speechSynthesis;
    if (!s) return;
    s.cancel();
    s.speak(new SpeechSynthesisUtterance(text));
  } catch { /* no voice here */ }
}
const hush = () => { try { globalThis.speechSynthesis?.cancel(); } catch { /* fine */ } };

function clearHighlight() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`.${HIGHLIGHT}`).forEach((el) => el.classList.remove(HIGHLIGHT));
}
function highlight(target: string) {
  clearHighlight();
  if (typeof document === 'undefined' || !target) return;
  for (const sel of targetSelector(target)) {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { continue; }
    if (el) { el.classList.add(HIGHLIGHT); el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); return; }
  }
}

function show(i: number) {
  if (!st.walk || !runtime) return;
  const s = stepAt(st.walk, i);
  set({ at: s.at });
  if (s.step.do && runtime.settings.get(K.run) !== false) {
    try { runtime.dispatch(s.step.do); } catch { /* an action that isn't here: still explain the step */ }
  }
  // let the page render before looking for what to highlight
  setTimeout(() => highlight(s.step.target), 350);
  speak(s.step.say);
}

/* ---------------------------------------------------------------- the window */

function openWindow() {
  if (!runtime) return;
  const wm = runtime.windows;
  if (st.windowId && wm.state.windows.some((w) => w.id === st.windowId)) return;
  const id = wm.openFloating([{ id: `molly-${Date.now()}`, title: 'Molly', kind: KIND, payload: '', icon: 'sparkles' }], 'Molly', 'floating', 380, 300);
  set({ windowId: id });
}

export function play(w: Walkthrough) {
  set({ walk: w, at: 0, answer: '', error: '', lastSeq: Math.max(st.lastSeq, w.seq ?? st.lastSeq) });
  openWindow();
  show(0);
}

function close() {
  hush(); clearHighlight();
  set({ walk: null, at: 0 });
}

export async function askMolly(question: string) {
  const q = question.trim();
  if (!q) return;
  set({ asking: true, error: '', answer: '' });
  let r: { text?: unknown; walkthrough?: unknown; detail?: unknown } = {};
  let ok = false;
  try {
    const res = await pluginFetch(FOLDER, 'ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: q, app: 'console', page: runtime?.getState().view ?? '' }) });
    r = (await res.json().catch(() => ({}))) as typeof r;
    ok = res.ok;
  } catch (e) { r = { detail: (e as Error).message }; }
  set({ asking: false });
  if (!ok) { set({ error: typeof r.detail === 'string' ? r.detail : 'Molly didn\'t answer.' }); return; }
  const text = typeof r.text === 'string' ? r.text : '';
  const w = cleanWalkthrough(r.walkthrough);
  if (w) play(w);
  else { set({ answer: text }); speak(text); }
}

function GuideWindow() {
  const g = useGuide();
  const rt = useRuntime();
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!st.walk || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowRight') show(st.at + 1);
      if (e.key === 'ArrowLeft') show(st.at - 1);
      if (e.key === 'Escape') close();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);
  useEffect(() => () => { hush(); clearHighlight(); set({ windowId: null }); }, []);
  if (g.walk) {
    const s = stepAt(g.walk, g.at);
    return (
      <div className="fx-stack axp-molly-guide">
        <div className="fx-row axp-molly-guide__head">
          <span className="fx-eyebrow">{s.label}</span>
          <strong className="axp-molly-guide__title">{g.walk.title}</strong>
          <IconButton icon="x" label="Close the walkthrough" onClick={close} />
        </div>
        <p className="axp-molly-guide__say" aria-live="polite">{s.step.say}</p>
        <div className="axp-molly-guide__dots" aria-hidden="true">
          {g.walk.steps.map((_, i) => <span key={i} className={`axp-molly-guide__dot${i === s.at ? ' is-on' : i < s.at ? ' is-done' : ''}`} />)}
        </div>
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone="quiet" icon="chevron-left" disabled={s.first} onClick={() => show(s.at - 1)}>Previous</Button>
          <Button size="sm" tone="quiet" icon="volume" onClick={() => speak(s.step.say)}>Repeat</Button>
          {s.last
            ? <Button size="sm" tone="primary" icon="check" onClick={close}>Done</Button>
            : <Button size="sm" tone="primary" icon="chevron-right" onClick={() => show(s.at + 1)}>Next</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className="fx-stack axp-molly-guide">
      <p className="fx-muted">Ask Molly how to do something in the console: she'll show you, step by step.</p>
      <TextField label="What do you want to do?" value={q} onChange={setQ} placeholder="How do I switch the colour theme?" autoFocus />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="sparkles" disabled={g.asking || !q.trim()} onClick={() => void askMolly(q)}>{g.asking ? 'Molly is looking…' : 'Show me'}</Button>
        {rt.settings.get(K.speak) !== false && <Button tone="quiet" icon="volume-x" onClick={hush}>Stop talking</Button>}
      </div>
      {g.answer && <Note tone="info">{g.answer}</Note>}
      {g.error && <Note tone="warning">{g.error}</Note>}
    </div>
  );
}

/* ---------------------------------------------------------------- walkthroughs from AmberX */

let timer: ReturnType<typeof setTimeout> | null = null;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

async function poll() {
  if (!runtime || !visible()) return;
  try {
    const r = await pluginFetch(FOLDER, `walkthroughs?after=${Math.max(0, st.lastSeq)}`);
    if (!r.ok) return;
    const j = (await r.json()) as { walkthroughs?: unknown[] };
    const list = (j.walkthroughs ?? []).map(cleanWalkthrough).filter((w): w is Walkthrough => !!w);
    const newest = list.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
    if (!newest) return;
    // the first read only learns where we are; later ones open (unless switched off)
    if (st.lastSeq < 0) { set({ lastSeq: newest.seq ?? 0 }); return; }
    if (runtime.settings.get(K.auto) === false) { set({ lastSeq: newest.seq ?? st.lastSeq }); return; }
    play(newest);
  } catch { /* the agent manager isn't here: nothing to play */ }
}
function loop() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void poll().finally(loop); }, POLL_MS);
}

let last: Walkthrough | null = null;
subs.add(() => { if (st.walk) last = st.walk; });

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Molly guide',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-28' },
  appMenu,
  tabs: { [KIND]: () => <GuideWindow /> },
  settingsTabs: [{ id: 'molly-guide', label: 'Molly guide', icon: 'sparkles', order: 60, parent: 'plugins', description: 'Narrated walkthroughs from Molly in a floating window.' }],
  settings: [
    { id: 'molly-guide.main', label: 'Walkthroughs', icon: 'sparkles', tab: 'molly-guide', order: 10, settings: [
      { key: K.speak, label: 'Read each step out loud', kind: 'toggle', default: true },
      { key: K.run, label: 'Move the console to each step (run its action)', kind: 'toggle', default: true },
      { key: K.auto, label: 'Open walkthroughs Molly makes from AmberX by themselves', kind: 'toggle', default: true },
    ] },
  ],
  settingsPanels: [
    { id: 'molly-guide.try', tab: 'molly-guide', title: 'Try it', icon: 'play', order: 20, render: () => <TryPanel /> },
    { id: 'molly-guide.amberx-video', tab: 'molly-guide', title: 'AmberX walkthrough video', icon: 'refresh', order: 30, render: () => <RerecordPanel /> },
    { id: 'molly-guide.lifecycle', tab: 'molly-guide', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    runtime = rt;
    rt.actions.register('molly.ask', ([q]) => { openWindow(); if (q) void askMolly(decodeURIComponent(q)); }, { label: 'Ask Molly to show me how' });
    rt.actions.register('molly.replay', () => { if (last) play(last); else openWindow(); }, { label: 'Replay the last walkthrough' });
    rt.actions.register('molly.next', () => show(st.at + 1), { label: 'Walkthrough: next step', searchable: false });
    rt.actions.register('molly.prev', () => show(st.at - 1), { label: 'Walkthrough: previous step', searchable: false });
    void poll();
    loop();
  },
};

function TryPanel() {
  const [on, setOn] = useState(false);
  return (
    <div className="fx-stack">
      <p className="fx-muted">A three-step sample, no Molly needed: it opens Settings, then this tab.</p>
      <Switch label="Show me the sample" checked={on} onChange={(v) => {
        setOn(v);
        if (v) play({ $axf: 'walkthrough@1', id: 'sample', title: 'Where Molly lives', app: 'console', steps: [
          { say: 'This window is Molly\'s guide. Each step moves the console and reads itself out.', do: '', target: '' },
          { say: 'Settings, Plugins, Molly guide: switch the voice or the auto-open here.', do: 'settings.open:molly-guide', target: 'molly-guide' },
          { say: 'Ask her anything from Help, Ask Molly to show me. That\'s it.', do: '', target: '' },
        ] });
        else close();
      }} />
    </div>
  );
}

/** Re-records AmberX's narrated walkthrough video (apps/amberx-droid/walkthrough) after a UI change: one veto call on axHub. */
function RerecordPanel() {
  const [st, set] = useState<{ state: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pluginFetch(FOLDER, 'amberx-walkthrough/rerecord').then((r) => (r.ok ? r.json() : null)).then((j) => j?.state !== 'idle' && set(j)).catch(() => undefined); }, []);
  const go = async () => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, 'amberx-walkthrough/rerecord', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      set(r.ok ? j : { state: 'failed', message: j.detail ?? `The console answered ${r.status}.` });
      if (r.ok) for (let i = 0; i < 20; i++) {
        await new Promise((ok) => setTimeout(ok, 1500));
        const s = await (await pluginFetch(FOLDER, 'amberx-walkthrough/rerecord')).json();
        set(s);
        if (s.state !== 'sending') break;
      }
    } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted">Changed AmberX's screens? Record its walkthrough again: the live app with demo data, Amber's voice, chapters, a secrets scan, then it replaces the video in AmberX → Walkthrough (about 15 minutes). It goes to axHub as a veto call, so you can still deny it.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" busy={busy} confirm="Re-record the AmberX walkthrough video?" onClick={() => void go()}>Re-record the AmberX walkthrough</Button>
      </div>
      {st && <Note tone={st.state === 'failed' ? 'danger' : st.state === 'sent' ? 'success' : 'info'}>{st.message}</Note>}
    </div>
  );
}

export default plugin;
