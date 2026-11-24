/**
 * A workspace toolbar's look and behaviour (chrome-settings@1): its own instance settings (`axf.chrome.toolbar.<toolbar
 * id>`, what its right-click Settings dialog and `chrome.set:toolbar:<toolbar id>:<field>:<value>` save) over its
 * defaults. `labels` on the toolbar definition is its default Buttons choice; every other field starts at the toolbar
 * asset type's default. No React here, so the specs can check it.
 */
import { CHROME_INSTANCE_KEY, chromeInstanceData } from '../../core/engines/chrome-settings-rules.mjs';
import type { ToolbarDef } from './store';

export interface WsToolbarLook { variant: 'icons' | 'icons-labels' | 'labels'; align: 'start' | 'center' | 'spread'; density: 'compact' | 'regular' | 'roomy'; surface: 'flat' | 'raised' | 'glass'; divider: boolean; showSearch: boolean; collapsible: boolean }

/** The per-device fold of one collapsible workspace toolbar. */
export const WS_TOOLBAR_FOLD_KEY = (toolbarId: string) => `axf.workspace.toolbar.${toolbarId}.folded`;

export function wsToolbarLook(get: (key: string) => unknown, tb: Pick<ToolbarDef, 'id' | 'labels'>): WsToolbarLook {
  const base: WsToolbarLook = { variant: tb.labels ? 'icons-labels' : 'icons', align: 'start', density: 'regular', surface: 'flat', divider: true, showSearch: false, collapsible: false };
  return chromeInstanceData('toolbar', base, get(CHROME_INSTANCE_KEY('toolbar', tb.id)));
}

/** The attributes a workspace toolbar carries for its look (workspace.css styles them). */
export function wsToolbarAttrs(look: WsToolbarLook, folded: boolean): Record<string, string> {
  const out: Record<string, string> = { 'data-variant': look.variant, 'data-align': look.align, 'data-density': look.density, 'data-surface': look.surface, 'data-divider': look.divider ? 'on' : 'off' };
  if (folded) out['data-folded'] = 'on';
  return out;
}
