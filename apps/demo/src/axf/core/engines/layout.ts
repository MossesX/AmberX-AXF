/**
 * Layout engine — compiles a layout asset into a CSS grid. The shell renders
 * fixed regions (menubar, toolbar, nav, main, inspector, status) and the
 * engine decides where each one sits. A separate single-column grid is
 * produced for narrow (phone) viewports.
 */
import type { LayoutData } from '../types';
import type { VarMap } from './theme';

export type Region = 'menubar' | 'toolbar' | 'nav' | 'main' | 'inspector' | 'status';

export interface CompiledLayout {
  regions: Region[];
  areas: string;
  columns: string;
  rows: string;
  mobileAreas: string;
  mobileRows: string;
  navOrientation: 'vertical' | 'horizontal';
}

const row = (cells: string[]) => `"${cells.join(' ')}"`;

export function compileLayout(l: LayoutData): CompiledLayout {
  const cols: string[] = [];
  const sizes: string[] = [];
  const push = (name: string, size: string) => {
    cols.push(name);
    sizes.push(size);
  };
  if (l.nav === 'left') push('nav', `${l.navWidth}px`);
  if (l.inspector === 'left') push('inspector', `${l.inspectorWidth}px`);
  push('main', 'minmax(0, 1fr)');
  if (l.inspector === 'right') push('inspector', `${l.inspectorWidth}px`);
  if (l.nav === 'right') push('nav', `${l.navWidth}px`);

  const span = (name: string) => row(cols.map(() => name));
  const areas: string[] = [];
  const rows: string[] = [];
  const regions: Region[] = ['main'];
  const add = (r: Region, a: string, size: string) => {
    areas.push(a);
    rows.push(size);
    if (!regions.includes(r)) regions.push(r);
  };

  if (l.showMenubar) add('menubar', span('menubar'), 'auto');
  if (l.nav === 'top') add('nav', span('nav'), 'auto');
  if (l.showToolbar && l.toolbarPosition === 'top') add('toolbar', span('toolbar'), 'auto');
  areas.push(row(cols));
  rows.push('minmax(0, 1fr)');
  if (l.nav !== 'top') regions.push('nav');
  if (l.inspector !== 'none') regions.push('inspector');
  if (l.showToolbar && l.toolbarPosition === 'bottom') add('toolbar', span('toolbar'), 'auto');
  if (l.showStatusbar) add('status', span('status'), 'auto');

  // Phone: single column, nav becomes a bottom tab strip, inspector hidden.
  const mAreas: string[] = [];
  const mRows: string[] = [];
  if (l.showMenubar) { mAreas.push('"menubar"'); mRows.push('auto'); }
  if (l.showToolbar) { mAreas.push('"toolbar"'); mRows.push('auto'); }
  mAreas.push('"main"'); mRows.push('minmax(0, 1fr)');
  mAreas.push('"nav"'); mRows.push('auto');

  return {
    regions,
    areas: areas.join(' '),
    columns: sizes.join(' '),
    rows: rows.join(' '),
    mobileAreas: mAreas.join(' '),
    mobileRows: mRows.join(' '),
    navOrientation: l.nav === 'top' ? 'horizontal' : 'vertical',
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
