/*
 * Claude link — console actions, the control@1 target and the deep link (API parity, terminal-main-tab-streaming-console-s).
 * Every one runs the same store / REST calls as the tab's toolbar, the plugin commands (MCP console-terminal_claude_link_*),
 * `axf claude-link …` and voice:
 *   claude-link.open                   open the Terminal on its Claude link tab (deep link ?view=terminal&tab=claude-link,
 *                                      control@1 view:terminal/tab:claude-link, voice "show the Claude link")
 *   claude-link.state                  say what the link is doing (voice "what's Claude doing")
 *   claude-link.pause · claude-link.resume
 *   claude-link.filter:<kinds,…>[:<text>]   set the kind filter ("all" or empty = every kind) and the text filter
 *   claude-link.clear                  clear the view (the log is kept)
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { KINDS, clear, linkStore, pause, resume, setView, state, type LinkKind } from './claude-link';
import { ensureLink, focusSession, host, hostOf, isLink } from './hosts';
import { findHost, newWindow } from './open';
import { LINK_ADDRESS } from './claudeLinkToolbar';

/** Open (or bring up) a Terminal window with its Claude link tab in front. Returns the host id. */
export function openLink(rt: AxfRuntime): string {
  let hid = findHost(rt);
  if (!hid || !rt.windows.groupOf(hid)) hid = newWindow(rt, []);
  ensureLink(hid);
  focusSession(rt, host(hid).sessions[0]!.id);
  return hid;
}

const kindsOf = (raw: string): LinkKind[] => (raw === 'all' ? [] : raw.split(',').map((k) => k.trim()).filter((k): k is LinkKind => (KINDS as readonly string[]).includes(k)));

/** One spoken / toasted line on what the link is doing. */
export async function describeLink(): Promise<string> {
  const st = await state();
  const hub = st.connected === null ? 'axHub not called yet' : st.connected ? 'axHub answers' : `axHub unreachable (${st.why})`;
  const busy = Object.entries(st.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing yet';
  const last = st.last ? `Last: ${st.last.summary}` : '';
  return `Claude link: ${hub}. ${busy}.${last ? ` ${last}` : ''}${st.view?.paused ? ' (paused)' : ''}`;
}

export function registerClaudeLink(rt: AxfRuntime): void {
  rt.actions.register('claude-link.open', () => { openLink(rt); }, { label: 'Show the Claude link (Terminal)', effect: 'navigate' });
  rt.actions.register('claude-link.state', () => { void describeLink().then((t) => rt.toast(t, 'info', 'Claude link'), (e: Error) => rt.toast(e.message, 'danger', 'Claude link')); }, { label: 'What is Claude doing (Claude link)', effect: 'read' });
  rt.actions.register('claude-link.pause', () => pause(), { label: 'Pause the Claude link', effect: 'write' });
  rt.actions.register('claude-link.resume', () => resume(), { label: 'Resume the Claude link', effect: 'write' });
  rt.actions.register('claude-link.filter', ([kinds = '', ...q]) => setView({ kinds: kindsOf(decodeURIComponent(kinds)), ...(q.length ? { q: decodeURIComponent(q.join(':')) } : {}) }), { label: 'Filter the Claude link (kinds, text)', params: true, effect: 'write' });
  rt.actions.register('claude-link.clear', () => { void clear().then(() => rt.toast('Claude link view cleared (the log is kept)', 'success', 'Claude link'), (e: Error) => rt.toast(e.message, 'danger', 'Claude link')); }, { label: 'Clear the Claude link view', effect: 'write' });

  // control@1: the tab is addressable (and openable) even while no Terminal window is open
  controlRegistry(rt).register({
    address: LINK_ADDRESS, kind: 'tab', label: 'Claude link', icon: 'cloud',
    detail: 'The Terminal’s pinned first tab: the console’s connection to Claude and axHub, live',
    keywords: ['claude link', 'claude connection', 'what is claude doing', "what's claude doing", 'cloud connection', 'axhub calls', 'terminal'],
    open: () => { openLink(rt); },
    get: () => { const s = linkStore.get(); return { conn: s.conn, hub: s.hub, paused: s.view.paused, kinds: s.view.kinds, q: s.view.q, shown: s.items.length }; },
    element: () => document.querySelector('[data-axf-target="view:terminal/tab:claude-link"]'),
  });

  // deep link: ?view=terminal&tab=claude-link (also #/terminal?tab=claude-link)
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
    const wants = (q.get('view') === 'terminal' && q.get('tab') === 'claude-link') || (/^#\/terminal\b/.test(location.hash) && h.get('tab') === 'claude-link');
    if (wants) setTimeout(() => openLink(rt), 0);
  } catch { /* no location (tests) */ }
}

/** True when a session id is a host's Claude link tab. */
export const isLinkSession = (sid: string) => { const hid = hostOf(sid); return !!hid && isLink(host(hid).sessions.find((s) => s.id === sid)); };
