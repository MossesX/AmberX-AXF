/**
 * Jump-menu engine (jump-menu@1, build jump-menu-asset): compiles a jump-menu asset (plus its overrides) into
 * `--fx-jump-*` tokens and `data-fx-jump-*` attributes for the menu element, and holds the pure logic the component
 * uses: the entries per display mode, scroll-spy (which section is on screen), the overflow split for a More menu,
 * keyboard stepping and the per-device folded state.
 *
 * The fields, defaults and validators are in jumpmenu-rules.mjs (one registry, shared with control@1 `tokens.jump` and
 * the build engine). Everything compiles to theme tokens: sizes are multiples of `--fx-space` and steps of the type
 * scale, colours are the stylesheet's own (chip / tab / nav rules), so swapping a theme restyles every jump menu.
 *
 * Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { normalizeJumpMenu, type JumpDisplay, type JumpLocation, type JumpMenuData, type JumpSection } from './jumpmenu-rules.mjs';
import type { StyleOutput } from './components';

export { normalizeJumpMenu, jumpMenuErrors, jumpFieldErrors, jumpFieldValue, jumpMenuPath, jumpSections, jumpConfig, jumpFieldSource, jumpMenuTokens, JUMP_FIELDS, JUMP_FIELD_IDS, JUMP_FIELD_LEVELS, JUMP_MENU_TYPE, JUMP_MENU_FRAME, JUMP_LOCATIONS, JUMP_DISPLAYS, JUMP_VARIANTS, JUMP_SIZES, JUMP_DENSITIES, JUMP_OVERFLOWS, JUMP_MENU_PREFIX, JUMP_ASSET_FIELD, JUMP_MENU_ID } from './jumpmenu-rules.mjs';
export type { JumpMenuData, JumpSection, JumpLocation, JumpDisplay, JumpVariant, JumpOverflow, JumpFieldSpec } from './jumpmenu-rules.mjs';

/** Per-device folded state: `{ "<menu id>": true | false }` (a menu with no entry starts as its asset says). */
export const JUMP_COLLAPSED_KEY = 'axf.jumpmenu.collapsed';

/** Entry padding (block) per density, in multiples of the space unit; `theme` leaves it to the stylesheet. */
const DENSITY_PY: Record<string, number> = { compact: 0.25, regular: 0.5, roomy: 0.875 };
/** Text step and icon size (× font size) per size. */
const SIZE_TYPE: Record<string, string> = { sm: 'xs', md: 'sm', lg: 'md' };
const SIZE_ICON: Record<string, number> = { sm: 0.85, md: 1, lg: 1.15 };

export interface JumpMenuState {
  /** the user asked for reduced motion (prefers-reduced-motion): no smooth scrolling */
  reducedMotion?: boolean;
  /** folded right now (per device; undefined = as the asset says) */
  collapsed?: boolean;
}

/** Is the menu laid out along a row (top / bottom / floating) or a column (left / right)? */
export function jumpAxis(location: JumpLocation): 'row' | 'column' {
  return location === 'left' || location === 'right' ? 'column' : 'row';
}

/** Folded right now? Only a collapsible menu folds; the device's choice beats the asset's default. */
export function jumpCollapsed(s: Pick<JumpMenuData, 'collapsible' | 'collapsed'>, state: JumpMenuState = {}): boolean {
  if (!s.collapsible) return false;
  return typeof state.collapsed === 'boolean' ? state.collapsed : s.collapsed;
}

/** Tokens + attributes for the menu element (not the root: several jump menus may be on one page). */
export function jumpMenuOutput(raw: unknown, state: JumpMenuState = {}): StyleOutput {
  const s = normalizeJumpMenu(raw);
  const vars: Record<string, string> = {
    '--fx-jump-offset': `calc(var(--fx-space) * ${s.offset})`,
    '--fx-jump-font': `var(--fx-type-scale-${SIZE_TYPE[s.size]})`,
    '--fx-jump-icon': `calc(var(--fx-font-size) * ${SIZE_ICON[s.size]})`,
  };
  if (s.density !== 'theme') vars['--fx-jump-py'] = `calc(var(--fx-space) * ${DENSITY_PY[s.density]})`;
  const folded = jumpCollapsed(s, state);
  return {
    vars,
    attrs: {
      'data-fx-jump': 'on',
      'data-fx-jump-location': s.location,
      'data-fx-jump-axis': jumpAxis(s.location),
      'data-fx-jump-display': s.display,
      'data-fx-jump-variant': s.variant,
      'data-fx-jump-size': s.size,
      'data-fx-jump-overflow': s.overflow,
      'data-fx-jump-sticky': s.sticky ? 'on' : 'off',
      'data-fx-jump-collapsible': s.collapsible ? 'on' : 'off',
      'data-fx-jump-collapsed': folded ? 'on' : 'off',
      'data-fx-jump-spy': s.spy ? 'on' : 'off',
      'data-fx-jump-smooth': s.smooth && !state.reducedMotion ? 'on' : 'off',
    },
  };
}

/** One drawn entry. */
export interface JumpItem {
  id: string;
  label: string;
  icon?: string;
  /** 1-based position (numbered display shows it) */
  n: number;
  showIcon: boolean;
  showText: boolean;
  /** what the entry prints: the label, or "3" for numbered */
  text: string;
  /** the accessible name (always the label) */
  name: string;
}

/** The entries per display mode. Icons only falls back to the number when a section has no icon. */
export function jumpItems(sections: readonly JumpSection[], display: JumpDisplay): JumpItem[] {
  return sections.map((s, i) => {
    const n = i + 1;
    const hasIcon = !!s.icon;
    switch (display) {
      case 'text': return { ...s, n, showIcon: false, showText: true, text: s.label, name: s.label };
      case 'icons': return { ...s, n, showIcon: hasIcon, showText: !hasIcon, text: hasIcon ? '' : String(n), name: s.label };
      case 'numbered': return { ...s, n, showIcon: false, showText: true, text: `${n}. ${s.label}`, name: s.label };
      default: return { ...s, n, showIcon: hasIcon, showText: true, text: s.label, name: s.label };
    }
  });
}

/** Where a section sits in the scroll container (px, relative to the container's scroll origin). */
export interface JumpPosition { id: string; top: number; bottom: number }

/** The reading line sits this far down the viewport (a fraction of its height) below the offset: a heading just under a sticky bar still counts as reached. */
export const JUMP_SPY_BAND = 0.25;

/**
 * Scroll-spy: the section on screen. The last section whose top has passed the reading line (the scroll position plus
 * the offset, plus a quarter of the viewport, with a small tolerance) is active; before the first one, the first; at
 * the very end of the scroll, the last (a short final section would otherwise never light). Null without sections.
 */
export function jumpSpy(positions: readonly JumpPosition[], scrollTop: number, viewport: number, scrollMax: number, offsetPx = 0, tolerance = 2, band = JUMP_SPY_BAND): string | null {
  if (!positions.length) return null;
  if (scrollMax > 0 && scrollTop + viewport >= scrollMax - tolerance) return positions[positions.length - 1]!.id;
  const line = scrollTop + offsetPx + tolerance + Math.max(0, viewport) * band;
  let active = positions[0]!.id;
  for (const p of positions) { if (p.top <= line) active = p.id; else break; }
  return active;
}

/**
 * Overflow `more`: how many entries fit in the room (each with its width, plus the gap between them), keeping space
 * for the More button when not all fit. Always shows at least one entry.
 */
export function jumpMoreSplit(widths: readonly number[], room: number, moreWidth: number, gap = 0): { shown: number; more: boolean } {
  if (!widths.length) return { shown: 0, more: false };
  const total = widths.reduce((a, w, i) => a + w + (i ? gap : 0), 0);
  if (total <= room) return { shown: widths.length, more: false };
  let used = 0; let shown = 0;
  for (const w of widths) {
    const next = used + (shown ? gap : 0) + w;
    if (next + gap + moreWidth > room) break;
    used = next; shown++;
  }
  return { shown: Math.max(1, shown), more: true };
}

/** The entry an arrow key lands on (wraps at the ends; Home / End = first / last). */
export function jumpStep(ids: readonly string[], current: string | null, dir: -1 | 1 | 'first' | 'last'): string | null {
  if (!ids.length) return null;
  if (dir === 'first') return ids[0]!;
  if (dir === 'last') return ids[ids.length - 1]!;
  const i = current ? ids.indexOf(current) : -1;
  if (i === -1) return dir === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[(i + dir + ids.length) % ids.length]!;
}

/** The saved folded map, cleaned. */
export function parseJumpCollapsed(raw: unknown): Record<string, boolean> {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === 'boolean' && /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(k)) out[k] = b;
  return out;
}

/** The map with one menu's folded state set (or dropped when null). */
export function withJumpCollapsed(raw: unknown, menuId: string, collapsed: boolean | null): Record<string, boolean> {
  const m = parseJumpCollapsed(raw);
  if (collapsed === null) delete m[menuId]; else m[menuId] = collapsed;
  return m;
}
