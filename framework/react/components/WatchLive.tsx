/*
 * Watch live (watch-live@1) — the link and the popup that show a session's live preview: the exact screen it is
 * changing, hot-rendering as files change, with the changed element scrolled to and outlined (the page-side helper is
 * framework/core/watch-live.ts). Desktop: a floating window you can drag and resize. Phone: a full-screen sheet.
 * Data-free: the host app passes the preview (url, label, focus, note); the console gets them from /api/previews.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { withFocusParams, type WatchLiveFocus } from '../../core/watch-live';
import { useIsPhone } from './AppMenu';
import { Button, IconButton } from './Controls';
import { Note } from './Forms';
import { Icon } from './Icon';
import { usePortalRoot } from './InterfaceScope';

export interface WatchLivePreview {
  session: string;
  app: string;
  label?: string;
  /** proxied URL (empty while the preview is starting or has failed) */
  url: string;
  status?: string;
  why?: string;
  focus?: WatchLiveFocus | null;
  /** shown in the popup: e.g. an Android screen whose code changes only show in the next APK */
  note?: string;
  android?: boolean;
}

/** The preview URL with the focus parameters for the page-side helper. */
export function watchLiveSrc(p: WatchLivePreview): string {
  return withFocusParams(p.url, p.focus ?? null);
}

/** "Watch live" when a preview is ready; a greyed "No live preview" otherwise (with why, when known). */
export function WatchLiveLink({ previews, className }: { previews: WatchLivePreview[]; className?: string }) {
  const [open, setOpen] = useState<WatchLivePreview | null>(null);
  const ready = previews.filter((p) => p.url);
  if (!ready.length) {
    const why = previews.find((p) => p.why || p.status)?.why || (previews[0] ? `preview ${previews[0].status ?? 'starting'}` : 'this session has no live preview');
    return <Button size="sm" tone="quiet" icon="eye" disabled title={why} className={`fx-watchlive-link is-none ${className ?? ''}`}>No live preview</Button>;
  }
  return (
    <span className={`fx-watchlive-link ${className ?? ''}`}>
      {ready.map((p) => (
        <Button key={`${p.session}/${p.app}`} size="sm" tone="ghost" icon="eye" title={p.focus?.note || `Watch ${p.label ?? p.app} live`}
          onClick={(e) => { e.stopPropagation(); setOpen(p); }}>
          {ready.length > 1 ? `Watch live · ${p.label ?? p.app}` : 'Watch live'}
        </Button>
      ))}
      {open && <WatchLiveWindow preview={open} onClose={() => setOpen(null)} />}
    </span>
  );
}

/** The popup itself: floating window (desktop) or full-screen sheet (phone). */
export function WatchLiveWindow({ preview, onClose }: { preview: WatchLivePreview; onClose: () => void }) {
  const phone = useIsPhone();
  const root = usePortalRoot();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [rev, setRev] = useState(0);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const src = watchLiveSrc(preview);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phone || (e.target as HTMLElement).closest('button')) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) });
  };
  const up = () => { drag.current = null; };

  const focusText = preview.focus?.note || preview.focus?.selector || '';
  return createPortal(
    <div className={`fx-watchlive ${phone ? 'is-sheet' : 'is-float'}`} role="dialog" aria-label={`Watch live: ${preview.label ?? preview.app}`}
      style={!phone && pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="fx-watchlive__head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <span className="fx-watchlive__live" aria-hidden="true" />
        <Icon name="eye" size={14} />
        <strong className="fx-watchlive__title">Watch live · {preview.label ?? preview.app}</strong>
        {focusText && <span className="fx-watchlive__focus" title={preview.focus?.selector}>{focusText}</span>}
        <span className="fx-watchlive__tools">
          <IconButton icon="refresh" label="Reload the preview" onClick={() => setRev((r) => r + 1)} />
          <IconButton icon="external" label="Open in a new tab" onClick={() => window.open(src, '_blank', 'noopener')} />
          <IconButton icon="x" label="Close" onClick={onClose} />
        </span>
      </div>
      {(preview.note || preview.android) && <Note tone="info" className="fx-watchlive__note">{preview.note || 'Android screen through the web port: code changes show in the next APK.'}</Note>}
      <iframe key={rev} className="fx-watchlive__frame" src={src} title={`Live preview of ${preview.label ?? preview.app}`} />
    </div>,
    root,
  );
}
