/*
 * Claude link — the browser side of the Terminal's pinned first tab (terminal-main-tab-streaming-console-s, Nov 17
 * 2026, Brett: "Give terminal a main tab that outputs in real time the console's connection to cloud.").
 *
 * One store per page, not per component, so the actions (claude-link.pause / resume / filter / clear, the MCP tools,
 * voice and the CLI through the shared view) drive it with or without the tab on screen:
 *   - EventSource on GET claude-link/stream (hello → state + shared view, link → one event, view → the shared view
 *     changed elsewhere); reconnects by itself with Last-Event-ID, and once more after 5 s if the browser gave up
 *   - items: the newest `max` events (the claudeLinkBuffer setting); unseen = events that came while paused
 *   - view: { paused, kinds, q }: the same object as GET/PUT claude-link/view, so a pause from voice pauses the tab
 */
import { useSyncExternalStore } from 'react';
import { FOLDER, call, post, put } from './api';

export const KINDS = ['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error'] as const;
export type LinkKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<LinkKind, string> = { launch: 'Launch', exit: 'Exit', account: 'Account', mcp: 'MCP', axhub: 'axHub', connect: 'Connect', disconnect: 'Disconnect', error: 'Error' };
/** The chip tone per kind (framework chip variants only). */
export const KIND_TONE: Record<LinkKind, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  launch: 'accent', exit: undefined, account: undefined, mcp: undefined, axhub: 'accent', connect: 'success', disconnect: 'warning', error: 'danger',
};
export interface LinkEvent { id: number; ts: number; kind: LinkKind; source: string; session: string; account: string; model: string; summary: string; detail: Record<string, unknown>; level: 'info' | 'warn' | 'error' }
export interface LinkView { paused: boolean; kinds: LinkKind[]; q: string; rev?: number }
export interface LinkStateDoc { connected: boolean | null; since: number; why: string; last: LinkEvent | null; counts: Record<LinkKind, number>; seq: number; clearedAt: number; size: number; view?: LinkView }
export type Conn = 'connecting' | 'live' | 'down';

interface Store { items: LinkEvent[]; conn: Conn; hub: boolean | null; hubWhy: string; view: LinkView; unseen: number; max: number; open: Set<number>; detailDefault: boolean }

let s: Store = { items: [], conn: 'connecting', hub: null, hubWhy: '', view: { paused: false, kinds: [], q: '' }, unseen: 0, max: 2000, open: new Set(), detailDefault: false };
const subs = new Set<() => void>();
const set = (p: Partial<Store>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
export const linkStore = { get: () => s, subscribe: (f: () => void) => { subs.add(f); ensure(); return () => { subs.delete(f); if (!subs.size) idleClose(); }; } };
export const useClaudeLink = () => useSyncExternalStore(linkStore.subscribe, linkStore.get);

let es: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

function ensure() {
  if (idle) { clearTimeout(idle); idle = null; }
  if (es || typeof EventSource === 'undefined') return;
  set({ conn: 'connecting' });
  // Last-Event-ID only travels on the browser's own reconnects; a fresh connect asks for what came after our newest
  const last = s.items[s.items.length - 1]?.id ?? 0;
  es = new EventSource(`/api/plugins/${FOLDER}/claude-link/stream${last ? `?since=${last}` : ''}`);
  es.addEventListener('hello', (m) => {
    try { const st = JSON.parse((m as MessageEvent).data) as LinkStateDoc; set({ conn: 'live', hub: st.connected, hubWhy: st.why, ...(st.view ? { view: st.view } : {}), max: st.size || s.max }); } catch { set({ conn: 'live' }); }
  });
  es.addEventListener('link', (m) => { try { add(JSON.parse((m as MessageEvent).data) as LinkEvent); } catch { /* a bad frame */ } });
  es.addEventListener('view', (m) => { try { set({ view: JSON.parse((m as MessageEvent).data) as LinkView }); } catch { /* ignore */ } });
  es.onopen = () => set({ conn: 'live' });
  es.onerror = () => {
    // a dropped stream reconnects by itself (retry 3 s): only say Disconnected when it is still down a moment later
    const was = es;
    setTimeout(() => { if (es === was && es?.readyState !== EventSource.OPEN) set({ conn: 'down' }); }, 4000);
    if (es && es.readyState === EventSource.CLOSED) { es = null; set({ conn: 'down' }); if (!retry) retry = setTimeout(() => { retry = null; if (subs.size) ensure(); }, 5000); }
  };
}
/** Nobody watching for a minute: close the stream (it opens again with the next subscriber, resuming after our newest). */
function idleClose() { idle = setTimeout(() => { if (!subs.size && es) { es.close(); es = null; set({ conn: 'down' }); } }, 60_000); }

function add(e: LinkEvent) {
  if (s.items.length && e.id <= s.items[s.items.length - 1]!.id) return;
  const items = [...s.items, e]; if (items.length > s.max) items.splice(0, items.length - s.max);
  const hub = e.kind === 'connect' ? true : e.kind === 'disconnect' ? false : s.hub;
  const hubWhy = e.kind === 'connect' || e.kind === 'disconnect' ? e.summary : s.hubWhy;
  set({ items, hub, hubWhy, unseen: s.view.paused && matches(e, s.view) ? s.unseen + 1 : s.unseen });
}

export function matches(e: LinkEvent, v: Pick<LinkView, 'kinds' | 'q'>): boolean {
  if (v.kinds.length && !v.kinds.includes(e.kind)) return false;
  if (!v.q.trim()) return true;
  const hay = `${e.summary} ${e.source} ${e.session} ${e.account} ${e.model} ${e.kind} ${JSON.stringify(e.detail ?? {})}`.toLowerCase();
  return v.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}
export const visible = (st: Store = s) => st.items.filter((e) => matches(e, st.view));

/** Change the shared view (here at once, then on the server so the API, CLI and voice read the same). */
export function setView(p: Partial<LinkView>) {
  const view = { ...s.view, ...p };
  set({ view, ...(p.paused === false ? { unseen: 0 } : {}) });
  void put<LinkView>('claude-link/view', p).catch(() => undefined);
}
export const pause = () => setView({ paused: true });
export const resume = () => setView({ paused: false });
export const toggleKind = (k: LinkKind) => setView({ kinds: s.view.kinds.includes(k) ? s.view.kinds.filter((x) => x !== k) : [...s.view.kinds, k] });
export async function clear() { await post('claude-link/clear'); set({ items: [], unseen: 0, open: new Set() }); }
export const toggleOpen = (id: number) => { const open = new Set(s.open); if (open.has(id)) open.delete(id); else open.add(id); set({ open }); };
export const setDefaults = (p: { max?: number; detailDefault?: boolean }) => set({ ...(p.max ? { max: p.max } : {}), ...(p.detailDefault !== undefined ? { detailDefault: p.detailDefault } : {}) });
export const markSeen = () => { if (s.unseen) set({ unseen: 0 }); };
export const state = () => call<LinkStateDoc>('claude-link/state');
