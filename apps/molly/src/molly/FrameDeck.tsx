import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAxfState } from '../axf/react';
import { deepLink, MOLLY_APPS, mollyApp } from './apps';

/**
 * Molly keeps every app it has opened alive. Moving an iframe in the DOM reloads it, so the frames never move: they
 * live in one deck at the end of <body>, and the frame of the app on screen is laid exactly over that view's slot
 * (an empty box the view renders; the frame covers the main region around it). Leaving a view only hides its frame, so switching apps never loses their state.
 */

type Rect = { top: number; left: number; width: number; height: number };

const slotListeners = new Set<() => void>();
const slots = new Map<string, HTMLElement>();
const notify = () => slotListeners.forEach((f) => f());

/** Reload / reopen requests from the menus and toolbar (actions.ts). */
const reloads = new Map<string, number>();
export function reloadFrame(id: string) {
  reloads.set(id, (reloads.get(id) ?? 0) + 1);
  notify();
}

/** The box a view gives its app's frame. */
export function AppSlot({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    slots.set(id, el);
    notify();
    return () => {
      if (slots.get(id) === el) slots.delete(id);
      notify();
    };
  }, [id]);
  return <div ref={ref} className="molly-slot" data-app={id} />;
}

function useSlotRect(id: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    slotListeners.add(f);
    return () => { slotListeners.delete(f); };
  }, []);
  // The frame fills the whole main region the slot sits in (edge to edge, past the view's padding).
  const slot = id ? slots.get(id) ?? null : null;
  const el = slot ? (slot.closest('.fx-main') as HTMLElement | null) ?? slot : null;
  useLayoutEffect(() => {
    if (!el) { setRect(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((p) => (p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height ? p : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [el]);
  return rect;
}

/** Every opened app's frame; mounted once, next to the shell. */
export function FrameDeck() {
  const view = useAxfState().view;
  const active = mollyApp(view) ? view : null;
  const rect = useSlotRect(active);
  // First address per app: a deep link on load (#/<app>/<route>), else the app's own start page.
  const [srcs] = useState(() => {
    const m = new Map<string, string>();
    const link = deepLink(window.location.hash);
    if (link) m.set(link.app.id, link.src);
    return m;
  });
  const [opened, setOpened] = useState<string[]>(() => (active ? [active] : []));
  useEffect(() => { if (active && !opened.includes(active)) setOpened((o) => [...o, active]); }, [active, opened]);

  return createPortal(
    <div className="molly-deck">
      {MOLLY_APPS.filter((a) => opened.includes(a.id)).map((a) => {
        const on = a.id === active && rect !== null;
        return (
          <iframe
            key={`${a.id}:${reloads.get(a.id) ?? 0}`}
            title={a.label}
            className="molly-frame"
            data-on={on ? 'true' : 'false'}
            src={srcs.get(a.id) ?? a.url}
            allow="clipboard-read; clipboard-write; microphone; fullscreen; autoplay"
            style={on && rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
          />
        );
      })}
    </div>,
    document.body,
  );
}
