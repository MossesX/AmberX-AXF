/*
 * Settings open (settings-open, Nov 13 2026): where a settings interface lands when something opens it.
 *
 * Brett, Nov 13 2026: "I want by default all settings interfaces, whether they're built already or not built, to
 * default to open in a dialogue".
 *
 * Every opener goes through the framework actions `app.settings` (the whole interface) and `settings.open[:<tab>]`
 * (one tab); both ask `settingsOpenRoute` here, so a settings interface added later opens in a dialog without doing
 * anything. Brett, Nov 16 2026: there is no choice any more; every settings interface always opens as a floating popup.
 * Pure: the settings library renders, the runtime routes.
 *
 * Web only for now; the Kotlin twin is a deferred gap (framework/spec/PORTING.md).
 */

/**
 * Retired (Brett, Nov 16 2026): the per-user "Settings open in" choice (`axf.settings.opensAs`), the `settings.opensas`
 * and `settings.page` actions, the dialogs' "Open as page" button and a plugin's "Opens in" pull on its settings. Every
 * settings interface always opens as a floating popup. Saved values under these keys are dropped on load
 * (`RETIRED_SETTINGS_OPEN_KEYS`), and framework/spec/check-settings-open.mts fails CI if any of them comes back.
 */
export const RETIRED_SETTINGS_OPEN_KEYS = ['axf.settings.opensAs'] as const;

/** Dialog ids the settings library registers: the whole interface, and one tab. */
export const SETTINGS_ALL_DIALOG = 'axf.settings.all';
export const SETTINGS_TAB_DIALOG = 'axf.settings.tab';

export interface SettingsOpenInput {
  /** The tab asked for (undefined = the whole interface). */
  tab?: string;
  /** The view on screen now. */
  view?: string;
  /** The host took the settings view (embed@1): it opens there, never in our dialog. */
  hostTakes?: boolean;
}

export type SettingsOpenRoute =
  | { via: 'page'; tab?: string; why: string }
  | { via: 'dialog'; dialog: string; tab?: string; why: string };

/** Where one opening lands: always the floating dialog, unless a host shows settings or the Settings view is already up. */
export function settingsOpenRoute(i: SettingsOpenInput): SettingsOpenRoute {
  const tab = i.tab || undefined;
  if (i.hostTakes) return { via: 'page', tab, why: 'the host shows settings' };
  // Already on the Settings view (an old link): switch the tab in place, never stack a dialog over the same settings.
  if (i.view === 'settings') return { via: 'page', tab, why: 'already on the Settings view' };
  return tab
    ? { via: 'dialog', dialog: SETTINGS_TAB_DIALOG, tab, why: 'always a floating popup' }
    : { via: 'dialog', dialog: SETTINGS_ALL_DIALOG, why: 'always a floating popup' };
}

/**
 * Is this dialog a settings interface? (id `…settings…` as a word, or a title ending in "settings"). The dialog host
 * gives every one the glass surface without the dialog asking, so settings dialogs added later look the same as the
 * built ones (chrome settings, banner settings, window settings, plugin settings, a settings tab).
 */
export function isSettingsDialog(id: string, title?: string): boolean {
  return /(^|[.:_-])settings($|[.:_-])/i.test(id) || /\bsettings$/i.test((title ?? '').trim());
}

/** The surface a dialog gets: its own pick, else glass for every settings dialog. */
export function dialogSurface(id: string, def: { title?: string; surface?: 'glass' }): 'glass' | undefined {
  return def.surface ?? (isSettingsDialog(id, def.title) ? 'glass' : undefined);
}
