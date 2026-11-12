/**
 * Collapse / expand + auto-collapse on every toolbar (Brett, Nov 12 2026, build collapse-and-auto-collapse-buttons-on-
 * every-tab: "All tab groups and toolbars and nav menus and application menus need a, auto collapse button or, and a
 * collapsible button.").
 *
 * The app toolbar and page toolbars (Chrome.tsx), tab groups (TabGroup.tsx), nav menus and the menu bar draw their own
 * fold button. Every other toolbar (a plugin's or a library's own `role="toolbar"` row) gets it from here, the same way
 * tap-to-confirm reaches them (tapConfirm.ts): mounted once by <AxfProvider>, it finds each such toolbar and renders a
 * collapse / expand button at its end through a portal. Its settings id is the toolbar's (`data-axf-toolbar`,
 * `data-axf-toolbar-asset`, else its aria-label, the same id tap-to-confirm and the Toolbars library use), so:
 *
 *   folded              setting axf.toolbar.<id>.collapsed (per device; chrome.fold:toolbar:<id>:fold|unfold|toggle)
 *   collapse button     chrome field `collapsible` (on by default; chrome.set:toolbar:<id>:collapsible:off hides it)
 *   auto-collapse       chrome field `autoCollapse` (chrome.set:toolbar:<id>:autoCollapse:on folds it after a tool is used)
 *   settings            right-click the toolbar → Toolbar settings… (it is given the chrome context target when it has none)
 *
 * A toolbar that must never fold says so in code: `data-axf-no-fold="<why>"`. Folded, every child but the button is
 * hidden by axf.css (`[data-axf-fold-host][data-axf-folded='on']`); nothing is restyled.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHROME_FOLD_KEY, CHROME_FOLD_LABELS, CHROME_INSTANCE_KEY, type AxfRuntime } from '../core';
import { toolbarElementId } from './tapConfirm';
import { Icon } from './components/Icon';

/** Toolbars that draw their own fold (the framework's), or opted out, or sit inside another toolbar. */
function ownsFold(el: HTMLElement): boolean {
  if (el.dataset.axfNoFold !== undefined) return true;
  if (el.dataset.axfToolbar === 'app' || el.dataset.axfToolbarAsset) return true;
  if (el.querySelector(':scope > [data-axf-fold]:not([data-axf-fold-portal])')) return true;
  return !!el.parentElement?.closest('[role="toolbar"]');
}

/** Every toolbar on the page that should get the shared fold button. */
export function foldableToolbars(doc: Document = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('[role="toolbar"]')).filter((el) => !ownsFold(el));
}

function FoldButton({ rt, el }: { rt: AxfRuntime; el: HTMLElement }) {
  const id = toolbarElementId(el);
  const [, tick] = useState(0);
  useEffect(() => {
    const offs = [CHROME_FOLD_KEY('toolbar', id) as string, CHROME_INSTANCE_KEY('toolbar', id)].map((k) => rt.settings.onChange(k, () => tick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [rt, id]);
  const fold = rt.chromeFold('toolbar', id);

  // the host element carries the state (axf.css hides its other children while folded) and the chrome context target
  useEffect(() => {
    el.dataset.axfFoldHost = id;
    el.dataset.axfFolded = fold.collapsible && fold.folded ? 'on' : 'off';
    if (!el.dataset.fxCtxTarget) { el.dataset.fxCtxTarget = 'toolbar'; el.dataset.fxCtxPayload = id; }
  }, [el, id, fold.collapsible, fold.folded]);
  useEffect(() => () => { delete el.dataset.axfFoldHost; delete el.dataset.axfFolded; }, [el]);

  // auto-collapse: a click on one of the toolbar's own controls folds it again, after the control ran
  useEffect(() => {
    if (!fold.autoCollapse) return;
    const onClick = (e: Event) => {
      const hit = (e.target as Element).closest?.('button, a[href], [role="button"]');
      if (!hit || hit.closest('[data-axf-fold]')) return;
      window.setTimeout(() => rt.setChromeFold('toolbar', id, 'use'), 0);
    };
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  }, [el, rt, id, fold.autoCollapse]);

  if (!fold.collapsible) return null;
  const label = fold.folded ? CHROME_FOLD_LABELS.toolbar.unfold : CHROME_FOLD_LABELS.toolbar.fold;
  return createPortal(
    <button type="button" className="fx-toolbtn fx-toolbar__fold" data-axf-fold="toolbar" data-axf-fold-portal="" aria-expanded={!fold.folded} aria-label={label} title={label} onClick={() => rt.setChromeFold('toolbar', id, 'toggle')}>
      <Icon name={fold.folded ? 'chevron-down' : 'chevron-up'} size={14} />
    </button>,
    el,
  );
}

/** Mounted once by <AxfProvider>: a fold button on every toolbar that has none of its own. */
export function ToolbarFolds({ rt }: { rt: AxfRuntime }) {
  const [bars, setBars] = useState<HTMLElement[]>([]);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let queued = 0;
    const scan = () => {
      queued = 0;
      const next = foldableToolbars(document);
      setBars((cur) => (cur.length === next.length && cur.every((b, i) => b === next[i]) ? cur : next));
    };
    const later = () => { if (!queued) queued = window.requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-label', 'data-axf-toolbar', 'data-axf-no-fold'] });
    return () => { mo.disconnect(); if (queued) window.cancelAnimationFrame(queued); };
  }, []);
  return <>{bars.map((el, i) => <FoldButton key={`${toolbarElementId(el)}:${i}`} rt={rt} el={el} />)}</>;
}
