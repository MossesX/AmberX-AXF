/**
 * Nav-style engine (nav-style@1, build molly-nav-submenus): compiles a nav-style asset into `--fx-navs-*` tokens and
 * `data-fx-navs-*` root attributes, and holds the pure sub-menu logic the navigation component uses (which sub menus
 * are open, the path to the active page, pinned / hidden / reordered items).
 *
 * The fields, defaults and validators are in navstyle-rules.mjs (one registry, shared with control@1 `tokens.nav` and
 * the build engine). Everything compiles to theme tokens: colours name colour-theme tokens, fonts name the style
 * theme's families and the typography scale, sizes are multiples of `--fx-space`, so swapping a theme restyles the nav.
 * `theme` values compile to nothing, so the stylesheet's own rule applies and the `standard` preset looks like the nav
 * did before. Opt-in: the runtime only compiles this when the nav-menu asset says `navStyle: true`.
 *
 * Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { normalizeNavStyle, navIdList, type NavStyleData } from './navstyle-rules.mjs';
import { MOTION_EASE } from './behavior';
import type { StyleOutput } from './components';

export { normalizeNavStyle, navStyleErrors, navFieldErrors, navFieldValue, navIdList, NAV_STYLE_FIELDS, NAV_STYLE_TYPE, NAV_STYLE_FRAME, NAV_COLOR_TOKENS, NAV_ANIMATIONS, NAV_ACCENT_PREFIX, NAV_STYLE_GROUPS } from './navstyle-rules.mjs';
export type { NavStyleData, NavAnimation, NavFieldSpec } from './navstyle-rules.mjs';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** A colour token id → the theme variable it reads. */
export const navColorVar = (token: string) => `var(--fx-${kebab(token)})`;
/** Item padding (block) per density, in multiples of the space unit. */
const DENSITY_PY: Record<string, number> = { compact: 0.5, regular: 0.875, roomy: 1.25 };
/** The width of a nav collapsed to its icons, in multiples of the space unit. */
export const NAV_COLLAPSED_SPACE = 7;
const COLOR_SLOTS = ['background', 'text', 'hover', 'active', 'activeText', 'submenu', 'accent'] as const;

export interface NavStyleState {
  /** the user asked for reduced motion (prefers-reduced-motion) */
  reducedMotion?: boolean;
  /** the nav is collapsed to its icons */
  collapsed?: boolean;
  /** the width the user dragged the nav to (px), when resizable */
  width?: number | null;
}

/** Is motion off for this style right now? */
export function navMotionOff(s: NavStyleData, reducedMotion = false): boolean {
  return s.animation.kind === 'none' || s.animation.reduced === 'always' || (s.animation.reduced === 'system' && reducedMotion);
}

/** The width the nav gets (px), or null to keep the layout asset's. */
export function navWidth(s: NavStyleData, state: NavStyleState = {}): number | null {
  const w = s.width.resizable && typeof state.width === 'number' && state.width > 0 ? state.width : s.width.size;
  if (!w) return null;
  return Math.round(Math.min(s.width.max, Math.max(s.width.min, w)));
}

/** Tokens + root attributes for a nav-style (already normalized or raw). */
export function navStyleOutput(raw: unknown, state: NavStyleState = {}): StyleOutput {
  const s = normalizeNavStyle(raw);
  const vars: Record<string, string> = {};
  const set: string[] = [];
  for (const slot of COLOR_SLOTS) {
    const t = s.colors[slot];
    if (t === 'theme') continue;
    vars[`--fx-navs-${kebab(slot)}`] = navColorVar(t);
    set.push(kebab(slot));
  }
  if (s.font.family !== 'theme') set.push('font');
  if (s.font.size !== 'theme') { vars['--fx-navs-size'] = `var(--fx-type-scale-${s.font.size})`; set.push('size'); }
  if (s.font.weight !== 'theme') { vars['--fx-navs-weight'] = s.font.weight; set.push('weight'); }
  if (s.layout.density !== 'theme') vars['--fx-nav-item-py'] = `calc(var(--fx-space) * ${DENSITY_PY[s.layout.density]})`;
  vars['--fx-navs-indent'] = `calc(var(--fx-space) * ${s.layout.indent})`;
  const off = navMotionOff(s, state.reducedMotion);
  vars['--fx-navs-dur'] = off ? '0ms' : s.animation.durationMs ? `${s.animation.durationMs}ms` : 'var(--fx-motion)';
  vars['--fx-navs-ease'] = s.animation.easing === 'theme' ? 'var(--fx-ease)' : MOTION_EASE[s.animation.easing] ?? MOTION_EASE.standard!;
  vars['--fx-navs-stagger'] = off ? '0ms' : `${s.animation.staggerMs}ms`;
  if (state.collapsed && s.width.collapsible) vars['--fx-layout-nav-width'] = `calc(var(--fx-space) * ${NAV_COLLAPSED_SPACE})`;
  else { const w = navWidth(s, state); if (w) vars['--fx-layout-nav-width'] = `${w}px`; }
  return {
    vars,
    attrs: {
      'data-fx-navs': 'on',
      'data-fx-navs-set': set.join(' '),
      'data-fx-navs-anim': off ? 'none' : s.animation.kind,
      'data-fx-navs-chevron': s.animation.chevron,
      'data-fx-navs-font': s.font.family,
      'data-fx-navs-icons': s.icons.show ? 'on' : 'off',
      'data-fx-navs-collapsed': state.collapsed && s.width.collapsible ? 'on' : 'off',
    },
  };
}

/* ---------------- the sub-menu tree ---------------- */

/** Anything with an id, an optional view and optional children (NavItem, a merged app nav, a test tree). */
export interface NavNode { id: string; view?: string; items?: readonly NavNode[] }

/** The ids from the top down to the node whose view is `view` (that node included), or [] when it isn't there. */
export function navPathTo(tree: readonly NavNode[], view: string | null | undefined): string[] {
  if (!view) return [];
  for (const n of tree) {
    if (n.view === view) return [n.id];
    if (n.items?.length) { const p = navPathTo(n.items, view); if (p.length) return [n.id, ...p]; }
  }
  return [];
}

/** The ids above a node (its ancestors, top first), or null when it isn't in the tree. */
export function navAncestors(tree: readonly NavNode[], id: string): string[] | null {
  for (const n of tree) {
    if (n.id === id) return [];
    if (n.items?.length) { const p = navAncestors(n.items, id); if (p) return [n.id, ...p]; }
  }
  return null;
}

const descendants = (tree: readonly NavNode[], id: string): string[] => {
  const find = (ns: readonly NavNode[]): NavNode | null => { for (const n of ns) { if (n.id === id) return n; const f = n.items ? find(n.items) : null; if (f) return f; } return null; };
  const out: string[] = [];
  const walk = (ns: readonly NavNode[] | undefined) => ns?.forEach((n) => { out.push(n.id); walk(n.items); });
  walk(find(tree)?.items);
  return out;
};

/**
 * Open or close one sub menu. Single mode keeps only the opened one's own branch open (its ancestors stay open, its
 * siblings and their children close); closing one closes everything under it too. Order: top first.
 */
export function navToggle(tree: readonly NavNode[], open: readonly string[], id: string, single: boolean, want?: boolean): string[] {
  const isOpen = open.includes(id);
  const next = want ?? !isOpen;
  if (!next) { const gone = new Set([id, ...descendants(tree, id)]); return open.filter((x) => !gone.has(x)); }
  if (isOpen) return [...open];
  const up = navAncestors(tree, id) ?? [];
  if (single) return [...up, id];
  return [...new Set([...open, ...up, id])];
}

/** The open list after the page moved to `view`: the active branch opens (followActive), others close (autoCollapse). */
export function navFollow(tree: readonly NavNode[], open: readonly string[], view: string | null | undefined, s: Pick<NavStyleData, 'behavior'>): string[] {
  const path = navPathTo(tree, view);
  if (!path.length) return [...open];
  const branch = path.slice(0, -1); // the page's own node only opens when it has children of its own
  const last = path[path.length - 1]!;
  const lastHasKids = (() => { const f = (ns: readonly NavNode[]): NavNode | undefined => { for (const n of ns) { if (n.id === last) return n; const x = n.items ? f(n.items) : undefined; if (x) return x; } return undefined; }; return !!f(tree)?.items?.length; })();
  const want = s.behavior.followActive ? [...branch, ...(lastHasKids ? [last] : [])] : [];
  const kept = s.behavior.autoCollapse ? open.filter((x) => want.includes(x) || path.includes(x)) : [...open];
  return [...new Set([...kept, ...want])];
}

/** Is a node (or anything under it) the page on screen? */
export function navContains(n: NavNode, view: string | null | undefined): boolean {
  if (!view) return false;
  return n.view === view || !!n.items?.some((c) => navContains(c, view));
}

/**
 * The top-level items as the style arranges them: hidden ones dropped, the `order` ids first in that order (the rest
 * keep theirs), and the pinned ones pulled out (for a Pinned group at the top). Ids are matched on the item id.
 */
export function navArrange<T extends { id: string }>(items: readonly T[], s: Pick<NavStyleData, 'items'>): { pinned: T[]; items: T[] } {
  const hidden = new Set(navIdList(s.items.hidden));
  const order = navIdList(s.items.order);
  const pinnedIds = navIdList(s.items.pinned);
  const shown = items.filter((i) => !hidden.has(i.id));
  const rank = (i: T) => { const k = order.indexOf(i.id); return k === -1 ? order.length + shown.indexOf(i) : k; };
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b));
  return { pinned: pinnedIds.map((id) => sorted.find((i) => i.id === id)).filter((i): i is T => !!i), items: sorted.filter((i) => !pinnedIds.includes(i.id)) };
}

/** The colour an item's accent reads (an item id with an accent in the style), or null. */
export function navAccent(s: Pick<NavStyleData, 'accents'>, id: string): string | null {
  const t = s.accents[id];
  return t ? navColorVar(t) : null;
}

/** Saved open state, cleaned (a list of ids). */
export function parseNavOpen(raw: unknown): string[] {
  if (typeof raw === 'string') { try { return parseNavOpen(JSON.parse(raw)); } catch { return navIdList(raw); } }
  return Array.isArray(raw) ? navIdList(raw) : [];
}
