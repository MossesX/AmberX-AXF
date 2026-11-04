/*
 * Terminal host (tab kind `terminal-host`): the Windows Terminal-style window body (Brett, Oct 28 2026: "looks and
 * feels and behaves exactly like a Windows program … no Linux feel"). One host per terminal window:
 *   - tab strip: icon, title (double-click renames), status dot, close; drag to reorder; middle-click closes;
 *     right-click = tab menu (rename, duplicate, colour, move to a new window, close / close others / close right)
 *   - + adds a tab like the last one; ∨ opens the new-tab menu (every connection + Settings)
 *   - command toolbar (hideable): new Claude Code tab, the front tab's connection, search, text size, mouse + Mosh
 *     modes, copy / paste, settings
 *   - Windows keys: Ctrl+Shift+T new tab, Ctrl+Shift+W close tab, Ctrl+Tab / Ctrl+Shift+Tab next / previous,
 *     Ctrl+Alt+1…9 jump, Ctrl+Shift+D duplicate, Ctrl+= / Ctrl+- / Ctrl+0 text size
 * Headless tabs (Nov 3 2026): a headless session's tab shows its agent, model, live cost and a status dot (working /
 * waiting / done / failed, meters.ts) and splits into the session and its context chain (SplitView + ChainPane).
 * Closing a tab detaches from its tmux session; the tab menu has Open in Moshi (copies the attach command) and Kill
 * session (with a confirm). The ∨ menu lists running sessions no tab shows, to attach again.
 * Closing the last tab closes the window, like Windows Terminal. Theme tokens only (axp-wt prefix); controls are the
 * framework's (fx-tab, fx-iconbtn, fx-btn, fx-menu__item) so the app's style still applies.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AgentAvatar, Icon, useRuntime, useWindowFrame, useWindowManager } from '@console/axf/react';
import type { TabSpec } from '@console/axf/core';
import { call, getSettings, post, type ClaudeProfile, onSettings, parseOpen, tabSessions, type Open, type Settings, type Target, type TmuxSession } from './api';
import { applyProfile, useProfiles } from './profiles';
import { activate, addSession, ctl, dropHost, host, hostIds, hostOf, move, patchSession, removeSession, sessionId, snapshot, subscribe, titleFor, type HostSession } from './hosts';
import { newWindow } from './open';
import { TerminalSession } from './TerminalSession';
import { follow, meterOf, modelName, money, statusOf, useMeters } from './meters';
import { SplitView, type Split } from './SplitView';
import { ChainPane } from './ChainPane';
import { markClosed } from './headless';

const P = 'axp-wt';
const ICONS: Record<string, string> = { console: 'terminal', vps: 'monitor', claude: 'sparkles', container: 'box', axhub: 'zap' };
export const iconFor = (o: Open) => ICONS[o.kind] ?? 'terminal';

/** Close a tab: its server link closes; a persistent tab's tmux session lives on (detached), like closing Moshi. */
export function closeSession(sid: string, byUser = false) {
  const srv = tabSessions.get(sid); tabSessions.delete(sid);
  if (byUser) { const hid = hostOf(sid); const s = hid ? host(hid).sessions.find((x) => x.id === sid) : null; if (s?.open.attach) markClosed(s.open.attach); }
  if (srv) void call(`sessions/${srv}`, { method: 'DELETE' }).catch(() => undefined);
  removeSession(sid);
}

/** The tmux session a tab lives in, and where. */
export function tmuxOf(s: HostSession): { name: string; where: 'vps' | 'console' } | null {
  const o = s.open; const name = o.attach || o.tmux; if (!name) return null;
  return { name, where: o.attach || o.kind === 'vps' || o.via === 'vps' ? 'vps' : 'console' };
}
/** A headless session's tmux name (axf-…), or ''. */
export const headlessOf = (s: HostSession) => (s.open.attach?.startsWith('axf-') ? s.open.attach : '');

/** Kill session: the tmux session ends for good, then the tab closes. */
export async function killSession(s: HostSession) {
  const srv = tabSessions.get(s.id); const t = tmuxOf(s);
  if (srv) await post(`sessions/${srv}/kill`).catch(() => undefined);
  else if (t) await post('tmux/kill', t).catch(() => undefined);
  tabSessions.delete(s.id); removeSession(s.id);
}

export function TerminalHost({ tab }: { tab: TabSpec }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  useSyncExternalStore(subscribe, snapshot);
  // a legacy `terminal` tab (one session in its payload) becomes a host seeded with that session
  const h = host(tab.id, tab.kind === 'terminal' ? [{ id: tab.id + '-s', title: tab.title, open: parseOpen(tab.payload) }] : undefined);
  const front = h.sessions.find((s) => s.id === h.active) ?? h.sessions[0] ?? null;
  const c = ctl(front?.id);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [drop, setDrop] = useState<{ x: number; y: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toolbarOverride, setToolbar] = useState<boolean | null>(null);
  const toolbar = toolbarOverride ?? settings?.toolbar ?? true;
  const [ask, setAsk] = useState<string | null>(null); // close confirm for a running tab
  const [killAsk, setKillAsk] = useState<string | null>(null); // Kill session confirm
  useMeters();
  const [, tickNow] = useState(0); // waiting = quiet for a minute: re-check now and then
  useEffect(() => { const t = setInterval(() => tickNow((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const headlessNames = h.sessions.map(headlessOf).filter(Boolean).join(',');
  useEffect(() => { const stops = headlessNames ? headlessNames.split(',').map(follow) : []; return () => stops.forEach((f) => f()); }, [headlessNames]);
  const splitOf = (s: HostSession): Split => (headlessOf(s) && settings?.showChain !== false ? s.split ?? settings?.splitDefault ?? 'side' : 'none');
  const copyAttach = (s: HostSession) => {
    const cmd = ctl(s.id)?.info?.attachCmd?.mosh;
    if (!cmd) { rt.toast('This tab has no tmux session to attach to', 'warning'); return; }
    void navigator.clipboard?.writeText(cmd).then(() => rt.toast(`Copied: ${cmd}`, 'success'), () => rt.toast(cmd, 'info'));
  };
  const profiles = useProfiles();
  // frameless window (s17): the strip is the title bar. Empty strip space drags (double-tap maximizes); the caption
  // buttons sit at its end, Windows order: minimize, maximize / restore, close.
  const frame = useWindowFrame();
  const stripDown = (e: React.PointerEvent) => { if (!frame || (e.target as HTMLElement).closest('.fx-tab, button, input, form, [role="menu"]')) return; frame.startMove(e); };
  useEffect(() => { void getSettings().then(setSettings, () => undefined); return onSettings(setSettings); }, []);
  const dragFrom = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const windowId = () => { const g = wm.groupOf(tab.id); return g ? wm.state.groups[g]?.windowId ?? null : null; };
  const add = (o: Open) => addSession(tab.id, { id: sessionId(), title: titleFor(o), open: o });
  const closeNow = (sid: string) => { setAsk(null); closeSession(sid, true); };
  const close = (sid: string) => { const sc = ctl(sid); if (settings?.closeConfirm !== false && sc?.conn === 'live') setAsk(sid); else closeNow(sid); };
  const pick = (mode: 'claude' | 'shell') => rt.openDialog('terminal.connect', { hostId: tab.id, mode });
  const manage = (sid: string) => rt.openDialog('terminal.connection', { sessionId: sid });
  const newLike = () => (settings?.newTab === 'same' || !front ? add(front?.open ? { ...front.open, attach: undefined, tmux: undefined } : { kind: 'console' }) : pick(front.open.kind === 'claude' ? 'claude' : 'shell'));
  const duplicate = (s: HostSession) => addSession(tab.id, { id: sessionId(), title: s.title, open: { ...s.open, attach: undefined, tmux: undefined }, color: s.color }, h.sessions.indexOf(s) + 1);
  const toNewWindow = (s: HostSession) => { removeSession(s.id); newWindow(rt, [s]); };

  // the last tab closed: the window closes, like Windows Terminal
  useEffect(() => { if (h.sessions.length === 0) { const w = windowId(); if (w) wm.close(w); else wm.closeTab(tab.id); } }, [h.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window closed (host gone from every group): its sessions close on the server too
  useEffect(() => () => { setTimeout(() => { if (!wm.groupOf(tab.id)) { for (const s of host(tab.id).sessions) closeSession(s.id, true); dropHost(tab.id); } }, 800); }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Windows Terminal keys (on the whole window, so they work from the terminal screen too)
  useEffect(() => {
    const el = root.current; if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase(); const list = host(tab.id).sessions; const i = list.findIndex((s) => s.id === host(tab.id).active);
      const go = (j: number) => { const s = list[(j + list.length) % list.length]; if (s) activate(tab.id, s.id); };
      let done = true;
      if (e.ctrlKey && e.shiftKey && k === 't') add(list[i]?.open ? { ...list[i]!.open, attach: undefined, tmux: undefined } : { kind: 'console' });
      else if (e.ctrlKey && e.shiftKey && k === 'w') { const s = list[i]; if (s) close(s.id); }
      else if (e.ctrlKey && e.shiftKey && k === 'd') { const s = list[i]; if (s) duplicate(s); }
      else if (e.ctrlKey && k === 'tab') go(e.shiftKey ? i - 1 : i + 1);
      else if (e.ctrlKey && e.altKey && /^[1-9]$/.test(k)) go(k === '9' ? list.length - 1 : Number(k) - 1);
      else if (e.ctrlKey && !e.shiftKey && (k === '=' || k === '+')) ctl(list[i]?.id)?.zoom(1);
      else if (e.ctrlKey && !e.shiftKey && k === '-') ctl(list[i]?.id)?.zoom(-1);
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };
    el.addEventListener('keydown', onKey, true);
    return () => el.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const item = (label: string, icon: string, fn: () => void, opts: { disabled?: boolean; hint?: string } = {}): ReactNode => (
    <button key={label} type="button" role="menuitem" className="fx-menu__item" disabled={opts.disabled} onClick={() => { setMenu(null); setDrop(null); fn(); }}>
      <Icon name={icon} size={13} /> <span className="fx-grow">{label}</span>{opts.hint && <span className={`${P}__hint`}>{opts.hint}</span>}
    </button>
  );
  const at = (x: number, y: number, w = 240, hgt = 360) => ({ left: Math.max(4, Math.min(x, innerWidth - w)), top: Math.max(4, Math.min(y, innerHeight - hgt)) });
  const target = front?.open ? describe(front.open) : '';

  return (
    <div ref={root} className={`${P} ${settings?.mica === false ? '' : `${P}--mica`} ${settings?.windowsLook === false ? `${P}--plain` : ''} ${P}--tabs-${settings?.tabWidth ?? 'equal'}`} data-fx-ctx-ignore>
      <div className={`${P}__strip ${frame ? `${P}__strip--titlebar` : ''}`} role="tablist" aria-label="Terminal tabs" onPointerDown={stripDown} onContextMenu={(e) => { if (!frame || (e.target as HTMLElement).closest('.fx-tab, button')) return; e.preventDefault(); e.stopPropagation(); rt.openContext(e.clientX, e.clientY, 'window-title', frame.w.id); }}>
        {h.sessions.map((s, i) => {
          const sc = ctl(s.id); const on = s.id === front?.id;
          const hl = headlessOf(s); const m = hl ? meterOf(hl) : null; const st = statusOf(m);
          const label = !s.renamed && m?.agent ? m.agent : s.title;
          return (
            <div key={s.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} draggable={!renaming}
              className={`fx-tab ${P}__tab ${on ? 'is-active' : ''} ${hl ? 'is-headless' : ''}`} style={s.color ? { ['--axp-wt-tint' as string]: `var(--fx-${s.color})` } : undefined} data-tint={s.color ? '' : undefined}
              title={`${label}${m ? ` · ${modelName(m.model)} · ${money(m.costUsd)}${m.costEstimated ? ' (estimate)' : ''} · ${st}` : ''}${s.open ? ` · ${describe(s.open)}` : ''}`}
              onClick={() => activate(tab.id, s.id)}
              onDoubleClick={() => setRenaming({ id: s.id, text: s.title })}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(s.id); } }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: s.id }); }}
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
              onDragOver={(e) => { if (dragFrom.current !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) move(tab.id, dragFrom.current, i); dragFrom.current = null; }}
              onDragEnd={() => { dragFrom.current = null; }}>
              {st ? <span className={`${P}__state is-${st}`} role="img" aria-label={st} /> : <Icon name={iconFor(s.open)} size={14} />}
              {hl ? <AgentAvatar agent={hl} size="small" noMenu /> : null}
              {renaming?.id === s.id ? (
                <form onSubmit={(e) => { e.preventDefault(); patchSession(s.id, { title: renaming.text.trim() || s.title, renamed: true }); setRenaming(null); }}>
                  <input className={`fx-input ${P}__rename`} autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: s.id, text: e.target.value })} onBlur={() => { patchSession(s.id, { title: renaming.text.trim() || s.title, renamed: true }); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} aria-label="Tab name" />
                </form>
              ) : <span className={`${P}__name`}>{label}</span>}
              {m && <span className={`${P}__meta`}>{m.model && <span className={`${P}__model`}>{modelName(m.model)}</span>}<span className={`${P}__cost ${m.costEstimated ? 'is-estimate' : ''}`} aria-label={`cost ${money(m.costUsd)}`}>{money(m.costUsd)}</span></span>}
              {sc && sc.conn !== 'live' && <span className={`${P}__dot is-${sc.conn}`} aria-label={sc.conn} />}
              {sc?.info?.badge && <span className={`${P}__badge`} title={sc.info.badge}><Icon name="alert" size={11} /></span>}
              <button type="button" className={`fx-iconbtn ${P}__close`} title="Close tab (Ctrl+Shift+W)" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); close(s.id); }}><Icon name="x" size={12} /></button>
            </div>
          );
        })}
        <button type="button" className={`fx-iconbtn ${P}__new`} title="New tab (Ctrl+Shift+T)" aria-label="New tab" onClick={newLike}><Icon name="plus" size={14} /></button>
        <button type="button" className={`fx-iconbtn ${P}__new`} title="Open a tab: pick the connection" aria-label="New tab menu" aria-expanded={!!drop}
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDrop({ x: r.left, y: r.bottom + 2 }); }}><Icon name="chevron-down" size={14} /></button>
        <span className={`${P}__drag`} />
        {frame && (
          <div className={`${P}__caption`} role="group" aria-label="Window">
            {frame.canMinimize && <button type="button" className={`fx-iconbtn ${P}__cap`} title="Minimize" aria-label="Minimize" onPointerDown={(e) => e.stopPropagation()} onClick={frame.minimize}><Icon name="minimize" size={14} /></button>}
            <button type="button" className={`fx-iconbtn ${P}__cap`} title={frame.maximized ? 'Restore down' : 'Maximize'} aria-label={frame.maximized ? 'Restore down' : 'Maximize'} onPointerDown={(e) => e.stopPropagation()} onClick={frame.toggleMaximize}><Icon name={frame.maximized ? 'restore' : 'maximize'} size={13} /></button>
            {frame.w.closable && <button type="button" className={`fx-iconbtn ${P}__cap ${P}__cap--close`} title="Close" aria-label="Close window" onPointerDown={(e) => e.stopPropagation()} onClick={frame.close}><Icon name="x" size={14} /></button>}
          </div>
        )}
      </div>

      {toolbar && (
        <div className={`${P}__toolbar`} role="toolbar" aria-label="Terminal commands">
          <button type="button" className="fx-btn fx-btn--ghost" title="New Claude Code tab: pick a connection" onClick={() => pick('claude')}><Icon name="sparkles" size={14} /> Claude Code</button>
          <span className={`${P}__sep`} />
          <button type="button" className={`fx-chip ${P}__conn`} title="This tab's connection" disabled={!front} onClick={() => { if (front) manage(front.id); }}>
            <Icon name={front ? iconFor(front.open) : 'terminal'} size={13} /> {target || 'No tab'}
            {c?.info?.badge && <strong className={`${P}__flag`}>{c.info.badge}</strong>}
          </button>
          <span className="fx-grow" />
          <button type="button" className="fx-iconbtn" title="Find (Ctrl+Shift+F)" disabled={!c} onClick={() => c?.search()}><Icon name="search" size={14} /></button>
          <button type="button" className="fx-iconbtn" title="Smaller text (Ctrl+-)" disabled={!c} onClick={() => c?.zoom(-1)}>A−</button>
          <button type="button" className="fx-iconbtn" title="Bigger text (Ctrl+=)" disabled={!c} onClick={() => c?.zoom(1)}>A+</button>
          <button type="button" className={`fx-iconbtn ${c?.mouse ? 'is-active' : ''}`} aria-pressed={!!c?.mouse} title="Mouse mode: a click moves the cursor" disabled={!c} onClick={() => c?.setMouse(!c.mouse)}><Icon name="monitor" size={14} /></button>
          <button type="button" className={`fx-iconbtn ${c?.mosh ? 'is-active' : ''}`} aria-pressed={!!c?.mosh} title="Mosh mode: the session lives on the server and survives dropped signal" disabled={!c} onClick={() => c?.setMosh(!c.mosh)}><Icon name="zap" size={14} /></button>
          <button type="button" className="fx-iconbtn" title="Copy (Ctrl+Shift+C)" disabled={!c} onClick={() => c?.copy()}><Icon name="copy" size={14} /></button>
          <button type="button" className="fx-iconbtn" title="Paste (Ctrl+Shift+V)" disabled={!c} onClick={() => c?.paste(false)}><Icon name="paste" size={14} /></button>
          <button type="button" className="fx-iconbtn" title="Terminal settings" onClick={() => rt.dispatch('settings.open:terminal')}><Icon name="settings" size={14} /></button>
          <button type="button" className="fx-iconbtn" title="Hide this toolbar (right-click a tab to show it again)" onClick={() => setToolbar(false)}><Icon name="chevron-up" size={14} /></button>
        </div>
      )}

      {killAsk && (() => { const s = h.sessions.find((x) => x.id === killAsk); const t = s ? tmuxOf(s) : null; return s ? (
        <div className={`axp-terminal__warn`} role="alertdialog">
          <Icon name="alert" size={14} /><span className="fx-grow">Kill “{s.title}”{t ? ` (tmux ${t.name})` : ''}? Whatever runs in it stops, for every device attached to it.</span>
          <button type="button" className="fx-btn fx-btn--danger" onClick={() => { setKillAsk(null); void killSession(s); }}>Kill session</button>
          <button type="button" className="fx-btn fx-btn--ghost" onClick={() => setKillAsk(null)}>Cancel</button>
        </div>) : null; })()}
      {ask && (() => { const s = h.sessions.find((x) => x.id === ask); return s ? (
        <div className={`axp-terminal__warn`} role="alertdialog">
          <Icon name="alert" size={14} /><span className="fx-grow">Close “{s.title}”? {tmuxOf(s) ? 'It keeps running in its tmux session (reopen it from ∨ → Running sessions).' : 'It’s still running.'}</span>
          <button type="button" className="fx-btn fx-btn--danger" onClick={() => closeNow(s.id)}>Close</button>
          <button type="button" className="fx-btn fx-btn--ghost" onClick={() => setAsk(null)}>Cancel</button>
        </div>) : null; })()}
      <div className={`${P}__body`}>
        {h.sessions.map((s) => {
          const hl = headlessOf(s); const on = s.id === front?.id;
          return <SplitView key={s.id} split={splitOf(s)} active={on}
            a={<TerminalSession s={s} active={on} onClose={() => close(s.id)} onRename={() => setRenaming({ id: s.id, text: s.title })} />}
            b={hl ? <ChainPane session={hl} settings={settings} /> : null} />;
        })}
      </div>

      {(menu || drop) && createPortal(<>
      {(menu || drop) && <div className={`${P}__scrim`} onClick={() => { setMenu(null); setDrop(null); }} onContextMenu={(e) => { e.preventDefault(); setMenu(null); setDrop(null); }} />}
        {menu && (() => {
          const s = h.sessions.find((x) => x.id === menu.id); if (!s) return null; const i = h.sessions.indexOf(s);
          return (
            <div className={`${P}__menu fx-popover`} role="menu" style={at(menu.x, menu.y)}>
              {item('Connection…', 'shuffle', () => manage(s.id))}
              {item('Rename tab', 'edit', () => setRenaming({ id: s.id, text: s.title }))}
              {item('Duplicate tab', 'copy', () => duplicate(s), { hint: 'Ctrl+Shift+D' })}
              <div className={`${P}__colors`} role="group" aria-label="Tab colour">
                {[null, 'accent', 'success', 'warning', 'danger', 'info'].map((col) => (
                  <button key={col ?? 'none'} type="button" data-fx-row className={`${P}__swatch ${s.color === (col ?? undefined) ? 'is-on' : ''}`} style={col ? { ['--axp-wt-tint' as string]: `var(--fx-${col})` } : undefined} title={col ?? 'No colour'} aria-label={col ? `Colour ${col}` : 'No colour'} onClick={() => { patchSession(s.id, { color: col ?? undefined }); setMenu(null); }} />
                ))}
              </div>
              {item('Move to a new window', 'external', () => toNewWindow(s), { disabled: h.sessions.length < 2 })}
              {headlessOf(s) && settings?.showChain !== false && <>
                <div className={`${P}__mh`}>Split</div>
                {([['side', 'Side by side', 'layout'], ['stacked', 'Stacked', 'layers'], ['none', 'No split', 'minus']] as const).map(([v, l, ic]) =>
                  item(l, splitOf(s) === v ? 'check' : ic, () => patchSession(s.id, { split: v })))}
              </>}
              <div className={`${P}__sepline`} />
              {item('Open in Moshi (copy command)', 'smartphone', () => copyAttach(s), { disabled: !tmuxOf(s) })}
              {item('Kill session…', 'x-circle', () => setKillAsk(s.id), { disabled: !tmuxOf(s) })}
              {!toolbar && item('Show the toolbar', 'layout', () => setToolbar(true))}
              <div className={`${P}__sepline`} />
              {item('Close tab', 'x', () => close(s.id), { hint: 'Ctrl+Shift+W' })}
              {item('Close other tabs', 'x', () => h.sessions.filter((x) => x.id !== s.id).forEach((x) => close(x.id)), { disabled: h.sessions.length < 2 })}
              {item('Close tabs to the right', 'x', () => h.sessions.slice(i + 1).forEach((x) => close(x.id)), { disabled: i === h.sessions.length - 1 })}
            </div>
          );
        })()}
        {drop && <NewTabMenu at={at(drop.x, drop.y, 280, 480)} profiles={profiles.items} onPick={(o, color) => { setDrop(null); addSession(tab.id, { id: sessionId(), title: titleFor(o), open: o, color }); }}
          picker={(m) => { setDrop(null); pick(m); }} settings={() => { setDrop(null); rt.dispatch('settings.open:terminal'); }} />}
  </>, document.body)}
    </div>
  );
}

/** One line saying where a tab is connected. */
export function describe(o: Open): string {
  switch (o.kind) {
    case 'console': return 'Console container';
    case 'vps': return o.attach ? `VPS host · ${o.attach}` : 'VPS host (root)';
    case 'claude': return `Claude Code · ${o.via === 'vps' ? 'VPS host' : o.via === 'axhub' ? 'axHub' : o.via === 'container' ? o.container ?? 'container' : 'console'}`;
    case 'container': return `Container · ${o.container ?? '?'}`;
    default: return String(o.kind);
  }
}

/** ∨: every place a tab can open, like Windows Terminal's profile list. */
function NewTabMenu({ at, profiles, onPick, picker, settings }: { at: { left: number; top: number }; profiles: ClaudeProfile[]; onPick(o: Open, color?: string): void; picker(m: 'claude' | 'shell'): void; settings(): void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [status, setStatus] = useState<{ claude: boolean; vps: { ready: boolean }; containers: boolean } | null>(null);
  const [tmux, setTmux] = useState<TmuxSession[]>([]);
  useEffect(() => {
    void call<{ claude: boolean; vps: { ready: boolean }; containers: boolean }>('status').then(setStatus, () => undefined);
    void call<{ items: Target[] }>('targets').then((r) => setTargets(r.items), () => setTargets([]));
    void call<{ vps: { items: TmuxSession[] }; console: TmuxSession[] }>('tmux').then((r) => setTmux([...r.vps.items, ...r.console]), () => undefined);
  }, []);
  // running tmux sessions no tab on this page shows (detached tabs, headless runs whose tab was closed)
  const shown = new Set(hostIds().flatMap((id) => host(id).sessions.map((s) => s.open.attach || s.open.tmux || '')));
  const running = tmux.filter((t) => !shown.has(t.name));
  const row = (label: string, icon: string, o: Open, opts: { disabled?: boolean; title?: string; hint?: string } = {}) => (
    <button key={label} type="button" role="menuitem" className="fx-menu__item" disabled={opts.disabled} title={opts.title} onClick={() => onPick(o)}>
      <Icon name={icon} size={13} /> <span className="fx-grow">{label}</span>{opts.hint && <span className="axp-wt__hint">{opts.hint}</span>}
    </button>
  );
  return (
    <div className="axp-wt__menu fx-popover" role="menu" style={at}>
      <button type="button" role="menuitem" className="fx-menu__item" onClick={() => picker('claude')}><Icon name="sparkles" size={13} /> <span className="fx-grow">Claude Code…</span><span className="axp-wt__hint">pick a connection</span></button>
      {profiles.length > 0 && <div className="axp-wt__mh">Claude Code profiles</div>}
      {profiles.map((p) => (
        <button key={p.id} type="button" role="menuitem" className="fx-menu__item" onClick={() => onPick({ ...applyProfile(p), ...viaOf(p.connection) } as Open, p.color || undefined)}>
          <Icon name={p.icon || 'sparkles'} size={13} /> <span className="fx-grow">{p.name}</span><span className="axp-wt__hint">{p.connection.replace('container:', '')}</span>
        </button>
      ))}
      <div className="axp-wt__sepline" />
      <button type="button" role="menuitem" className="fx-menu__item" onClick={() => picker('shell')}><Icon name="terminal" size={13} /> <span className="fx-grow">Shell…</span><span className="axp-wt__hint">pick a connection</span></button>
      {row('Console (this container)', 'terminal', { kind: 'console' })}
      {row('VPS host (root)', 'monitor', { kind: 'vps' }, { disabled: !status?.vps.ready, title: status?.vps.ready ? '' : 'Set up the VPS host in Settings → Plugins → Terminal' })}
      {(targets ?? []).length > 0 && <div className="axp-wt__mh">Containers</div>}
      {(targets ?? []).map((t) => row(t.name, t.protected ? 'lock' : 'box', { kind: 'container', container: t.name }, { hint: t.protected ? 'protected' : '' }))}
      {status && !status.containers && <div className="axp-wt__mh fx-muted">Install Container access for container shells</div>}
      {running.length > 0 && <><div className="axp-wt__sepline" /><div className="axp-wt__mh">Running sessions</div></>}
      {running.map((t) => row(t.agent && t.kind === 'headless' ? `${t.agent} (${t.name})` : t.name, t.kind === 'headless' ? 'sparkles' : t.where === 'vps' ? 'monitor' : 'terminal',
        t.where === 'vps' ? { kind: 'vps', attach: t.name, title: t.kind === 'headless' ? `Claude: ${t.name.slice(4)}` : t.name } : { kind: 'console', tmux: t.name, title: t.name },
        { hint: t.attached ? 'attached elsewhere' : t.where }))}
      <div className="axp-wt__sepline" />
      <button type="button" role="menuitem" className="fx-menu__item" onClick={settings}><Icon name="settings" size={13} /> <span className="fx-grow">Settings</span></button>
    </div>
  );
}

/** A profile's default connection as the Claude Code part of an Open. */
function viaOf(conn: string): Partial<Open> {
  if (conn.startsWith('container:')) return { kind: 'claude', via: 'container', container: conn.slice(10) };
  return { kind: 'claude', via: conn === 'vps' || conn === 'axhub' ? conn : 'console' };
}
