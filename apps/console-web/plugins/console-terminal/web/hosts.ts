/*
 * Terminal hosts (Oct 28 2026, Windows-style terminal): one window-engine tab of kind `terminal-host` per terminal
 * window. The host draws its own Windows Terminal tab strip, so every shell / Claude Code session is a *session* of a
 * host, not a window-engine tab. This file is the plain state behind it: which sessions each host has, which is in
 * front, and a per-session control handle the host's toolbar talks to. State is kept per browser (localStorage when
 * it's there), so a reload brings the same tabs back.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { Open, SessionInfo } from './api';

export type Conn = 'connecting' | 'live' | 'reconnecting' | 'closed';
export interface HostSession { id: string; title: string; open: Open; color?: string }
export interface HostState { sessions: HostSession[]; active: string | null }

/** What a mounted session lets its host do (the toolbar acts on the session in front). */
export interface SessionCtl {
  conn: Conn; info: SessionInfo | null; mouse: boolean; mosh: boolean; fontSize: number;
  setMouse(on: boolean): void; setMosh(on: boolean): void; zoom(delta: number): void; search(): void;
  copy(): void; paste(plain: boolean): void; selectAll(): void; clear(): void; restart(): void; focus(): void;
  menu(x: number, y: number): void;
}

const KEY = 'axf.terminal.hosts';
const hosts = new Map<string, HostState>();
const ctls = new Map<string, SessionCtl>();
const listeners = new Set<() => void>();
let version = 0;

function load() {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, HostState>; for (const [k, v] of Object.entries(raw)) if (v && Array.isArray(v.sessions)) hosts.set(k, v); } catch { /* storage blocked */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(hosts))); } catch { /* storage blocked: works for this page */ }
}
load();

export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const snapshot = () => version;
const emit = () => { version++; save(); listeners.forEach((f) => f()); };

export const sessionId = () => `ts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const TITLES: Record<string, string> = { console: 'Console', vps: 'VPS', claude: 'Claude Code', axhub: 'axHub' };
export const titleFor = (o: Open) => o.title || (o.kind === 'container' ? o.container ?? 'Container' : TITLES[o.kind] ?? 'Terminal');

export function host(id: string, seed?: HostSession[]): HostState {
  let h = hosts.get(id);
  if (!h) { h = { sessions: seed ?? [], active: seed?.[0]?.id ?? null }; hosts.set(id, h); save(); }
  return h;
}
export const hostIds = () => [...hosts.keys()];
export const hostOf = (sid: string) => [...hosts.entries()].find(([, h]) => h.sessions.some((s) => s.id === sid))?.[0] ?? null;

export function addSession(hostId: string, s: HostSession, at?: number) {
  const h = host(hostId);
  const i = at ?? h.sessions.length;
  h.sessions = [...h.sessions.slice(0, i), s, ...h.sessions.slice(i)];
  h.active = s.id; emit();
}
/** Take a session out of its host (closing or moving it). Returns it. */
export function removeSession(sid: string): HostSession | null {
  const hid = hostOf(sid); if (!hid) return null;
  const h = hosts.get(hid)!; const i = h.sessions.findIndex((s) => s.id === sid); const [s] = h.sessions.splice(i, 1);
  h.sessions = [...h.sessions];
  if (h.active === sid) h.active = h.sessions[Math.min(i, h.sessions.length - 1)]?.id ?? null;
  emit(); return s ?? null;
}
export function patchSession(sid: string, p: Partial<HostSession>) {
  const hid = hostOf(sid); if (!hid) return; const h = hosts.get(hid)!;
  h.sessions = h.sessions.map((s) => (s.id === sid ? { ...s, ...p } : s)); emit();
}
export function activate(hostId: string, sid: string) { const h = hosts.get(hostId); if (h && h.active !== sid) { h.active = sid; emit(); } }
export function move(hostId: string, from: number, to: number) {
  const h = hosts.get(hostId); if (!h || from === to) return;
  const list = [...h.sessions]; const [s] = list.splice(from, 1); if (!s) return; list.splice(Math.max(0, Math.min(to, list.length)), 0, s); h.sessions = list; emit();
}
export function dropHost(hostId: string) { if (hosts.delete(hostId)) emit(); }

export function setCtl(sid: string, c: SessionCtl | null) { if (c) ctls.set(sid, c); else ctls.delete(sid); version++; listeners.forEach((f) => f()); }
export const ctl = (sid: string | null | undefined) => (sid ? ctls.get(sid) ?? null : null);

/** Bring a session's window up (restore, focus, raise) and put the session in front. */
export function focusSession(rt: AxfRuntime, sid: string) {
  const hid = hostOf(sid); if (!hid) return;
  activate(hid, sid);
  const wm = rt.windows; const gid = wm.groupOf(hid); const g = gid ? wm.state.groups[gid] : null; if (!g) return;
  wm.activate(g.id, g.tabs.findIndex((t) => t.id === hid));
  const w = wm.state.windows.find((x) => x.id === g.windowId);
  if (w?.minimized) wm.restore(w.id); else if (w) wm.focus(w.id);
  ctl(sid)?.focus();
}
