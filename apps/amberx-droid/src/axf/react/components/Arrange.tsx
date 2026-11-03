/*
 * Arrange mode for widget hosts — on the banner it is the banner editor (Brett, Nov 3 2026): long-press the banner on
 * touch, or right-click → Edit banner, or the `banner.edit` command / Settings → Appearance. Each widget gets an × (or
 * drag it off the bar, or Delete) to remove it, the palette adds any banner widget back, Undo takes back the last change,
 * Reset puts the host's own arrangement back, Done / Esc leaves.
 *
 * Arrange mode for widget hosts (banner, toolbar, any host a library registers): drag a widget and it snaps into the
 * gap between the others on the side under the pointer, so nothing sits on top of anything. The drop is saved at once
 * through rt.moveHostItem (setting `axf.widgets.arrange.<host>`, part of the look) and every copy redraws (hot render).
 * Arrow keys move the focused widget one place (across sides at the ends). The snap rule is the engine's (snapIndex).
 * Theme tokens only.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { hostSpec, snapIndex, type PlacedAttachment } from '../../core/engines/widgets';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, IconButton } from './Controls';

interface Drag { key: string; startX: number; startY: number; dx: number; dy: number; side: string; index: number; moved: boolean; off: boolean }

/** Pixels the pointer must travel before a press becomes a drag (a tap stays a tap). */
const DRAG_SLOP = 4;
/** How far outside the host (in host heights) a widget must be dragged to be removed when dropped. */
const DRAG_OFF = 1.5;

export interface ArrangeApi {
  on: boolean;
  drag: Drag | null;
  /** Props for one side's container (it holds that side's items). */
  sideProps: (side: string) => Record<string, string>;
  /** Wrap one placed item: drag handle + key moves while arranging, plain otherwise. */
  item: (p: PlacedAttachment, index: number, className: string, extra: Record<string, string | undefined>, children: ReactNode) => ReactNode;
  /** The drop marker for a side at an index (render it between items). */
  marker: (side: string, index: number) => ReactNode;
}

export function useArrange(host: string, placed: Record<string, PlacedAttachment[]>): ArrangeApi {
  const rt = useRuntime();
  useAxfState();
  const on = rt.arranging(host);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const sides = hostSpec(host)?.sides ?? [];

  const update = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  // Which side is under the pointer (the nearest side box horizontally), and where on it the item would snap.
  const target = useCallback((key: string, x: number, origin: Element | null): { side: string; index: number } | null => {
    const root = origin?.closest(`[data-axf-arrange-host="${host}"]`);
    if (!root) return null;
    let best: { side: string; el: Element; dist: number } | null = null;
    for (const el of root.querySelectorAll(`[data-axf-arrange-side]`)) {
      const r = el.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const side = el.getAttribute('data-axf-arrange-side')!;
      if (!best || dist < best.dist) best = { side, el, dist };
    }
    if (!best) return null;
    const mids = [...best.el.querySelectorAll('[data-axf-arrange-item]')]
      .filter((n) => n.getAttribute('data-axf-arrange-item') !== key)
      .map((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; });
    return { side: best.side, index: snapIndex(mids, x) };
  }, [host]);

  const onDown = (p: PlacedAttachment, side: string, index: number) => (e: PointerEvent<HTMLElement>) => {
    if (!on || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    update({ key: p.key, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, side, index, moved: false, off: false });
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    const moved = d.moved || Math.hypot(dx, dy) > DRAG_SLOP;
    const t = moved ? target(d.key, e.clientX, e.currentTarget) : null;
    // dragged well above or below the bar: dropping it there removes it
    const r = e.currentTarget.closest(`[data-axf-arrange-host="${host}"]`)?.getBoundingClientRect();
    const off = !!r && moved && (e.clientY < r.top - r.height * DRAG_OFF || e.clientY > r.bottom + r.height * DRAG_OFF);
    update({ ...d, dx, dy, moved, off, ...(t ?? {}) });
  };
  const onUp = () => {
    const d = dragRef.current;
    update(null);
    if (d?.moved && d.off) rt.removeHostItem(host, d.key);
    else if (d?.moved) rt.moveHostItem(host, d.key, d.side, d.index);
  };

  // Keyboard: ← / → one place; past the first / last item of a side it moves to the next side.
  const onKey = (p: PlacedAttachment, side: string, index: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (!on) return;
    if (e.key === 'Escape') { rt.setArranging(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); rt.removeHostItem(host, p.key); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const si = sides.indexOf(side);
    const count = (placed[side] ?? []).length;
    if (e.key === 'ArrowLeft') {
      if (index > 0) rt.moveHostItem(host, p.key, side, index - 1);
      else if (si > 0) rt.moveHostItem(host, p.key, sides[si - 1]!, (placed[sides[si - 1]!] ?? []).length);
    } else {
      if (index < count - 1) rt.moveHostItem(host, p.key, side, index + 1);
      else if (si < sides.length - 1) rt.moveHostItem(host, p.key, sides[si + 1]!, 0);
    }
    // keep focus on the moved widget after the redraw
    requestAnimationFrame(() => (document.querySelector(`[data-axf-arrange-host="${host}"] [data-axf-arrange-item="${p.key}"]`) as HTMLElement | null)?.focus());
  };
  // While arranging a tap never runs the widget (its buttons, links and search stay inert).
  const swallow = (e: MouseEvent) => { if (on) { e.preventDefault(); e.stopPropagation(); } };

  const sideOf = (key: string) => sides.find((s) => (placed[s] ?? []).some((p) => p.key === key));

  return {
    on,
    drag,
    sideProps: (side) => (on ? { 'data-axf-arrange-side': side } : {}) as Record<string, string>,
    item: (p, index, className, extra, children) => {
      const side = sideOf(p.key) ?? sides[0] ?? '';
      const dragging = drag?.key === p.key && drag.moved;
      return (
        <span
          key={p.key}
          className={`${className}${on ? ' fx-arrange__item' : ''}${dragging ? ' is-dragging' : ''}${dragging && drag!.off ? ' is-off' : ''}`}
          {...extra}
          {...(on ? {
            'data-axf-arrange-item': p.key,
            tabIndex: 0,
            role: 'button',
            'aria-label': `${p.type} ${p.id}: drag, or use the arrow keys, to move it; Delete removes it`,
            title: 'Drag to move · drag off the bar or × to remove · arrow keys move one place',
            onPointerDown: onDown(p, side, index),
            onPointerMove: onMove,
            onPointerUp: onUp,
            onPointerCancel: () => update(null),
            onKeyDown: onKey(p, side, index),
            onClickCapture: swallow,
            style: dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)` } : undefined,
          } : {})}
        >
          {children}
          {on && (
            <IconButton
              icon="x"
              label={`Remove ${p.id}`}
              className="fx-arrange__remove"
              data-axf-help-id="banner-editor.remove"
              onPointerDown={(e) => e.stopPropagation()}
              onClickCapture={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); rt.removeHostItem(host, p.key); }}
            />
          )}
        </span>
      );
    },
    marker: (side, index) => {
      if (!drag?.moved || drag.side !== side || drag.index !== index) return null;
      return <span key={`marker:${side}`} className="fx-arrange__marker" aria-hidden="true" />;
    },
  };
}

/** Render a side's items with the drop marker in the gap the dragged item would snap into. */
export function arrangedSide(api: ArrangeApi, side: string, list: PlacedAttachment[], draw: (p: PlacedAttachment, index: number) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const key = api.drag?.moved ? api.drag.key : null;
  let gap = 0; // position among the items other than the dragged one
  list.forEach((p, i) => {
    if (p.key !== key) { out.push(api.marker(side, gap)); gap++; }
    out.push(draw(p, i));
  });
  out.push(api.marker(side, gap));
  return out;
}

/**
 * The bar shown while a host is being arranged (the banner editor's bar on the banner): what to do, the palette of
 * widgets that aren't on the host (tap one to add it at the end; it can then be dragged into place), Undo, Reset, Done.
 * Esc leaves, Ctrl/Cmd+Z undoes.
 */
export function ArrangeBar({ host, label }: { host: string; label: string }) {
  const rt = useRuntime();
  useAxfState();
  const on = rt.arranging(host);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!on) { setAdding(false); return undefined; }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); rt.setArranging(null); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !(e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); rt.undoHostArrangement(host); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [on, rt, host]);
  if (!on) return null;
  const editor = host === 'banner';
  const palette = rt.hostPalette(host);
  return (
    <div className={`fx-arrange__bar fx-row${editor ? ' fx-arrange__bar--editor' : ''}`} role="toolbar" aria-label={editor ? 'Edit banner' : `Arrange ${label}`} data-fx-ctx-ignore="" data-axf-help-id={editor ? 'banner-editor.bar' : undefined}>
      <span className="fx-arrange__hint">{editor ? 'Drag widgets to move them; they snap into place. × or drag off the bar removes one.' : `Drag the ${label} widgets to arrange them. They snap into place.`}</span>
      <span className="fx-arrange__actions fx-row">
        <Button size="sm" tone="quiet" icon="plus" aria-expanded={adding} data-axf-help-id="banner-editor.add" onClick={() => setAdding((v) => !v)} disabled={!palette.length && !adding}>Add{palette.length ? ` (${palette.length})` : ''}</Button>
        {editor && <Button size="sm" tone="quiet" icon="grid" data-axf-help-id="action:banners.gallery" title="Start from another banner: the boilerplate gallery" onClick={() => { rt.setArranging(null); rt.dispatch('banners.gallery'); }}>Boilerplates</Button>}
        <Button size="sm" tone="quiet" icon="undo" data-axf-help-id="banner-editor.undo" disabled={!rt.canUndoArrange(host)} onClick={() => rt.undoHostArrangement(host)}>Undo</Button>
        <Button size="sm" tone="quiet" icon="refresh" data-axf-help-id="banner-editor.reset" disabled={!Object.keys(rt.hostArrangement(host)).length} onClick={() => rt.resetHostArrangement(host)}>Reset</Button>
        <Button size="sm" tone="primary" icon="check" data-axf-help-id="banner-editor.done" onClick={() => rt.setArranging(null)}>Done</Button>
      </span>
      {adding && (
        <div className="fx-arrange__palette" role="list" aria-label="Widgets you can add">
          {palette.length ? palette.map((w) => (
            <Button key={w.key} size="sm" tone="neutral" icon="plus" role="listitem" className="fx-arrange__pick" title={`Add ${w.name} (${w.type})${w.removed ? ' back' : ''}`} onClick={() => rt.addHostItem(host, w.key)}>
              {w.name}<span className="fx-arrange__type">{w.type}{w.removed ? ' · removed' : ''}</span>
            </Button>
          )) : <span className="fx-arrange__hint">Every widget is on the {label}.</span>}
        </div>
      )}
    </div>
  );
}
