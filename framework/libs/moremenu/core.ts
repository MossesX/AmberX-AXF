/**
 * ⋯ "More" menu, pure part (`ai.amberx.axf.moremenu`, harvested Nov 7 2026 from ten console plugins' identical copies).
 *
 * Two looks, because the two plugin families drew their menu two ways and a harvest changes nothing:
 * - `ctx` (default): the context-menu look (`fx-ctx fx-popover`); the menu hangs under the button and opens towards
 *   the side of the screen with more room (anchored right when the button sits in the right half).
 * - `dropdown`: the dropdown look (`fx-popover fx-dropdown`); the menu is at most 260 px wide (less on a narrow screen,
 *   keeping an 8 px margin) and its right edge lines up with the button's, clamped inside the viewport.
 */

export const MORE_MENU_ID = 'ai.amberx.axf.moremenu';
export const LOOKS = ['ctx', 'dropdown'] as const;
export type MoreMenuLook = (typeof LOOKS)[number];

/** One entry. `onPick` and `onSelect` are the same thing (both plugin families' names); `id` falls back to the label. */
export interface MoreItem {
  id?: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  onPick?: () => void;
  onSelect?: () => void;
}

export interface Placement { top: number; left?: number; right?: number }
export interface AnchorRect { left: number; right: number; bottom: number }

export const DROPDOWN_MAX_WIDTH = 260;
export const DROPDOWN_MARGIN = 8;

/** Where the pop-up goes for a button at `rect` in a viewport `viewportWidth` wide. */
export function placeMenu(rect: AnchorRect, viewportWidth: number, look: MoreMenuLook = 'ctx'): Placement {
  if (look === 'dropdown') {
    const w = Math.min(DROPDOWN_MAX_WIDTH, viewportWidth - DROPDOWN_MARGIN * 2);
    return { top: rect.bottom, left: Math.max(DROPDOWN_MARGIN, Math.min(rect.right - w, viewportWidth - w - DROPDOWN_MARGIN)) };
  }
  return rect.right >= viewportWidth / 2 ? { top: rect.bottom, right: Math.max(0, viewportWidth - rect.right) } : { top: rect.bottom, left: Math.max(0, rect.left) };
}

/** The inline style for a placement (`right` anchored menus switch `left` off). */
export function placementStyle(at: Placement): { top: number; left?: number | 'auto'; right?: number } {
  return at.right !== undefined ? { top: at.top, right: at.right, left: 'auto' } : { top: at.top, left: at.left };
}

/** Drop the `false` / `null` / `undefined` entries callers use for conditional items. */
export function visibleItems(items: readonly (MoreItem | false | null | undefined)[]): MoreItem[] {
  return items.filter((x): x is MoreItem => !!x);
}

export const itemKey = (it: MoreItem): string => it.id ?? it.label;

/** What running an item does (either name). */
export function pick(it: MoreItem): void {
  (it.onPick ?? it.onSelect)?.();
}

export const popoverClass = (look: MoreMenuLook): string => (look === 'dropdown' ? 'fx-popover fx-dropdown axf-moremenu__pop' : 'fx-ctx fx-popover axf-moremenu__pop');
