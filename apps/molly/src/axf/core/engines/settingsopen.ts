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

/*
 * One entry point for every settings opener (build settings-opened-banners-nav-menu, Nov 17 2026; Brett: "When I click
 * on like banners or whenever the settings opens from on like the navigation menu or the toolbar, it doesn't open in
 * the floating window. It opens in the main area."). A target names what to open; `settingsFloatingDialog` says which
 * dialog shows it; `sameSettingsDialog` says whether that dialog is already up (then the opener focuses it instead of
 * opening a second one). The web host is framework/react/settingsFloating.ts (`openSettingsFloating`).
 */

/** The Settings view id (the page the old nav links point at). */
export const SETTINGS_VIEW = 'settings';
/** The tab the Settings view / whole-interface dialog shows (settings key) and the event that switches it in place. */
export const SETTINGS_LAST_TAB_KEY = 'axf.settings.lastTab';
export const SETTINGS_TAB_EVENT = 'axf:settings-tab';
/** Dialog ids of the chrome settings (tab group / toolbar / banner / nav / menu bar) and the banner settings. */
export const CHROME_SETTINGS_DIALOG_ID = 'axf.chrome.settings';
export const BANNER_SETTINGS_DIALOG_ID = 'axf.banners.settings';

export type SettingsFloatingTarget =
  | { kind: 'all' }
  | { kind: 'tab'; tab: string }
  | { kind: 'chrome'; type: string; instance?: string }
  | { kind: 'banner'; id?: string };

/** The dialog ids a settings target can land in. */
export const SETTINGS_FLOATING_DIALOGS = [SETTINGS_ALL_DIALOG, SETTINGS_TAB_DIALOG, CHROME_SETTINGS_DIALOG_ID, BANNER_SETTINGS_DIALOG_ID] as const;

/**
 * Parse an action / API / spoken target: `all` (or nothing), `tab:<id>`, `chrome:<type>[:<instance>]`,
 * `banner[:<id>]`, or a bare settings tab id. Null when the words make no target.
 */
export function parseSettingsFloatingTarget(parts: readonly string[]): SettingsFloatingTarget | null {
  const [head = '', ...rest] = parts.map((p) => p.trim());
  if (!head || head === 'all' || head === 'settings') return { kind: 'all' };
  if (head === 'tab') return rest[0] ? { kind: 'tab', tab: rest.join(':') } : null;
  if (head === 'chrome') return rest[0] ? { kind: 'chrome', type: rest[0], ...(rest[1] ? { instance: rest.slice(1).join(':') } : {}) } : null;
  if (head === 'banner') return rest[0] ? { kind: 'banner', id: rest.join(':') } : { kind: 'banner' };
  return /^[a-z0-9][a-z0-9._-]*$/i.test(head) ? { kind: 'tab', tab: [head, ...rest].join(':') } : null;
}

/** The dialog a target opens in, and the props that dialog takes. Pure. */
export function settingsFloatingDialog(t: SettingsFloatingTarget): { dialog: string; props: Record<string, unknown> } {
  switch (t.kind) {
    case 'tab': return { dialog: SETTINGS_TAB_DIALOG, props: { tab: t.tab } };
    case 'chrome': return { dialog: CHROME_SETTINGS_DIALOG_ID, props: t.instance ? { type: t.type, instance: t.instance } : { type: t.type } };
    case 'banner': return { dialog: BANNER_SETTINGS_DIALOG_ID, props: t.id ? { id: t.id } : {} };
    default: return { dialog: SETTINGS_ALL_DIALOG, props: {} };
  }
}

/** Is the dialog on screen the one this target would open (same id, same props)? Then focus it, never open another. */
export function sameSettingsDialog(open: { id: string; props?: Record<string, unknown> } | null | undefined, t: SettingsFloatingTarget): boolean {
  if (!open) return false;
  const want = settingsFloatingDialog(t);
  if (open.id !== want.dialog) return false;
  const have = open.props ?? {};
  const keys = new Set([...Object.keys(have), ...Object.keys(want.props)]);
  for (const k of keys) if ((have[k] ?? '') !== (want.props[k] ?? '')) return false;
  return true;
}

/** A navigation to a view id: the Settings view is not a page to navigate to, it is the floating window. */
export function viewOpensSettings(view: string): boolean {
  return view === SETTINGS_VIEW;
}
