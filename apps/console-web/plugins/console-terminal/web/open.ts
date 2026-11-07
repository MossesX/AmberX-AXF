/* Opening terminals: a new session in the open terminal window when there is one, else a new floating window. */
import type { AxfRuntime } from '@console/axf/core';
import type { Open } from './api';
import { addSession, focusSession, host, removeSession, sessionId, titleFor, type HostSession } from './hosts';
import { tabSessions } from './api';

export const HOST_KIND = 'terminal-host';

/** The terminal window to add to: the one in front (focused) first, else any. */
export function findHost(rt: AxfRuntime): string | null {
  const wm = rt.windows;
  const groups = Object.values(wm.state.groups).filter((g) => g.tabs.some((t) => t.kind === HOST_KIND));
  const front = groups.find((g) => wm.state.windows.find((w) => w.id === g.windowId)?.id === wm.state.focused) ?? groups[0];
  return front?.tabs.find((t) => t.kind === HOST_KIND)?.id ?? null;
}

/** Open a fresh terminal window holding these sessions. Returns the host id. */
export function newWindow(rt: AxfRuntime, sessions: HostSession[]): string {
  const hid = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  host(hid, sessions);
  // frameless (windows-terminal s17): the tab strip is the title bar (drag, double-click, min / max / close), like Windows Terminal
  // on a touch screen: centred with a margin each side, so the side edges (and their resize handles) stay clear of the
  // phone's edge-swipe (back) gesture zone
  const touch = matchMedia('(pointer: coarse)').matches;
  const width = Math.max(280, Math.min(900, innerWidth - (touch ? 80 : 32))), height = Math.min(540, innerHeight - 120);
  rt.windows.openFloating([{ id: hid, title: 'Terminal', kind: HOST_KIND, payload: '', icon: 'terminal' }], 'Terminal', 'floating', width, height, touch ? Math.round((innerWidth - width) / 2) : undefined, undefined, { frame: 'frameless', minWidth: Math.min(320, width), minHeight: 200 });
  return hid;
}

/** Add a session (into `hostId`, the window in front, or a new window). Returns the session id. */
export function newTab(rt: AxfRuntime, o: Open, hostId?: string | null): string {
  const s: HostSession = { id: sessionId(), title: titleFor(o), open: o };
  const hid = hostId ?? findHost(rt);
  if (hid && rt.windows.groupOf(hid)) addSession(hid, s); else newWindow(rt, [s]);
  return s.id;
}

/**
 * The `terminal.open:<target>:<payload>` action. Targets the console marks with data-fx-ctx-target:
 *   axf-container        payload = container name            → root shell in that container (its working dir)
 *   axf-container-path   payload = "<container>|<abs path>"  → in that folder (a file opens in its folder)
 *   anything else                                            → the console's own container, at the repo
 */
export function openFromContext(rt: AxfRuntime, rawTarget = '', payload = '') {
  const target = decodeURIComponent(rawTarget || '');
  const p = decodeURIComponent(payload || '');
  if (target === 'axf-container' && p) return newTab(rt, { kind: 'container', container: p });
  if (target === 'axf-container-path' && p.includes('|')) {
    const [container, path] = [p.slice(0, p.indexOf('|')), p.slice(p.indexOf('|') + 1)];
    return newTab(rt, { kind: 'container', container, cwd: path });
  }
  return newTab(rt, { kind: 'console' });
}

/**
 * `terminal.show:<sid>:<kind>:<tmux>:<where>:<target>:<title>` (full-api-control): a session the API opened on the server
 * (drive/open) gets a tab here attached to that same session, in front, so what the API types is drawn live. A second
 * show of the same session only brings its tab up.
 */
export function showApiTab(rt: AxfRuntime, [sid = '', kind = '', tmux = '', where = '', target = '', title = '']: string[]): string | null {
  if (!/^t[0-9a-f]{6,32}$/.test(sid)) return null;
  const have = [...tabSessions.entries()].find(([, v]) => v === sid)?.[0];
  if (have) { focusSession(rt, have); return have; }
  const t = title || undefined;
  const o: Open = kind === 'container' ? { kind: 'container', container: target, title: t, sid }
    : where === 'vps' ? (tmux.startsWith('axt-') ? { kind: 'vps', tmux, title: t, sid } : { kind: 'vps', attach: tmux || undefined, title: t, sid })
    : { kind: 'console', ...(tmux ? { tmux } : {}), title: t, sid };
  const id = newTab(rt, o);
  focusSession(rt, id);
  return id;
}

/** `terminal.drop:<sid>`: the API closed that session; its tab goes too. */
export function dropApiTab(sid: string): void {
  const tab = [...tabSessions.entries()].find(([, v]) => v === sid)?.[0];
  if (!tab) return;
  tabSessions.delete(tab);
  removeSession(tab);
}
