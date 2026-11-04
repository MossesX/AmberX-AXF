/*
 * Sessions nav (terminal-sessions-nav, Nov 3 2026): the Terminal window's collapsible left rail. Brett: "a collapsible
 * navigation menu on the left listing live sessions, including each session I'm doing with Claude, so I can mirror it
 * and jump in".
 *   - collapsed = icons only, open = full list; on a phone it is a drawer (hamburger in the tab strip, swipe from the
 *     left edge to open, swipe back to close). Open / collapsed, the groups and the sort are remembered per browser.
 *   - sections: My sessions (Brett's own tmux / Claude Code sessions, his claude.ai chats as feeds), Agents (headless
 *     builds: agent, model, live cost, status), Connections (where a new tab can open), Recent (ended; links to the
 *     Session browser). Each item shows when it started and a running timer.
 *   - tap = open or focus its tab (My sessions open as a read-only mirror; Jump in makes it writable); right-click /
 *     long-press = Open, Open in a new window, Jump in, Open in Moshi, Stop (with a confirm), Session info.
 *   - live: one websocket (nav/ws) for every terminal window on the page; it falls back to polling GET nav.
 * Theme tokens only (axp-wtnav prefix); controls are the framework's (fx-iconbtn, fx-btn, fx-input, fx-menu__item, fx-chip).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import * as consoleApi from '@console/api';
import { FOLDER, call, post, type Open } from './api';
import { addSession, focusSession, host, hostIds, sessionId } from './hosts';
import { findHost, newWindow } from './open';
import { openHeadless } from './headless';
import { modelName, money } from './meters';
import { SECTIONS, chatLink, dotOf, elapsed, openFor, view, type Filter, type NavItem, type NavModel, type SectionId, type Sort } from './nav-core';

const N = 'axp-wtnav';
const KEY = 'axf.terminal.nav';

/* ---------------- the live model: one websocket for the page ---------------- */
let model: NavModel | null = null;
let version = 0;
let users = 0;
let ws: WebSocket | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let live = false;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((f) => f()); };
const set = (m: NavModel) => { model = m; emit(); };

export async function refreshNav() { try { set(await call<NavModel>('nav')); } catch { /* VPS or plugin unreachable: keep the last list */ } }

async function connect() {
  if (!users) return;
  try {
    const path = `/api/plugins/${FOLDER}/nav/ws`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const t = consoleApi.getToken(); if (t) headers.authorization = `Bearer ${t}`;
    const r = await fetch('/api/ws-ticket', { method: 'POST', headers, body: JSON.stringify({ path }), cache: 'no-store' });
    const j = (await r.json()) as { ticket?: string };
    if (!j.ticket) throw new Error('no ticket');
    const s = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}?ticket=${encodeURIComponent(j.ticket)}`);
    ws = s;
    s.onopen = () => { live = true; emit(); };
    s.onmessage = (m) => { try { const msg = JSON.parse(String(m.data)) as { type: string; model?: NavModel }; if (msg.type === 'nav' && msg.model) set(msg.model); } catch { /* not ours */ } };
    s.onclose = () => { if (ws === s) { ws = null; live = false; emit(); if (users) setTimeout(() => void connect(), 4000); } };
  } catch { if (users) setTimeout(() => void connect(), 6000); }
}

function start() {
  users++;
  if (users > 1) return;
  void refreshNav(); void connect();
  // the socket is the live path; this is the fallback while it's down (and a safety net for the timers' list)
  poll = setInterval(() => { if (!live && document.visibilityState === 'visible') void refreshNav(); }, 5000);
}
function stop() {
  users = Math.max(0, users - 1);
  if (users) return;
  if (poll) clearInterval(poll); poll = null;
  const s = ws; ws = null; live = false; s?.close();
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function useNav(): { model: NavModel | null; live: boolean } {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => { start(); return stop; }, []);
  return { model, live };
}

/* ---------------- remembered state ---------------- */
interface Prefs { collapsed: boolean; closed: SectionId[]; sort: Sort; filter: Filter }
function loadPrefs(): Prefs {
  try { return { collapsed: false, closed: ['recent'], sort: 'started', filter: 'all', ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>) }; } catch { return { collapsed: false, closed: ['recent'], sort: 'started', filter: 'all' }; }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }

/* ---------------- what an item does ---------------- */
/** The tab (any terminal window on the page) that shows this item now. */
function shownBy(it: NavItem): string | null {
  for (const hid of hostIds()) for (const s of host(hid).sessions) {
    if (it.kind === 'chat' ? s.open.feed === it.id : s.open.attach === it.name || s.open.tmux === it.name) return s.id;
  }
  return null;
}

export function openItem(rt: AxfRuntime, hostId: string, it: NavItem, opts: { write?: boolean; window?: boolean } = {}) {
  const known = opts.window ? null : shownBy(it);
  if (known && !opts.write) { focusSession(rt, known); return; }
  if (it.kind === 'headless' && !opts.window) { openHeadless(rt, { name: it.name, createdAt: it.startedAt ?? 0, agent: it.agent, model: it.model }); return; }
  let o: Open | null;
  if (it.kind === 'connection') {
    o = it.via === 'container' ? { kind: 'container', container: it.container ?? '' } : it.via === 'axhub' ? { kind: 'claude', via: 'axhub' } : { kind: (it.via === 'vps' ? 'vps' : 'console') };
  } else {
    const f = openFor(it, opts.write || it.kind === 'headless'); o = f as Open | null;
  }
  if (!o) return;
  const s = { id: sessionId(), title: o.title || it.title, open: o };
  if (opts.window) { newWindow(rt, [s]); return; }
  addSession(hostId, s); focusSession(rt, s.id);
}

/** Jump in: a chat opens in claude.ai (its feed stays beside it); a tmux session gets a writable tab. */
export function jumpIn(rt: AxfRuntime, hostId: string, it: NavItem) {
  if (it.kind === 'chat') {
    const url = chatLink(it);
    openItem(rt, hostId, it);
    if (url) window.open(url, '_blank', 'noopener,noreferrer'); else rt.toast('This chat has not reported its claude.ai link yet (console_session_note url)', 'warning');
    return;
  }
  openItem(rt, hostId, it, { write: true });
}

/** The actions terminal.mirror / terminal.jump (REST, MCP and CLI through plugin commands): a session by its tmux
 *  name (or chat:<session>) and where, opened in the terminal window in front (a new one when none is open). */
export async function openByName(rt: AxfRuntime, name: string, where = '', write = false) {
  if (!name) { rt.toast('Which session? Give its name (sessions-list shows them)', 'warning'); return; }
  if (!model) await refreshNav();
  const all = [...(model?.mine ?? []), ...(model?.agents ?? []), ...(model?.recent ?? [])];
  const it: NavItem = all.find((x) => x.name === name && (!where || !x.where || x.where === where))
    ?? { id: name, name, title: name, kind: name.startsWith('chat:') ? 'chat' : name.startsWith('axf-') ? 'headless' : 'tmux', where: where === 'console' ? 'console' : 'vps' };
  const hid = findHost(rt);
  if (!hid) { openItem(rt, '', it, { write, window: true }); if (write && it.kind === 'chat' && chatLink(it)) window.open(chatLink(it), '_blank', 'noopener,noreferrer'); return; }
  if (write) jumpIn(rt, hid, it); else openItem(rt, hid, it);
}

function sessionIcon(it: NavItem): string {
  if (it.kind === 'chat') return it.source === 'claude-ai-voice' ? 'mic' : 'sparkles';
  if (it.kind === 'headless') return 'sparkles';
  if (it.kind === 'connection') return it.icon || 'terminal';
  return it.where === 'console' ? 'terminal' : 'monitor';
}

/* ---------------- the rail ---------------- */
export function SessionsRail({ hostId, drawer, onDrawer }: { hostId: string; drawer: boolean; onDrawer(open: boolean): void }) {
  const rt = useRuntime();
  const { model: m, live: isLive } = useNav();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const patch = (p: Partial<Prefs>) => setPrefs((x) => { const n = { ...x, ...p }; savePrefs(n); return n; });
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; it: NavItem } | null>(null);
  const [info, setInfo] = useState<NavItem | null>(null);
  const [stopAsk, setStopAsk] = useState<NavItem | null>(null);
  const [, tick] = useState(0); // the running timers
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const collapsed = prefs.collapsed && !drawer;
  const v = view(m, q, prefs.filter, prefs.sort);
  const now = Date.now();
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = (it: NavItem) => { openItem(rt, hostId, it); if (drawer) onDrawer(false); };
  const copyMoshi = (it: NavItem) => {
    const cmd = (it as NavItem & { attachCmd?: { mosh: string } | null }).attachCmd?.mosh;
    if (!cmd) { rt.toast('No attach command for this session', 'warning'); return; }
    void navigator.clipboard?.writeText(cmd).then(() => rt.toast(`Copied: ${cmd}`, 'success'), () => rt.toast(cmd, 'info'));
  };
  const doStop = async (it: NavItem) => {
    setStopAsk(null);
    try { await post('nav/stop', { name: it.name, where: it.where ?? 'vps' }); rt.toast(`Stopped ${it.title}`, 'success'); void refreshNav(); } catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const ctx = (e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, it: NavItem) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, it }); };

  const row = (it: NavItem): ReactNode => {
    const dot = dotOf(it); const t0 = it.startedAt ?? 0; const end = it.endedAt ?? 0;
    const timer = it.kind === 'connection' ? '' : t0 ? elapsed((end || now) - t0) : '';
    const tip = [it.title, it.agent && it.agent !== it.title ? it.agent : '', it.model ? modelName(it.model) : '', typeof it.costUsd === 'number' ? money(it.costUsd) : '', it.where, it.status, t0 ? `started ${new Date(t0).toLocaleTimeString()}` : '', it.why].filter(Boolean).join(' · ');
    return (
      <button key={it.id} type="button" role="treeitem" className={`fx-menu__item ${N}__item ${shownBy(it) ? 'is-shown' : ''}`} title={tip} aria-label={tip}
        disabled={it.kind === 'connection' && !it.ready}
        onClick={() => act(it)} onContextMenu={(e) => ctx(e, it)}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') { const { clientX, clientY } = e; press.current = setTimeout(() => setMenu({ x: clientX, y: clientY, it }), 550); } }}
        onPointerUp={() => { if (press.current) clearTimeout(press.current); }} onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}>
        <span className={`${N}__icon`}><Icon name={sessionIcon(it)} size={14} />{it.kind !== 'connection' && <span className={`axp-wt__state is-${dot} ${N}__dot`} role="img" aria-label={dot} />}</span>
        {!collapsed && <span className={`${N}__text`}>
          <span className={`${N}__title`}>{it.title}</span>
          <span className={`${N}__sub`}>
            {it.kind === 'chat' ? (it.lastLine || `${it.lines ?? 0} lines`) : it.kind === 'connection' ? (it.ready ? it.detail : it.why) : [it.model && modelName(it.model), it.where, it.kind === 'tmux' && it.attached ? 'attached' : ''].filter(Boolean).join(' · ')}
          </span>
        </span>}
        {!collapsed && <span className={`${N}__meta`}>
          {typeof it.costUsd === 'number' && <span className={`${N}__cost ${it.costEstimated ? 'is-estimate' : ''}`}>{money(it.costUsd)}</span>}
          {timer && <span className={`${N}__timer`} title={t0 ? `started ${new Date(t0).toLocaleString()}` : ''}>{timer}</span>}
        </span>}
      </button>
    );
  };

  const section = (id: SectionId, label: string, icon: string) => {
    const items = v[id]; const shut = prefs.closed.includes(id);
    if (collapsed) {
      if (id === 'connections' || id === 'recent') return null;
      return <div key={id} className={`${N}__group`} role="group" aria-label={label}>{items.slice(0, 12).map(row)}</div>;
    }
    return (
      <div key={id} className={`${N}__group`} role="group" aria-label={label}>
        <button type="button" className={`fx-menu__item ${N}__head`} aria-expanded={!shut} onClick={() => patch({ closed: shut ? prefs.closed.filter((x) => x !== id) : [...prefs.closed, id] })}>
          <Icon name={shut ? 'chevron-right' : 'chevron-down'} size={12} /><Icon name={icon} size={13} /><span className="fx-grow">{label}</span><span className={`${N}__count`}>{items.length}</span>
        </button>
        {!shut && items.map(row)}
        {!shut && items.length === 0 && <div className={`${N}__empty`}>{id === 'mine' ? (m?.vps.ready === false ? 'VPS host not set up' : 'Nothing running') : id === 'agents' ? 'No headless builds running' : id === 'recent' ? 'Nothing ended yet' : 'None'}</div>}
        {!shut && id === 'recent' && <button type="button" className={`fx-menu__item ${N}__link`} onClick={() => rt.navigate('session-checkin')}><Icon name="list" size={13} /><span className="fx-grow">Session browser</span><Icon name="arrow-right" size={12} /></button>}
      </div>
    );
  };

  // phone: swipe the drawer back to close it
  const swipe = useRef<number | null>(null);
  return (
    <>
      {drawer && <div className={`${N}__scrim`} onClick={() => onDrawer(false)} />}
      <nav className={`${N} ${collapsed ? 'is-collapsed' : ''} ${drawer ? 'is-drawer' : ''}`} aria-label="Sessions"
        onTouchStart={(e) => { swipe.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => { const x0 = swipe.current; const x1 = e.changedTouches[0]?.clientX; swipe.current = null; if (drawer && x0 !== null && x1 !== undefined && x0 - x1 > 60) onDrawer(false); }}>
        <div className={`${N}__bar`}>
          <button type="button" className="fx-iconbtn" title={collapsed ? 'Open the sessions list' : 'Collapse to icons'} aria-label={collapsed ? 'Open the sessions list' : 'Collapse the sessions list'} aria-expanded={!collapsed}
            onClick={() => (drawer ? onDrawer(false) : patch({ collapsed: !prefs.collapsed }))}><Icon name={drawer ? 'x' : collapsed ? 'menu' : 'chevron-left'} size={14} /></button>
          {!collapsed && <span className={`${N}__name fx-grow`}>Sessions</span>}
          {!collapsed && <span className={`${N}__live ${isLive ? 'is-on' : ''}`} title={isLive ? 'Live' : 'Updating every few seconds'}>{isLive ? 'live' : 'polling'}</span>}
        </div>
        {!collapsed && (
          <div className={`${N}__tools`}>
            <input className="fx-input" type="search" placeholder="Search sessions" aria-label="Search sessions" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className={`${N}__chips`} role="group" aria-label="Filter and sort">
              {(['all', 'live', 'working', 'waiting'] as Filter[]).map((f) => (
                <button key={f} type="button" className={`fx-chip ${prefs.filter === f ? 'is-on' : ''}`} aria-pressed={prefs.filter === f} onClick={() => patch({ filter: f })}>{f}</button>
              ))}
              <button type="button" className="fx-chip" title="Sort" onClick={() => patch({ sort: prefs.sort === 'started' ? 'recent' : prefs.sort === 'recent' ? 'name' : 'started' })}><Icon name="list" size={11} /> {prefs.sort}</button>
            </div>
          </div>
        )}
        <div className={`${N}__list`} role="tree" aria-label="Sessions">
          {SECTIONS.map((s) => section(s.id, s.label, s.icon))}
        </div>
      </nav>

      {(menu || info || stopAsk) && createPortal(<>
        <div className="axp-wt__scrim" onClick={() => { setMenu(null); setInfo(null); setStopAsk(null); }} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
        {menu && (() => {
          const it = menu.it; const tmux = it.kind === 'tmux' || it.kind === 'headless'; const i = (label: string, icon: string, fn: () => void, disabled = false) => (
            <button key={label} type="button" role="menuitem" className="fx-menu__item" disabled={disabled} onClick={() => { setMenu(null); fn(); }}><Icon name={icon} size={13} /> <span className="fx-grow">{label}</span></button>);
          return (
            <div className="axp-wt__menu fx-popover" role="menu" style={{ left: Math.max(4, Math.min(menu.x, innerWidth - 260)), top: Math.max(4, Math.min(menu.y, innerHeight - 300)) }}>
              {i('Open', 'external', () => act(it), it.kind === 'connection' && !it.ready)}
              {it.kind !== 'connection' && i('Open in a new window', 'layers', () => openItem(rt, hostId, it, { window: true }))}
              {it.kind !== 'connection' && !it.endedAt && i(it.kind === 'chat' ? 'Jump in (open in claude.ai)' : 'Jump in (type into it)', 'edit', () => jumpIn(rt, hostId, it))}
              {tmux && i('Open in Moshi (copy command)', 'smartphone', () => copyMoshi(it))}
              {i('Session info', 'info', () => setInfo(it))}
              {tmux && !it.endedAt && <><div className="axp-wt__sepline" />{i('Stop…', 'x-circle', () => setStopAsk(it))}</>}
            </div>
          );
        })()}
        {info && (
          <div className={`axp-wt__menu fx-popover ${N}__info`} role="dialog" aria-label="Session info">
            <div className="axp-wt__mh">{info.title}</div>
            <dl>
              {([['Kind', info.kind], ['Name', info.name], ['Where', info.where], ['Agent', info.agent], ['Model', info.model && modelName(info.model)], ['Cost', typeof info.costUsd === 'number' ? `${money(info.costUsd)}${info.costEstimated ? ' (estimate)' : ''}` : ''],
                ['Status', info.status], ['Started', info.startedAt ? new Date(info.startedAt).toLocaleString() : ''], ['Ended', info.endedAt ? new Date(info.endedAt).toLocaleString() : ''],
                ['Folder', info.cwd], ['Lines', info.lines !== undefined ? String(info.lines) : ''], ['Link', info.url]] as [string, string | undefined][]).filter(([, x]) => x).map(([k, x]) => (
                <div key={k} className={`${N}__kv`}><dt>{k}</dt><dd>{x}</dd></div>
              ))}
            </dl>
            <button type="button" className="fx-btn fx-btn--ghost" onClick={() => setInfo(null)}>Close</button>
          </div>
        )}
        {stopAsk && (
          <div className={`axp-wt__menu fx-popover ${N}__info`} role="alertdialog">
            <div className="axp-wt__mh">Stop “{stopAsk.title}”?</div>
            <p className={`${N}__warn`}>tmux session {stopAsk.name} on {stopAsk.where === 'console' ? 'the console' : 'the VPS'} ends for good, for every device attached to it (Moshi included).</p>
            <div className="fx-row">
              <button type="button" className="fx-btn fx-btn--danger" onClick={() => void doStop(stopAsk)}>Stop session</button>
              <button type="button" className="fx-btn fx-btn--ghost" onClick={() => setStopAsk(null)}>Cancel</button>
            </div>
          </div>
        )}
      </>, document.body)}
    </>
  );
}

/* ---------------- a chat's mirror feed (tab kind 'feed') ---------------- */
interface FeedLine { at: number; kind: 'note' | 'call'; text: string; tool?: string; ok?: boolean; error?: string; ms?: number }
interface Feed { id: string; session: string; source: string; title: string; agent: string; url: string; model: string; costUsd: number | null; startedAt: number; lastAt: number; items: FeedLine[] }

export function FeedPane({ feed, active }: { feed: string; active: boolean }) {
  const rt = useRuntime();
  const [f, setF] = useState<Feed | null>(null);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useNav(); // re-read when the nav says something changed
  const lastAt = (model?.mine ?? []).concat(model?.recent ?? []).find((x) => x.id === feed)?.lastAt ?? 0;
  useEffect(() => {
    let off = false;
    void call<Feed>(`nav/feed?id=${encodeURIComponent(feed)}`).then((x) => { if (!off) { setF(x); setErr(''); } }, (e: Error) => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, [feed, lastAt]);
  useEffect(() => { if (active) end.current?.scrollIntoView({ block: 'end' }); }, [f?.items.length, active]);
  const url = f?.url && /^https:\/\/claude\.ai\//.test(f.url) ? f.url : '';
  return (
    <div className={`${N}-feed`} hidden={!active}>
      <div className={`${N}-feed__bar`}>
        <Icon name={f?.source === 'claude-ai-voice' ? 'mic' : 'sparkles'} size={14} />
        <span className="fx-grow">{f?.title || f?.session || feed}{f?.agent ? ` · ${f.agent}` : ''}{f?.model ? ` · ${modelName(f.model)}` : ''}{typeof f?.costUsd === 'number' ? ` · ${money(f.costUsd)}` : ''}</span>
        <button type="button" className="fx-btn fx-btn--primary" disabled={!url} title={url ? 'Open this chat in claude.ai; the feed stays here' : 'The chat has not reported its claude.ai link (console_session_note url)'}
          onClick={() => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); else rt.toast('No claude.ai link for this chat yet', 'warning'); }}><Icon name="external" size={13} /> Jump in</button>
      </div>
      <div className={`${N}-feed__list`} role="log" aria-live="polite">
        {err && <div className={`${N}__empty`}>{err}</div>}
        {f && f.items.length === 0 && <div className={`${N}__empty`}>No lines yet. The chat posts them with console_session_note.</div>}
        {f?.items.map((l, k) => (
          <div key={`${l.at}-${k}`} className={`${N}-feed__line is-${l.kind} ${l.ok === false ? 'is-failed' : ''}`}>
            <span className={`${N}-feed__at`}>{new Date(l.at).toLocaleTimeString()}</span>
            {l.kind === 'call' ? <span className={`${N}-feed__tool`}><Icon name={l.ok === false ? 'x-circle' : 'zap'} size={11} /> {l.tool}</span> : null}
            <span className={`${N}-feed__text`}>{l.text}{l.error ? ` (${l.error})` : ''}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
