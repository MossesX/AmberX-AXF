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
 * Closing the last tab closes the window, like Windows Terminal. Theme tokens only (axp-wt prefix); controls are the
 * framework's (fx-tab, fx-iconbtn, fx-btn, fx-menu__item) so the app's style still applies.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, useRuntime, useWindowManager } from '@console/axf/react';
import type { TabSpec } from '@console/axf/core';
import { call, parseOpen, tabSessions, type Open, type Target } from './api';
import { activate, addSession, ctl, dropHost, host, move, patchSession, removeSession, sessionId, snapshot, subscribe, titleFor, type HostSession } from './hosts';
import { newWindow } from './open';
import { TerminalSession } from './TerminalSession';

const P = 'axp-wt';
const ICONS: Record<string, string> = { console: 'terminal', vps: 'monitor', claude: 'sparkles', container: 'box', axhub: 'zap' };
export const iconFor = (o: Open) => ICONS[o.kind] ?? 'terminal';

/** Close a session for good: its server session too. */
export function closeSession(sid: string) {
  const srv = tabSessions.get(sid); tabSessions.delete(sid);
  if (srv) void call(`sessions/${srv}`, { method: 'DELETE' }).catch(() => undefined);
  removeSession(sid);
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
  const [toolbar, setToolbar] = useState(true);
  const dragFrom = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const windowId = () => { const g = wm.groupOf(tab.id); return g ? wm.state.groups[g]?.windowId ?? null : null; };
  const add = (o: Open) => addSession(tab.id, { id: sessionId(), title: titleFor(o), open: o });
  const close = (sid: string) => closeSession(sid);
  const duplicate = (s: HostSession) => addSession(tab.id, { id: sessionId(), title: s.title, open: { ...s.open, attach: undefined }, color: s.color }, h.sessions.indexOf(s) + 1);
  const toNewWindow = (s: HostSession) => { removeSession(s.id); newWindow(rt, [s]); };

  // the last tab closed: the window closes, like Windows Terminal
  useEffect(() => { if (h.sessions.length === 0) { const w = windowId(); if (w) wm.close(w); else wm.closeTab(tab.id); } }, [h.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window closed (host gone from every group): its sessions close on the server too
  useEffect(() => () => { setTimeout(() => { if (!wm.groupOf(tab.id)) { for (const s of host(tab.id).sessions) closeSession(s.id); dropHost(tab.id); } }, 800); }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Windows Terminal keys (on the whole window, so they work from the terminal screen too)
  useEffect(() => {
    const el = root.current; if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase(); const list = host(tab.id).sessions; const i = list.findIndex((s) => s.id === host(tab.id).active);
      const go = (j: number) => { const s = list[(j + list.length) % list.length]; if (s) activate(tab.id, s.id); };
      let done = true;
      if (e.ctrlKey && e.shiftKey && k === 't') add(list[i]?.open ?? { kind: 'console' });
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
    <div ref={root} className={P} data-fx-ctx-ignore>
      <div className={`${P}__strip`} role="tablist" aria-label="Terminal tabs">
        {h.sessions.map((s, i) => {
          const sc = ctl(s.id); const on = s.id === front?.id;
          return (
            <div key={s.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} draggable={!renaming}
              className={`fx-tab ${P}__tab ${on ? 'is-active' : ''}`} style={s.color ? { ['--axp-wt-tint' as string]: `var(--fx-${s.color})` } : undefined} data-tint={s.color ? '' : undefined}
              title={`${s.title}${s.open ? ` · ${describe(s.open)}` : ''}`}
              onClick={() => activate(tab.id, s.id)}
              onDoubleClick={() => setRenaming({ id: s.id, text: s.title })}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(s.id); } }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: s.id }); }}
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); }}
              onDragOver={(e) => { if (dragFrom.current !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) move(tab.id, dragFrom.current, i); dragFrom.current = null; }}
              onDragEnd={() => { dragFrom.current = null; }}>
              <Icon name={iconFor(s.open)} size={14} />
              {renaming?.id === s.id ? (
                <form onSubmit={(e) => { e.preventDefault(); patchSession(s.id, { title: renaming.text.trim() || s.title }); setRenaming(null); }}>
                  <input className={`fx-input ${P}__rename`} autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: s.id, text: e.target.value })} onBlur={() => { patchSession(s.id, { title: renaming.text.trim() || s.title }); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} aria-label="Tab name" />
                </form>
              ) : <span className={`${P}__name`}>{s.title}</span>}
              {sc && sc.conn !== 'live' && <span className={`${P}__dot is-${sc.conn}`} aria-label={sc.conn} />}
              {sc?.info?.badge && <span className={`${P}__badge`} title={sc.info.badge}><Icon name="alert" size={11} /></span>}
              <button type="button" className={`fx-iconbtn ${P}__close`} title="Close tab (Ctrl+Shift+W)" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); close(s.id); }}><Icon name="x" size={12} /></button>
            </div>
          );
        })}
        <button type="button" className={`fx-iconbtn ${P}__new`} title="New tab (Ctrl+Shift+T)" aria-label="New tab" onClick={() => add(front?.open ? { ...front.open, attach: undefined } : { kind: 'console' })}><Icon name="plus" size={14} /></button>
        <button type="button" className={`fx-iconbtn ${P}__new`} title="Open a tab: pick the connection" aria-label="New tab menu" aria-expanded={!!drop}
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDrop({ x: r.left, y: r.bottom + 2 }); }}><Icon name="chevron-down" size={14} /></button>
        <span className={`${P}__drag`} />
      </div>

      {toolbar && (
        <div className={`${P}__toolbar`} role="toolbar" aria-label="Terminal commands">
          <button type="button" className="fx-btn fx-btn--ghost" title="New Claude Code tab" onClick={() => add({ kind: 'claude' })}><Icon name="sparkles" size={14} /> Claude Code</button>
          <span className={`${P}__sep`} />
          <button type="button" className={`fx-chip ${P}__conn`} title="This tab's connection" disabled={!front} onClick={(e) => { if (front) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2, id: front.id }); } }}>
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

      <div className={`${P}__body`}>
        {h.sessions.map((s) => <TerminalSession key={s.id} s={s} active={s.id === front?.id} onClose={() => close(s.id)} onRename={() => setRenaming({ id: s.id, text: s.title })} />)}
      </div>

      {(menu || drop) && <div className={`${P}__scrim`} onClick={() => { setMenu(null); setDrop(null); }} onContextMenu={(e) => { e.preventDefault(); setMenu(null); setDrop(null); }} />}
      {menu && (() => {
        const s = h.sessions.find((x) => x.id === menu.id); if (!s) return null; const i = h.sessions.indexOf(s);
        return (
          <div className={`${P}__menu fx-popover`} role="menu" style={at(menu.x, menu.y)}>
            {item('Rename tab', 'edit', () => setRenaming({ id: s.id, text: s.title }))}
            {item('Duplicate tab', 'copy', () => duplicate(s), { hint: 'Ctrl+Shift+D' })}
            <div className={`${P}__colors`} role="group" aria-label="Tab colour">
              {[null, 'accent', 'success', 'warning', 'danger', 'info'].map((col) => (
                <button key={col ?? 'none'} type="button" className={`${P}__swatch ${s.color === (col ?? undefined) ? 'is-on' : ''}`} style={col ? { ['--axp-wt-tint' as string]: `var(--fx-${col})` } : undefined} title={col ?? 'No colour'} aria-label={col ? `Colour ${col}` : 'No colour'} onClick={() => { patchSession(s.id, { color: col ?? undefined }); setMenu(null); }} />
              ))}
            </div>
            {item('Move to a new window', 'external', () => toNewWindow(s), { disabled: h.sessions.length < 2 })}
            {!toolbar && item('Show the toolbar', 'layout', () => setToolbar(true))}
            <div className={`${P}__sepline`} />
            {item('Close tab', 'x', () => close(s.id), { hint: 'Ctrl+Shift+W' })}
            {item('Close other tabs', 'x', () => h.sessions.filter((x) => x.id !== s.id).forEach((x) => close(x.id)), { disabled: h.sessions.length < 2 })}
            {item('Close tabs to the right', 'x', () => h.sessions.slice(i + 1).forEach((x) => close(x.id)), { disabled: i === h.sessions.length - 1 })}
          </div>
        );
      })()}
      {drop && <NewTabMenu at={at(drop.x, drop.y, 280, 440)} onPick={(o) => { setDrop(null); add(o); }} settings={() => { setDrop(null); rt.dispatch('settings.open:terminal'); }} />}
    </div>
  );
}

/** One line saying where a tab is connected. */
export function describe(o: Open): string {
  switch (o.kind) {
    case 'console': return 'Console container';
    case 'vps': return o.attach ? `VPS host · ${o.attach}` : 'VPS host (root)';
    case 'claude': return 'Claude Code';
    case 'container': return `Container · ${o.container ?? '?'}`;
    default: return String(o.kind);
  }
}

/** ∨: every place a tab can open, like Windows Terminal's profile list. */
function NewTabMenu({ at, onPick, settings }: { at: { left: number; top: number }; onPick(o: Open): void; settings(): void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [status, setStatus] = useState<{ claude: boolean; vps: { ready: boolean }; containers: boolean } | null>(null);
  useEffect(() => {
    void call<{ claude: boolean; vps: { ready: boolean }; containers: boolean }>('status').then(setStatus, () => undefined);
    void call<{ items: Target[] }>('targets').then((r) => setTargets(r.items), () => setTargets([]));
  }, []);
  const row = (label: string, icon: string, o: Open, opts: { disabled?: boolean; title?: string; hint?: string } = {}) => (
    <button key={label} type="button" role="menuitem" className="fx-menu__item" disabled={opts.disabled} title={opts.title} onClick={() => onPick(o)}>
      <Icon name={icon} size={13} /> <span className="fx-grow">{label}</span>{opts.hint && <span className="axp-wt__hint">{opts.hint}</span>}
    </button>
  );
  return (
    <div className="axp-wt__menu fx-popover" role="menu" style={at}>
      {row('Claude Code', 'sparkles', { kind: 'claude' }, { disabled: status ? !status.claude : false })}
      {row('Console (this container)', 'terminal', { kind: 'console' })}
      {row('VPS host (root)', 'monitor', { kind: 'vps' }, { disabled: !status?.vps.ready, title: status?.vps.ready ? '' : 'Set up the VPS host in Settings → Plugins → Terminal' })}
      {status?.containers && <div className="axp-wt__mh">Containers</div>}
      {(targets ?? []).map((t) => row(t.name, t.protected ? 'lock' : 'box', { kind: 'container', container: t.name }, { hint: t.protected ? 'protected' : '' }))}
      {status && !status.containers && <div className="axp-wt__mh fx-muted">Install Container access for container shells</div>}
      <div className="axp-wt__sepline" />
      <button type="button" role="menuitem" className="fx-menu__item" onClick={settings}><Icon name="settings" size={13} /> <span className="fx-grow">Settings</span><span className="axp-wt__hint">Ctrl+,</span></button>
    </div>
  );
}
