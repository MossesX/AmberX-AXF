/**
 * Layout engine — compiles a layout asset into a CSS grid. The shell renders
 * fixed regions (menubar, toolbar, nav, main, inspector, status) and the
 * engine decides where each one sits. A separate single-column grid is
 * produced for narrow (phone) viewports.
 *
 * Every layout parameter is a token (Nov 2 2026, build token-control): the rules in layout-rules.mjs (shared with the
 * build engine) name every field, its default, range and unit, and `layoutVars` compiles each one to
 * `--fx-layout-<field>` beside the grid vars. The compiled struct stays port-neutral (px numbers, what the Kotlin
 * kernel and the conformance fixture compare); the web grid vars read the tokens (`var(--fx-layout-nav-width)`), so
 * a token override moves the grid live.
 */
import spec from '../../schemas/asset-types.json';
import type { LayoutData } from '../types';
import type { VarMap } from './theme';
import { LAYOUT_VIEWPORTS, layoutErrors, layoutToken, layoutTokenVars, layoutTokens, normalizeLayout } from './layout-rules.mjs';

export { LAYOUT_ENUMS, LAYOUT_FIELDS, LAYOUT_SWITCHES, LAYOUT_VIEWPORTS, layoutBreakpointAttr, layoutErrors, layoutFieldNames, layoutToken, layoutTokenVars, layoutTokens, layoutValue, layoutViewportAttrs, normalizeLayout, type LayoutTokenInfo, type LayoutUnit } from './layout-rules.mjs';

/** The framework's own layout values (what an asset that sets only the grid gets for everything else). */
export const DEFAULT_LAYOUT: NormalizedLayout = normalizeLayout({} as LayoutData) as NormalizedLayout;
/** A layout with every token field filled in. */
export type NormalizedLayout = LayoutData & Required<Pick<LayoutData, 'statusHeight' | 'regionGap' | 'mainPadTop' | 'mainPadX' | 'mainPadBottom' | 'phoneMainPadTop' | 'phoneMainPadX' | 'phoneMainPadBottom' | 'phoneNavItemMin' | 'phoneEdge' | 'tinyMaxWidth' | 'smallMaxWidth' | 'phoneMaxWidth' | 'mediumMaxWidth' | 'largeMaxWidth'>>;

/** Validation entry for the asset validator (empty for other types). */
export const layoutAssetErrors = (type: string, data: unknown): string[] => layoutErrors(type, data);

/** The root attributes the viewport cut-offs stamp (data-fx-tiny / -small / -narrow / -medium), with the max width each one watches. */
export function layoutViewports(l: LayoutData): { attr: string; field: string; maxWidth: number }[] {
  const n = normalizeLayout(l) as NormalizedLayout;
  return LAYOUT_VIEWPORTS.map((v) => ({ attr: v.attr, field: v.field, maxWidth: n[v.field as keyof NormalizedLayout] as number }));
}

export type Region = 'menubar' | 'toolbar' | 'nav' | 'main' | 'inspector' | 'status';

/**
 * Region slot contract (f.regions). Every region a shell may render, on any
 * port, and which asset types it accepts. Defaults live in asset-types.json
 * (layout.slots); a layout asset may override any region with `data.slots`.
 * Regions are append-only: new ones may be added, never renamed.
 */
export type SlotRegion = Region | 'fab' | 'sheet' | 'overlay';
const SLOT_SPEC = (spec.types.layout as unknown as { slots: { regions: SlotRegion[]; defaults: Record<SlotRegion, string[]> } }).slots;
export const SLOT_REGIONS: readonly SlotRegion[] = SLOT_SPEC.regions;
export const DEFAULT_SLOTS: Readonly<Record<SlotRegion, readonly string[]>> = SLOT_SPEC.defaults;
export type CompiledSlots = Record<SlotRegion, string[]>;

/** Merge a layout's slot overrides onto the defaults. Unknown regions are ignored (tolerant), like every decoder. */
export function compileSlots(l: LayoutData): CompiledSlots {
  const out = {} as CompiledSlots;
  for (const r of SLOT_REGIONS) {
    const o = l.slots?.[r];
    out[r] = Array.isArray(o) ? o.filter((t): t is string => typeof t === 'string') : [...DEFAULT_SLOTS[r]];
  }
  return out;
}

/** Does `region` accept assets of `type`? Shells ask this before mounting chrome, plugins before contributing. */
export function regionAccepts(slots: CompiledSlots, region: SlotRegion, type: string): boolean {
  return slots[region]?.includes(type) ?? false;
}

export interface CompiledLayout {
  regions: Region[];
  areas: string;
  columns: string;
  rows: string;
  mobileAreas: string;
  mobileRows: string;
  navOrientation: 'vertical' | 'horizontal';
  /** region → accepted asset types (defaults merged with the layout's `slots`) */
  slots: CompiledSlots;
  /** the desktop grid's columns, left to right (nav / inspector / main); `columns` holds their sizes in the same order */
  columnRegions: string[];
}

const row = (cells: string[]) => `"${cells.join(' ')}"`;

/** `hidden`: slot types the user hid (core/engines/hide.ts); their regions drop out like a refusing slot. */
export function compileLayout(raw: LayoutData, hidden: readonly string[] = []): CompiledLayout {
  const l = normalizeLayout(raw) as NormalizedLayout;
  const cols: string[] = [];
  const sizes: string[] = [];
  const push = (name: string, size: string) => {
    cols.push(name);
    sizes.push(size);
  };
  // Chrome regions render only when their slot accepts the matching asset type.
  const slots = compileSlots(l);
  const shows = (r: Region, type: string) => regionAccepts(slots, r, type) && !hidden.includes(type);
  const navOn = shows('nav', 'nav-menu');
  const nav = navOn ? l.nav : 'none';
  if (nav === 'left') push('nav', `${l.navWidth}px`);
  if (l.inspector === 'left') push('inspector', `${l.inspectorWidth}px`);
  push('main', 'minmax(0, 1fr)');
  if (l.inspector === 'right') push('inspector', `${l.inspectorWidth}px`);
  if (nav === 'right') push('nav', `${l.navWidth}px`);

  const span = (name: string) => row(cols.map(() => name));
  const areas: string[] = [];
  const rows: string[] = [];
  const regions: Region[] = ['main'];
  const add = (r: Region, a: string, size: string) => {
    areas.push(a);
    rows.push(size);
    if (!regions.includes(r)) regions.push(r);
  };

  const menubar = l.showMenubar && shows('menubar', 'app-menu');
  const toolbar = l.showToolbar && shows('toolbar', 'toolbar');
  if (menubar) add('menubar', span('menubar'), 'auto');
  if (nav === 'top') add('nav', span('nav'), 'auto');
  if (toolbar && l.toolbarPosition === 'top') add('toolbar', span('toolbar'), 'auto');
  areas.push(row(cols));
  rows.push('minmax(0, 1fr)');
  if (nav === 'left' || nav === 'right') regions.push('nav');
  if (l.inspector !== 'none') regions.push('inspector');
  if (toolbar && l.toolbarPosition === 'bottom') add('toolbar', span('toolbar'), 'auto');
  if (l.showStatusbar) add('status', span('status'), 'auto');

  // Phone: single column, nav becomes a bottom tab strip, inspector hidden.
  const mAreas: string[] = [];
  const mRows: string[] = [];
  if (menubar) { mAreas.push('"menubar"'); mRows.push('auto'); }
  if (toolbar) { mAreas.push('"toolbar"'); mRows.push('auto'); }
  mAreas.push('"main"'); mRows.push('minmax(0, 1fr)');
  if (navOn) { mAreas.push('"nav"'); mRows.push('auto'); }

  return {
    regions,
    areas: areas.join(' '),
    columns: sizes.join(' '),
    rows: rows.join(' '),
    mobileAreas: mAreas.join(' '),
    mobileRows: mRows.join(' '),
    navOrientation: nav === 'top' ? 'horizontal' : 'vertical',
    slots,
    columnRegions: cols,
  };
}

/**
 * Root CSS vars: every `--fx-layout-*` token, then the grid. The grid's column sizes read the width tokens
 * (`var(--fx-layout-nav-width)`), so changing a token changes the grid; the compiled struct keeps the px numbers.
 */
export function layoutVars(raw: LayoutData, hidden: readonly string[] = []): VarMap {
  const l = normalizeLayout(raw) as NormalizedLayout;
  const c = compileLayout(l, hidden);
  const token = (region: string) => (region === 'nav' ? `var(${layoutToken('navWidth')})` : region === 'inspector' ? `var(${layoutToken('inspectorWidth')})` : 'minmax(0, 1fr)');
  return {
    ...layoutTokenVars(l),
    [layoutToken('navOrientation')]: c.navOrientation,
    '--fx-grid-areas': c.areas,
    '--fx-grid-cols': c.columnRegions.map(token).join(' '),
    '--fx-grid-rows': c.rows,
    '--fx-grid-areas-m': c.mobileAreas,
    '--fx-grid-rows-m': c.mobileRows,
    '--fx-content-max': l.contentMaxWidth > 0 ? `var(${layoutToken('contentMaxWidth')})` : 'none',
  };
}

/** Re-exported for editors: the token list with the current values of one layout filled in. */
export function layoutTokenValues(raw: LayoutData): (ReturnType<typeof layoutTokens>[number] & { value: number | string | boolean })[] {
  const n = normalizeLayout(raw) as Record<string, unknown>;
  return layoutTokens().map((t) => ({ ...t, value: n[t.field] as number | string | boolean }));
}
