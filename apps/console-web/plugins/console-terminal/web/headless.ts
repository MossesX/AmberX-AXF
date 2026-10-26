/*
 * Headless Claude Code sessions, shown in the terminal (Brett, Oct 26 2026): "whenever the console or axHub runs a
 * headless session on the VPS, use the built-in terminal in the console and bring the floating window to focus and
 * front". Launches go through deploy/claude-headless.sh, which runs them in a tmux session named axf-…; this polls the
 * plugin's `GET headless` (one ssh `tmux ls`, cached 8 s) every 5 s while the page is visible, and opens each new
 * session in a VPS tab attached to it (`tmux attach`), in the terminal window, which is restored, focused and raised.
 * Each session opens once per browser (remembered in localStorage when it's available). Setting: showHeadless.
 */
import type { AxfRuntime } from '@console/axf/core';
import { call } from './api';
import { newTab } from './open';

export interface Headless { name: string; createdAt: number }
interface Answer { ready: boolean; on: boolean; items: Headless[]; why: string; now: number }

const SEEN_KEY = 'axf.terminal.headless.seen';
const tabFor = new Map<string, string>(); // session name → tab id opened on this page

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[]); } catch { return new Set(); }
}
function saveSeen(seen: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch { /* storage blocked: still works for this page */ }
}

/** The new sessions to open: running now and not opened before. Pure, for the self-test. */
export function toOpen(items: Headless[], seen: Set<string>): Headless[] {
  return items.filter((h) => /^axf-[A-Za-z0-9._-]{1,64}$/.test(h.name) && !seen.has(h.name)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Bring a tab's window up: restore it if minimized, focus it, raise it, show the tab. */
export function bringToFront(rt: AxfRuntime, tabId: string) {
  const wm = rt.windows;
  const gid = wm.groupOf(tabId);
  const g = gid ? wm.state.groups[gid] : null;
  if (!g) return;
  wm.activate(g.id, g.tabs.findIndex((t) => t.id === tabId));
  const w = wm.state.windows.find((x) => x.id === g.windowId);
  if (w?.minimized) wm.restore(w.id); else if (w) wm.focus(w.id);
}

/** Open (or bring forward) the attached VPS tab for one headless session. */
export function openHeadless(rt: AxfRuntime, h: Headless) {
  const known = tabFor.get(h.name);
  if (known && rt.windows.groupOf(known)) { bringToFront(rt, known); return; }
  const id = newTab(rt, { kind: 'vps', attach: h.name, title: `Claude: ${h.name.slice(4)}` });
  tabFor.set(h.name, id);
  bringToFront(rt, id);
}

let started = false;
export function watchHeadless(rt: AxfRuntime) {
  if (started) return;
  started = true;
  const seen = loadSeen();
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const a = await call<Answer>('headless');
      if (!a.on) return;
      const running = new Set(a.items.map((h) => h.name));
      for (const h of toOpen(a.items, seen)) { seen.add(h.name); openHeadless(rt, h); }
      for (const n of [...seen]) if (!running.has(n) && a.ready) seen.delete(n); // ended: forget it (a reused name opens again)
      saveSeen(seen);
    } catch { /* plugin off, VPS unreachable: try again next tick */ }
  };
  setInterval(() => void tick(), 5000);
  document.addEventListener('visibilitychange', () => void tick());
  void tick();
}
