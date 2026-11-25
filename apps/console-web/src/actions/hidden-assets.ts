/**
 * Hidden assets as console actions (hidden-assets@1): hide one piece of the console's chrome, bring one or all back,
 * open the Hidden list. On the action bus they are reachable from menus, toolbars, search, control@1
 * (`console.actions run chrome.hide:toolbar:app`), MCP console_action / console_show, the CLI and voice like any action.
 *
 *   chrome.hide:<kind>:<id>     hide one tab group, toolbar, banner, navigation menu, menu bar or widget
 *   chrome.unhide:<kind>:<id>   show it again
 *   chrome.unhideAll            show everything hidden again
 *   chrome.hidden               open the Hidden list (the dialog axf.hidden-assets, else Settings → Appearance → Hidden)
 *
 * The framework's chrome registers the same four where it is mounted (the right-click menu, the Assets menu). This
 * installer fills in whichever of them is not on the bus yet, so the console answers all four on every screen; an id
 * that is already registered is left to its owner. The state itself lives in the runtime (`rt.hide` / `rt.unhide` /
 * `rt.unhideAll`, saved in the console's look document); nothing here keeps a list.
 *
 * Deep links (console_show): `view:settings/tab:appearance#hidden` and `dialog:axf.hidden-assets`.
 */
import type { AxfRuntime } from '../axf/core';

/** The dialog the Hidden list opens in (the settings library ships it). */
export const HIDDEN_ASSETS_DIALOG = 'axf.hidden-assets';
/** The Hidden list inside Settings → Appearance, as a console-control@1 address. */
export const HIDDEN_ASSETS_LINK = 'view:settings/tab:appearance#hidden';
/** The settings tab the list lives on. */
const HIDDEN_ASSETS_TAB = 'appearance';

export const HIDDEN_ASSET_ACTIONS = {
  'chrome.hide': { label: 'Hide one tab group, toolbar, banner, nav, menu bar or widget in this app (chrome.hide:<kind>:<id>)', params: true, requires: 'assets.swap', effect: 'write' },
  'chrome.unhide': { label: 'Show a hidden piece again (chrome.unhide:<kind>:<id>)', params: true, requires: 'assets.swap', effect: 'write' },
  'chrome.unhideAll': { label: 'Unhide all: show every hidden piece again', requires: 'assets.swap', effect: 'write' },
  'chrome.hidden': { label: 'Hidden items: what is hidden in this app', effect: 'navigate' },
} as const;

export type HiddenAssetAction = keyof typeof HIDDEN_ASSET_ACTIONS;
export const HIDDEN_ASSET_ACTION_IDS = Object.keys(HIDDEN_ASSET_ACTIONS) as HiddenAssetAction[];

/** The runtime's hidden-assets calls (core/runtime.ts). Optional here, so a runtime without them answers with a toast. */
interface HiddenRuntime {
  hide?(ref: { kind: string; id: string }, opts?: { by?: string }): boolean;
  unhide?(ref: { kind: string; id: string }): boolean;
  unhideAll?(): boolean;
}

/** `chrome.hide:<kind>:<id>` arguments → the piece. A widget's id is `<type>:<id>`, so the id is everything after the kind. */
export function hiddenAssetTargetOf(args: string[]): { kind: string; id: string } | null {
  const [kind = '', ...rest] = args;
  const id = rest.join(':');
  return kind && id ? { kind, id } : null;
}

/** Register whichever of the four actions is not on the bus yet. Returns a remover (of the ones registered here). */
export function installHiddenAssetActions(rt: AxfRuntime): () => void {
  const hidden = rt as unknown as HiddenRuntime;
  const missing = (id: string) => !rt.actions.list().some((a) => a.id === id);
  const unsupported = (title: string) => { rt.toast('Hiding pieces is not available in this build of the console.', 'warning', title); return false; };
  const piece = (args: string[], title: string) => {
    const t = hiddenAssetTargetOf(args);
    if (!t) rt.toast(`${title} needs a kind and an id (chrome.${title.toLowerCase()}:<kind>:<id>)`, 'warning', title);
    return t;
  };
  const handlers: Record<HiddenAssetAction, (args: string[]) => boolean> = {
    'chrome.hide': (args) => { const t = piece(args, 'Hide'); return !!t && (hidden.hide ? hidden.hide(t) : unsupported('Hide')); },
    'chrome.unhide': (args) => { const t = piece(args, 'Unhide'); return !!t && (hidden.unhide ? hidden.unhide(t) : unsupported('Unhide')); },
    'chrome.unhideAll': () => (hidden.unhideAll ? hidden.unhideAll() : unsupported('Unhide all')),
    'chrome.hidden': () => {
      if (rt.uiRenderers.dialogs[HIDDEN_ASSETS_DIALOG]) { rt.openDialog(HIDDEN_ASSETS_DIALOG, {}); return true; }
      return rt.dispatch(`settings.open:${HIDDEN_ASSETS_TAB}`);
    },
  };
  const offs = HIDDEN_ASSET_ACTION_IDS.filter(missing).map((id) => rt.actions.register(id, (args) => handlers[id](args), { ...HIDDEN_ASSET_ACTIONS[id], module: 'console.hidden-assets' }));
  return () => offs.forEach((off) => off());
}
