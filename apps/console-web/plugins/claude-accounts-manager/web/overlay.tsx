/**
 * The floating accounts window (not a toolbar): a small, narrow window over the console with the account list and
 * Brett's own buttons, each running a console action or opening a sub-menu (static items, or a live list of accounts).
 * Moves by its title bar, resizes from its corner, size lock (no move, no resize), docks to an edge of the console,
 * minimizes to a pill on the main screen. Scope: the console (a layer in this page) or the whole screen (Document
 * Picture-in-Picture: an always-on-top window over every app, where the browser has it). Everything it shows is
 * framework controls and --fx-* tokens, so a theme or style asset restyles it like any other.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, IconButton, Note, useRuntime } from '@console/axf/react';
import { AccountList } from './ui';
import { saveSettings, sessionFor, useManager, type Overlay, type OverlayButton, type View } from './data';

type Pip = { requestWindow: (o: { width: number; height: number }) => Promise<globalThis.Window>; window: globalThis.Window | null };
const pipApi = (): Pip | null => ((globalThis as unknown as { documentPictureInPicture?: Pip }).documentPictureInPicture ?? null);
export const osOverlaySupported = () => !!pipApi();

const patch = (o: Partial<Overlay>) => saveSettings({ overlay: o });

/** Open Claude Code as an account in the Terminal. */
export function openSession(rt: ReturnType<typeof useRuntime>, name: string) {
  sessionFor(name).then((r) => rt.dispatch(`terminal.tab:${encodeURIComponent(JSON.stringify(r.open))}`), (e: Error) => rt.toast(e.message, 'danger'));
}

function ButtonMenu({ b, view, close }: { b: OverlayButton; view: View | null; close: () => void }) {
  const rt = useRuntime();
  const items: { label: string; run: () => void }[] = [
    ...b.menu.map((m) => ({ label: m.label, run: () => { if (m.action) rt.dispatch(m.action); } })),
    ...(b.list && view ? view.accounts.map((r) => ({
      label: `${r.n ? `${r.n}. ` : ''}${r.display}`,
      run: () => {
        if (b.list === 'session') openSession(rt, r.name);
        else if (b.list === 'rename') rt.openDialog('claude-accounts-manager.rename', { name: r.name });
        else void saveSettings({ widget: { account: r.name } });
      },
    })) : []),
  ];
  return (
    <div className="axp-cam-ov__menu fx-popover" role="menu" aria-label={b.label}>
      {items.map((it, i) => <button key={`${i}-${it.label}`} type="button" role="menuitem" className="fx-menu__item" onClick={() => { close(); it.run(); }}>{it.label}</button>)}
      {!items.length && <span className="fx-muted">Nothing here yet: add items in its settings.</span>}
    </div>
  );
}

function Body({ o, view, error, onPopOut }: { o: Overlay; view: View | null; error: string; onPopOut?: () => void }) {
  const rt = useRuntime();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="axp-cam-ov__buttons" role="toolbar" aria-label="Accounts overlay buttons">
        {o.buttons.map((b) => (
          <span key={b.id} className="axp-cam-ov__btnwrap">
            <Button size="sm" tone="ghost" icon={b.icon} aria-expanded={b.menu.length || b.list ? open === b.id : undefined}
              onClick={() => { if (b.menu.length || b.list) setOpen(open === b.id ? null : b.id); else if (b.action) rt.dispatch(b.action); }}>{b.label}</Button>
            {open === b.id && <ButtonMenu b={b} view={view} close={() => setOpen(null)} />}
          </span>
        ))}
      </div>
      {onPopOut && <Note tone="info">Whole-screen scope: <Button size="sm" tone="ghost" icon="external" onClick={onPopOut}>Pop out over every window</Button></Note>}
      <div className="axp-cam-ov__list">
        {error ? <Note tone="warning">{error}</Note> : view ? <AccountList view={view} compact onSession={(n) => openSession(rt, n)} /> : <p className="fx-muted">Loading…</p>}
      </div>
    </>
  );
}

/** Copy the console's styles and theme into the Picture-in-Picture window, so it looks the same and restyles with it. */
function cloneStyles(w: globalThis.Window) {
  for (const n of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) w.document.head.appendChild(n.cloneNode(true));
  for (const a of Array.from(document.documentElement.attributes)) w.document.documentElement.setAttribute(a.name, a.value);
  w.document.body.className = `${document.body.className} axp-cam-pip`;
}

export function OverlayWindow() {
  const { view, settings, error } = useManager();
  const o = settings?.overlay;
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pip, setPip] = useState<globalThis.Window | null>(null);
  const drag = useRef<{ kind: 'move' | 'size'; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => { if ((!o?.open || o.scope !== 'os') && pip) { pip.close(); setPip(null); } }, [o?.open, o?.scope, pip]);
  if (!o?.open) return null;

  const box = live ?? { x: o.x, y: o.y, w: o.w, h: o.h };
  const start = (kind: 'move' | 'size') => (e: RPointerEvent) => {
    if (o.locked || (kind === 'move' && o.dock !== 'free')) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, ...box };
  };
  const moveTo = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    setLive(d.kind === 'move' ? { ...box, x: Math.max(0, Math.min(innerWidth - 80, d.x + dx)), y: Math.max(0, Math.min(innerHeight - 40, d.y + dy)) }
      : { ...box, w: Math.max(160, d.w + dx), h: Math.max(120, d.h + dy) });
  };
  const end = () => { if (drag.current && live) void patch(live); drag.current = null; setLive(null); };

  const popOut = async () => {
    const api = pipApi(); if (!api) return;
    const w = await api.requestWindow({ width: o.w, height: o.h });
    cloneStyles(w);
    w.addEventListener('pagehide', () => setPip(null));
    setPip(w);
  };

  if (o.minimized) {
    return (
      <div className="axp-cam-ov-pill">
        <Button size="sm" tone="neutral" icon="key" title="Restore the accounts window" onClick={() => void patch({ minimized: false })}>Accounts{view ? ` · ${view.totals.accounts}` : ''}</Button>
      </div>
    );
  }

  const frame = (inPip: boolean): ReactNode => (
    <section className={`axp-cam-ov ${inPip ? 'axp-cam-ov--pip' : `axp-cam-ov--dock-${o.dock}`} ${o.locked ? 'is-locked' : ''}`} aria-label="Claude accounts overlay"
      style={inPip ? undefined : { left: o.dock === 'free' ? box.x : undefined, top: o.dock === 'free' ? box.y : undefined, width: o.dock === 'top' || o.dock === 'bottom' ? undefined : box.w, height: o.dock === 'left' || o.dock === 'right' ? undefined : box.h, opacity: o.opacity / 100 }}
      onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end}>
      <header className="axp-cam-ov__bar" onPointerDown={inPip ? undefined : start('move')}>
        <Icon name="key" size={14} /><span className="axp-cam-ov__title">Claude accounts</span>
        {!inPip && <>
          <IconButton icon="lock" label={o.locked ? 'Unlock size and place' : 'Lock size and place'} aria-pressed={o.locked} className={o.locked ? 'is-active' : ''} onClick={() => void patch({ locked: !o.locked })} />
          <IconButton icon="layout" label={`Dock: ${o.dock} (tap for the next)`} onClick={() => { const ds: Overlay['dock'][] = ['free', 'left', 'right', 'top', 'bottom']; void patch({ dock: ds[(ds.indexOf(o.dock) + 1) % ds.length] }); }} />
          <IconButton icon="minimize" label="Minimize to the main screen" onClick={() => void patch({ minimized: true })} />
        </>}
        <IconButton icon="x" label="Close the overlay" onClick={() => void patch({ open: false })} />
      </header>
      <Body o={o} view={view} error={error} onPopOut={!inPip && o.scope === 'os' && !pip && osOverlaySupported() ? () => void popOut() : undefined} />
      {!inPip && o.scope === 'os' && !osOverlaySupported() && <Note tone="warning">This browser can't float a window over other apps (Document Picture-in-Picture): it stays over the console.</Note>}
      {!inPip && !o.locked && o.dock === 'free' && <span className="axp-cam-ov__size" role="separator" aria-label="Resize" onPointerDown={start('size')}><Icon name="grip" size={12} /></span>}
    </section>
  );

  if (pip) return createPortal(frame(true), pip.document.body);
  return frame(false);
}
