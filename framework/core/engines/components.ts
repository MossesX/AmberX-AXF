/**
 * Component style engine — maps component assets (button, slider, container,
 * dialog, popup, context-menu, toolbar, nav-menu, app-menu) to CSS variables plus data-attributes on the
 * document root. axf.css keys off these, so every Button, Slider, etc. in
 * every AmberX AXF app restyles the instant an asset is swapped.
 */
import type { AppMenuData, ButtonData, ChromeDensity, ContainerData, ContextMenuData, DialogData, NavMenuData, PopupData, SliderData, ToolbarData } from '../types';
import type { VarMap } from './theme';

export interface StyleOutput {
  vars: VarMap;
  attrs: Record<string, string>;
}

const BTN_PAD = { sm: [5, 10], md: [8, 14], lg: [11, 20] } as const;
const PAD = { sm: 0.75, md: 1.1, lg: 1.5 } as const;

export function buttonStyle(b: ButtonData): StyleOutput {
  const [py, px] = BTN_PAD[b.size];
  return {
    vars: {
      '--fx-btn-radius': b.shape === 'pill' ? '999px' : b.shape === 'square' ? '2px' : 'var(--fx-radius-md)',
      '--fx-btn-weight': String(b.weight),
      '--fx-btn-py': `calc(${py}px * var(--fx-density-k, 1))`,
      '--fx-btn-px': `${px}px`,
      '--fx-btn-shadow': b.elevation ? 'var(--fx-shadow-sm)' : 'none',
      '--fx-btn-case': b.uppercase ? 'uppercase' : 'none',
      '--fx-btn-tracking': b.uppercase ? '0.06em' : '0',
    },
    attrs: { 'data-fx-btn': b.fill },
  };
}

export function sliderStyle(s: SliderData): StyleOutput {
  return {
    vars: {
      '--fx-slider-track': `${s.track}px`,
      '--fx-slider-thumb': `${s.thumbSize}px`,
      '--fx-slider-thumb-w': s.thumb === 'bar' ? `${Math.max(6, Math.round(s.thumbSize / 3))}px` : `${s.thumbSize}px`,
      '--fx-slider-thumb-r': s.thumb === 'circle' ? '50%' : s.thumb === 'bar' ? '3px' : 'var(--fx-radius-sm)',
    },
    attrs: { 'data-fx-slider': s.fill },
  };
}

export function containerStyle(c: ContainerData): StyleOutput {
  const shadows = ['none', 'var(--fx-shadow-sm)', 'var(--fx-shadow-md)', 'var(--fx-shadow-lg)'];
  return {
    vars: {
      '--fx-card-pad': `calc(var(--fx-space) * ${PAD[c.padding] * 2})`,
      '--fx-card-shadow': shadows[c.elevation] ?? 'none',
    },
    attrs: { 'data-fx-card': c.variant, 'data-fx-card-header': c.header },
  };
}

/**
 * Whether a section / group renders a collapse toggle: the container asset asks for it, or the
 * active style theme turns on `wrapGroups` (build option --wrap-groups), which wraps every group.
 * Mirrors ComponentStyleEngine.container on Android.
 */
export function containerCollapsible(c: Pick<ContainerData, 'collapsible'>, s?: { wrapGroups?: boolean } | null): boolean {
  return c.collapsible === true || s?.wrapGroups === true;
}

export function dialogStyle(d: DialogData): StyleOutput {
  return {
    vars: { '--fx-dialog-w': `${d.width}px` },
    attrs: {
      'data-fx-dialog': d.variant,
      'data-fx-backdrop': d.backdrop,
      'data-fx-dialog-anim': d.animation,
      'data-fx-dialog-header': d.header,
    },
  };
}

export function popupStyle(p: PopupData): StyleOutput {
  return { vars: {}, attrs: { 'data-fx-toast-pos': p.position, 'data-fx-toast': p.variant } };
}

export function contextMenuStyle(c: ContextMenuData): StyleOutput {
  return { vars: {}, attrs: { 'data-fx-ctx': c.variant } };
}

/* ---------- chrome: toolbar, nav-menu, app-menu ----------
 * Their optional style fields default to the values that reproduce the
 * pre-0.2.1 look exactly, so existing assets render unchanged. */

const TOOLBAR_PY: Record<ChromeDensity, number> = { compact: 0.35, regular: 0.6, roomy: 0.9 };
const TOOLBTN_H: Record<ChromeDensity, number> = { compact: -8, regular: -4, roomy: 0 };
const NAV_PY: Record<ChromeDensity, number> = { compact: 4, regular: 7, roomy: 10 };
const MENUBAR_H: Record<ChromeDensity, number> = { compact: 0, regular: 4, roomy: 12 };
const rowH = (delta: number) => (delta === 0 ? 'var(--fx-row-h)' : `calc(var(--fx-row-h) ${delta < 0 ? '-' : '+'} ${Math.abs(delta)}px)`);

export function toolbarStyle(t: ToolbarData): StyleOutput {
  const d = t.density ?? 'regular';
  return {
    vars: {
      '--fx-toolbar-py': `calc(var(--fx-space) * ${TOOLBAR_PY[d]})`,
      '--fx-toolbtn-h': rowH(TOOLBTN_H[d]),
    },
    attrs: {
      'data-fx-toolbar': t.variant,
      'data-fx-toolbar-surface': t.surface ?? 'flat',
      'data-fx-toolbar-divider': t.divider === false ? 'off' : 'on',
      'data-fx-toolbar-collapsible': t.collapsible === true ? 'on' : 'off',
    },
  };
}

export function navMenuStyle(n: NavMenuData): StyleOutput {
  const d = n.density ?? 'regular';
  return {
    vars: { '--fx-nav-item-py': `${NAV_PY[d]}px` },
    attrs: {
      'data-fx-nav': n.style,
      'data-fx-nav-indicator': n.indicator ?? 'auto',
      'data-fx-nav-icons': n.showIcons === false ? 'off' : 'on',
    },
  };
}

export function appMenuStyle(a: AppMenuData): StyleOutput {
  const d = a.density ?? 'regular';
  return {
    vars: { '--fx-menubar-h': rowH(MENUBAR_H[d]) },
    attrs: { 'data-fx-menubar': a.surface ?? 'flat' },
  };
}
