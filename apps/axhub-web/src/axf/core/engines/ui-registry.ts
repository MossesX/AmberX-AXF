/**
 * UI registry engine (ui-registry@1) — the typed face of ui-registry-rules.mjs for the runtime and the React layer, plus
 * `uiRegistryFromRuntime`: the live registry of a running app (every screen, dialog, settings tab, setting, menu entry,
 * window and argument-free action its search index and action bus know, with the plugin that owns each one), so the
 * UI shortcuts plugin and the console's live catalog can open anything the moment a plugin is installed.
 */
export {
  UI_ATTR, UI_EFFECTS, UI_KINDS, UI_KIND_LABELS, UI_KIND_WORDS, UI_LIMITS, UI_OPEN_ACTION, UI_OPEN_VERBS, UI_OPEN_VIAS, UI_OWNERS, UI_REGISTRY_FRAME, UI_REGISTRY_TYPE, UI_SOURCES, UI_VOICE_COMMAND_ID, UI_VOICE_PHRASES,
  matchUiShortcut, mergeUiItems, nearWord, normalizeUiItem, normalizeUiOpen, normalizeUiRegistry, normalizeUiShortcut, ownerFromModule, parseUiId, resolveUiItem, scoreUiItem, searchUiItems,
  uiEffect, uiElementSelector, uiId, uiItemsFromConsoleCatalog, uiItemsFromMenuAsset, uiItemsFromPluginManifest, uiItemsFromSearchEntries, uiOpenCommand, uiOpenPlan, uiQueryWords, uiRegistryCoverage,
  uiRegistryErrors, uiRegistrySchemaProperties, uiSay, uiShortcutErrors, uiVoiceCommands,
  type UiControlCommand, type UiCoverage, type UiEffect, type UiItem, type UiItemHit, type UiKind, type UiOpen, type UiOpenPlan, type UiOpenVia, type UiRegistryData, type UiResolve, type UiSayResult, type UiShortcut, type UiSource, type UiVoiceCommand,
} from './ui-registry-rules.mjs';

import type { AxfRuntime } from '../runtime';
import { mergeUiItems as merge, uiItemsFromMenuAsset as fromMenu, uiItemsFromSearchEntries as fromSearch, type UiItem } from './ui-registry-rules.mjs';

/**
 * The live registry of a running app: its search index (views, settings tabs, single settings, dialogs, menu entries,
 * windows) and its action bus (argument-free actions), each stamped with the library that contributed it (`rt.libraries`
 * `ui`), plus the active app-menu, context-menu, nav-menu and toolbar assets' entries. `app` = the app's project name.
 */
export function uiRegistryFromRuntime(rt: AxfRuntime, app: string): UiItem[] {
  const owners = new Map<string, string>();
  for (const lib of rt.libraries) {
    for (const v of lib.ui?.views ?? []) owners.set(`view:${v.id}`, `library:${lib.id}`);
    for (const d of lib.ui?.dialogs ?? []) owners.set(`dialog:${d.id}`, `library:${lib.id}`);
    for (const t of lib.ui?.settingsTabs ?? []) owners.set(`settings-tab:${t.id}`, `library:${lib.id}`);
  }
  const live = fromSearch(rt.search.entries(), rt.actions.list(), { app }, (kind, id) => owners.get(`${kind}:${id}`));
  const menus: UiItem[] = [];
  for (const type of ['app-menu', 'context-menu', 'nav-menu', 'toolbar'] as const) {
    try {
      const asset = rt.asset(type);
      if (asset) menus.push(...fromMenu(asset, { app, owner: 'app', source: 'live' }));
    } catch { /* an app without that asset */ }
  }
  return merge(live, menus);
}
