/*
 * The live preview window (step s13): a floating, movable, resizable window (tab kind `ui-manager-preview`) showing
 * the screen being edited with every pending change, so an element off screen, under the UI Manager window or on a
 * part of the page scrolled away can be seen as it will look. It is the console itself in a same-origin frame at the
 * current route, scaled to fit (or 50 / 75 / 100 %): the override CSS in force (saved plan or the window's draft,
 * web/apply.ts) is mirrored into it on every change, the UI Manager's own windows are hidden in it, and the selected
 * element is scrolled into view and outlined. Nothing in the frame is saved; it never opens a preview of its own.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Note, Segmented, useRuntime } from '@console/axf/react';
import { currentCss, onCss } from './apply';
import { nodesOf } from './live';
import { getUi, setUi, subscribeUi, type PreviewScale } from './state';
import { knownElements } from './useElements';

export const PREVIEW_KIND = 'ui-manager-preview';
export const PREVIEW_ID = 'ui-manager-preview';
const FLAG = 'axf-uim-preview';
const STYLE_ID = 'axp-uim-overrides'; // the same sheet web/apply.ts writes in the console
const HIDE_ID = 'axp-uim-preview-hide';
/** In the frame: the UI Manager's own windows are not part of the screen being edited. */
const HIDE_CSS = `.fx-window:has(.axp-uim), .fx-window:has(.axp-uimp) { display: none; }`;

/** True inside the preview frame: no preview of a preview. */
export const inPreviewFrame = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has(FLAG);

export const isPreviewOpen = (rt: AxfRuntime) => !!rt.windows.groupOf(PREVIEW_ID);

export function openPreview(rt: AxfRuntime): void {
  if (inPreviewFrame()) return;
  const wm = rt.windows;
  const g = wm.groupOf(PREVIEW_ID);
  if (g) { const win = wm.state.windows.find((w) => w.id === wm.state.groups[g]!.windowId); if (win?.minimized) wm.restore(win.id); else if (win) wm.focus(win.id); return; }
  const w = Math.max(280, Math.min(560, Math.round(innerWidth * 0.4)));
  const h = Math.max(220, Math.min(420, Math.round(innerHeight * 0.45)));
  wm.openFloating([{ id: PREVIEW_ID, title: 'Live preview', kind: PREVIEW_KIND, icon: 'eye' }], 'Live preview', 'floating', w, h, 16, Math.max(64, innerHeight - h - 16), { minWidth: 220, minHeight: 160 });
}
export function closePreview(rt: AxfRuntime): void { if (rt.windows.groupOf(PREVIEW_ID)) rt.windows.closeTab(PREVIEW_ID); }
export function togglePreview(rt: AxfRuntime): void { if (isPreviewOpen(rt)) closePreview(rt); else openPreview(rt); }

/** The console's current address, flagged as a preview frame. */
function frameSrc(): string {
  const u = new URL(location.href);
  u.searchParams.set(FLAG, '1');
  return u.toString();
}

function put(doc: Document, id: string, css: string): void {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = doc.createElement('style'); el.id = id; doc.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

const SCALES: { value: PreviewScale; label: string }[] = [{ value: 'fit', label: 'Fit' }, { value: '50', label: '50%' }, { value: '75', label: '75%' }, { value: '100', label: '100%' }];

export function PreviewPane() {
  const rt = useRuntime();
  const ui = useSyncExternalStore(subscribeUi, getUi, getUi);
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState(frameSrc);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(0);
  // follow the console: the frame goes where the console goes
  useEffect(() => { const t = window.setInterval(() => { const s = frameSrc(); setSrc((o) => (o === s ? o : s)); }, 1000); return () => clearInterval(t); }, []);
  // the pane's size, for the fit scale
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // mirror the override CSS (saved or pending) into the frame, on load and on every change
  useEffect(() => {
    const sync = (css: string) => { const d = frame.current?.contentDocument; if (d?.head) { put(d, STYLE_ID, css); put(d, HIDE_ID, HIDE_CSS); } };
    sync(currentCss());
    return onCss(sync);
  }, [loaded]);
  // the selected element: scrolled into view and outlined in the frame
  useEffect(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    d.querySelectorAll('.axp-uim-hover').forEach((n) => n.classList.remove('axp-uim-hover'));
    const e = knownElements().find((x) => x.id === ui.selected);
    const node = e ? nodesOf(e, d)[0] : null;
    if (node) { node.classList.add('axp-uim-hover'); node.scrollIntoView({ block: 'center', inline: 'center' }); }
  }, [ui.selected, loaded]);
  if (inPreviewFrame()) return <Note>The live preview does not open inside itself.</Note>;
  // the frame renders at the console's own size and is scaled down into the pane
  const vw = Math.max(320, innerWidth), vh = Math.max(240, innerHeight);
  const scale = ui.previewScale === 'fit' ? Math.min(1, box.w / vw || 1, box.h / vh || 1) : Number(ui.previewScale) / 100;
  return (
    <div className="axp-uimp" data-help="ui-manager.preview">
      <div className="axp-uim__bar" role="toolbar" aria-label="Live preview">
        <Segmented size="sm" label="Scale" value={ui.previewScale} options={SCALES} onChange={(v) => setUi({ previewScale: v })} />
        <span className="axp-uim__grow fx-small fx-muted">Pending changes shown live; nothing here is saved.</span>
        <Button size="sm" icon="refresh" onClick={() => { setSrc(frameSrc()); frame.current?.contentWindow?.location.reload(); }}>Reload</Button>
        <Button size="sm" tone="ghost" icon="x" onClick={() => closePreview(rt)}>Close</Button>
      </div>
      <div className="axp-uimp__stage" ref={host}>
        <iframe ref={frame} className="axp-uimp__frame" title="Live preview of the screen being edited" src={src} onLoad={() => setLoaded((n) => n + 1)}
          style={{ width: vw, height: vh, transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}
