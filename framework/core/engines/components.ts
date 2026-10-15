/**
 * Component style engine — maps component assets (button, slider, container,
 * dialog, popup, context-menu) to CSS variables plus data-attributes on the
 * document root. frame.css keys off these, so every Button, Slider, etc. in
 * every Frame app restyles the instant an asset is swapped.
 */
import type { ButtonData, ContainerData, ContextMenuData, DialogData, PopupData, SliderData } from '../types';
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
