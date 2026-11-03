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
 */
import type { AxfRuntime } from '@console/axf/core';
import { call } from './api';
import { newTab } from './open';
import { focusSession, host, hostIds } from './hosts';

export type { Headless } from './headless-core';
import type { Headless } from './headless-core';
interface Answer { ready: boolean; on: boolean; items: Headless[]; why: string; now: number }

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
import { toOpen } from './headless-core';

/** Headless sessions a tab in a live terminal window shows now. */
function shownNow(rt: AxfRuntime): Map<string, string> {
  const out = new Map<string, string>();
  for (const hid of hostIds()) {
    if (!rt.windows.groupOf(hid)) continue; // a host whose window is gone (not restored after a reload) shows nothing
    for (const s of host(hid).sessions) if (s.open.attach) out.set(s.open.attach, s.id);
  }
  return out;
}

/** Open (or bring forward) the attached VPS tab for one headless session. */
export function openHeadless(rt: AxfRuntime, h: Headless) {
  const known = shownNow(rt).get(h.name);
  if (known) { focusSession(rt, known); return; }
  closed.delete(h.name); store(CLOSED_KEY, closed);
  const id = newTab(rt, { kind: 'vps', attach: h.name, title: h.agent || `Claude: ${h.name.slice(4)}` });
  focusSession(rt, id);
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
      const shown = new Set(shownNow(rt).keys());
      for (const h of toOpen(a.items, shown, closed)) openHeadless(rt, h);
      const running = new Set(a.items.map((h) => h.name));
      let changed = false;
      for (const n of [...closed]) if (!running.has(n)) { closed.delete(n); changed = true; } // ended: a reused name opens again
      if (changed) store(CLOSED_KEY, closed);
    } catch { /* plugin off, VPS unreachable: try again next tick */ }
  };
  setInterval(() => void tick(), 5000);
  document.addEventListener('visibilitychange', () => void tick());
  void tick();
}
