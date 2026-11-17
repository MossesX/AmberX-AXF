/**
 * openSettingsFloating (build settings-opened-banners-nav-menu, Nov 17 2026). Brett: "When I click on like banners or
 * whenever the settings opens from on like the navigation menu or the toolbar, it doesn't open in the floating window.
 * It opens in the main area."
 *
 * The one entry point every settings opener calls: the nav menu's Settings item, the nav tree, the `nav:settings`
 * action, the search palette, Help's related links, toolbar / menu-bar / banner actions (`app.settings`,
 * `settings.open:<tab>`), the chrome context menu (`chrome.settings:<type>:<instance>`) and Banner settings. It wraps
 * the floating window PR 628 added (core/engines/settingsopen.ts): a target names what to open, the engine says which
 * dialog shows it, and this file opens it, or focuses it when that same dialog is already up, instead of adding a
 * second one. On a phone the dialog host draws the same dialog as the dialog style asset says (floating, sheet or
 * drawer), so there is nothing phone-specific here.
 *
 * Where it does not float: an embedding host that takes settings (embed@1) gets the opening through `dispatch`, and a
 * Settings view that is actually on screen (an old deep link) switches its tab in place rather than stacking a dialog
 * over the same settings. A nav click never puts the Settings view on screen any more, so that case no longer sticks.
 *
 * API (console actions, so REST, MCP, CLI and voice all reach it): `settings.floating[:<target>]` with
 * `all` · `tab:<id>` (or a bare tab id) · `chrome:<type>[:<instance>]` · `banner[:<id>]`. The older actions keep
 * working and go through the same door: `app.settings`, `settings.open:<tab>`, `chrome.settings:<type>:<instance>`,
 * `banners.settings[:<id>]`, `nav:settings`. State: console-control `state.dialog` names the open dialog.
 *
 * Web only; the Kotlin twin is a deferred gap (framework/spec/PORTING.md). Contract: framework/spec/SETTINGS-FLOATING.md.
 */
import type { AxfRuntime } from '../core';
import { SETTINGS_LAST_TAB_KEY, SETTINGS_TAB_EVENT, SETTINGS_ALL_DIALOG, parseSettingsFloatingTarget, sameSettingsDialog, settingsFloatingDialog, settingsOpenRoute, viewOpensSettings, type SettingsFloatingTarget } from '../core/engines/settingsopen';

export type { SettingsFloatingTarget } from '../core/engines/settingsopen';

/** The action every surface uses: settings.floating[:<target>]. */
export const SETTINGS_FLOATING_ACTION = 'settings.floating';

export type SettingsFloatingResult =
  /** the dialog was opened */
  | { via: 'dialog'; dialog: string; tab?: string }
  /** the same dialog was already up: it got focus (a tab switched inside the whole-interface dialog) */
  | { via: 'focused'; dialog: string; tab?: string }
  /** the Settings view is on screen: its tab switched in place */
  | { via: 'page'; tab?: string }
  /** an embedding host shows settings: it was asked */
  | { via: 'host' };

const installed = new WeakSet<AxfRuntime>();

/** Focus the dialog on screen (the dialog host focuses a new one itself; a repeat open only needs the focus back). */
function focusOpenDialog(): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>('.fx-dialog[role="dialog"]');
  el?.focus();
}

/** Tell the Settings view / whole-interface dialog which tab to show (both listen for the event). */
function switchTabInPlace(rt: AxfRuntime, tab: string): void {
  rt.settings.set(SETTINGS_LAST_TAB_KEY, tab);
  globalThis.dispatchEvent?.(new CustomEvent(SETTINGS_TAB_EVENT, { detail: tab }));
}

/**
 * Open a settings interface in the floating window: the whole interface, one settings tab, one chrome instance's
 * settings (tab group / toolbar / banner / nav menu / menu bar) or the banner settings. The same dialog already up is
 * focused, not opened twice; a tab asked for while the whole interface is up switches inside it.
 */
export function openSettingsFloating(rt: AxfRuntime, target: SettingsFloatingTarget): SettingsFloatingResult {
  const state = rt.getState();
  if (target.kind === 'all' || target.kind === 'tab') {
    const tab = target.kind === 'tab' ? target.tab : undefined;
    // the host shows settings (embed@1): the actions forward there through dispatch
    if (rt.hostTakes('settings')) { rt.dispatch(tab ? `settings.open:${tab}` : 'app.settings'); return { via: 'host' }; }
    const r = settingsOpenRoute({ tab, view: state.view });
    if (r.via === 'page') {
      // the Settings view is the screen on show (an old deep link): switch its tab there, never a dialog over it
      if (tab) switchTabInPlace(rt, tab);
      return { via: 'page', tab };
    }
    // the whole interface is already up: a tab switches inside it
    if (tab && state.dialog?.id === SETTINGS_ALL_DIALOG) { switchTabInPlace(rt, tab); focusOpenDialog(); return { via: 'focused', dialog: SETTINGS_ALL_DIALOG, tab }; }
  }
  const { dialog, props } = settingsFloatingDialog(target);
  const tab = target.kind === 'tab' ? target.tab : undefined;
  if (sameSettingsDialog(state.dialog, target)) { focusOpenDialog(); return { via: 'focused', dialog, tab }; }
  rt.openDialog(dialog, props);
  return { via: 'dialog', dialog, tab };
}

/**
 * Go to a view the way a nav item, a search hit or a related link does: every view is a page, except Settings, which
 * is the floating window (never the main area). Returns what happened for Settings, null for a page.
 */
export function openView(rt: AxfRuntime, view: string): SettingsFloatingResult | null {
  if (viewOpensSettings(view)) return openSettingsFloating(rt, { kind: 'all' });
  rt.navigate(view);
  return null;
}

/** Install the `settings.floating[:<target>]` action, once per runtime (AppShell calls it). */
export function installSettingsFloating(rt: AxfRuntime): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  rt.actions.register('settings.floating', (args) => {
    const t = parseSettingsFloatingTarget(args);
    if (!t) { rt.toast(`Say what to open: all, tab:<id>, chrome:<type>[:<instance>] or banner[:<id>] (not "${args.join(':')}").`, 'warning', 'Settings'); return; }
    openSettingsFloating(rt, t);
  }, { label: 'Open settings in the floating window (settings.floating[:all|tab:<id>|chrome:<type>[:<instance>]|banner[:<id>]])', params: true });
}
