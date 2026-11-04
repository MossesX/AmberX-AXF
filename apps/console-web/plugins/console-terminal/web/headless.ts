/*
 * Headless Claude Code sessions, shown in the terminal (Brett, Oct 26 2026): "whenever the console or axHub runs a
 * headless session on the VPS, use the built-in terminal in the console and bring the floating window to focus and
 * front". Launches go through deploy/claude-headless.sh, which runs them in a tmux session named axf-…; this polls the
 * plugin's `GET headless` (one ssh `tmux ls`, cached 8 s) every 5 s while the page is visible, and opens each new
 * session in a VPS tab attached to it (`tmux attach`), in the terminal window, which is restored, focused and raised.
 * Headless tabs (Nov 3 2026, Brett): "every time a headless session starts, the console automatically opens a new tab
 * attached to it; builds started while the console is closed too". Every running axf-… session that no live terminal
 * window shows gets a tab, on every load as well, unless Brett closed that session's tab himself (remembered per
 * browser; the ∨ menu's Running sessions brings it back). The tab is titled after the agent the launcher tagged the
 * session with (else the build name). Setting: showHeadless.
 * No focus stealing (terminal-no-focus, Nov 4 2026, Brett: "I don't want the terminal to come to the front on every
 * session."): setting newSession. quiet (default) adds the tab in the background of an open terminal window (no new
 * window, no tab switch, no raise) and counts it on the Terminal toolbar icon (badge terminal.sessions.new) until Brett
 * looks at that tab; with no window open it only counts, and the tab appears once he opens the Terminal. nothing = no tab
 * by itself; front = the old open-and-raise. Explicit opens (Open, Jump in, the Crew's Terminal tab, terminal.attach)
 * always bring it up.
 */
import type { AxfRuntime } from '@console/axf/core';
import { call } from './api';
import { findHost, newTab } from './open';
import { addSession, focusSession, host, hostIds, sessionId, subscribe, titleFor, type HostSession } from './hosts';

export type { Headless } from './headless-core';
import type { Headless } from './headless-core';
interface Answer { ready: boolean; on: boolean; items: Headless[]; why: string; now: number; newSession?: string }

const CLOSED_KEY = 'axf.terminal.headless.closed';
const NAME = /^axf-[A-Za-z0-9._-]{1,64}$/;

function load(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]); } catch { return new Set(); }
}
function store(key: string, v: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...v].slice(-200))); } catch { /* storage blocked: still works for this page */ }
}
const closed = load(CLOSED_KEY);
/** Brett closed this headless session's tab: don't open it again by itself. */
export function markClosed(name: string) { if (NAME.test(name)) { closed.add(name); store(CLOSED_KEY, closed); } }

export { toOpen } from './headless-core';
import { NEW_SESSIONS_BADGE, newSessionMode, planNew, toOpen, type NewSessionMode } from './headless-core';

/** New headless sessions Brett hasn't looked at yet (tmux name → session), shown as the toolbar count. */
const unseen = new Map<string, Headless>();

/** Headless sessions a tab in a live terminal window shows now. */
function shownNow(rt: AxfRuntime): Map<string, string> {
  const out = new Map<string, string>();
  for (const hid of hostIds()) {
    if (!rt.windows.groupOf(hid)) continue; // a host whose window is gone (not restored after a reload) shows nothing
    for (const s of host(hid).sessions) if (s.open.attach) out.set(s.open.attach, s.id);
  }
  return out;
}

const openOf = (h: Headless) => ({ kind: 'vps' as const, attach: h.name, title: h.agent || `Claude: ${h.name.slice(4)}` });

/** Open (or bring forward) the attached VPS tab for one headless session. Explicit: always raises the window. */
export function openHeadless(rt: AxfRuntime, h: Headless) {
  unseen.delete(h.name); badge(rt);
  const known = shownNow(rt).get(h.name);
  if (known) { focusSession(rt, known); return; }
  closed.delete(h.name); store(CLOSED_KEY, closed);
  const id = newTab(rt, openOf(h));
  focusSession(rt, id);
}

/** A background tab in the open terminal window: no raise, no focus, the current tab stays in front. */
function addQuiet(rt: AxfRuntime, h: Headless): boolean {
  const hid = findHost(rt); if (!hid || !rt.windows.groupOf(hid)) return false;
  const s: HostSession = { id: sessionId(), title: titleFor(openOf(h)), open: openOf(h) };
  addSession(hid, s, undefined, true);
  return true;
}

/** Seen = its tab is the one in front of its terminal window. Ended sessions drop out. */
function badge(rt: AxfRuntime, running?: Set<string>) {
  const front = new Set<string>();
  for (const hid of hostIds()) {
    if (!rt.windows.groupOf(hid)) continue;
    const h = host(hid); const s = h.sessions.find((x) => x.id === h.active);
    if (s?.open.attach) front.add(s.open.attach);
  }
  for (const n of [...unseen.keys()]) if (front.has(n) || (running && !running.has(n))) unseen.delete(n);
  rt.setBadge(NEW_SESSIONS_BADGE, unseen.size);
}

/** The Terminal toolbar icon with a count on it: open the oldest new session Brett hasn't looked at (explicit). */
export function openUnseen(rt: AxfRuntime): boolean {
  const h = [...unseen.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!h) return false;
  openHeadless(rt, h);
  return true;
}

let started = false;
export function watchHeadless(rt: AxfRuntime) {
  if (started) return;
  started = true;
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const a = await call<Answer>('headless');
      if (!a.on || !a.ready) return;
      const mode: NewSessionMode = newSessionMode(a.newSession);
      const shown = new Set(shownNow(rt).keys());
      const plan = planNew(mode, toOpen(a.items, shown, closed), !!findHost(rt));
      for (const h of plan.open) {
        if (plan.raise) openHeadless(rt, h);
        else if (addQuiet(rt, h)) unseen.set(h.name, h);
      }
      for (const h of plan.wait) unseen.set(h.name, h);
      const running = new Set(a.items.map((h) => h.name));
      badge(rt, running);
      let changed = false;
      for (const n of [...closed]) if (!running.has(n)) { closed.delete(n); changed = true; } // ended: a reused name opens again
      if (changed) store(CLOSED_KEY, closed);
    } catch { /* plugin off, VPS unreachable: try again next tick */ }
  };
  subscribe(() => badge(rt)); // a tab brought to the front counts as seen
  setInterval(() => void tick(), 5000);
  document.addEventListener('visibilitychange', () => void tick());
  void tick();
}
