/*
 * Settings open (settings-open, Nov 13 2026): where a settings interface lands when something opens it.
 *
 * Brett, Nov 13 2026: "I want by default all settings interfaces, whether they're built already or not built, to
 * default to open in a dialogue".
 *
 * Every opener goes through the framework actions `app.settings` (the whole interface) and `settings.open[:<tab>]`
 * (one tab); both ask `settingsOpenRoute` here, so a settings interface added later opens in a dialog without doing
 * anything. The person can keep the page instead (`axf.settings.opensAs` = page), a plugin's own "Opens in" pick still
 * wins for its tab, and `settings.page[:<tab>]` always opens the page (deep links that mean the page, the dialog's
 * "Open as page" button). Pure: the settings library renders, the runtime routes.
 *
 * Web only for now; the Kotlin twin is a deferred gap (framework/spec/PORTING.md).
 */

export const SETTINGS_OPENS_AS = ['dialog', 'page'] as const;
export type SettingsOpensAs = (typeof SETTINGS_OPENS_AS)[number];

/** Per-user setting: how settings interfaces open. */
export const SETTINGS_OPENS_AS_KEY = 'axf.settings.opensAs';
/** The framework default (Brett, Nov 13 2026): a floating dialog over the current screen. */
export const SETTINGS_OPENS_AS_DEFAULT: SettingsOpensAs = 'dialog';

export const SETTINGS_OPENS_AS_LABELS: Record<SettingsOpensAs, string> = {
  dialog: 'Floating dialog over the screen',
  page: 'The Settings page',
};

/** Dialog ids the settings library registers: the whole interface, and one tab. */
export const SETTINGS_ALL_DIALOG = 'axf.settings.all';
export const SETTINGS_TAB_DIALOG = 'axf.settings.tab';

export function normalizeSettingsOpensAs(x: unknown): SettingsOpensAs {
  return x === 'page' || x === 'main' ? 'page' : SETTINGS_OPENS_AS_DEFAULT;
}

/** Words for voice / CLI ("as a page", "in a dialog", "floating", "pop up") → a choice; null = not understood. */
export function parseSettingsOpensAs(words: unknown): SettingsOpensAs | null {
  if (typeof words !== 'string') return null;
  const w = words.toLowerCase();
  if (/\b(page|full|main|navigate)\b/.test(w)) return 'page';
  if (/\b(dialog|dialogue|float|floating|pop ?up|popup|window|overlay|default)\b/.test(w)) return 'dialog';
  return null;
}

export interface SettingsOpenInput {
  /** The tab asked for (undefined = the whole interface). */
  tab?: string;
  /** The person's `axf.settings.opensAs` value. */
  pref?: unknown;
  /** The owning plugin's "Opens in" pick for its tab (placement@1), when it has one. */
  ownerPlacement?: string | null;
  /** The view on screen now. */
  view?: string;
  /** The host took the settings view (embed@1): it opens there, never in our dialog. */
  hostTakes?: boolean;
  /** Force the page (`settings.page`). */
  forcePage?: boolean;
}

export type SettingsOpenRoute =
  | { via: 'page'; tab?: string; why: string }
  | { via: 'dialog'; dialog: string; tab?: string; why: string };

/** Where one opening lands. */
export function settingsOpenRoute(i: SettingsOpenInput): SettingsOpenRoute {
  const tab = i.tab || undefined;
  if (i.forcePage) return { via: 'page', tab, why: 'asked for the page' };
  if (i.hostTakes) return { via: 'page', tab, why: 'the host shows settings' };
  // Already on the Settings page: switch the tab in place, never stack a dialog over the same page.
  if (i.view === 'settings') return { via: 'page', tab, why: 'already on the Settings page' };
  if (tab && i.ownerPlacement === 'dialog') return { via: 'dialog', dialog: SETTINGS_TAB_DIALOG, tab, why: "the plugin's Opens in pick" };
  if (normalizeSettingsOpensAs(i.pref) === 'page') return { via: 'page', tab, why: 'your Settings open as a page' };
  return tab
    ? { via: 'dialog', dialog: SETTINGS_TAB_DIALOG, tab, why: 'default' }
    : { via: 'dialog', dialog: SETTINGS_ALL_DIALOG, why: 'default' };
}

export const settingsOpensAsOptions = () => SETTINGS_OPENS_AS.map((value) => ({ value, label: SETTINGS_OPENS_AS_LABELS[value] }));
