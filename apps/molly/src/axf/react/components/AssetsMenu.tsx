/**
 * The Assets menu (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab groups and
 * all that and be able to see what's hidden.").
 *
 * Hidden items… (with a count), Unhide all, and Hide ▸ for every tab group, toolbar, banner, navigation menu, menu bar
 * and widget on screen.
 *
 * `installAssetsMenu(rt)` (AxfProvider calls it, once per runtime) gives every app on the framework the menu-bar entry:
 *   - an app-menu contribution into the top-level menu `assets` (created when the app's own app-menu asset has none,
 *     merged into it when it has one; the framework's app-menu assets carry the same items, so the menu is in the asset
 *     for designers and the contribution keeps it there after a swap to an asset without it);
 *   - the live list `axf.hideable` behind Hide ▸: every chrome piece on the page right now that can be hidden, by name;
 *   - Hidden items… on the page's own right-click menu (context target `canvas`, `rt.addContextItems`), so the list is
 *     still reachable when the menu bar itself is hidden;
 *   - the actions `chrome.hidden`, `chrome.hide`, `chrome.unhide` and `chrome.unhideAll`, each only when nothing has
 *     registered it yet (the chrome context block and the console register the full ones; a later registration wins).
 *
 * `<AssetsMenu />` is the same three things as a panel (a dialog body, a settings group, a side pane): the two buttons on
 * top, then one row per visible piece with Hide.
 *
 * The runtime owns the state (`rt.hidden()`, `rt.hide()`, `rt.unhide()`, `rt.unhideAll()`, kept in the app's look
 * document); nothing here stores anything. The DOM is read only to name what is on screen.
 *
 * Console control (spec/CONSOLE-CONTROL.md → Hidden assets): the menu-bar entry is `button:menu.assets`; the panel is
 * `panel:assets-menu` with `button:assets.hidden-items`, `button:assets.unhide-all`, `grid:assets-hide`, one
 * `row:<kind>:<id>` per visible piece and `button:assets.hide.<kind>.<id>` on it.
 */
import { useEffect, useState } from 'react';
import type { AxfRuntime, MenuItem } from '../../core';
import { FRAMEWORK_MODULE } from '../../core/engines/actions';
import { CHROME_ICONS, CHROME_LABELS, CHROME_MANY, CHROME_TARGETS, CHROME_TYPES, chromeInstanceSlug, chromeTypeOfTarget, isChromeInstanceId } from '../../core/engines/chrome-settings-rules.mjs';
import { useAxfState, useRuntime } from '../AxfProvider';
import { ControlScope } from '../controlTargets';
import { Button } from './Controls';
import { Note } from './Forms';
import { Icon } from './Icon';

/* ================================================================== names (decided in the build report, s1) */

/** The top-level menu the entries live in. */
export const ASSETS_MENU_ID = 'assets';
/** The module that owns the contribution, the live list and the context item (`rt.removeAppMenuItems(ASSETS_MENU_MODULE)`). */
export const ASSETS_MENU_MODULE = 'axf.assets';
/** The live list behind Assets ▸ Hide: every visible piece on the page, by name. */
export const HIDEABLE_PROVIDER = 'axf.hideable';
/** The counter that is the number of pieces hidden in this app (the runtime reads it live from the look document). */
export const HIDDEN_ASSETS_COUNTER = 'hidden-assets.count';
/** The dialog the Hidden list opens in (the settings library ships it). */
export const HIDDEN_ASSETS_DIALOG_ID = 'axf.hidden-assets';
/** The instance id of the chrome an app draws once (its toolbar, nav, menu bar, banner). */
const APP_INSTANCE = 'app';
const WIDGET_KIND = 'widget';
/** A piece's instance id (hidden-assets@1: the chrome context menu's slug; a widget's is `<type>:<id>`). */
const PIECE_ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
/** What is chrome on a page: the same elements the context menu host treats as a toolbar, tab row or nav. */
const CHROME_PIECE_SELECTOR = '[data-fx-ctx-target], [role="toolbar"], [role="tablist"], nav';
/** Never listed: menus and popovers that are open right now, live previews, and anything already hidden as a piece. */
const NOT_A_PIECE = '.fx-ctx, .fx-menu, .fx-dropdown, [data-axf-banner-preview], [data-axf-hidden-piece], [data-axf-assets-menu]';

export const ASSETS_MENU_ITEM_IDS = { top: 'axf-assets-top', hidden: 'axf-assets-hidden', unhideAll: 'axf-assets-unhide-all', sep: 'axf-assets-sep', hide: 'axf-assets-hide' } as const;

/**
 * The items of the Assets menu, as the app-menu assets in framework/assets/app-menu carry them. The leading rule sets
 * them apart from an app's own Assets items; it is dropped where they come first (the engine cleans separators).
 */
export const ASSETS_MENU_ITEMS: MenuItem[] = [
  { id: ASSETS_MENU_ITEM_IDS.top, separator: true },
  { id: ASSETS_MENU_ITEM_IDS.hidden, label: 'Hidden items…', icon: 'eye', action: 'chrome.hidden', badge: HIDDEN_ASSETS_COUNTER },
  { id: ASSETS_MENU_ITEM_IDS.unhideAll, label: 'Unhide all', icon: 'refresh', action: 'chrome.unhideAll', requires: 'assets.swap' },
  { id: ASSETS_MENU_ITEM_IDS.sep, separator: true },
  { id: ASSETS_MENU_ITEM_IDS.hide, label: 'Hide', icon: 'layers', provider: HIDEABLE_PROVIDER },
];

/* ================================================================== the runtime's hidden-assets API */

interface PieceRef { kind: string; id: string }
/**
 * The hidden-assets@1 part of the runtime (core/runtime.ts). Read through this shape so the menu also loads against a
 * core that predates it: nothing is hidden there, and Hide says so instead of failing.
 */
interface HiddenApi {
  hidden(): PieceRef[];
  hiddenCount(): number;
  isHidden(ref: PieceRef): boolean;
  hide(ref: PieceRef): boolean;
  unhide(ref: PieceRef): boolean;
  unhideAll(): boolean;
  hideableKinds(): string[];
}
const api = (rt: AxfRuntime): Partial<HiddenApi> => rt as unknown as Partial<HiddenApi>;

/** The kinds a piece can be hidden as: the runtime's list, else the chrome kinds with a region on the page plus widget. */
export function hideableKinds(rt: AxfRuntime): string[] {
  const own = api(rt).hideableKinds?.();
  if (own) return own;
  const targets = CHROME_TARGETS as Record<string, string[] | undefined>;
  return [...(CHROME_TYPES as string[]).filter((k) => (targets[k] ?? []).length > 0), WIDGET_KIND];
}
/** How many pieces are hidden in this app. */
export const hiddenCount = (rt: AxfRuntime): number => api(rt).hiddenCount?.() ?? api(rt).hidden?.().length ?? 0;
const isHidden = (rt: AxfRuntime, ref: PieceRef): boolean => api(rt).isHidden?.(ref) ?? false;

/* ================================================================== what is on screen */

/** One visible piece: what Hide ▸ and the panel list. */
export interface HideablePiece { kind: string; id: string; label: string; icon: string }

const kindName = (kind: string): string => (kind === WIDGET_KIND ? 'Widget' : kind === 'app-menu' ? 'Menu bar' : (CHROME_LABELS as Record<string, string>)[kind] ?? kind);
const kindIcon = (kind: string): string => (CHROME_ICONS as Record<string, string>)[kind] ?? 'layers';

/** A piece in words: "Toolbar: Page tools", "Menu bar (whole app)", "Widget: clock". */
export function pieceLabel(kind: string, id: string, name?: string | null): string {
  const base = kindName(kind);
  if (kind !== WIDGET_KIND && id === APP_INSTANCE) return `${base} (whole app)`;
  const said = name?.trim();
  if (said && said.toLowerCase() !== base.toLowerCase()) return `${base}: ${said}`;
  return `${base}: ${kind === WIDGET_KIND ? id.slice(id.indexOf(':') + 1) : id}`;
}

/**
 * The piece (`{ kind, id }`) a chrome element is, or null. The rule is the context menu host's (Overlays.tsx), so the
 * Assets menu hides the same id a right-click → Hide does: an element naming its own target uses its payload; a
 * `role="toolbar"`, a `role="tablist"` or a nav uses its settings id, else its accessible name as a slug.
 */
function pieceOf(el: Element): PieceRef | null {
  const own = el.getAttribute('data-fx-ctx-target');
  const role = el.getAttribute('role');
  const target = own ?? (role === 'toolbar' ? 'toolbar' : role === 'tablist' ? 'tab-group' : el.tagName === 'NAV' && el.getAttribute('data-axf-not-nav') === null ? 'nav' : '');
  if (!target || target === 'nav-item') return null;
  const kind = chromeTypeOfTarget(target) as string | null;
  if (!kind) return null;
  const named = own
    ? el.getAttribute('data-fx-ctx-payload')
    : chromeInstanceSlug(target === 'toolbar' ? el.getAttribute('data-axf-toolbar') ?? el.getAttribute('data-axf-toolbar-asset') ?? el.getAttribute('aria-label')
      : target === 'tab-group' ? el.getAttribute('data-axf-tab-group') ?? el.getAttribute('aria-label')
        : el.getAttribute('data-axf-nav') ?? el.getAttribute('aria-label'));
  const id = named && isChromeInstanceId(named) ? named : (CHROME_MANY as Record<string, boolean>)[kind] ? '' : APP_INSTANCE;
  return id ? { kind, id } : null;
}

/**
 * Every chrome piece on the page right now that can be hidden and is not: tab groups, toolbars, banners, navigation
 * menus, the menu bar, and the widgets on the banner and the toolbar. One entry per piece, in page order.
 */
export function hideablePieces(rt: AxfRuntime, root: ParentNode | null = typeof document === 'undefined' ? null : document): HideablePiece[] {
  if (!root) return [];
  const kinds = hideableKinds(rt);
  const seen = new Set<string>();
  const out: HideablePiece[] = [];
  const onScreen = (el: Element) => !el.closest(NOT_A_PIECE) && el.getClientRects().length > 0;
  for (const el of Array.from(root.querySelectorAll(CHROME_PIECE_SELECTOR))) {
    if (!onScreen(el)) continue;
    const p = pieceOf(el);
    if (!p || !kinds.includes(p.kind) || seen.has(`${p.kind}:${p.id}`) || isHidden(rt, p)) continue;
    seen.add(`${p.kind}:${p.id}`);
    out.push({ ...p, label: pieceLabel(p.kind, p.id, el.getAttribute('aria-label')), icon: kindIcon(p.kind) });
  }
  if (kinds.includes(WIDGET_KIND)) {
    for (const el of Array.from(root.querySelectorAll('[data-axf-banner-item], [data-axf-toolbar-widget]'))) {
      const id = el.getAttribute('data-axf-banner-item') ?? el.getAttribute('data-axf-toolbar-widget') ?? '';
      const p = { kind: WIDGET_KIND, id };
      if (!PIECE_ID.test(id) || seen.has(`${WIDGET_KIND}:${id}`) || !onScreen(el) || isHidden(rt, p)) continue;
      seen.add(`${WIDGET_KIND}:${id}`);
      out.push({ ...p, label: pieceLabel(WIDGET_KIND, id, el.getAttribute('aria-label') ?? el.getAttribute('title')), icon: 'box' });
    }
  }
  return out;
}

/* ================================================================== install */

const installed = new WeakSet<AxfRuntime>();

/** Hide ▸ as menu rows: one per visible piece, `chrome.hide:<kind>:<id>`. */
export function hideableMenuItems(rt: AxfRuntime): MenuItem[] {
  const list = hideablePieces(rt);
  if (!list.length) return [{ id: 'axf-assets-hide-none', label: 'Nothing on this screen to hide' }];
  return list.map((p) => ({ id: `axf-assets-hide:${p.kind}:${p.id}`, label: p.label, icon: p.icon, action: `chrome.hide:${p.kind}:${p.id}`, requires: 'assets.swap' }));
}

/** The actions the menu runs, for an app where nothing registered them yet (the full ones replace these). */
function installFallbackActions(rt: AxfRuntime): void {
  const missing = (id: string) => !rt.actions.get(id);
  const ref = (kind: string, rest: string[], ctx?: { payload?: unknown }): PieceRef => ({ kind, id: rest.join(':') || (typeof ctx?.payload === 'string' ? ctx.payload : '') || APP_INSTANCE });
  const unavailable = () => rt.toast('Hiding pieces needs a newer framework core in this app.', 'warning', 'Assets');
  rt.actions.withModule(FRAMEWORK_MODULE, () => {
    if (missing('chrome.hidden')) rt.actions.register('chrome.hidden', () => {
      // the Hidden list is a dialog of the settings library; an app without it lands on Settings → Appearance
      if (rt.uiRenderers.dialogs[HIDDEN_ASSETS_DIALOG_ID] || rt.registry.has('dialog', HIDDEN_ASSETS_DIALOG_ID)) rt.openDialog(HIDDEN_ASSETS_DIALOG_ID, {});
      else rt.dispatch('settings.open:appearance');
    }, { label: 'Hidden items: what is hidden in this app (open the list)' });
    if (missing('chrome.hide')) rt.actions.register('chrome.hide', ([kind = '', ...rest], ctx) => {
      const hide = api(rt).hide;
      if (!hide) { unavailable(); return; }
      const p = ref(kind, rest, ctx);
      if (!isHidden(rt, p) && hide.call(rt, p)) rt.toast(`${pieceLabel(p.kind, p.id)} is hidden. Assets → Hidden items… brings it back.`, 'info', 'Hidden');
    }, { label: 'Hide one tab group, toolbar, banner, nav, menu bar or widget in this app (chrome.hide:<kind>:<id>)', params: true, requires: 'assets.swap' });
    if (missing('chrome.unhide')) rt.actions.register('chrome.unhide', ([kind = '', ...rest], ctx) => {
      const p = ref(kind, rest, ctx);
      if (isHidden(rt, p) && api(rt).unhide?.call(rt, p)) rt.toast(`${pieceLabel(p.kind, p.id)} is back.`, 'success', 'Shown');
    }, { label: 'Show a hidden piece again (chrome.unhide:<kind>:<id>)', params: true, requires: 'assets.swap' });
    if (missing('chrome.unhideAll')) rt.actions.register('chrome.unhideAll', () => {
      const n = hiddenCount(rt);
      if (!n) { rt.toast('Nothing is hidden in this app.', 'info', 'Assets'); return; }
      if (api(rt).unhideAll?.call(rt)) rt.toast(`${n} hidden piece${n === 1 ? ' is' : 's are'} back.`, 'success', 'Shown');
    }, { label: 'Show every hidden piece in this app again', requires: 'assets.swap' });
  });
}

/**
 * Give this app the Assets menu: the menu-bar entry, the live Hide list, Hidden items… on the page's right-click menu.
 * Once per runtime; returns nothing to undo (`rt.removeAppMenuItems(ASSETS_MENU_MODULE)` and
 * `rt.removeContextItems(ASSETS_MENU_MODULE)` take it out).
 */
export function installAssetsMenu(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  installFallbackActions(rt);
  rt.registerAppMenuProvider(HIDEABLE_PROVIDER, { module: ASSETS_MENU_MODULE, max: 60, items: () => hideableMenuItems(rt) });
  rt.addAppMenuItems({ id: `${ASSETS_MENU_MODULE}.menu`, module: ASSETS_MENU_MODULE, menu: ASSETS_MENU_ID, menuLabel: 'Assets', menuOrder: 900, order: 900, items: ASSETS_MENU_ITEMS });
  rt.addContextItems({ id: `${ASSETS_MENU_MODULE}.canvas`, module: ASSETS_MENU_MODULE, target: 'canvas', order: 900, items: [
    { id: 'axf-assets-hidden-ctx', label: 'Hidden items…', icon: 'eye', action: 'chrome.hidden' },
  ] });
}

/* ================================================================== the panel */

/** A piece as a row id inside a control address: `<kind>:<id>`, a `/` written `%2F` (CONSOLE-CONTROL.md → The address). */
export const assetsRowId = (kind: string, id: string): string => `${kind}:${id}`.replace(/%/g, '%25').replace(/\//g, '%2F');
/** A piece inside a button id: `<kind>.<id>` with `:` and `/` as dots (`assets.hide.widget.clock.main`). */
export const assetsButtonId = (kind: string, id: string): string => `${kind}.${id}`.replace(/[:/]+/g, '.');

/** One visible piece: its name and Hide (`row:<kind>:<id>` with `button:assets.hide.<kind>.<id>` under it). */
function HideRow({ piece: p, locked }: { piece: HideablePiece; locked: boolean }) {
  const rt = useRuntime();
  const row = assetsRowId(p.kind, p.id);
  return (
    <div role="listitem" data-axf-target={`row:${row}`} data-axf-hideable={`${p.kind}:${p.id}`}>
      <ControlScope address={`row:${row}`}>
        <div className="fx-row fx-row--between">
          <span className="fx-row"><Icon name={p.icon} size={14} /><span>{p.label}</span></span>
          <Button size="sm" tone="neutral" icon="eye" id={`assets.hide.${assetsButtonId(p.kind, p.id)}`} aria-label={`Hide ${p.label}`} requires="assets.swap" disabled={locked} onClick={() => rt.dispatch(`chrome.hide:${p.kind}:${p.id}`)}>Hide</Button>
        </div>
      </ControlScope>
    </div>
  );
}

/**
 * The Assets menu as a panel: Hidden items… (the count as a badge) and Unhide all on top, then every visible piece by
 * name with Hide. The list is read from the page after every runtime change (a hide, a navigation, a swap).
 */
export function AssetsMenu({ onDone }: { /** called after Hidden items… opened the list (a host dialog closes itself) */ onDone?: () => void }) {
  const rt = useRuntime();
  const state = useAxfState();
  const [pieces, setPieces] = useState<HideablePiece[]>([]);
  // After the page has drawn the change: the list names what is on screen, so it is read one frame later.
  useEffect(() => {
    const read = () => setPieces(hideablePieces(rt));
    if (typeof requestAnimationFrame !== 'function') { read(); return; }
    const f = requestAnimationFrame(read);
    return () => cancelAnimationFrame(f);
  }, [rt, state]);
  const count = hiddenCount(rt);
  const locked = !rt.can('assets.swap');
  return (
    <div data-axf-assets-menu="" data-axf-target="panel:assets-menu" data-axf-hidden-count={count}>
      <ControlScope address="panel:assets-menu">
        <div className="fx-stack">
          <div className="fx-row fx-row--between">
            <Button tone="neutral" icon="eye" id="assets.hidden-items" aria-label={count ? `Hidden items, ${count} hidden` : 'Hidden items'} onClick={() => { rt.dispatch('chrome.hidden'); onDone?.(); }}>
              Hidden items…{count > 0 && <span className="fx-menu__badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
            </Button>
            <Button tone="quiet" icon="refresh" id="assets.unhide-all" requires="assets.swap" disabled={!count} onClick={() => rt.dispatch('chrome.unhideAll')}>Unhide all</Button>
          </div>
          {!pieces.length && <Note tone="info">Nothing on this screen to hide.</Note>}
          {pieces.length > 0 && (
            <div role="list" aria-label="Hide a piece of this screen" data-axf-target="grid:assets-hide">
              <ControlScope address="grid:assets-hide">
                <div className="fx-stack fx-stack--xs">
                  {pieces.map((p) => <HideRow key={`${p.kind}:${p.id}`} piece={p} locked={locked} />)}
                </div>
              </ControlScope>
            </div>
          )}
        </div>
      </ControlScope>
    </div>
  );
}
