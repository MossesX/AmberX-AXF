/* Opening terminals: into the open terminal window when there is one, else a new floating window. */
import type { AxfRuntime } from '@console/axf/core';
import { tabSessions, type Open } from './api';

const TITLES: Record<string, string> = { console: 'Console', vps: 'VPS', claude: 'Claude Code' };

export function newTab(rt: AxfRuntime, o: Open, groupId?: string | null): string {
  const wm = rt.windows;
  const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tab = { id, title: o.title || (o.kind === 'container' ? o.container ?? 'Container' : TITLES[o.kind] ?? 'Terminal'), kind: 'terminal', payload: JSON.stringify(o), icon: 'terminal' };
  const existing = groupId ?? Object.values(wm.state.groups).find((g) => g.tabs.some((t) => t.kind === 'terminal'))?.id ?? null;
  if (existing && wm.state.groups[existing]) wm.addTab(existing, tab);
  else wm.openFloating([tab], 'Terminal', 'floating', Math.min(820, innerWidth - 32), Math.min(480, innerHeight - 120));
  return id;
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

const TMUX_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Bring a terminal tab forward: its group's active tab, its window on top. */
function show(rt: AxfRuntime, tabId: string): boolean {
  const wm = rt.windows;
  const gid = wm.groupOf(tabId);
  const g = gid ? wm.state.groups[gid] : null;
  if (!g) return false;
  wm.activate(g.id, g.tabs.findIndex((t) => t.id === tabId));
  wm.focus(g.windowId);
  return true;
}

/**
 * `terminal.attach:<tmux session>` — a VPS tab attached to that tmux session (Claude Code started in tmux, e.g. from
 * Moshi). A tab already attached to it is focused instead of opening a second one.
 */
export function attachTmux(rt: AxfRuntime, raw = ''): string | null {
  const name = decodeURIComponent(raw || '');
  if (!TMUX_NAME.test(name)) { rt.toast(`“${name.slice(0, 40)}” isn’t a tmux session name.`, 'warning', 'Terminal'); return null; }
  for (const g of Object.values(rt.windows.state.groups)) {
    const t = g.tabs.find((x) => x.kind === 'terminal' && (() => { try { return (JSON.parse(x.payload || '{}') as Open).tmux === name; } catch { return false; } })());
    if (t && show(rt, t.id)) return t.id;
  }
  const id = newTab(rt, { kind: 'vps', tmux: name, title: `tmux ${name}` });
  show(rt, id);
  return id;
}

/** `terminal.focus:<session id>` — the tab showing that console terminal session, in focus. */
export function focusSession(rt: AxfRuntime, raw = ''): boolean {
  const sid = decodeURIComponent(raw || '');
  for (const [tabId, s] of tabSessions) if (s === sid && show(rt, tabId)) return true;
  rt.toast('That terminal isn’t open in this browser. It may be open on another device.', 'info', 'Terminal');
  return false;
}
