/**
 * Layout engine — compiles a layout asset into a CSS grid. The shell renders
 * fixed regions (menubar, toolbar, nav, main, inspector, status) and the
 * engine decides where each one sits. A separate single-column grid is
 * produced for narrow (phone) viewports.
 */
import spec from '../../schemas/asset-types.json';
import type { LayoutData } from '../types';
import type { VarMap } from './theme';

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
}

const row = (cells: string[]) => `"${cells.join(' ')}"`;

export function compileLayout(l: LayoutData): CompiledLayout {
  const cols: string[] = [];
  const sizes: string[] = [];
  const push = (name: string, size: string) => {
    cols.push(name);
    sizes.push(size);
  };
  // Chrome regions render only when their slot accepts the matching asset type.
  const slots = compileSlots(l);
  const shows = (r: Region, type: string) => regionAccepts(slots, r, type);
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
  };
}

export function layoutVars(l: LayoutData): VarMap {
  const c = compileLayout(l);
  return {
    '--fx-grid-areas': c.areas,
    '--fx-grid-cols': c.columns,
    '--fx-grid-rows': c.rows,
    '--fx-grid-areas-m': c.mobileAreas,
    '--fx-grid-rows-m': c.mobileRows,
    '--fx-content-max': l.contentMaxWidth > 0 ? `${l.contentMaxWidth}px` : 'none',
  };
}
