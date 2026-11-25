/**
 * Hidden assets on the web (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab
 * groups and all that and be able to see what's hidden.").
 *
 * The runtime owns the list (`rt.hidden()`, `rt.isHidden()`, `rt.hide()`, `rt.unhide()`, `rt.unhideAll()`, kept in the
 * app's look document on axHub); this file only draws it:
 *
 *   useHidden('tab-group', 'settings.tabs')    → true while that piece is hidden in this app (re-renders on a change)
 *   <Hideable kind="toolbar" id="page.tools">…</Hideable>   → renders nothing while hidden
 *   useHiddenList()                            → everything hidden in this app, oldest first
 *
 * A hidden piece takes no room, so its neighbours on the same host (flex rows, the banner sides, the toolbar row, the
 * shell grid) close up by themselves:
 *   - framework components that know their own id (TabGroup, the banner bar, a banner frame) are not rendered at all;
 *   - every other piece (any `role="toolbar"`, so every tap-to-confirm host; a `role="tablist"`; a nav element; the
 *     menu bar; a banner or toolbar widget) is found by one pass over the page (`installHiddenChrome`), which stamps
 *     `data-axf-hidden-piece` on it before the next paint; axf.css draws a stamped piece as nothing and closes the
 *     layout region around it.
 *
 * The id of a piece is the one its right-click menu gives it (`chromePieceOf`), so Hide, the Hidden list and this file
 * always name the same thing. A widget is `widget:<type>:<id>` (the key its host places it by).
 *
 * Outside an <AxfProvider> (a component drawn standalone), or on a runtime with no hidden list, nothing is hidden.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../core';
import { CHROME_MANY, chromeInstanceSlug, chromeTypeOfTarget, isChromeInstanceId } from '../core/engines/chrome-settings-rules.mjs';
import { useOptionalRuntime } from './AxfProvider';

/** One hidden piece as the runtime lists it (the saved entry of core/engines/hidden-assets.ts). */
export interface HiddenPiece {
  kind: string;
  id: string;
  /** the asset id the piece was drawn with when it was hidden */
  assetRef?: string;
  /** ISO time, '' when unknown */
  hiddenAt: string;
  /** the app id, a plugin, or an API caller; '' when unknown */
  by: string;
}
/** What names a piece: its kind and instance id. */
export interface HiddenPieceTarget { kind: string; id: string }

/** The part of the runtime this file reads. A runtime without it hides nothing. */
interface HiddenSource {
  hidden?(): HiddenPiece[];
  isHidden?(ref: HiddenPieceTarget): boolean;
  hiddenCount?(): number;
}
const source = (rt: AxfRuntime | null): HiddenSource => (rt ?? {}) as unknown as HiddenSource;

/** The kind a banner / toolbar widget is hidden as. */
export const HIDDEN_WIDGET_KIND = 'widget';
/** What a chrome element is, as a piece: the same rule the context menu uses, so right-click → Hide hits the same id. */
export const CHROME_PIECE_SELECTOR = '[data-fx-ctx-target], [role="toolbar"], [role="tablist"], nav';
/** A widget on a host (the banner bar, a banner strip, the toolbar); the attribute's value is its key `<type>:<id>`. */
export const WIDGET_PIECE_SELECTOR = '[data-axf-banner-item], [data-axf-toolbar-widget]';
/** The attribute the page pass stamps on a hidden piece (axf.css: display none); its value is `<kind>:<id>`. */
export const HIDDEN_PIECE_ATTR = 'data-axf-hidden-piece';

/** Everything hidden in this app, oldest first (empty without a runtime or a hidden list). */
export function hiddenPieces(rt: AxfRuntime | null): HiddenPiece[] {
  return source(rt).hidden?.() ?? [];
}

/** How many pieces are hidden in this app. */
export function hiddenPieceCount(rt: AxfRuntime | null): number {
  const s = source(rt);
  return s.hiddenCount?.() ?? s.hidden?.().length ?? 0;
}

/** Is this piece hidden in this app? */
export function pieceHidden(rt: AxfRuntime | null, kind: string, id: string | null | undefined): boolean {
  if (!rt || !kind || !id) return false;
  const s = source(rt);
  if (s.isHidden) return s.isHidden({ kind, id });
  return (s.hidden?.() ?? []).some((e) => e.kind === kind && e.id === id);
}

/**
 * The context-menu target name and instance of a chrome element (`[data-fx-ctx-target]`, a `role="toolbar"`, a
 * `role="tablist"`, a nav element): an element naming its own target uses its payload; an implicit one its settings id
 * (`data-axf-toolbar` / `-toolbar-asset` / `-tab-group` / `-nav`), else its accessible name as a slug. The same rule
 * the context menu host applies on right-click (components/Overlays.tsx, ContextMenuHost).
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
export function chromePieceOf(el: Element): HiddenPieceTarget | null {
  const { name, payload } = chromeTargetOf(el);
  const kind = chromeTypeOfTarget(name) as string | null;
  if (!kind || kind === 'context-menu') return null;
  const valid = !!payload && isChromeInstanceId(payload);
  // a kind an app shows once (toolbar, banner, nav, menu bar) is the app's own when it names no instance
  const id = valid ? payload! : (CHROME_MANY as Record<string, boolean>)[kind] ? '' : 'app';
  return id ? { kind, id } : null;
}

/** The hideable piece a widget element (`[data-axf-banner-item]`, `[data-axf-toolbar-widget]`) is, or null. */
export function widgetPieceOf(el: Element): HiddenPieceTarget | null {
  const key = el.getAttribute('data-axf-banner-item') ?? el.getAttribute('data-axf-toolbar-widget');
  return key ? { kind: HIDDEN_WIDGET_KIND, id: key } : null;
}

/** The hideable piece any element is: a widget first (it sits inside its host's piece), else a chrome piece. */
export function pieceOf(el: Element): HiddenPieceTarget | null {
  return el.matches(WIDGET_PIECE_SELECTOR) ? widgetPieceOf(el) : chromePieceOf(el);
}

/**
 * The page pass: stamps `data-axf-hidden-piece` on every chrome piece and widget hidden in this app (axf.css draws it
 * as nothing) and takes it off again on Unhide. It runs on every runtime change and on every change to the page, in
 * the same task as the change, so a hidden piece that has just been drawn is never painted. Nothing hidden and nothing
 * stamped costs one count read. Returns the uninstall, which also clears every stamp.
 */
export function installHiddenChrome(rt: AxfRuntime, root: Document = document): () => void {
  const all = `${CHROME_PIECE_SELECTOR}, ${WIDGET_PIECE_SELECTOR}`;
  let stamped = false;
  const pass = () => {
    const any = hiddenPieceCount(rt) > 0;
    if (!any && !stamped) return;
    let left = false;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(all))) {
      const piece = any ? pieceOf(el) : null;
      const hide = !!piece && pieceHidden(rt, piece.kind, piece.id);
      if (hide) {
        left = true;
        const key = `${piece!.kind}:${piece!.id}`;
        if (el.getAttribute(HIDDEN_PIECE_ATTR) !== key) el.setAttribute(HIDDEN_PIECE_ATTR, key);
      } else if (el.hasAttribute(HIDDEN_PIECE_ATTR)) el.removeAttribute(HIDDEN_PIECE_ATTR);
    }
    stamped = left;
  };
  const off = rt.subscribe(pass);
  // a DOM without MutationObserver (SSR shims, test renderers): the pass runs on runtime changes only
  const obs = typeof MutationObserver === 'function' && root.body ? new MutationObserver(pass) : null;
  // attribute changes too: a piece renamed in place (a new label, another settings id) is another piece
  obs?.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-fx-ctx-target', 'data-fx-ctx-payload', 'data-axf-toolbar', 'data-axf-toolbar-asset', 'data-axf-tab-group', 'data-axf-nav', 'data-axf-banner-item', 'data-axf-toolbar-widget', 'aria-label', 'role'] });
  pass();
  return () => {
    off();
    obs?.disconnect();
    for (const el of Array.from(root.querySelectorAll(`[${HIDDEN_PIECE_ATTR}]`))) el.removeAttribute(HIDDEN_PIECE_ATTR);
  };
}

const never = () => () => {};
const none = (): unknown => 0;

/** Subscribe to the runtime (a look change bumps its state) when there is one. */
function useTick(rt: AxfRuntime | null): void {
  const get: () => unknown = rt ? rt.getState : none;
  useSyncExternalStore(rt ? rt.subscribe : never, get, get);
}

/** Is this piece hidden in this app? `kind` is a hideable kind (tab-group, toolbar, banner, nav-menu, app-menu, widget). */
export function useHidden(kind: string, id: string | null | undefined): boolean {
  const rt = useOptionalRuntime();
  useTick(rt);
  return pieceHidden(rt, kind, id);
}

/** Everything hidden in this app, oldest first (re-renders on a change). */
export function useHiddenList(): HiddenPiece[] {
  const rt = useOptionalRuntime();
  useTick(rt);
  return hiddenPieces(rt);
}

/** Renders its children unless the piece is hidden in this app. */
export function Hideable({ kind, id, children }: { kind: string; id: string | null | undefined; children: ReactNode }) {
  return useHidden(kind, id) ? null : <>{children}</>;
}
