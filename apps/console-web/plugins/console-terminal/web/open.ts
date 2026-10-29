/* Opening terminals: a new session in the open terminal window when there is one, else a new floating window. */
import type { AxfRuntime } from '@console/axf/core';
import type { Open } from './api';
import { addSession, host, sessionId, titleFor, type HostSession } from './hosts';

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
  rt.windows.openFloating([{ id: hid, title: 'Terminal', kind: HOST_KIND, payload: '', icon: 'terminal' }], 'Terminal', 'floating', Math.min(900, innerWidth - 32), Math.min(540, innerHeight - 120), undefined, undefined, { frame: 'frameless', minWidth: 320, minHeight: 200 });
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
