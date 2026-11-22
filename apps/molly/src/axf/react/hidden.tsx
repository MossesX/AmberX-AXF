/**
 * Hidden assets on the web (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab
 * groups and all that and be able to see what's hidden.").
 *
 * The runtime owns the list (`rt.hidden()`, `rt.hide()`, `rt.unhide()`, `rt.unhideAll()`, kept in the app's look document
 * on axHub); this file only draws it:
 *
 *   useHidden('tab-group', 'settings.tabs')    → true while that piece is hidden in this app (re-renders on a change)
 *   <Hideable kind="toolbar" id="page.tools">…</Hideable>   → renders nothing while hidden
 *
 * A hidden piece renders nothing, so it leaves no box: the neighbours on its host (flex rows, the banner sides, the toolbar
 * row) close up by themselves. The app-wide toolbar, nav, menu bar and banner (instance `app`) are folded into the
 * runtime's hidden slots instead (`rt.hiddenAppChrome()`), so the layout grid drops their region the same way a hidden
 * slot does. Banner and toolbar widgets (`widget:<type>:<id>`) are filtered out where their host places them.
 *
 * Outside an <AxfProvider> (a component drawn standalone) nothing is hidden.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime, HiddenAsset } from '../core';
import { CHROME_MANY, chromeInstanceSlug, chromeTypeOfTarget, isChromeInstanceId } from '../core/engines/chrome-settings-rules.mjs';
import { useOptionalRuntime } from './AxfProvider';

/** What a chrome element is, as a piece: the same rule the context menu uses, so right-click → Hide hits the same id. */
export const CHROME_PIECE_SELECTOR = '[data-fx-ctx-target], [role="toolbar"], [role="tablist"], nav';
/** The attribute the DOM pass stamps on a hand-drawn piece that is hidden (axf.css: display none). */
export const HIDDEN_PIECE_ATTR = 'data-axf-hidden-piece';

/**
 * The context-menu target name and instance of a chrome element (`[data-fx-ctx-target]`, a `role="toolbar"`, a
 * `role="tablist"`, a nav element): an element naming its own target uses its payload; an implicit one its settings id
 * (`data-axf-toolbar` / `-toolbar-asset` / `-tab-group` / `-nav`), else its accessible name as a slug.
 */
export function chromeTargetOf(el: Element): { name: string; payload?: string } {
  const own = el.getAttribute('data-fx-ctx-target');
  if (own) return { name: own, payload: el.getAttribute('data-fx-ctx-payload') ?? undefined };
  const role = el.getAttribute('role');
  const name = role === 'toolbar' ? 'toolbar' : role === 'tablist' ? 'tab-group' : el.tagName === 'NAV' && el.getAttribute('data-axf-not-nav') === null ? 'nav' : 'default';
  const label = name === 'toolbar' ? el.getAttribute('data-axf-toolbar') ?? el.getAttribute('data-axf-toolbar-asset') ?? el.getAttribute('aria-label') : name === 'tab-group' ? el.getAttribute('data-axf-tab-group') ?? el.getAttribute('aria-label') : name === 'nav' ? el.getAttribute('data-axf-nav') ?? el.getAttribute('aria-label') : null;
  return { name, payload: chromeInstanceSlug(label) || undefined };
}

/** The hideable piece (`{ kind, id }`) a chrome element is, or null (a canvas, a card, a kind with no region). */
export function chromePieceOf(el: Element): { kind: string; id: string } | null {
  const { name, payload } = chromeTargetOf(el);
  const kind = chromeTypeOfTarget(name);
  if (!kind || kind === 'context-menu') return null;
  const valid = !!payload && isChromeInstanceId(payload);
  const id = valid ? payload! : (CHROME_MANY as Record<string, boolean>)[kind] ? '' : 'app';
  return id ? { kind, id } : null;
}

/**
 * Hand-drawn chrome (a plugin's own `role="toolbar"` strip, the Terminal tab strip, a nav element): no component to wrap, so
 * one pass over the page stamps `data-axf-hidden-piece` on every piece hidden in this app (axf.css draws it as nothing)
 * and takes it off again on Unhide. Runs on every runtime change and on every page change (one frame later). Returns
 * the uninstall.
 */
export function installHiddenChrome(rt: AxfRuntime, root: Document = document): () => void {
  let frame = 0;
  const pass = () => {
    frame = 0;
    const any = rt.hiddenCount() > 0;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(CHROME_PIECE_SELECTOR))) {
      const piece = any ? chromePieceOf(el) : null;
      const hide = !!piece && rt.isHidden(piece);
      if (hide && !el.hasAttribute(HIDDEN_PIECE_ATTR)) el.setAttribute(HIDDEN_PIECE_ATTR, `${piece!.kind}:${piece!.id}`);
      else if (!hide && el.hasAttribute(HIDDEN_PIECE_ATTR)) el.removeAttribute(HIDDEN_PIECE_ATTR);
    }
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(pass); };
  const off = rt.subscribe(soon);
  const obs = new MutationObserver(soon);
  obs.observe(root.body, { childList: true, subtree: true });
  soon();
  return () => { off(); obs.disconnect(); if (frame) cancelAnimationFrame(frame); };
}

const never = () => () => {};
const none = (): unknown => 0;

/** Subscribe to the runtime (look changes bump its state) when there is one. */
function useTick(rt: AxfRuntime | null): void {
  const get: () => unknown = rt ? rt.getState : none;
  useSyncExternalStore(rt ? rt.subscribe : never, get, get);
}

/** Is this piece hidden in this app? `kind` is a hideable kind (tab-group, toolbar, banner, nav-menu, app-menu, widget). */
export function useHidden(kind: string, id: string | null | undefined): boolean {
  const rt = useOptionalRuntime();
  useTick(rt);
  if (!rt || !id) return false;
  return rt.isHidden({ kind, id });
}

/** Everything hidden in this app, oldest first, and the count (re-renders on a change). */
export function useHiddenList(): HiddenAsset[] {
  const rt = useOptionalRuntime();
  useTick(rt);
  return rt ? rt.hidden() : [];
}

/** Renders its children unless the piece is hidden in this app. */
export function Hideable({ kind, id, children }: { kind: string; id: string | null | undefined; children: ReactNode }) {
  return useHidden(kind, id) ? null : <>{children}</>;
}
