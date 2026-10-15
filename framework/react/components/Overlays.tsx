/** Overlay engines: dialogs, toasts/popups, and the context menu. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAsset, useFrameState, useRuntime } from '../FrameProvider';
import { Icon } from './Icon';
import { MenuList } from './MenuList';

export interface DialogDef {
  title: string;
  icon?: string;
  render: (props: Record<string, unknown>, close: () => void) => ReactNode;
}
export type DialogMap = Record<string, DialogDef>;

/* ---------------- DialogHost (dialog asset) ---------------- */

export function DialogHost({ dialogs }: { dialogs: DialogMap }) {
  const rt = useRuntime();
  const state = useFrameState();
  const d = useAsset('dialog').data;
  const panelRef = useRef<HTMLDivElement>(null);
  const def = state.dialog ? dialogs[state.dialog.id] : undefined;

  useEffect(() => {
    if (def) panelRef.current?.focus();
  }, [def]);

  if (!state.dialog) return null;
  if (!def) {
    queueMicrotask(() => {
      rt.closeDialog();
      rt.toast(`No dialog is registered as "${state.dialog?.id}".`, 'warning');
    });
    return null;
  }
  const close = () => rt.closeDialog();
  return (
    <div className="fx-backdrop" onPointerDown={(e) => d.closeOnBackdrop && e.target === e.currentTarget && close()}>
      <div className="fx-dialog" role="dialog" aria-modal="true" aria-label={def.title} tabIndex={-1} ref={panelRef}>
        <header className="fx-dialog__head">
          {def.icon && <Icon name={def.icon} size={18} />}
          <h2>{def.title}</h2>
          <button type="button" className="fx-iconbtn" onClick={close} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="fx-dialog__body">{def.render(state.dialog.props ?? {}, close)}</div>
      </div>
    </div>
  );
}

/* ---------------- ToastHost (popup asset) ---------------- */

const TOAST_ICON = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle' } as const;

export function ToastHost() {
  const rt = useRuntime();
  const state = useFrameState();
  const p = useAsset('popup').data;
  return (
    <div className="fx-toasts" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} className={`fx-toast fx-toast--${t.kind}`} role="status">
          {p.showIcon && <Icon name={TOAST_ICON[t.kind]} size={18} className="fx-toast__icon" />}
          <div className="fx-toast__text">
            {t.title && <strong>{t.title}</strong>}
            <span>{t.message}</span>
          </div>
          <button type="button" className="fx-iconbtn" onClick={() => rt.dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- ContextMenuHost (context-menu asset) ---------------- */

export function ContextMenuHost() {
  const rt = useRuntime();
  const state = useFrameState();
  const cm = useAsset('context-menu').data;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const open = (target: Element | null, x: number, y: number) => {
      const el = target?.closest('[data-fx-ctx-target]');
      const name = el?.getAttribute('data-fx-ctx-target') ?? 'default';
      rt.openContext(x, y, name, el?.getAttribute('data-fx-ctx-payload') ?? undefined);
    };
    const onCtx = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest('input, textarea, .fx-ctx')) return;
      if (!t.closest('.fx-shell')) return;
      e.preventDefault();
      open(t, e.clientX, e.clientY);
    };
    // Long-press for touch devices
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const t = e.target as Element;
      if (t.closest('input, textarea, .fx-ctx') || !t.closest('.fx-shell')) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => open(t, e.clientX, e.clientY), 550);
    };
    const cancel = (e: PointerEvent) => {
      if (start && e.type === 'pointermove' && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
      clearTimeout(timer);
      start = null;
    };
    const onAway = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.fx-ctx')) rt.closeContext();
    };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', cancel);
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointerdown', onAway, true);
    window.addEventListener('blur', () => rt.closeContext());
    return () => {
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', cancel);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointerdown', onAway, true);
    };
  }, [rt]);

  // Clamp inside the viewport once measured
  useLayoutEffect(() => {
    if (!state.context || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(state.context.x, window.innerWidth - r.width - 8);
    const y = Math.min(state.context.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [state.context]);

  if (!state.context) return null;
  const items = cm.targets[state.context.target] ?? cm.targets.default ?? [];
  return (
    <div
      ref={ref}
      className="fx-ctx fx-popover"
      style={{ left: pos?.x ?? state.context.x, top: pos?.y ?? state.context.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList
        items={items}
        payload={state.context.payload}
        onDone={() => rt.closeContext()}
        showIcons={cm.showIcons}
        showShortcuts={cm.showShortcuts}
      />
    </div>
  );
}
