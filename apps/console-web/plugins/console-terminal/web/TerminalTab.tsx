/*
 * One terminal tab (tab kind `terminal`, payload = JSON Open). A floating window holds several; tabs can be renamed,
 * reordered and dragged out like any console tab. Each tab has: a status dot, the HOST ROOT / PROTECTED badge,
 * mouse mode, Mosh mode (server-kept session, auto-reconnect, predictive echo), search, font size, copy/paste,
 * its own right-click / long-press menu, a multi-line paste warning and a phone key row.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Icon, useRuntime, useWindowManager } from '@console/axf/react';
import type { TabSpec } from '@console/axf/core';
import { call, getSettings, loadXterm, parseOpen, post, socketUrl, tabPrefs, tabSessions, themeFromTokens, type Open, type SessionInfo, type Settings, type Target, type XTerm } from './api';
import { newTab } from './open';

type Conn = 'connecting' | 'live' | 'reconnecting' | 'closed';
const P = 'axp-terminal';

const KEYS: { label: string; seq?: string; mod?: 'ctrl' }[] = [
  { label: 'Ctrl', mod: 'ctrl' }, { label: 'Esc', seq: '\x1b' }, { label: 'Tab', seq: '\t' }, { label: '←', seq: '\x1b[D' }, { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' }, { label: '→', seq: '\x1b[C' }, { label: '|', seq: '|' }, { label: '~', seq: '~' }, { label: '/', seq: '/' }, { label: '-', seq: '-' },
];

export function TerminalTab({ tab }: { tab: TabSpec }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  const open = useMemo(() => parseOpen(tab.payload), [tab.payload]);
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const searchRef = useRef<{ findNext(t: string): boolean; findPrevious(t: string): boolean } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const alive = useRef(true);
  const ctrl = useRef(false);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const prefs = tabPrefs.get(tab.id);
  const [mouse, setMouse] = useState(prefs?.mouse ?? false);
  const [mosh, setMosh] = useState(prefs?.mosh ?? false);
  const [fontSize, setFontSize] = useState(14);
  const [search, setSearch] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState('');
  const [pasteAsk, setPasteAsk] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [plus, setPlus] = useState(false);

  const send = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data));
    if (mosh && /^[\x20-\x7e]+$/.test(data)) setPending((p) => (p + data).slice(-80)); // predictive echo until the server answers
  };

  /* -------- session + socket -------- */
  const connect = async (sid: string, attempt = 0): Promise<void> => {
    if (!alive.current) return;
    setConn(attempt ? 'reconnecting' : 'connecting');
    let url: string;
    try { url = await socketUrl(sid, offset.current); } catch (e) { return retry(sid, attempt, (e as Error).message); }
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onmessage = (m) => {
      const t = termRef.current;
      if (typeof m.data === 'string') {
        const msg = JSON.parse(m.data) as { type: string; reset?: boolean; offset?: number; info?: SessionInfo };
        if (msg.type === 'hello') {
          if (msg.reset) t?.reset();
          offset.current = msg.offset ?? 0;
          if (msg.info) setInfo(msg.info);
          setConn('live'); setErr('');
          const fit = fitRef.current; if (fit) { fit.fit(); if (t) ws.send(`\x00resize:${t.cols},${t.rows}`); }
        } else if (msg.type === 'exit') { setConn('closed'); alive.current = false; }
        return;
      }
      const bytes = new Uint8Array(m.data as ArrayBuffer);
      offset.current += bytes.length;
      setPending('');
      t?.write(bytes);
    };
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!alive.current || e.code === 4404) { setConn('closed'); return; }
      void retry(sid, attempt, 'connection lost');
    };
  };
  const retry = async (sid: string, attempt: number, why: string) => {
    if (!alive.current) return;
    const maxTries = mosh ? Infinity : 8;
    if (attempt >= maxTries) { setConn('closed'); setErr(why); return; }
    setConn('reconnecting');
    await new Promise((r) => setTimeout(r, Math.min(5000, 400 * 2 ** Math.min(attempt, 4))));
    await connect(sid, attempt + 1);
  };

  const start = async (o: Open) => {
    setErr('');
    try {
      let sid = tabSessions.get(tab.id);
      if (!sid) {
        const t = termRef.current;
        const s = await post<SessionInfo>('sessions', { ...o, mosh, cols: t?.cols ?? 100, rows: t?.rows ?? 30 });
        sid = s.id; tabSessions.set(tab.id, sid); setInfo(s);
      }
      await connect(sid);
    } catch (e) {
      const m = (e as Error).message;
      if (/protected/i.test(m) && !o.confirmProtected) { setConfirm(m); return; }
      setErr(m); setConn('closed');
    }
  };

  /* -------- xterm -------- */
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const s = await getSettings().catch(() => null);
      if (s) { setSettings(s); setFontSize(s.fontSize); if (!prefs) { setMouse(s.mouseDefault); setMosh(s.moshDefault); } }
      const L = await loadXterm().catch((e: Error) => { setErr(e.message); return null; });
      if (!L || disposed || !host.current) return;
      const el = host.current;
      const term = new L.Terminal({
        fontFamily: getComputedStyle(el).getPropertyValue('--fx-font-mono').trim() || 'monospace', fontSize: s?.fontSize ?? 14, cursorBlink: true, scrollback: 5000,
        allowProposedApi: true, theme: themeFromTokens(el), macOptionIsMeta: true, rightClickSelectsWord: false, altClickMovesCursor: true,
      });
      const fit = new L.FitAddon();
      const search = new L.SearchAddon();
      term.loadAddon(fit); term.loadAddon(search);
      term.loadAddon(new L.WebLinksAddon((_e, uri) => { if (/^https?:\/\//.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer'); }));
      term.open(el);
      fit.fit();
      termRef.current = term; fitRef.current = fit; searchRef.current = search;
      const d1 = term.onData((d) => {
        if (ctrl.current && d.length === 1) { const c = d.toUpperCase().charCodeAt(0); ctrl.current = false; setCtrlOn(false); if (c >= 64 && c <= 95) { send(String.fromCharCode(c - 64)); return; } }
        send(d);
      });
      const d2 = term.onBinary((d) => { const ws = wsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0))); });
      const d3 = term.onResize(({ cols, rows }) => { const ws = wsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(`\x00resize:${cols},${rows}`); });
      const d4 = term.onSelectionChange(() => { if (s?.copyOnSelect && term.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()).catch(() => undefined); });
      cleanups.push(() => { d1.dispose(); d2.dispose(); d3.dispose(); d4.dispose(); });
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const k = e.key.toLowerCase();
        if (e.ctrlKey && e.shiftKey && k === 'c') { void navigator.clipboard?.writeText(term.getSelection()); return false; }
        if (e.ctrlKey && e.shiftKey && k === 'v') { void pasteFromClipboard(false); return false; }
        if (e.ctrlKey && !e.shiftKey && k === 'c' && term.hasSelection()) { void navigator.clipboard?.writeText(term.getSelection()); term.clearSelection(); return false; }
        if (e.ctrlKey && !e.shiftKey && k === 'v') return false; // the browser's paste event delivers it (with the multi-line warning)
        if (e.ctrlKey && e.shiftKey && k === 'f') { setSearch(''); return false; }
        return true;
      });
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
      ro.observe(el);
      cleanups.push(() => ro.disconnect());
      // multi-line paste warning (capture: before xterm's own textarea handler)
      const onPaste = (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData('text/plain') ?? '';
        e.preventDefault(); e.stopPropagation();
        if (s?.pasteWarn !== false && text.includes('\n')) setPasteAsk(text); else term.paste(text);
      };
      el.addEventListener('paste', onPaste, true);
      cleanups.push(() => el.removeEventListener('paste', onPaste, true));
      void start(open);
    })();
    const onTheme = () => { const t = termRef.current; if (t && host.current) t.options.theme = themeFromTokens(host.current); };
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-fx-scheme'] });
    return () => {
      disposed = true; alive.current = false;
      mo.disconnect();
      cleanups.forEach((f) => f());
      wsRef.current?.close(); wsRef.current = null;
      termRef.current?.dispose(); termRef.current = null;
      const sid = tabSessions.get(tab.id);
      // A tab that moved windows remounts; a closed tab is gone from every group: then the session closes too.
      setTimeout(() => { if (sid && !wm.groupOf(tab.id)) { tabSessions.delete(tab.id); tabPrefs.delete(tab.id); void call(`sessions/${sid}`, { method: 'DELETE' }).catch(() => undefined); } }, 800);
    };
  }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { tabPrefs.set(tab.id, { mouse, mosh }); }, [tab.id, mouse, mosh]);
  useEffect(() => { const t = termRef.current; if (t) { t.options.fontSize = fontSize; fitRef.current?.fit(); } }, [fontSize]);
  useEffect(() => { const sid = tabSessions.get(tab.id); if (sid) void post(`sessions/${sid}/mosh`, { on: mosh }).catch(() => undefined); }, [mosh, tab.id]);

  const pasteFromClipboard = async (plain: boolean) => {
    const t = termRef.current;
    const text = await navigator.clipboard?.readText().catch(() => '') ?? '';
    if (!t || !text) return;
    const clean = plain ? text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') : text;
    if (settings?.pasteWarn !== false && clean.includes('\n')) setPasteAsk(clean); else t.paste(clean);
  };

  /* mouse mode: a click moves the cursor along the current line (apps that track the mouse get the click instead) */
  const onClick = (e: React.MouseEvent) => {
    const t = termRef.current;
    if (!mouse || !t || t.hasSelection() || t.modes.mouseTrackingMode !== 'none') return;
    const screen = host.current?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return;
    const r = screen.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * t.cols);
    const row = Math.floor(((e.clientY - r.top) / r.height) * t.rows);
    const b = t.buffer.active;
    if (row !== b.cursorY + b.baseY - b.viewportY) return;
    const d = col - b.cursorX;
    if (d) send((d > 0 ? '\x1b[C' : '\x1b[D').repeat(Math.min(Math.abs(d), 400)));
  };

  // long-press (touch) opens the terminal menu
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const { clientX: x, clientY: y } = e;
    press.current = setTimeout(() => setMenu({ x, y }), 550);
  };
  const cancelPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };

  const term = termRef.current;
  const close = () => { const sid = tabSessions.get(tab.id); tabSessions.delete(tab.id); if (sid) void call(`sessions/${sid}`, { method: 'DELETE' }).catch(() => undefined); wm.closeTab(tab.id); };
  const menuItem = (label: string, icon: string, fn: () => void, disabled = false): ReactNode => (
    <button type="button" role="menuitem" className={`${P}__mi`} disabled={disabled} onClick={() => { setMenu(null); fn(); }}><Icon name={icon} size={13} /> {label}</button>
  );

  if (confirm) {
    return (
      <div className={`${P} ${P}--ask`}>
        <div className={`${P}__ask`}>
          <Icon name="alert" size={18} />
          <p>{confirm}</p>
          <p className="fx-small fx-muted">It’s your own shell, so no approval card. The session is logged.</p>
          <div className="fx-row fx-row--wrap">
            <Button tone="danger" icon="terminal" onClick={() => { setConfirm(null); void start({ ...open, confirmProtected: true }); }}>Open a root shell anyway</Button>
            <Button tone="ghost" onClick={close}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${P}`} data-fx-ctx-ignore onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className={`${P}__bar`}>
        <span className={`${P}__dot is-${conn}`} title={conn} aria-label={`connection ${conn}`} />
        {renaming !== null ? (
          <form onSubmit={(e) => { e.preventDefault(); wm.renameTab(tab.id, renaming.trim() || tab.title); setRenaming(null); }} className={`${P}__rename`}>
            <input className="fx-input" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => setRenaming(null)} aria-label="Tab name" />
          </form>
        ) : (
          <button type="button" className={`${P}__title`} title="Rename" onClick={() => setRenaming(tab.title)}>{tab.title}{info?.cwd ? <span className="fx-muted"> · {info.cwd}</span> : null}</button>
        )}
        {info?.badge && <span className={`${P}__badge ${info.badge === 'HOST ROOT' ? 'is-host' : 'is-protected'}`}>{info.badge}</span>}
        <span className="fx-grow" />
        <button type="button" className={`${P}__ib ${mouse ? 'is-on' : ''}`} title="Mouse mode: click moves the cursor; clicks go to apps that use the mouse" aria-pressed={mouse} onClick={() => setMouse(!mouse)}><Icon name="monitor" size={14} /></button>
        <button type="button" className={`${P}__ib ${mosh ? 'is-on' : ''}`} title="Mosh mode: the session lives on the server, survives dropped signal, reconnects by itself" aria-pressed={mosh} onClick={() => setMosh(!mosh)}><Icon name="zap" size={14} /></button>
        <button type="button" className={`${P}__ib`} title="Search (Ctrl+Shift+F)" onClick={() => setSearch(search === null ? '' : null)}><Icon name="search" size={14} /></button>
        <button type="button" className={`${P}__ib`} title="Smaller text" onClick={() => setFontSize((f) => Math.max(9, f - 1))}>A−</button>
        <button type="button" className={`${P}__ib`} title="Bigger text" onClick={() => setFontSize((f) => Math.min(28, f + 1))}>A+</button>
        <div className={`${P}__plusw`}>
          <button type="button" className={`${P}__ib`} title="New terminal tab" aria-expanded={plus} onClick={() => setPlus(!plus)}><Icon name="plus" size={14} /></button>
          {plus && <PlusMenu groupId={wm.groupOf(tab.id)} done={() => setPlus(false)} />}
        </div>
      </div>
      {search !== null && (
        <form className={`${P}__search`} onSubmit={(e) => { e.preventDefault(); searchRef.current?.findNext(search); }}>
          <input className="fx-input" autoFocus placeholder="Find in terminal" value={search} onChange={(e) => { setSearch(e.target.value); searchRef.current?.findNext(e.target.value); }} />
          <button type="button" className={`${P}__ib`} onClick={() => searchRef.current?.findPrevious(search)}><Icon name="chevron-up" size={14} /></button>
          <button type="button" className={`${P}__ib`} onClick={() => searchRef.current?.findNext(search)}><Icon name="chevron-down" size={14} /></button>
          <button type="button" className={`${P}__ib`} onClick={() => setSearch(null)}><Icon name="x" size={14} /></button>
        </form>
      )}
      {pasteAsk !== null && (
        <div className={`${P}__warn`} role="alertdialog">
          <span className="fx-grow">Paste {pasteAsk.split('\n').length} lines? Each line runs as you paste it.</span>
          <Button tone="primary" onClick={() => { term?.paste(pasteAsk); setPasteAsk(null); term?.focus(); }}>Paste</Button>
          <Button tone="ghost" onClick={() => { setPasteAsk(null); term?.focus(); }}>Cancel</Button>
        </div>
      )}
      <div ref={host} className={`${P}__screen ${mouse ? 'is-mouse' : ''}`} onClick={onClick} onPointerDown={onPointerDown} onPointerUp={cancelPress} onPointerMove={cancelPress} onPointerCancel={cancelPress} />
      {mosh && pending && conn !== 'live' && <div className={`${P}__predict`} aria-live="polite">{pending}</div>}
      {(conn === 'reconnecting' || conn === 'closed' || err) && (
        <div className={`${P}__status`}>
          {conn === 'reconnecting' ? <span>Reconnecting{mosh ? ' (Mosh mode: nothing is lost)' : ''}…</span> : conn === 'closed' ? <span>{err ? `Closed: ${err}` : 'Session ended.'}</span> : <span>{err}</span>}
          {conn === 'closed' && <Button tone="ghost" icon="refresh" onClick={() => { alive.current = true; tabSessions.delete(tab.id); offset.current = 0; termRef.current?.reset(); void start(open); }}>Start again</Button>}
        </div>
      )}
      <div className={`${P}__keys`} role="toolbar" aria-label="Extra keys">
        {KEYS.map((k) => (
          <button key={k.label} type="button" className={`${P}__key ${k.mod && ctrlOn ? 'is-on' : ''}`} onClick={() => {
            if (k.mod) { ctrl.current = !ctrl.current; setCtrlOn(ctrl.current); } else if (k.seq) send(k.seq);
            term?.focus();
          }}>{k.label}</button>
        ))}
        <button type="button" className={`${P}__key`} title="Copy" onClick={() => { if (term?.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()); }}><Icon name="copy" size={12} /></button>
        <button type="button" className={`${P}__key`} title="Paste" onClick={() => void pasteFromClipboard(false)}><Icon name="paste" size={12} /></button>
      </div>
      {menu && (
        <>
          <div className={`${P}__scrim`} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className={`${P}__menu fx-popover`} role="menu" style={{ left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 320) }}>
            {menuItem('Copy', 'copy', () => { if (term?.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()); }, !term?.hasSelection())}
            {menuItem('Paste', 'paste', () => void pasteFromClipboard(false))}
            {menuItem('Paste as plain text', 'paste', () => void pasteFromClipboard(true))}
            {menuItem('Select all', 'list', () => term?.selectAll())}
            {menuItem('Clear', 'trash', () => term?.clear())}
            {menuItem('Search', 'search', () => setSearch(''))}
            {menuItem('Open link', 'external', () => { const sel = term?.getSelection().trim() ?? ''; if (/^https?:\/\/\S+$/.test(sel)) window.open(sel, '_blank', 'noopener,noreferrer'); else rt.toast('Select a link first', 'warning'); })}
            {menuItem('Rename tab', 'edit', () => setRenaming(tab.title))}
            {menuItem('Close terminal', 'x', close)}
          </div>
        </>
      )}
    </div>
  );
}

/** “+”: another terminal in the same window. */
function PlusMenu({ groupId, done }: { groupId: string | null; done: () => void }) {
  const rt = useRuntime();
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [status, setStatus] = useState<{ claude: boolean; vps: { ready: boolean }; containers: boolean } | null>(null);
  useEffect(() => {
    void call<{ claude: boolean; vps: { ready: boolean }; containers: boolean }>('status').then(setStatus, () => undefined);
    void call<{ items: Target[] }>('targets').then((r) => setTargets(r.items), () => setTargets([]));
  }, []);
  const add = (o: Open) => { newTab(rt, o, groupId); done(); };
  return (
    <div className="axp-terminal__menu axp-terminal__plus fx-popover" role="menu">
      <button type="button" role="menuitem" className="axp-terminal__mi" onClick={() => add({ kind: 'console' })}><Icon name="terminal" size={13} /> Console (this container)</button>
      <button type="button" role="menuitem" className="axp-terminal__mi" disabled={!status?.vps.ready} title={status?.vps.ready ? '' : 'Set up the VPS host in Settings → Plugins → Terminal'} onClick={() => add({ kind: 'vps' })}><Icon name="monitor" size={13} /> VPS host (root)</button>
      <button type="button" role="menuitem" className="axp-terminal__mi" disabled={!status?.claude} onClick={() => add({ kind: 'claude' })}><Icon name="sparkles" size={13} /> Claude Code</button>
      {status?.containers && <div className="axp-terminal__mh">Containers</div>}
      {(targets ?? []).map((t) => (
        <button key={t.name} type="button" role="menuitem" className="axp-terminal__mi" onClick={() => add({ kind: 'container', container: t.name })}>
          <Icon name={t.protected ? 'lock' : 'box'} size={13} /> {t.name}{t.protected ? <span className="fx-muted"> · protected</span> : null}
        </button>
      ))}
      {status && !status.containers && <div className="axp-terminal__mh fx-muted">Install Container access for container shells</div>}
    </div>
  );
}
