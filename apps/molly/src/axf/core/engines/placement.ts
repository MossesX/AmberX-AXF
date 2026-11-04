/*
 * Placement engine (placement@1, Oct 23 2026): where a plugin's or library's UI opens.
 *
 * Brett, Oct 23 2026: "every plugin with a UI, new and existing, sets in its settings interface whether it opens in the
 * main application area, a floating window, a dialog or a tab group; by default in the main application area". The
 * default comes from the manifest (`opens`, filled by the build engine's default rules, framework/schemas/build-defaults.json);
 * the person's pick is the setting `axf.placement.<owner id>` and wins.
 *
 * Only the owner's *primary* UI moves (its first page, or its first dialog when it has no page: `opensUi`); its other
 * dialogs (confirm cards, detail pop-ups) stay dialogs. Pure: the runtime (core/runtime.ts navigate / openDialog) asks
 * `placementRoute` what to do, the React layer (AppShell) renders the placed UI.
 *
 *   main   = the main application area (a page)
 *   window = its own floating window
 *   dialog = a dialog over the page
 *   tab    = a tab in the shared plugin tab group (one floating window holding every UI placed there)
 *
 * Web only for now; the Kotlin twin is a deferred gap (framework/spec/PORTING.md).
 */

export const PLACEMENTS = ['main', 'window', 'dialog', 'tab'] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<Placement, string> = {
  main: 'Main application area',
  window: 'Floating window',
  dialog: 'Dialog',
  tab: 'Tab group',
};

/** The build engine's first default rule (build-defaults@1 `plugin.opens.main`). */
export const DEFAULT_PLACEMENT: Placement = 'main';

/** Settings key holding the person's pick for one owner (library / plugin id). */
export const placementKey = (owner: string) => `axf.placement.${owner}`;

/** Title of the shared tab group window that `tab` placements open in. */
export const PLACEMENT_TAB_GROUP = 'Plugins';

/** Tab kinds AppShell renders for placed UIs (payload = the view id, or the dialog id). */
export const PLACED_VIEW_TAB = 'axf-placed-view';
export const PLACED_DIALOG_TAB = 'axf-placed-dialog';
/** `axf.placed:<dialog id>` = the view a dialog placed in the main area shows under; `axf.placed:<view id>` = the dialog a page placed as a dialog opens in. */
export const PLACED_PREFIX = 'axf.placed:';
export const placedId = (id: string) => `${PLACED_PREFIX}${id}`;

export function isPlacement(x: unknown): x is Placement {
  return typeof x === 'string' && (PLACEMENTS as readonly string[]).includes(x);
}

/** A manifest / setting value → a placement; anything unknown → `fallback`. */
export function normalizePlacement(x: unknown, fallback: Placement = DEFAULT_PLACEMENT): Placement {
  return isPlacement(x) ? x : fallback;
}

/** A primary-UI reference: `view:<id>` or `dialog:<id>`. */
export type UiRef = { kind: 'view' | 'dialog'; id: string };

export function parseUiRef(x: unknown): UiRef | null {
  if (typeof x !== 'string') return null;
  const m = /^(view|dialog):([a-z0-9][a-z0-9._-]{0,63})$/.exec(x);
  return m ? { kind: m[1] as UiRef['kind'], id: m[2]! } : null;
}

/** The UI that moves: the manifest's `opensUi`, else the first page it provides, else its first dialog. */
export function primaryUi(provides: readonly string[] | undefined, opensUi?: string): UiRef | null {
  const own = parseUiRef(opensUi);
  if (own) return own;
  const list = (provides ?? []).map(parseUiRef).filter((r): r is UiRef => !!r);
  return list.find((r) => r.kind === 'view') ?? list.find((r) => r.kind === 'dialog') ?? null;
}

/** What the runtime does to open `ui` placed at `mode`. `natural` = open it the way it was declared. */
export type PlacementRoute =
  | { via: 'natural' }
  | { via: 'page'; view: string }            // a dialog shown as a page (AppShell renders it as view `axf.placed:<dialog>`)
  | { via: 'dialog'; dialog: string }        // a page shown in a dialog (dialog `axf.placed:<view>`)
  | { via: 'window'; tabKind: string; payload: string }
  | { via: 'tab'; tabKind: string; payload: string };

export function placementRoute(ui: UiRef, mode: Placement): PlacementRoute {
  const natural = ui.kind === 'view' ? 'main' : 'dialog';
  if (mode === natural) return { via: 'natural' };
  const tabKind = ui.kind === 'view' ? PLACED_VIEW_TAB : PLACED_DIALOG_TAB;
  if (mode === 'main') return { via: 'page', view: placedId(ui.id) };
  if (mode === 'dialog') return { via: 'dialog', dialog: placedId(ui.id) };
  return { via: mode, tabKind, payload: ui.id };
}

/** Choices for the "Opens in" setting. */
export const placementOptions = () => PLACEMENTS.map((value) => ({ value, label: PLACEMENT_LABELS[value] }));
