/**
 * AxfRuntime — the single source of truth for a AmberX AXF app.
 * Holds the asset registry, the active asset per slot, UAC role, view,
 * overlays, and compiles everything into document-level CSS through the
 * engines. Framework-agnostic: the React layer only subscribes to it.
 */
import { SettingsRegistry, type SettingValue } from './settings';
import { AssetRegistry, serializeAsset } from './registry';
import { ActionBus, FRAMEWORK_MODULE, STANDARD_ACTIONS, type ActionContext } from './engines/actions';
import { colorThemeVars, styleThemeVars, type VarMap } from './engines/theme';
import { layoutVars } from './engines/layout';
import { appMenuStyle, buttonStyle, containerStyle, contextMenuStyle, dialogStyle, gaugeStyle, meterStyle, navMenuStyle, popupStyle, sliderStyle, tabGroupStyle, toolbarStyle } from './engines/components';
import { CUSTOM_KEY, customizableTypes, customizeSheet, effectiveCustom, normalizeCustomSlot, type CustomSlot, type CustomValues } from './engines/customize';
import { gateFor, hasPermission, resolvePermissions } from './engines/uac';
import { WindowManager } from './engines/windows';
import { normalizePlacement, placementKey, placementRoute, PLACEMENT_TAB_GROUP, type Placement, type UiRef } from './engines/placement';
import { defaultHidden, hideable, hiddenSlots } from './engines/hide';
import { detectEmbedFull, embedHostLabel, embedTakeSpec, embedLockedBy, embedLockNote, embedTakenBy, embedTakenProvider, embedTakenView, embedTakesFn, parseEmbedMessage, settingsTabOf, EMBED_MESSAGE, type Embed, type EmbedMenu, type EmbedMenuItem, type EmbedMessage, type EmbedPlugin } from './engines/embed';
import { SPACING_DEFAULT as SPACING_DEFAULT_VALUE, spacingOf, type Spacing } from './engines/spacing';
import { attachmentKey, bannerVars, placeAttachments, type BannerAttachment, type PlacedBanner } from './engines/banner';
import { hostSpec, hostSpecs, moveOnHost, normalizeArrangement, placeHost, placeToolbarWidgets, type HostArrangement, type HostAttachment, type PlacedAttachment } from './engines/widgets';
import { rollAssetIncluded, rollAssetKey, rollNever, rollPlan, rollSlotIncluded, type RollRules } from './engines/roll';
import { SearchIndex } from './engines/search';
import { STYLE_PACKAGE_TYPE, stepPackage, stylePackageSlots, type StylePackageData } from './engines/stylepackage';
import { appMenuSearchEntries, chromeToggleItems, compileAppMenu, compileProviderItems, mergeAppMenu, resolveChecked, type AppMenuContribution, type AppMenuEnv, type CompiledAppMenu, type CompiledMenuItem, type MergedAppMenu, type MenuSearchEntry, type ProviderOptions } from './engines/appmenu';
import { DESIGN_APPLIED_KEY, DESIGN_PACKAGE_TYPE, PACKAGE_APPLIED_KEY, captureDesignPackage, designPackageSlots, isAppearanceSetting, normalizeDesignPackage, packageSettingsPlan } from './engines/designpackage';
import { behaviorStyle, confirmBeforeDelete, normalizeBehavior, vibrationPattern } from './engines/behavior';
import { animationFor, brandingVars, glyphFor, markSvg, resolveBranding, type Glyph, type MarkAnimation, type ResolvedBrand } from './engines/brand';
import { INTERFACE_SETTING_KEY, INTERFACE_TYPE, captureInterface, isScopeId, resolveInterface, scopeAttrs, scopeSheet, scopeVarsCss, type InterfaceData, type ResolvedInterface } from './engines/interface';
import { APPEARANCE_FRAME, mergeAppearance, paletteFromColorTheme, resolveAppearance, type AppearanceDocument, type AppearanceSourceState } from './engines/appearance';
import { Diagnostics } from './diagnostics';
import { OutputTerminal } from './terminal';
import {
  ASSET_TYPES,
  OPTIONAL_TYPES,
  type ActiveAssets,
  type AppearancePackageData,
  type BehaviorThemeData,
  type DesignPackageData,
  type Asset,
  type AssetType,
  type AxfManifest,
  type AxfState,
  type Gate,
  type MenuItem,
  type Toast,
} from './types';
import { assetTypeSpecs, attachable, type ValidationResult } from './validate';

/** A signed-in account bound to the runtime (bindPrincipal): its policy + role replace the role switcher. */
export interface BoundPrincipal {
  /** stable account id */
  id: string;
  /** shown name */
  label: string;
  /** uac-policy asset id the account's role lives in */
  policy: string;
  /** role id in that policy */
  role: string;
  /** extra facts the app wants to keep with it (username, grants…), never secrets */
  attributes?: Record<string, string>;
}

export interface AxfRuntimeOptions {
  manifest: AxfManifest;
  assets: unknown[];
  /** localStorage key for persisting the user's hot-swap choices */
  storageKey?: string;
  /**
   * The embed this app runs in (embed@1, engines/embed.ts): a host app that shows some of its chrome (the banner by
   * default). Omitted = detected from the page (`?axf-embed=` query, `AXF-Embed/` user agent) where there is one;
   * `null` = standalone whatever the page says.
   */
  embed?: Embed | null;
}

/** Settings keys for roll overrides (values: true | false; absent = built-in default). */
export const ROLL_SLOT_KEY = (type: string) => `axf.roll.slot.${type}`;
export const ROLL_ASSET_KEY = (type: string, id: string) => `axf.roll.asset.${type}.${id}`;
/** Hidden slot override (Settings → Appearance → Assets → Hidden); only hideable types (core/engines/hide.ts). */
export const HIDE_KEY = (type: string) => `axf.hide.${type}`;
/** Per-device fold state of a `collapsible` toolbar (same key on Android). */
export const TOOLBAR_COLLAPSED_KEY = 'axf.toolbar.collapsed';
/** Where a person put the widgets of one host (banner, toolbar, …): JSON of a HostArrangement (core/engines/widgets.ts). */
export const ARRANGE_KEY = (host: string) => `axf.widgets.arrange.${host}`;
/** Spacing choice (Settings → Appearance → Spacing): tight | compact | regular; absent = tight (engines/spacing.ts). */
export const SPACING_KEY = 'axf.appearance.spacing';
/**
 * Appearance lock (setting, true = on): every control that changes the look is greyed out (the permissions in
 * LOCKED_APPEARANCE_PERMS gate as `disable`) and this device's own look tweaks (Sliders, per-asset tokens) are set
 * aside, not deleted. The look from axHub still applies. Not an appearance setting itself, so Restore keeps it.
 */
export const APPEARANCE_LOCK_KEY = 'axf.lock.appearance';
export const LOCKED_APPEARANCE_PERMS: readonly string[] = ['assets.swap', 'assets.import'];
/** Developer apps: false = stop reading (and writing) the look on axHub; the app keeps its own saved look. */
export const APPEARANCE_FOLLOW_KEY = 'axf.hub.appearance.follow';

/** `defaults` = the app's manifest defaults when the choices were saved, so a changed app default can win (see constructor). */
type Persisted = { active?: Partial<ActiveAssets>; role?: string; defaults?: Partial<ActiveAssets> };

const safeStorage = {
  get(key: string): Persisted | null {
    try {
      const v = globalThis.localStorage?.getItem(key);
      return v ? (JSON.parse(v) as Persisted) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: Persisted) {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — choices just won't persist */
    }
  },
};

/** Context-menu items a library or plugin contributes to one target (web + Android: `addContextItems`). */
export interface ContextContribution {
  /** Unique, e.g. `<module>.<name>`; adding the same id again replaces it. */
  id: string;
  /** The contributing library or plugin id; `removeContextItems(module)` drops all of its items. */
  module: string;
  /** Context target (`data-fx-ctx-target`); default `default`. */
  target?: string;
  order?: number;
  items: import('./engines/windows').MenuEntry[];
}

/**
 * A live list for the application menu (`rt.registerAppMenuProvider`): called when its submenu opens, it returns
 * the items to show (sync or async; the web renderer shows a loading row meanwhile). `max` caps the list before a
 * More… entry that runs `moreAction`. (Android twin deferred: port on hold, Oct 21 2026.)
 */
export interface AppMenuProvider {
  items: () => MenuItem[] | Promise<MenuItem[]>;
  max?: number;
  moreAction?: string;
  moreLabel?: string;
  /** the module that registered it (`removeAppMenuItems(module)` also drops its providers) */
  module?: string;
}

/**
 * A library installed with `installLibraries` (web) — what the settings library's Plugins tab and the plugin
 * inventory engine (`engines/plugins.ts`) read. Everything a library declared, so the inventory can resolve
 * `dependsOn` → `plugin:<id>` and `provides` → `service:<capability>` the same way on every port.
 */
export interface InstalledLibrary {
  id: string;
  label: string;
  version: string;
  template?: string;
  dependsOn?: string[];
  provides?: string[];
  /** Kinds of values it edits (theme / style / layout / manager / builder), for the UI-editor clash rule. */
  uiEditor?: string[];
  /** Contribution ids (`view:x`, `dialog:x`, `settings-tab:x`), so two libraries contributing one id are reported. */
  contributes?: string[];
  /** The library's nav items / views / dialogs / settings tabs, for "Open" and "Settings" in the Plugin Manager. */
  ui?: { views: { id: string; title: string; icon?: string }[]; dialogs: { id: string; title: string }[]; settingsTabs: { id: string; label: string }[]; settingsCount: number; contextItems: number; /** app-menu items it contributes (engines/appmenu.ts) */ appMenuItems?: number };
  /** The model that built it (plugin@1 `builtWith`, Oct 23 2026), shown as a badge wherever its info shows. */
  builtWith?: { model: string; builtAt?: string };
  /** Where its primary UI opens by default (engines/placement.ts); the setting `axf.placement.<id>` wins. */
  opens?: Placement;
}

/** A nav section a library or plugin contributes; items point at views it registers. */
export interface NavExtraSection {
  /** Usually the contributing library's id. */
  id: string;
  label?: string;
  items: import('./types').NavItem[];
}

/**
 * Where a developer app's appearance selection lives: the axHub data server (`shared/settings/appearance.json`,
 * engines/appearance.ts). Off by default: an ordinary AXF app never attaches one. With one attached the runtime
 * applies the document through its normal swap / settings paths, pushes every local change back (per key, last
 * write wins), follows pushed changes live, and reports the source's state so the app can show its waiting screen
 * while the hub is unreachable (a developer app doesn't run without the hub: no local fallback, no default theme).
 * Web: `HubAppearanceSource` (react/hubAppearance.ts); Android: `HubAppearanceSource` in lib-hub.
 */
export interface AppearanceSource {
  /** Current connection state (the runtime mirrors it into `state.appearance`). */
  state(): AppearanceSourceState;
  /** Called with the document (null = none saved yet) whenever it loads or changes, and with the state on every change. */
  subscribe(listener: (ev: { doc: AppearanceDocument | null; version: string | null } | { state: AppearanceSourceState }) => void): () => void;
  /** Start loading / watching. */
  start(): void;
  stop(): void;
  /** Re-read now (the UI-editor rule: fresh on focus). */
  refresh(): void;
  /** Save a change. `change` is this app's keys only; the source merges into the latest document it holds (last write wins per key). */
  save(change: { slots?: Record<string, string>; spacing?: Spacing; hidden?: Record<string, boolean | null>; palette?: AppearanceDocument['palette'] }): void;
}

/** What `rt.brandPlace(slot)` gives a UI piece to draw. */
export interface BrandPlace { mode: string; name: string; asset: string; svg: string; animation: MarkAnimation | null }

export class AxfRuntime {
  readonly registry = new AssetRegistry();
  readonly actions = new ActionBus();
  /** Window / tab-group / docking engine (floating windows, splits, minimize) — see engines/windows.ts. */
  readonly windows = new WindowManager();
  /** The output terminal every install / import / hot swap / kit fallback writes to. */
  readonly terminal = new OutputTerminal();
  /** Extra context-menu items apps contribute per target (e.g. `tab-group`, `window-title`); `{payload}` in actions is substituted.
   *  Keys `*` or `*:<owner>` add items to EVERY context menu (after a separator), e.g. a plugin's "Open terminal". */
  readonly contextExtras = new Map<string, (target?: string, payload?: string) => import('./engines/windows').MenuEntry[]>();
  /** Context-menu items libraries and plugins contribute (`AxfWebLibrary.contextMenu`), keyed by id, removable per module. */
  private readonly contextContributions = new Map<string, ContextContribution>();
  /** Nav sections contributed by libraries and plugins (keyed, so re-adding replaces). Shown after the nav-menu asset's sections. */
  private readonly navSections = new Map<string, NavExtraSection>();
  /** Settings schema, panels and values (see settings.ts); the settings library renders them. */
  readonly settings: SettingsRegistry;
  /** Search index the toolbar's live search reads (engines/search.ts); anyone can add providers. */
  readonly search = new SearchIndex(this);
  /** Libraries installed with installLibraries, for the settings About / Plugins tabs. */
  readonly libraries: InstalledLibrary[] = [];
  /** Primary UIs that move with their owner's placement (engines/placement.ts): `view:<id>` / `dialog:<id>` → owner + default. */
  private readonly placements = new Map<string, { owner: string; ui: UiRef; fallback: Placement; title: string }>();
  /** Props of dialogs placed in a page / window tab (they don't fit in a tab payload string), by dialog id. */
  readonly placedProps = new Map<string, Record<string, unknown> | undefined>();
  /** The view to go back to when a dialog placed in the main area closes. */
  placedReturn: string | null = null;
  /** The shared tab-group window `tab` placements open in (while it's open). */
  private placementTabWindow: string | null = null;
  /** Libraries not installed on this page because the host app makes them unneeded (embed@1 `skipWhen`), with why. */
  readonly skippedLibraries: { id: string; label: string; version: string; reason: string }[] = [];
  /** Conflicts (two modules, same asset id / setting key / settings id) and crashes; see diagnostics.ts. */
  readonly diagnostics = new Diagnostics();
  /** Named counters toolbar items show as badges (`badge` on a toolbar item), e.g. `alerts.unread`. */
  private readonly badgeCounts = new Map<string, number>();
  readonly manifest: AxfManifest;
  /** The host app this one is embedded in (embed@1), or null when it runs on its own. Fixed for the page's life. */
  readonly embedded: Embed | null;
  readonly loadErrors: { id: string; errors: string[] }[] = [];
  private state: AxfState;
  private listeners = new Set<() => void>();
  private storageKey: string;
  private toastSeq = 0;
  private settingsBump = false;

  constructor(opts: AxfRuntimeOptions) {
    this.manifest = opts.manifest;
    this.embedded = opts.embed !== undefined ? opts.embed : detectPageEmbed();
    if (this.embedded) this.listenToHost();
    this.storageKey = opts.storageKey ?? `axf:${opts.manifest.app.id}`;
    this.settings = new SettingsRegistry(`${this.storageKey}:settings`);
    this.registry.onReplace = (r) => this.diagnostics.report({ kind: 'asset-conflict', ...r });
    this.settings.onConflict = (c) => this.diagnostics.report(
      c.what === 'setting'
        ? { kind: 'setting-conflict', key: c.id, was: c.was, now: c.now }
        : { kind: 'contribution-conflict', what: `settings ${c.what}`, id: c.id, was: c.was, now: c.now },
    );
    // The Spacing choice recompiles the styles (the provider re-applies them on any state change it sees).
    this.settings.onChange(SPACING_KEY, () => { this.terminal.ok('hot-swap', `spacing: ${this.spacing()}`); });
    // Hot render (Brett, Oct 23 2026): "whenever settings are changed that affect the UI, render immediately". Any
    // settings change is a state change, so everything that reads a setting while it renders (banners, chrome, plugin
    // pages) re-renders at once, wherever it was changed. Coalesced: several changes in one task = one render.
    this.settings.subscribe(() => {
      if (this.settingsBump) return;
      this.settingsBump = true;
      queueMicrotask(() => { this.settingsBump = false; this.set({}); });
    });
    // Another frame or tab of this app saved (a host's Settings tab, its banner strip, a second window): read it now.
    globalThis.addEventListener?.('storage', (e: StorageEvent) => {
      if (e.key !== null && e.key !== this.settings.savedUnder && e.key !== this.storageKey) return;
      this.reloadSaved();
    });
    for (const raw of opts.assets) {
      const r = this.registry.register(raw, 'builtin');
      if (!r.ok) this.loadErrors.push({ id: String((raw as { id?: string })?.id), errors: r.errors });
    }
    const saved = safeStorage.get(this.storageKey);
    const active = {} as ActiveAssets;
    for (const t of ASSET_TYPES) {
      // When the app ships a new default for a slot (its manifest default differs from the one saved alongside
      // the user's choices), the new default wins once; the user's later swaps persist as usual.
      const appChanged = saved?.defaults !== undefined && saved.defaults[t] !== opts.manifest.defaults[t];
      const candidates = [appChanged ? undefined : saved?.active?.[t], opts.manifest.defaults[t], this.registry.list(t)[0]?.id];
      const pick = candidates.find((id) => id && this.registry.has(t, id));
      if (!pick && (OPTIONAL_TYPES as readonly string[]).includes(t)) { active[t] = ''; continue; } // optional type, none shipped
      if (!pick) throw new Error(`AmberX AXF: no "${t}" asset is available — every slot needs at least one asset.`);
      active[t] = pick;
    }
    const policy = this.registry.get('uac-policy', active['uac-policy'])!.data;
    const role = saved?.role && policy.roles.some((r) => r.id === saved.role) ? saved.role : policy.defaultRole;

    this.state = {
      active,
      role,
      view: opts.manifest.startView ?? 'home',
      dialog: null,
      toasts: [],
      context: null,
      rev: 0,
      swaps: 0,
      appearance: null,
    };
    this.actions.withModule(FRAMEWORK_MODULE, () => this.registerBuiltinActions());
    this.registerBuiltinAppMenuProviders();
  }

  /* ---------------- appearance source (engines/appearance.ts): settings from the axHub data server ---------------- */

  private appearanceSource: AppearanceSource | null = null;
  private appearanceOff: (() => void) | null = null;
  /** true while the runtime applies a pushed document, so the change isn't echoed back to the source */
  private applyingAppearance = false;
  private lastAppearance: AppearanceDocument | null = null;

  /**
   * Make this a developer app: its appearance comes from the source (and goes back to it). Until the source is
   * `ready` the app's UI shows the waiting screen (`state.appearance`). Only one source at a time.
   */
  attachAppearanceSource(source: AppearanceSource): void {
    this.detachAppearanceSource();
    this.appearanceSource = source;
    this.appearanceOff = source.subscribe((ev) => {
      if (!this.appearanceFollowing()) return;
      if ('state' in ev) { this.set({ appearance: ev.state }); return; }
      this.applyAppearance(ev.doc);
    });
    this.followOff = this.settings.onChange(APPEARANCE_FOLLOW_KEY, () => this.syncAppearanceFollow());
    this.appearanceRunning = false;
    this.syncAppearanceFollow();
  }

  detachAppearanceSource(): void {
    this.appearanceOff?.();
    this.followOff?.();
    if (this.appearanceRunning) this.appearanceSource?.stop();
    this.appearanceOff = null;
    this.followOff = null;
    this.appearanceRunning = false;
    this.appearanceSource = null;
    this.lastAppearance = null;
    this.set({ appearance: null });
  }

  private followOff: (() => void) | null = null;
  private appearanceRunning = false;

  /** Is the look read from axHub right now? (A developer app with the follow switch on; true without a source too.) */
  appearanceFollowing(): boolean { return this.settings.get(APPEARANCE_FOLLOW_KEY) !== false; }

  /** Turn reading the look from axHub on or off (developer apps). Off = the app runs on its own saved look, no waiting. */
  setAppearanceFollowing(on: boolean): void {
    if (!this.mayChangeLook()) return this.toast('Your role cannot change where the look comes from.', 'danger', 'Permission denied');
    if (on) this.settings.clear(APPEARANCE_FOLLOW_KEY); else this.settings.set(APPEARANCE_FOLLOW_KEY, false);
  }

  /** Start or stop the source to match the follow switch. */
  private syncAppearanceFollow(): void {
    const src = this.appearanceSource;
    if (!src) return;
    const want = this.appearanceFollowing();
    if (want === this.appearanceRunning) return;
    this.appearanceRunning = want;
    if (want) {
      this.set({ appearance: src.state() });
      src.start();
      this.terminal.ok('appearance', 'reading the look from axHub again');
    } else {
      src.stop();
      this.set({ appearance: null });
      this.terminal.ok('appearance', 'not reading the look from axHub: this app keeps its own saved look');
    }
  }

  /** Is a source attached (developer app)? */
  hasAppearanceSource(): boolean { return this.appearanceSource !== null; }

  /** Is `source` the one attached right now? Libraries that attach a source detach only their own (Oct 28 2026). */
  appearanceSourceIs(source: AppearanceSource | null | undefined): boolean { return !!source && this.appearanceSource === source; }

  /** The hub the source talks to (shown on the waiting screen), when the source says. */
  appearanceHub(): string | undefined { return (this.appearanceSource as { origin?: string } | null)?.origin; }

  /** The source's state, or null when the app has none. */
  appearanceState(): AppearanceSourceState | null { return this.state.appearance ?? null; }

  /** The developer app runs only while its source is ready (or it has none). The React layer shows the waiting screen otherwise. */
  appearanceReady(): boolean { return !this.appearanceSource || !this.appearanceRunning || this.state.appearance?.status === 'ready'; }

  /** What the last document resolved to in this app, for Settings → Appearance to explain skipped ids. */
  appearanceSkipped(): string[] { return resolveAppearance(this.lastAppearance, (t, id) => this.registry.has(t as AssetType, id)).skipped; }

  /**
   * Apply a document from the source: every appearance slot starts from the app's own default, then takes the
   * document's id when the app has that asset (unknown id = the default; never a crash); spacing and hidden slots go
   * through the same settings keys the UI uses. Nothing here needs a permission: the document *is* the saved setting,
   * the UAC gate sits on changing it (swap / setSpacing / setSlotHidden still decide who may).
   */
  private applyAppearance(doc: AppearanceDocument | null): void {
    this.lastAppearance = doc;
    const r = resolveAppearance(doc, (t, id) => this.registry.has(t as AssetType, id));
    this.applyingAppearance = true;
    try {
      const active = { ...this.state.active };
      for (const t of ASSET_TYPES) {
        if (t === 'uac-policy') continue;
        const want = r.slots[t] ?? this.manifest.defaults[t];
        if (want && this.registry.has(t, want)) active[t] = want;
        else if (!want && (OPTIONAL_TYPES as readonly string[]).includes(t)) active[t] = '';
      }
      for (const t of ASSET_TYPES) {
        if (!hideable(t)) continue;
        const v = r.hidden[t];
        const cur = this.settings.get(HIDE_KEY(t));
        if (v === undefined) { if (cur !== null) this.settings.clear(HIDE_KEY(t)); }
        else if (cur !== v) this.settings.set(HIDE_KEY(t), v);
      }
      const sp = r.spacing ?? SPACING_DEFAULT_VALUE;
      if (this.spacing() !== sp) this.settings.set(SPACING_KEY, sp);
      const changed = ASSET_TYPES.some((t) => active[t] !== this.state.active[t]);
      this.set({ active, swaps: this.state.swaps + (changed ? 1 : 0) }, true);
      if (r.skipped.length) this.terminal.warn('appearance', `not in this app, kept the default: ${r.skipped.join(', ')}`);
      this.terminal.ok('appearance', `applied from the hub${doc?.updatedBy ? ` (saved by ${doc.updatedBy})` : ''}`);
    } finally {
      this.applyingAppearance = false;
    }
  }

  /** Push a local change to the source (no-op without one, or while applying a pushed document). */
  private pushAppearance(change: Parameters<AppearanceSource['save']>[0]): void {
    if (!this.appearanceSource || !this.appearanceRunning || this.applyingAppearance) return;
    this.appearanceSource.save(change);
  }

  /** The palette the hub's own pages use, from this app's active colour theme. */
  private appearancePalette(): AppearanceDocument['palette'] | undefined {
    return paletteFromColorTheme(this.asset('color-theme').data as { scheme?: string; tokens?: Record<string, string> });
  }

  /** The document this app would write for its whole current look (Reset, or a first save). */
  currentAppearance(): AppearanceDocument {
    const slots: Record<string, string> = {};
    for (const t of ASSET_TYPES) if (t !== 'uac-policy' && this.state.active[t]) slots[t] = this.state.active[t];
    const hidden: Record<string, boolean> = {};
    for (const t of ASSET_TYPES) { const v = this.settings.get(HIDE_KEY(t)); if (typeof v === 'boolean') hidden[t] = v; }
    return mergeAppearance({ $axf: APPEARANCE_FRAME }, { slots, spacing: this.spacing(), hidden, palette: this.appearancePalette() }, this.manifest.app.id, new Date().toISOString());
  }

  /* ---------------- store ---------------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  /* ---------------- badges ---------------- */

  /** A named counter's value (0 when unset). */
  badge(name: string): number { return this.badgeCounts.get(name) ?? 0; }

  /** Set a named counter; toolbar items with `badge: name` show it (0 hides it). */
  setBadge(name: string, count: number): void {
    const n = Math.max(0, Math.floor(count) || 0);
    if ((this.badgeCounts.get(name) ?? 0) === n) return;
    this.badgeCounts.set(name, n);
    this.set({});
  }

  /* ---------------- contributed navigation ---------------- */

  /** Nav sections libraries and plugins added, in the order they were added. */
  get navExtras(): NavExtraSection[] {
    return [...this.navSections.values()];
  }

  /** Add or replace a contributed nav section. The nav-menu asset stays untouched, so swapping it keeps plugin entries. */
  setNavSection(section: NavExtraSection): void {
    this.navSections.set(section.id, section);
    this.set({});
  }

  removeNavSection(id: string): void {
    if (this.navSections.delete(id)) this.set({});
  }

  /* ---------------- application menu: contributions + live lists (core/engines/appmenu.ts) ---------------- */

  /** App-menu contributions (`AxfWebLibrary.appMenu`), keyed by id, removable per module. */
  private readonly appMenuContributions = new Map<string, AppMenuContribution>();
  /** Live-list providers by id (open registry; the built-in ones are registered in the constructor). */
  private readonly appMenuProviders = new Map<string, AppMenuProvider>();
  private appMenuCache: { rev: number; active: string; merged: MergedAppMenu; reported: number } | null = null;

  /** Add or replace a contribution (same id replaces). The app-menu asset stays untouched, so swapping it keeps them. */
  addAppMenuItems(c: AppMenuContribution): void {
    this.appMenuContributions.set(c.id, c);
    this.appMenuCache = null;
    this.set({});
  }

  /** Remove every contribution and provider of a module (a plugin was disabled or removed), or one contribution by id. */
  removeAppMenuItems(moduleOrId: string): void {
    let changed = this.appMenuContributions.delete(moduleOrId);
    for (const [id, c] of this.appMenuContributions) if (c.module === moduleOrId) { this.appMenuContributions.delete(id); changed = true; }
    for (const [id, p] of this.appMenuProviders) if (p.module === moduleOrId) { this.appMenuProviders.delete(id); changed = true; }
    if (changed) { this.appMenuCache = null; this.set({}); }
  }

  /** Every contribution, in the order added. */
  appMenuContributed(): AppMenuContribution[] { return [...this.appMenuContributions.values()]; }

  /** Register (or replace) a live list; an item with `provider: id` shows it. Returns a remover. */
  registerAppMenuProvider(id: string, provider: AppMenuProvider | AppMenuProvider['items']): () => void {
    const p: AppMenuProvider = typeof provider === 'function' ? { items: provider } : provider;
    this.appMenuProviders.set(id, p);
    this.appMenuCache = null;
    this.set({});
    return () => { if (this.appMenuProviders.get(id) === p) this.unregisterAppMenuProvider(id); };
  }

  unregisterAppMenuProvider(id: string): void {
    if (this.appMenuProviders.delete(id)) { this.appMenuCache = null; this.set({}); }
  }

  /** Registered live-list ids. */
  appMenuProviderIds(): string[] { return [...this.appMenuProviders.keys()]; }

  /** What compiling the menu needs from this runtime (the fixtures feed the engine the same shape). */
  private appMenuEnv(): AppMenuEnv {
    return {
      gate: (r) => this.gate(r),
      counter: (n) => this.badge(n),
      setting: (k) => this.settings.get(k),
      hidden: (t) => this.slotHidden(t as AssetType),
      providers: this.appMenuProviderIds(),
      taken: (it) => this.takenByHost(it),
      locked: (it) => this.lockedByHost(it) !== null,
    };
  }

  /**
   * The application menu to draw: the active asset's menus merged with every contribution, gated for the current role,
   * badges and check marks resolved, live lists marked (`provider`) and filled on open with `loadAppMenuProvider`.
   * Conflicts (one id from two modules) are reported once through `diagnostics`, like context items.
   */
  appMenu(): CompiledAppMenu {
    const asset = this.asset('app-menu').data;
    const active = this.state.active['app-menu'];
    let cache = this.appMenuCache;
    if (!cache || cache.active !== active) {
      const merged = mergeAppMenu(asset, this.appMenuContributed());
      cache = { rev: this.state.rev, active, merged, reported: 0 };
      this.appMenuCache = cache;
    }
    for (; cache.reported < cache.merged.conflicts.length; cache.reported++) {
      const c = cache.merged.conflicts[cache.reported]!;
      this.diagnostics.report({ kind: 'contribution-conflict', what: c.what, id: c.id, was: c.was, now: c.now });
      this.terminal.warn('menus', `${c.what} "${c.id}": ${c.now} replaced the one from ${c.was}`);
    }
    const out = compileAppMenu(cache.merged, this.appMenuEnv());
    for (const n of out.notes) if (!this.appMenuNoted.has(n)) { this.appMenuNoted.add(n); this.terminal.warn('menus', n); }
    return out;
  }
  private readonly appMenuNoted = new Set<string>();

  /** Ask a live list for its items (compiled, capped with More…). Rejects when the provider throws. */
  async loadAppMenuProvider(id: string, opts: Partial<ProviderOptions> = {}): Promise<CompiledMenuItem[]> {
    const p = this.appMenuProviders.get(id);
    if (!p) return [];
    const items = await p.items();
    return compileProviderItems(items, this.appMenuEnv(), { id, max: p.max, moreAction: p.moreAction, moreLabel: p.moreLabel, ...opts });
  }

  /**
   * A toolbar group's live list (`groups[].provider`): the same providers the application menu uses, compiled the
   * same way (gating, badges, check marks), capped at `max` (1–24, default 8) with the provider's More… entry.
   */
  loadToolbarProvider(id: string, max = 8): Promise<CompiledMenuItem[]> {
    return this.loadAppMenuProvider(id, { max: Math.min(24, Math.max(1, Math.floor(max))) });
  }

  /** A toolbar item's `checked` binding (setting: / counter: / slot: / hidden:), null when it doesn't resolve. */
  toolbarChecked(binding: string | undefined): boolean | null { return resolveChecked(binding, this.appMenuEnv()); }

  /** Contributed menu items with an action, for the search index (kind `menu`). */
  appMenuSearchEntries(): MenuSearchEntry[] {
    const listed = new Set(this.actions.list().filter(({ meta }) => !meta.stub && !meta.params && meta.searchable !== false).map(({ id }) => id));
    return appMenuSearchEntries(this.appMenu(), listed);
  }

  /** Built-in live lists every app gets: views, toolbar, nav, settings, windows, dialogs, chrome (visibility toggles). */
  private registerBuiltinAppMenuProviders() {
    const fromSearch = (kinds: string[], icon: string, action: (f: Record<string, string>) => string | undefined) => (): MenuItem[] =>
      this.search.entries().filter((e) => kinds.includes(e.kind)).map((e) => {
        const f = e.focus as Record<string, string>;
        const spec = action(f);
        return { id: e.id, label: e.label, icon: e.icon ?? icon, ...(spec ? { action: spec } : {}), ...(e.requires ? { requires: e.requires } : {}) };
      }).filter((i) => i.action);
    // Every registered view (so hiding the nav loses nothing); the nav-menu's own tree; the toolbar's items and widget actions.
    this.registerAppMenuProvider('views', { items: fromSearch(['view'], 'layout', (f) => (f.view ? `nav:${f.view}` : undefined)), max: 40, module: 'axf' });
    this.registerAppMenuProvider('nav', {
      module: 'axf', max: 40,
      items: () => {
        const nav = this.asset('nav-menu').data;
        const sections = [...nav.sections.map((s) => ({ label: s.label, items: s.items })), ...this.navExtras.map((s) => ({ label: s.label, items: s.items }))];
        const out: MenuItem[] = [];
        sections.forEach((s, i) => {
          if (!s.items.length) return;
          if (out.length) out.push({ id: `nav-sep-${i}`, separator: true });
          for (const it of s.items) out.push({ id: `nav:${it.view}`, label: it.label, icon: it.icon, action: `nav:${it.view}`, ...(it.requires ? { requires: it.requires } : {}), ...(it.badge ? { badge: it.badge } : {}) });
        });
        return out;
      },
    });
    this.registerAppMenuProvider('toolbar', {
      module: 'axf', max: 40,
      items: () => {
        const tb = this.asset('toolbar').data;
        const out: MenuItem[] = [];
        tb.groups.forEach((g, i) => {
          if (!g.items.length) return;
          if (out.length) out.push({ id: `toolbar-sep-${i}`, separator: true });
          for (const it of g.items) out.push({ id: `toolbar:${it.id}`, label: it.label, icon: it.icon, action: it.action, ...(it.requires ? { requires: it.requires } : {}), ...(it.badge ? { badge: it.badge } : {}) });
        });
        // Widget actions (action-button widgets on the toolbar, its own or attached at run time).
        const widgets = [...(tb.widgets ?? []), ...this.hostAttachments('toolbar')];
        for (const w of widgets) {
          const a = this.registry.get(w.type as AssetType, w.id) as { data?: { action?: string; label?: string; icon?: string } } | undefined;
          if (a?.data?.action) out.push({ id: `toolbar-widget:${w.type}:${w.id}`, label: a.data.label ?? (a as { name?: string }).name ?? w.id, icon: a.data.icon ?? 'zap', action: a.data.action });
        }
        return out;
      },
    });
    this.registerAppMenuProvider('settings', { items: fromSearch(['settings-tab'], 'settings', (f) => (f.tab ? `settings.open:${f.tab}` : undefined)), max: 30, module: 'axf' });
    this.registerAppMenuProvider('windows', { items: fromSearch(['window'], 'monitor', (f) => (f.id ? `windows.restore:${f.id}` : undefined)), max: 20, module: 'axf' });
    this.registerAppMenuProvider('dialogs', { items: fromSearch(['dialog'], 'box', (f) => (f.id ? `dialog:${f.id}` : undefined)), max: 30, module: 'axf' });
    this.registerAppMenuProvider('chrome', { items: () => chromeToggleItems(), module: 'axf' });
  }

  /* ---------------- contributed context-menu items ---------------- */

  /** Add or replace a contribution (same id replaces). The context-menu asset stays untouched, so swapping it keeps them. */
  addContextItems(c: ContextContribution): void {
    this.contextContributions.set(c.id, c);
  }

  /** Remove every contribution of a module (a plugin was disabled or removed). */
  removeContextItems(module: string): void {
    for (const [id, c] of this.contextContributions) if (c.module === module) this.contextContributions.delete(id);
  }

  /** Every target libraries and plugins add context-menu items to (designers list them next to the asset's own). */
  contextTargets(): string[] {
    return [...new Set([...this.contextContributions.values()].map((c) => c.target ?? 'default'))];
  }

  /** Contributed items for a target (`default` = the menu shown where no element names a target), by order. */
  contributedContext(target: string): import('./engines/windows').MenuEntry[] {
    return [...this.contextContributions.values()]
      .filter((c) => (c.target ?? 'default') === target)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .flatMap((c) => c.items);
  }

  /**
   * Load the saved hot-swap choices and settings values again (another tab or editor may have saved since; last
   * save wins). UI-editing plugins (theme, style, layout, manager, builder) call this whenever they open, load or
   * come back into focus, so they read current token values, never a stale copy. Returns what changed.
   */
  refreshFromSaved(): { slots: AssetType[]; settings: string[]; role: boolean } {
    this.appearanceSource?.refresh(); // developer apps: the saved values live on the hub
    return this.reloadSaved();
  }

  /** refreshFromSaved without asking the appearance source (another frame of this app saved in this browser). */
  private reloadSaved(): { slots: AssetType[]; settings: string[]; role: boolean } {
    const settings = this.settings.reload();
    const saved = safeStorage.get(this.storageKey);
    const slots: AssetType[] = [];
    const active = { ...this.state.active };
    for (const t of ASSET_TYPES) {
      const id = saved?.active?.[t];
      if (t === 'uac-policy' || !id || id === active[t] || !this.registry.has(t, id)) continue;
      active[t] = id;
      slots.push(t);
    }
    const policy = this.registry.get('uac-policy', active['uac-policy'])!.data;
    const role = !this.principal && Boolean(saved?.role && saved.role !== this.state.role && policy.roles.some((r) => r.id === saved.role));
    if (slots.length || role) this.set({ active, ...(role ? { role: saved!.role } : {}), swaps: this.state.swaps + (slots.length ? 1 : 0) });
    return { slots, settings, role };
  }

  private set(patch: Partial<AxfState>, persist = false) {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    if (persist) safeStorage.set(this.storageKey, { active: this.state.active, role: this.state.role, defaults: this.manifest.defaults });
    for (const l of this.listeners) l();
  }

  /* ---------------- assets ---------------- */

  asset<K extends AssetType>(type: K): Asset<K> {
    return this.registry.get(type, this.state.active[type] ?? '')!;
  }

  /** The active asset of an optional type (banner, clock, badge), or null when the app has none. */
  assetOrNull<K extends AssetType>(type: K): Asset<K> | null {
    const id = this.state.active[type];
    return id ? this.registry.get(type, id) ?? null : null;
  }

  /* ---------------- widget hosts (core/engines/widgets.ts): banner + toolbar ---------------- */

  /** Run-time attachments per host (`banner`, `toolbar`, any host a library registers). */
  private readonly hostExtra = new Map<string, HostAttachment[]>();
  private bannerPopupTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Attach an asset to a widget host at run time. The entry is checked against the host's spec (type, side, asset
   * exists) so a bad call is reported in the terminal instead of silently vanishing; same type + id replaces the earlier
   * one. Returns a detach function.
   */
  attachToHost(host: string, a: HostAttachment & { origin: string }): () => void {
    const key = attachmentKey(a.type, a.id);
    const spec = hostSpec(host);
    if (!spec) this.terminal.warn('widgets', `"${host}" is not a widget host (${hostSpecs().map((h) => h.host).join(', ') || 'none registered'}); ${key} from ${a.origin} will not show`);
    else if (!spec.types.includes(a.type)) this.terminal.warn('widgets', `${host} doesn't take ${a.type} assets (${spec.types.join(', ')}); ${key} from ${a.origin} will not show`);
    else if (!spec.sides.includes(a.at)) this.terminal.warn('widgets', `${host} has no "${a.at}" side (${spec.sides.join(', ')}); ${key} from ${a.origin} will not show`);
    else if (!this.registry.has(a.type as AssetType, a.id)) this.terminal.warn('widgets', `${key} (attached to ${host} by ${a.origin}) is not registered; it shows once it is`);
    const list = this.hostExtra.get(host) ?? [];
    this.hostExtra.set(host, [...list.filter((x) => attachmentKey(x.type, x.id) !== key), { ...a }]);
    this.set({});
    return () => this.detachFromHost(host, key);
  }

  /** Remove run-time attachments from one host by key (`type:id`) or by origin (a module / plugin id). */
  detachFromHost(host: string, keyOrOrigin: string): void {
    const list = this.hostExtra.get(host);
    if (!list) return;
    const next = list.filter((x) => attachmentKey(x.type, x.id) !== keyOrOrigin && x.origin !== keyOrOrigin);
    if (next.length !== list.length) { this.hostExtra.set(host, next); this.set({}); }
  }

  /** Remove everything a module / plugin attached to any host (the console calls it when a plugin is disabled). */
  detachAll(origin: string): void {
    let changed = false;
    for (const [host, list] of this.hostExtra) {
      const next = list.filter((x) => x.origin !== origin);
      if (next.length !== list.length) { this.hostExtra.set(host, next); changed = true; }
    }
    if (changed) this.set({});
  }

  /** Run-time attachments of a host (copies). */
  hostAttachments(host: string): HostAttachment[] { return [...(this.hostExtra.get(host) ?? [])]; }

  /** Attach an asset (badge, clock, search bar) to the banner at run time. Same type + id replaces the earlier one. Returns detach. */
  attachToBanner(a: BannerAttachment & { origin: string }): () => void { return this.attachToHost('banner', a); }

  /** Remove run-time banner attachments by key (`type:id`) or by origin (a module / plugin id). */
  detachFromBanner(keyOrOrigin: string): void { this.detachFromHost('banner', keyOrOrigin); }

  /** The banner to draw: its data (null = no banner or hidden) and where every attachment goes. */
  banner(): { data: Asset<'banner'>['data'] | null; placed: PlacedBanner } {
    const b = this.slotHidden('banner') ? null : this.assetOrNull('banner')?.data ?? null;
    const placed = placeAttachments(b, b ? (this.hostExtra.get('banner') as BannerAttachment[] | undefined) ?? [] : [], (t, id) => this.registry.has(t as AssetType, id), this.hostArrangement('banner'));
    return { data: b, placed };
  }

  /** Attach a widget (clock, search bar) to the toolbar at run time (at: start | end). Same type + id replaces. Returns detach. */
  attachToToolbar(a: HostAttachment & { at: 'start' | 'end'; origin: string }): () => void { return this.attachToHost('toolbar', a); }

  /** Remove run-time toolbar widgets by key (`type:id`) or by origin (a module / plugin id). */
  detachFromToolbar(keyOrOrigin: string): void { this.detachFromHost('toolbar', keyOrOrigin); }

  /** Widgets on the active toolbar (its own `widgets` plus run-time ones), start and end. */
  toolbarWidgets(): Record<'start' | 'end', PlacedAttachment[]> {
    const tb = this.slotHidden('toolbar') ? null : (this.asset('toolbar')?.data as { widgets?: HostAttachment[] } | undefined) ?? null;
    return placeToolbarWidgets(tb, this.hostExtra.get('toolbar') ?? [], (t, id) => this.registry.has(t as AssetType, id), this.hostArrangement('toolbar'));
  }

  /* ---------------- arranging widgets on hosts (drag + snap; core/engines/widgets.ts) ---------------- */

  /** The host being arranged right now (its widgets can be dragged), or null. Not saved: arranging ends on reload. */
  private arrangingHost: string | null = null;

  /** A person's saved arrangement of a host (setting `axf.widgets.arrange.<host>`); {} when none or damaged. */
  hostArrangement(host: string): HostArrangement {
    const h = hostSpec(host);
    const raw = this.settings.get(ARRANGE_KEY(host));
    if (!h || typeof raw !== 'string' || !raw) return {};
    try { return normalizeArrangement(JSON.parse(raw), h.sides); } catch { return {}; }
  }

  /** Every attachment of a host where it is drawn now (banner and toolbar use their own rules; other hosts the generic one). */
  hostPlaced(host: string): Record<string, PlacedAttachment[]> {
    if (host === 'banner') return this.banner().placed;
    if (host === 'toolbar') return this.toolbarWidgets();
    const data = (this.registry.has(host as AssetType, this.state.active[host as AssetType] ?? '') ? this.assetOrNull(host as AssetType)?.data : null) as Record<string, unknown> | null;
    return placeHost(host, data ?? null, this.hostExtra.get(host) ?? [], (t, id) => this.registry.has(t as AssetType, id), true, this.hostArrangement(host));
  }

  /** May this person rearrange widgets? Same grant as any other change to the look. */
  canArrange(): boolean { return this.can('assets.swap'); }

  /**
   * Move one attachment (`type:id`) to a side of a host at a position (0 = first). Saved at once and drawn at once
   * (hot render); the whole host's order is written so every device shows the same. False when it can't move.
   */
  moveHostItem(host: string, key: string, side: string, index: number): boolean {
    const h = hostSpec(host);
    if (!h || !h.sides.includes(side)) return false;
    if (!this.canArrange()) { this.toast('Your account can\'t change the look.', 'warning', 'Arrange'); return false; }
    const placed = this.hostPlaced(host);
    if (!h.sides.some((s) => (placed[s] ?? []).some((p) => p.key === key))) return false;
    const next = moveOnHost(placed, this.hostArrangement(host), key, side, index, h.sides);
    this.settings.set(ARRANGE_KEY(host), JSON.stringify(next));
    this.terminal.ok('widgets', `${host}: ${key} → ${side} #${index + 1}`);
    this.set({});
    return true;
  }

  /** Back to where the host and its modules put everything. */
  resetHostArrangement(host: string): void {
    if (!this.canArrange()) return;
    this.settings.clear(ARRANGE_KEY(host));
    this.terminal.ok('widgets', `${host}: arrangement reset`);
    this.set({});
  }

  /** Is a host in arrange mode? With no host: is any? */
  arranging(host?: string): boolean { return host ? this.arrangingHost === host : this.arrangingHost !== null; }

  /** Start (host) or stop (null) arrange mode. Only one host at a time. */
  setArranging(host: string | null): void {
    if (host && (!hostSpec(host) || !this.canArrange())) return;
    if (this.arrangingHost === host) return;
    this.arrangingHost = host;
    this.set({});
  }

  /** Pop a short message out of a banner attachment for `ms` (default 5 s), e.g. a status badge on load. */
  showBannerPopup(key: string, text: string, ms = 5000): void {
    if (this.bannerPopupTimer) clearTimeout(this.bannerPopupTimer);
    this.set({ bannerPopup: { key, text, until: Date.now() + ms } });
    this.bannerPopupTimer = setTimeout(() => { this.bannerPopupTimer = null; this.set({ bannerPopup: null }); }, ms);
  }

  /** Close the banner popup early (the UI's dismiss, or a module replacing its badge). */
  dismissBannerPopup(): void {
    if (this.bannerPopupTimer) { clearTimeout(this.bannerPopupTimer); this.bannerPopupTimer = null; }
    if (this.state.bannerPopup) this.set({ bannerPopup: null });
  }

  /** Hot-swap the active asset of a slot. `target` = asset id | "next" | "prev" | "random". */
  /* ---------------- signed-in account (principal) ---------------- */

  private principal: BoundPrincipal | null = null;

  /**
   * The app signed someone in: their account decides the access policy and role, not the role switcher.
   * While bound, `setRole` and swapping the uac-policy are refused (the account wall owns them); `unbindPrincipal`
   * on sign-out. Same contract as Kotlin `AxfRuntime.bindPrincipal`.
   */
  bindPrincipal(p: BoundPrincipal): boolean {
    const policy = this.registry.get('uac-policy', p.policy);
    if (!policy || !policy.data.roles.some((r) => r.id === p.role)) {
      this.terminal.error('uac', `bindPrincipal: no role "${p.role}" in policy "${p.policy}"`);
      return false;
    }
    this.principal = { ...p };
    this.set({ active: { ...this.state.active, 'uac-policy': p.policy }, role: p.role });
    this.terminal.ok('uac', `signed in as ${p.label} (${p.role})`);
    return true;
  }

  unbindPrincipal(): void {
    if (!this.principal) return;
    this.principal = null;
    this.set({});
  }

  /** The signed-in account, or null when the app has no account wall (or nobody is signed in). */
  boundPrincipal(): BoundPrincipal | null {
    return this.principal ? { ...this.principal } : null;
  }

  swap(type: AssetType, target: string): boolean {
    if (type === 'uac-policy' && this.principal) {
      this.toast('Your access comes from your account. An admin changes it in Account management.', 'info', 'Access');
      return false;
    }
    const need = type === 'uac-policy' ? 'uac.manage' : 'assets.swap';
    if (this.lockedByAppearance(need)) { this.lockedToast(); return false; }
    if (!this.can(need)) {
      this.toast(`Your role needs "${need}" to change the ${assetTypeSpecs[type].label.toLowerCase()}.`, 'danger', 'Permission denied');
      return false;
    }
    const list = this.registry.list(type);
    const idx = list.findIndex((a) => a.id === this.state.active[type]);
    let next: string | undefined;
    if (target === 'next') next = list[(idx + 1) % list.length]?.id;
    else if (target === 'prev') next = list[(idx - 1 + list.length) % list.length]?.id;
    else if (target === 'random') {
      const others = list.filter((a) => a.id !== this.state.active[type]);
      next = others[Math.floor(Math.random() * others.length)]?.id ?? list[0]?.id;
    } else if (target === 'default') next = (this.manifest.defaults as Record<string, string | undefined>)[type] ?? list[0]?.id;
    else next = target;
    if (!next || !this.registry.has(type, next)) {
      this.terminal.error('hot-swap', `${type} → "${target}": no such asset`);
      this.toast(`No ${type} asset with id "${target}".`, 'warning', 'Swap failed');
      return false;
    }
    if (next === this.state.active[type] && type !== STYLE_PACKAGE_TYPE) return true;
    this.terminal.ok('hot-swap', `${type}: ${this.state.active[type]} → ${next}`);
    // a style package is a set of controls: picking one swaps every member it names (engines/stylepackage.ts)
    if (type === STYLE_PACKAGE_TYPE) { this.swapAll({ [type]: next } as Partial<ActiveAssets>); return true; }

    const active = { ...this.state.active, [type]: next };
    const patch: Partial<AxfState> = { active, swaps: this.state.swaps + 1 };
    if (type === 'uac-policy') {
      const policy = this.registry.get('uac-policy', next)!.data;
      if (!policy.roles.some((r) => r.id === this.state.role)) {
        patch.role = policy.defaultRole;
        const label = policy.roles.find((r) => r.id === policy.defaultRole)?.label;
        queueMicrotask(() => this.toast(`This policy has no "${this.state.role}" role, so you're now ${label}.`, 'info', 'Role changed'));
      }
    }
    this.set(patch, true);
    if (type !== 'uac-policy') this.pushAppearance({ slots: { [type]: next }, ...(type === 'color-theme' ? { palette: this.appearancePalette() } : {}) });
    return true;
  }

  swapAll(targets: Partial<ActiveAssets>) {
    // a style package among the targets brings its member controls; slots named explicitly win over them
    const sp = (targets as Record<string, string | undefined>)[STYLE_PACKAGE_TYPE];
    if (sp) {
      const pkg = this.registry.get(STYLE_PACKAGE_TYPE as AssetType, sp);
      if (pkg) {
        const members = stylePackageSlots(pkg.data as StylePackageData);
        for (const [t, id] of Object.entries(members)) if (!this.registry.has(t as AssetType, id)) { this.terminal.warn('hot-swap', `style package ${sp}: no ${t} "${id}" in this app, kept the current one`); delete members[t]; }
        targets = { ...members, ...targets } as Partial<ActiveAssets>;
      }
    }
    const active = { ...this.state.active };
    const pushed: Record<string, string> = {};
    for (const [t, id] of Object.entries(targets) as [AssetType, string][]) {
      if (t !== 'uac-policy' && this.registry.has(t, id)) { active[t] = id; pushed[t] = id; }
    }
    this.set({ active, swaps: this.state.swaps + 1 }, true);
    if (Object.keys(pushed).length) this.pushAppearance({ slots: pushed, ...(pushed['color-theme'] ? { palette: this.appearancePalette() } : {}) });
  }

  /* ---------------- randomize rolls (engines/roll.ts) ---------------- */

  /** Runtime overrides for rolls, kept as settings (`axf.roll.slot.<type>`, `axf.roll.asset.<type>.<id>`). */
  rollRules(): RollRules {
    const slots: Record<string, boolean> = {};
    const assets: Record<string, boolean> = {};
    for (const t of ASSET_TYPES) {
      const v = this.settings.get(ROLL_SLOT_KEY(t));
      if (typeof v === 'boolean') slots[t] = v;
      for (const a of this.registry.list(t)) {
        const av = this.settings.get(ROLL_ASSET_KEY(t, a.id));
        if (typeof av === 'boolean') assets[rollAssetKey(t, a.id)] = av;
      }
    }
    return { slots, assets };
  }

  /** Does a roll change this slot? Context menus: no, unless switched on. */
  rollSlotIncluded(type: AssetType): boolean {
    return rollSlotIncluded(type, this.rollRules());
  }

  /** Include or exclude a slot from rolls; `null` goes back to the built-in default. */
  setRollSlot(type: AssetType, on: boolean | null): void {
    if (rollNever(type)) return;
    if (on === null) this.settings.clear(ROLL_SLOT_KEY(type));
    else this.settings.set(ROLL_SLOT_KEY(type), on);
  }

  /** May a roll pick this asset? (the asset's own `roll` flag, else its type's default, else a runtime override) */
  rollAssetIncluded(type: AssetType, id: string): boolean {
    const a = this.registry.get(type, id);
    return a ? rollAssetIncluded(a, this.rollRules()) : false;
  }

  /** Include or exclude one asset from rolls; `null` goes back to the asset's own flag. */
  setRollAsset(type: AssetType, id: string, on: boolean | null): void {
    if (on === null) this.settings.clear(ROLL_ASSET_KEY(type, id));
    else this.settings.set(ROLL_ASSET_KEY(type, id), on);
  }

  /* ---------------- collapsible toolbar (asset `collapsible: true`) ---------------- */

  /** Is a collapsible toolbar folded to its handle on this device? (setting `axf.toolbar.collapsed`, same key on Android) */
  toolbarCollapsed(): boolean {
    return this.asset('toolbar').data.collapsible === true && this.settings.get(TOOLBAR_COLLAPSED_KEY) === true;
  }

  setToolbarCollapsed(on: boolean): void {
    if (on) this.settings.set(TOOLBAR_COLLAPSED_KEY, true);
    else this.settings.clear(TOOLBAR_COLLAPSED_KEY);
    this.set({});
  }

  /* ---------------- hidden slots (core/engines/hide.ts) ---------------- */

  /** Slots the app hides by default (`manifest.hidden`); the user's choice in Settings → Appearance wins over it. */
  defaultHiddenSlots(): AssetType[] {
    return defaultHidden(this.manifest.hidden) as AssetType[];
  }

  /** Is this slot hidden? Only hideable types (the chrome) can be. */
  slotHidden(type: AssetType): boolean {
    return hideable(type) && this.hiddenSlots().includes(type);
  }

  /** Chrome the host app shows while this one is embedded (embed@1): hidden here whatever the user chose. */
  embedHiddenSlots(): AssetType[] {
    return (this.embedded?.hidden ?? []) as AssetType[];
  }

  /** Is this slot hidden because a host app shows it (embed@1)? Settings grey such a row out instead of offering a choice. */
  slotHiddenByHost(type: AssetType): boolean {
    return this.embedHiddenSlots().includes(type);
  }

  /**
   * Chrome that belongs to the host while this app runs inside it (embed@1): what it hides for the whole app (its banner
   * by default, plus what a taken function hides, e.g. the app menu). On a page the host shows alone (settings page
   * mode) every bit of chrome is hidden for that page only, so only the whole-app part counts. Settings leave rows about
   * this chrome out instead of greying them (Brett, Oct 23 2026: "if a program runs inside Patches don't grey out its
   * settings").
   */
  slotOwnedByHost(type: AssetType): boolean {
    const e = this.embedded;
    if (!e) return false;
    if (!e.page) return this.slotHiddenByHost(type);
    return type === 'banner' || (e.takes ?? []).some((fn) => embedTakeSpec(fn)?.hides.includes(type));
  }

  /** Hidden by the user's own choice (or the app's default), leaving out the chrome a host forces off. Settings show this. */
  slotHiddenOwn(type: AssetType): boolean {
    if (!hideable(type)) return false;
    const o: Record<string, boolean | undefined> = {};
    for (const t of ASSET_TYPES) { const v = this.settings.get(HIDE_KEY(t)); if (typeof v === 'boolean') o[t] = v; }
    return (hiddenSlots(o, this.defaultHiddenSlots(), []) as AssetType[]).includes(type);
  }

  /** Every hidden slot: the host's chrome (while embedded) over the user's overrides (`axf.hide.<type>` true/false) over the app's defaults. */
  hiddenSlots(): AssetType[] {
    const o: Record<string, boolean | undefined> = {};
    for (const t of ASSET_TYPES) { const v = this.settings.get(HIDE_KEY(t)); if (typeof v === 'boolean') o[t] = v; }
    return hiddenSlots(o, this.defaultHiddenSlots(), this.embedHiddenSlots()) as AssetType[];
  }

  /** Hide or show a slot's chrome. Ignored for types that aren't hideable. Back at the app's default, the override is dropped. */
  setSlotHidden(type: AssetType, hidden: boolean): void {
    if (!hideable(type) || this.slotHiddenOwn(type) === hidden) return;
    if (this.slotOwnedByHost(type)) return this.toast(`${this.embedded!.host} shows the ${type} for this app while it runs inside it.`, 'info', 'Shown by the host app');
    if (!this.can('assets.swap')) return this.toast('Your role cannot change the layout.', 'danger', 'Permission denied');
    if (hidden === this.defaultHiddenSlots().includes(type)) this.settings.clear(HIDE_KEY(type));
    else this.settings.set(HIDE_KEY(type), hidden);
    if (hidden && type === 'context-menu') this.closeContext();
    this.terminal.ok('hot-swap', `${type} ${hidden ? 'hidden' : 'shown'}`);
    this.set({});
    this.pushAppearance({ hidden: { [type]: hidden === this.defaultHiddenSlots().includes(type) ? null : hidden } });
  }

  /* ---------------- spacing (core/engines/spacing.ts) ---------------- */

  /** The user's Spacing choice: tight (default) | compact | regular. */
  spacing(): Spacing {
    return spacingOf(this.settings.get(SPACING_KEY));
  }

  /** Change the Spacing choice; it applies at once to every theme. */
  setSpacing(s: Spacing): void {
    if (spacingOf(s) !== s || this.spacing() === s) return;
    this.settings.set(SPACING_KEY, s);
    this.pushAppearance({ spacing: s });
  }

  /** "Randomize all": rolls every included slot over its included assets. Excluded and hidden slots keep their asset. */
  randomize() {
    if (!this.can('assets.swap')) return this.toast('Your role cannot swap assets.', 'danger', 'Permission denied');
    const plan = rollPlan(ASSET_TYPES.filter((t) => !this.slotHidden(t) && !attachable(t)), (t) => this.registry.list(t as AssetType), this.rollRules());
    const targets: Partial<ActiveAssets> = {};
    for (const [t, ids] of Object.entries(plan) as [AssetType, string[]][]) {
      targets[t] = ids[Math.floor(Math.random() * ids.length)];
    }
    if (!Object.keys(targets).length) return this.toast('No slot is included in rolls. Turn some on in Settings → Appearance → Randomize.', 'info', 'Nothing to roll');
    this.terminal.ok('hot-swap', `roll: ${Object.keys(targets).join(', ')}`);
    this.swapAll(targets);
  }

  reset() {
    for (const t of ASSET_TYPES) if (this.settings.get(HIDE_KEY(t)) !== undefined) this.settings.clear(HIDE_KEY(t));
    for (const h of hostSpecs()) if (this.settings.get(ARRANGE_KEY(h.host)) !== null) this.settings.clear(ARRANGE_KEY(h.host));
    const active = { ...this.manifest.defaults };
    for (const t of ASSET_TYPES) if (!this.registry.has(t, active[t] ?? '')) active[t] = this.registry.list(t)[0]?.id ?? '';
    if (this.principal) {
      // signed in: the account keeps deciding the policy and role
      active['uac-policy'] = this.principal.policy;
      this.set({ active, role: this.principal.role, swaps: this.state.swaps + 1 }, true);
    } else {
      const policy = this.registry.get('uac-policy', active['uac-policy'])!.data;
      this.set({ active, role: policy.defaultRole, swaps: this.state.swaps + 1 }, true);
    }
    const hidden: Record<string, null> = {};
    for (const t of ASSET_TYPES) if (hideable(t)) hidden[t] = null;
    const slots: Record<string, string> = {};
    for (const t of ASSET_TYPES) if (t !== 'uac-policy' && active[t]) slots[t] = active[t];
    this.pushAppearance({ slots, hidden, palette: this.appearancePalette() });
  }

  /* ---------------- design packages (engines/designpackage.ts) ---------------- */

  /** The current look as a design package: the four themes, plus every other appearance slot and setting as extras. */
  captureDesignPackage(withExtras = true): DesignPackageData {
    const hidden: Record<string, boolean> = {};
    for (const t of ASSET_TYPES) { const v = this.settings.get(HIDE_KEY(t)); if (typeof v === 'boolean') hidden[t] = v; }
    return captureDesignPackage({ active: this.state.active as Record<string, string>, types: ASSET_TYPES, spacing: this.spacing(), hidden, values: this.settings.savedValues() }, withExtras);
  }

  /** The design package last applied in this app, if any (Restore default appearance forgets it). */
  appliedDesignPackage(): string | undefined {
    let v = this.settings.get(DESIGN_APPLIED_KEY);
    if (typeof v !== 'string') {
      // the retired appearance package's pick: the shipped packages kept their ids, so move it over once
      const old = this.settings.get(PACKAGE_APPLIED_KEY);
      if (typeof old === 'string' && this.registry.has(DESIGN_PACKAGE_TYPE as AssetType, old)) { this.settings.set(DESIGN_APPLIED_KEY, old); this.settings.clear(PACKAGE_APPLIED_KEY); v = old; }
    }
    return typeof v === 'string' && this.registry.has(DESIGN_PACKAGE_TYPE as AssetType, v) ? v : undefined;
  }

  /**
   * Apply design package `id`: its style, colour, layout and behaviour themes; and when it carries extras, the other
   * slots, spacing, shown / hidden chrome and the other appearance settings too (the whole look).
   */
  applyDesignPackage(id: string): boolean {
    if (!this.can('assets.swap')) { this.toast('Your role cannot change the look.', 'danger', 'Permission denied'); return false; }
    const a = this.registry.get(DESIGN_PACKAGE_TYPE as AssetType, id);
    if (!a) { this.toast(`No design package "${id}".`, 'warning', 'Design package'); return false; }
    const pkg = normalizeDesignPackage(a.data);
    const plan = packageSettingsPlan(pkg, Object.keys(this.settings.savedValues()));
    for (const k of plan.clear) this.settings.clear(k);
    for (const [k, v] of Object.entries(plan.set)) this.settings.set(k, v as SettingValue);
    const hidden: Record<string, boolean | null> = {};
    if (pkg.extras) for (const t of ASSET_TYPES) {
      if (!hideable(t) || this.slotOwnedByHost(t)) continue;
      const want = pkg.extras.hidden?.[t];
      if (typeof want !== 'boolean' || want === this.defaultHiddenSlots().includes(t)) { if (this.settings.get(HIDE_KEY(t)) !== null) this.settings.clear(HIDE_KEY(t)); hidden[t] = null; }
      else { this.settings.set(HIDE_KEY(t), want); hidden[t] = want; }
    }
    if (pkg.extras?.spacing) this.setSpacing(pkg.extras.spacing as Spacing);
    const slots = designPackageSlots(pkg);
    // a theme the package names but this app doesn't ship is skipped (warned), never a broken look
    for (const [t, sid] of Object.entries(slots)) if (!this.registry.has(t as AssetType, sid)) { this.terminal.warn('hot-swap', `design package ${id}: no ${t} "${sid}" in this app, kept the current one`); delete slots[t]; }
    this.swapAll({ ...(slots as Partial<ActiveAssets>), [DESIGN_PACKAGE_TYPE]: id } as Partial<ActiveAssets>);
    if (pkg.extras) this.pushAppearance({ hidden });
    this.settings.set(DESIGN_APPLIED_KEY, id);
    if (this.settings.get(PACKAGE_APPLIED_KEY) !== null) this.settings.clear(PACKAGE_APPLIED_KEY);
    this.terminal.ok('hot-swap', `design package ${id} applied (${Object.keys(slots).length} slots, ${Object.keys(plan.set).length} settings)`);
    this.toast(`${a.name} applied.`, 'success', 'Design package');
    return true;
  }

  /** @deprecated the appearance package became the design package (Oct 27 2026). */
  captureAppearancePackage(): AppearancePackageData { const p = this.captureDesignPackage(); return { ...(p.extras ?? {}), slots: designPackageSlots(p) }; }
  /** @deprecated use appliedDesignPackage */
  appliedAppearancePackage(): string | undefined { return this.appliedDesignPackage(); }
  /** @deprecated use applyDesignPackage */
  applyAppearancePackage(id: string): boolean { return this.applyDesignPackage(id); }

  /** Back to the app's default look: default assets, spacing, chrome and every other appearance setting cleared. */
  restoreDefaultAppearance(): void {
    if (this.lockedByAppearance('assets.swap')) return this.lockedToast();
    if (!this.can('assets.swap')) return this.toast('Your role cannot change the look.', 'danger', 'Permission denied');
    for (const k of Object.keys(this.settings.savedValues())) if (isAppearanceSetting(k) || k === SPACING_KEY || k === PACKAGE_APPLIED_KEY || k === DESIGN_APPLIED_KEY) this.settings.clear(k);
    this.reset();
    this.pushAppearance({ spacing: this.spacing() });
    this.terminal.ok('hot-swap', 'default appearance restored');
    this.toast('Default appearance restored.', 'success', 'Appearance');
  }

  /* ---------------- behaviour (engines/behavior.ts) ---------------- */

  /** The active behaviour theme, every field filled (the framework default when the app ships none). */
  behavior(): BehaviorThemeData {
    return normalizeBehavior(this.assetOrNull('behavior-theme' as AssetType)?.data);
  }

  /** Should deleting something ask first? (`undoable` = it can be brought back.) */
  confirmDelete(undoable = false): boolean {
    return confirmBeforeDelete(this.behavior(), undoable);
  }

  /** How many pieces of work hold the app busy right now (`busy()` / `withBusy()`). */
  private busyCount = 0;
  /** While anything is busy and the behaviour theme says `feedback.busyCursor`, the root carries `data-fx-busy` (the stylesheet shows a progress cursor). */
  busy(): boolean { return this.busyCount > 0; }
  /** Mark work started (`true`) or finished (`false`); balanced calls, never below zero. */
  setBusy(on: boolean): void {
    const n = Math.max(0, this.busyCount + (on ? 1 : -1));
    if (n === this.busyCount) return;
    this.busyCount = n;
    this.set({});
  }
  /** Run a promise with the busy cursor on until it settles. */
  async withBusy<T>(work: Promise<T> | (() => Promise<T>)): Promise<T> {
    this.setBusy(true);
    try { return await (typeof work === 'function' ? work() : work); } finally { this.setBusy(false); }
  }

  /** Haptic + sound feedback for an event, as the behaviour theme says (no-op where the browser can't). */
  feedback(kind: 'tap' | 'success' | 'warning' | 'error' = 'tap'): void {
    const b = this.behavior();
    const pattern = vibrationPattern(b, kind);
    const nav = (globalThis as { navigator?: { vibrate?: (p: number[]) => boolean } }).navigator;
    try { if (pattern.length && nav?.vibrate) nav.vibrate(pattern); } catch { /* not allowed here */ }
    if (b.feedback.sound === 'off') return;
    try {
      const Ctx = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = kind === 'error' ? 220 : kind === 'warning' ? 330 : kind === 'success' ? 660 : 520;
      gain.gain.value = b.feedback.sound === 'full' ? 0.12 : 0.04;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (kind === 'tap' ? 0.03 : 0.09));
      osc.onended = () => { void ctx.close(); };
    } catch { /* no audio here */ }
  }

  importAsset(raw: unknown, activate = true, origin?: string): ValidationResult {
    if (!this.can('assets.import')) {
      return { ok: false, errors: ['Your role needs "assets.import" to import assets.'] };
    }
    if (this.principal && (raw as { type?: unknown } | null)?.type === 'uac-policy') {
      return { ok: false, errors: ['Access policies come from your account while you are signed in.'] };
    }
    const r = this.registry.register(raw, 'imported', origin);
    if (r.ok && r.asset) {
      if (activate && this.can('assets.swap')) this.swap(r.asset.type, r.asset.id);
      else this.set({});
    }
    return r;
  }

  exportAsset(type: AssetType, id: string): string {
    const a = this.registry.get(type, id);
    return a ? serializeAsset(a) : '';
  }

  /* ---------------- UAC ---------------- */

  permissions(): Set<string> {
    return resolvePermissions(this.asset('uac-policy').data, this.state.role);
  }

  can(perm?: string): boolean {
    if (this.lockedByAppearance(perm)) return false;
    return hasPermission(this.permissions(), perm);
  }

  gate(requires?: string): Gate {
    if (this.lockedByAppearance(requires)) return 'disable';
    return gateFor(this.asset('uac-policy').data, this.permissions(), requires);
  }

  /* ---------------- appearance lock ---------------- */

  /** Is the look locked (every look control greyed, this device's own tweaks set aside)? */
  appearanceLocked(): boolean { return this.settings.get(APPEARANCE_LOCK_KEY) === true; }

  /** Does the lock (not the role) stop this permission right now? */
  lockedByAppearance(perm?: string): boolean {
    return !!perm && LOCKED_APPEARANCE_PERMS.includes(perm) && this.appearanceLocked();
  }

  /** May this role change the look at all (the lock aside)? */
  mayChangeLook(): boolean { return hasPermission(this.permissions(), 'assets.swap'); }

  /** Lock or unlock the look. Only a role that may change the look may lock or unlock it. */
  setAppearanceLocked(on: boolean): boolean {
    if (!this.mayChangeLook()) {
      this.toast('Your role cannot change the look, so it cannot lock or unlock it either.', 'danger', 'Permission denied');
      return false;
    }
    if (on === this.appearanceLocked()) return true;
    if (on) this.settings.set(APPEARANCE_LOCK_KEY, true); else this.settings.clear(APPEARANCE_LOCK_KEY);
    this.terminal.ok('appearance', on ? 'look locked' : 'look unlocked');
    this.toast(on ? 'Look locked: nothing can change it here until you unlock it.' : 'Look unlocked.', 'info', 'Appearance');
    return true;
  }

  private lockedToast(): void {
    this.toast('The look is locked. Unlock it in Settings → Appearance to change it.', 'info', 'Appearance locked');
  }

  setRole(id: string) {
    if (this.principal) {
      if (id !== this.principal.role) this.toast('Your role comes from your account. An admin changes it in Account management.', 'info', 'Access');
      return;
    }
    const policy = this.asset('uac-policy').data;
    if (!policy.roles.some((r) => r.id === id)) return;
    this.set({ role: id }, true);
    this.toast(`Now acting as ${policy.roles.find((r) => r.id === id)!.label}.`, 'info', 'Role switched');
  }

  /* ---------------- views & overlays ---------------- */

  /**
   * Let `owner`'s primary UI open where its placement says (engines/placement.ts). `fallback` = the manifest default
   * (`opens`); the person's pick (`axf.placement.<owner>`) wins and is read on every open, so a change applies at once.
   */
  setPlacement(owner: string, ui: UiRef, fallback: Placement, title = ui.id) {
    this.placements.set(`${ui.kind}:${ui.id}`, { owner, ui, fallback, title });
  }

  /** Forget `owner`'s placement (its library was switched off). */
  removePlacement(owner: string) {
    for (const [k, v] of this.placements) if (v.owner === owner) this.placements.delete(k);
  }

  /** Where `owner`'s primary UI opens now: the person's pick, else its default (null = nothing placed for it). */
  placementOf(owner: string): Placement | null {
    const p = [...this.placements.values()].find((x) => x.owner === owner);
    return p ? normalizePlacement(this.settings.get(placementKey(owner)), p.fallback) : null;
  }

  /** The placed primary UIs (for settings and the Plugin Manager). */
  placedUis(): { owner: string; ui: UiRef; fallback: Placement; title: string }[] {
    return [...this.placements.values()];
  }

  /** Open a placed UI where its placement says; false = open it the normal way. */
  private openPlaced(ref: string, props?: Record<string, unknown>): boolean {
    const p = this.placements.get(ref);
    if (!p) return false;
    const r = placementRoute(p.ui, normalizePlacement(this.settings.get(placementKey(p.owner)), p.fallback));
    if (r.via === 'natural') return false;
    if (p.ui.kind === 'dialog') this.placedProps.set(p.ui.id, props);
    if (r.via === 'page') {
      this.placedReturn = this.state.view;
      this.set({ view: r.view, context: null, dialog: null });
    } else if (r.via === 'dialog') {
      this.set({ dialog: { id: r.dialog }, context: null });
    } else {
      const wm = this.windows;
      // already open somewhere: bring it up instead of opening it twice
      const open = Object.values(wm.state.groups).find((g) => g.tabs.some((t) => t.kind === r.tabKind && t.payload === r.payload));
      if (open) {
        wm.activate(open.id, open.tabs.findIndex((t) => t.kind === r.tabKind && t.payload === r.payload));
        wm.focus(open.windowId);
      } else {
        const tab = { id: `placed-${p.ui.id}-${Date.now().toString(36)}`, title: p.title, kind: r.tabKind, payload: r.payload };
        const shared = r.via === 'tab' && this.placementTabWindow ? wm.state.windows.find((w) => w.id === this.placementTabWindow) : undefined;
        const group = shared && Object.values(wm.state.groups).find((g) => g.windowId === shared.id);
        if (group) { wm.addTab(group.id, tab); wm.activate(group.id, group.tabs.length); wm.focus(shared!.id); }
        else {
          const wid = wm.openFloating([tab], r.via === 'tab' ? PLACEMENT_TAB_GROUP : p.title, 'floating', 640, 520);
          if (r.via === 'tab') this.placementTabWindow = wid;
        }
      }
      this.set({ context: null, ...(p.ui.kind === 'dialog' ? { dialog: null } : {}) });
    }
    return true;
  }

  /** Open a view the way it was declared (in the main area), past its placement: what a placed UI's "go to page" uses. */
  navigateHere(view: string) {
    this.set({ view, context: null });
  }

  navigate(view: string) {
    if (this.openPlaced(`view:${view}`)) return;
    // A view the host took over (embed@1 takes: the settings view inside Patches) opens in the host instead.
    if (embedTakenView(this.embedded, view)) { this.askHost(`nav:${view}`); return; }
    // A view of a function the host locks (plugins inside Patches): say who manages it instead of opening it.
    const lock = this.lockedByHost({ view });
    if (lock) { this.toast(lock, 'info', `Managed in ${embedHostLabel(this.embedded)}`); return; }
    this.set({ view, context: null });
  }

  openDialog(id: string, props?: Record<string, unknown>) {
    if (this.openPlaced(`dialog:${id}`, props)) return;
    this.set({ dialog: { id, props, scope: this.uiScope }, context: null });
  }

  closeDialog() {
    this.set({ dialog: null });
  }

  toast(message: string, kind: Toast['kind'] = 'info', title?: string) {
    const popup = this.asset('popup').data;
    const t: Toast = { id: ++this.toastSeq, kind, title, message, scope: this.uiScope };
    const toasts = [...this.state.toasts, t].slice(-popup.maxVisible);
    this.set({ toasts });
    // the behaviour theme's toast time wins when it sets one (0 = the pop-up asset's); 0 on the asset = stay until closed
    const b = this.behavior().feedback;
    const ms = popup.duration > 0 && b.toastMs > 0 ? b.toastMs : popup.duration;
    if (ms > 0) setTimeout(() => this.dismissToast(t.id), ms);
    if (kind === 'danger') this.feedback('error'); else if (kind === 'warning') this.feedback('warning');
  }

  dismissToast(id: number) {
    if (!this.state.toasts.some((t) => t.id === id)) return;
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  openContext(x: number, y: number, target: string, payload?: string) {
    if (this.slotHidden('context-menu')) return;
    this.set({ context: { x, y, target, payload, scope: this.uiScope } });
  }

  closeContext() {
    if (this.state.context) this.set({ context: null });
  }

  dispatch(spec: string, ctx: Omit<ActionContext, 'runtime'> = {}): boolean {
    // A hook of a function the host took over (embed@1): the host does it (e.g. Patches' combined settings).
    if (embedTakenBy(this.embedded, spec)) return this.askHost(spec);
    // A hook of a function the host locks (plugins inside Patches): shown greyed out; running it only says who manages it.
    const lock = this.lockedByHost({ action: spec });
    if (lock) { this.toast(lock, 'info', `Managed in ${embedHostLabel(this.embedded)}`); return false; }
    return this.actions.dispatch(spec, { runtime: this, ...ctx });
  }

  /* ---------------- embed@1: what the host takes over ---------------- */

  /** Does the host this app runs in take this function over (`settings`, `notifications`)? */
  hostTakes(fn: string): boolean { return embedTakesFn(this.embedded, fn); }

  /**
   * Is this action / view / live list a hook the host took over? Chrome drops such hooks (app menu, toolbar, nav,
   * context menu, banner widgets), so the app shows none of its own hooks for a function the host does for it.
   */
  takenByHost(what: { action?: string; view?: string; provider?: string }): boolean {
    return !!(embedTakenBy(this.embedded, what.action) || embedTakenView(this.embedded, what.view) || embedTakenProvider(this.embedded, what.provider));
  }

  /**
   * Is this action / view / live list a hook of a function the host locks (embed@1 take with `lock`, e.g. plugins
   * inside Patches)? Returns the note to show (`Plugins are managed in Patches`), or null. Chrome keeps such hooks on
   * screen greyed out with the note as their tooltip.
   */
  lockedByHost(what: { action?: string; view?: string; provider?: string }): string | null {
    const e = this.embedded;
    if (!e?.takes?.length) return null;
    const fn = embedLockedBy(e, what.action) ?? embedTakenView(e, what.view, true) ?? embedTakenProvider(e, what.provider, true);
    return embedLockNote(e, fn);
  }

  /** The note for a whole function the host locks (`plugins` → `Plugins are managed in Patches`), or null. */
  hostLockNote(fn: string): string | null { return embedLockNote(this.embedded, fn); }

  /* ---------------- embed@1: the host manages this app's plugins (take `plugins`) ---------------- */

  /**
   * The plugins the host enabled for this app (`plugins-enabled` message), or null while the host hasn't said (or
   * doesn't take plugins). An app loads only these while the host takes plugins; its own on/off switches don't apply.
   */
  hostPlugins: string[] | null = null;
  private hostPluginSubs = new Set<(ids: string[]) => void>();
  private reportedPlugins: EmbedPlugin[] | null = null;

  /** Called whenever the host sends its list for this app. Returns the unsubscribe. */
  onHostPlugins(fn: (ids: string[]) => void): () => void { this.hostPluginSubs.add(fn); return () => { this.hostPluginSubs.delete(fn); }; }

  /** Tell the host which plugins this app has (and which it had on by itself). Kept, and sent again when the host asks. */
  reportPluginsToHost(plugins: EmbedPlugin[]): boolean {
    if (!this.hostTakes('plugins')) return false;
    this.reportedPlugins = plugins.map((p) => ({ ...p }));
    return this.postToHost({ $axf: EMBED_MESSAGE, type: 'plugins', plugins: this.reportedPlugins });
  }

  /** The host's list arrived (also used by tests and Android hosts through AxfEmbedGuest). */
  receiveHostPlugins(ids: string[]): void {
    this.hostPlugins = [...ids];
    for (const f of this.hostPluginSubs) try { f(this.hostPlugins); } catch { /* a listener's own problem */ }
    this.set({});
  }

  /** Send a message to the host (Android: its `AxfEmbedHost` bridge; web: the parent frame). False when there's no host. */
  postToHost(msg: EmbedMessage): boolean {
    if (!this.embedded) return false;
    const g = globalThis as unknown as { AxfEmbedHost?: { post?: (json: string) => void }; parent?: { postMessage?: (m: unknown, o: string) => void }; window?: unknown };
    try {
      if (typeof g.AxfEmbedHost?.post === 'function') { g.AxfEmbedHost.post(JSON.stringify(msg)); return true; }
      // The message only asks the host to do something it would do anyway; its content is checked on arrival.
      if (g.parent && g.parent !== (globalThis as unknown) && typeof g.parent.postMessage === 'function') { g.parent.postMessage(msg, '*'); return true; }
    } catch { /* no host to reach */ }
    return false;
  }

  /** A taken hook was used: ask the host (open its settings on this app's tab, and the tab the action named). */
  private askHost(spec: string): boolean {
    const fn = embedTakenBy(this.embedded, spec) ?? embedTakenView(this.embedded, spec.startsWith('nav:') ? spec.slice(4) : spec);
    if (fn === 'settings') {
      const tab = settingsTabOf(spec);
      if (this.postToHost(tab ? { $axf: EMBED_MESSAGE, type: 'open-settings', tab } : { $axf: EMBED_MESSAGE, type: 'open-settings' })) return true;
    }
    // Banner settings: the host shows every banner's settings in its own Banners tab (`banners` / `banners:<banner id>`).
    if (fn === 'banners') {
      const id = spec.startsWith('banners.settings:') ? spec.slice('banners.settings:'.length) : '';
      const tab = /^[a-z0-9][a-z0-9._-]{0,54}$/i.test(id) ? `banners:${id}` : 'banners';
      if (this.postToHost({ $axf: EMBED_MESSAGE, type: 'open-settings', tab })) return true;
    }
    this.toast(`${this.embedded?.host ?? 'The host app'} has this app's settings: open them from its menu.`, 'info', 'Settings');
    return false;
  }

  /** Messages from the host: a settings page opens the tab the host asks for. Web only; Android hosts evaluate the same. */
  private listenToHost(): void {
    const handle = (raw: unknown) => {
      const m = parseEmbedMessage(raw);
      if (m?.type === 'open-tab' && this.embedded?.page === 'settings') this.actions.dispatch(`settings.open:${m.tab}`, { runtime: this });
      if (m?.type === 'open-tab' && this.embedded?.page === 'banners') this.actions.dispatch(`banners.settings:${m.tab}`, { runtime: this });
      if (m?.type === 'menu-request') void this.shareAppMenu({ force: true, refresh: true });
      if (m?.type === 'run') this.runSharedMenuItem(m.id);
      if (m?.type === 'plugins-enabled' && this.hostTakes('plugins')) this.receiveHostPlugins(m.plugins);
      if (m?.type === 'plugins-request' && this.reportedPlugins) this.reportPluginsToHost(this.reportedPlugins);
    };
    // the app itself in a tab shares its menu; a page the host shows alone (its settings page) doesn't
    if (this.hostTakes('app-menu') && !this.embedded?.page) this.startMenuShare();
    // Android hosts can't post into the page; they call this instead (evaluateJavascript).
    (globalThis as unknown as { AxfEmbedGuest?: { receive: (json: string) => void } }).AxfEmbedGuest = { receive: (json: string) => handle(json) };
    const g = globalThis as unknown as { addEventListener?: (t: string, f: (e: { data: unknown; source: unknown }) => void) => void; parent?: unknown };
    if (typeof g.addEventListener !== 'function') return;
    g.addEventListener('message', (e) => {
      // Only the frame this app runs in may ask; anything else (other frames, the page itself) is ignored.
      if (!e || e.source !== g.parent || g.parent === (globalThis as unknown)) return;
      handle(e.data);
    });
  }

  /**
   * The launch log of libraries a host made unneeded (installLibraries calls this once per install): kept in
   * `skippedLibraries` for Settings → Plugins and written to the terminal, one line each and one summary line.
   */
  noteSkippedLibraries(list: readonly { id: string; label: string; version: string; reason: string }[]): void {
    const fresh = list.filter((s) => !this.skippedLibraries.some((x) => x.id === s.id));
    if (!fresh.length) return;
    this.skippedLibraries.push(...fresh);
    for (const s of fresh) this.terminal.log('libraries', `${s.label} ${s.version} not loaded: ${s.reason}`);
    this.terminal.warn('libraries', `inside ${this.embedded?.host ?? 'a host app'}: ${fresh.length} plugin(s) not loaded (${fresh.map((s) => s.label).join(', ')})`);
  }

  /* ---------------- embed@1: the host's menu carries this app's (take `app-menu`) ---------------- */

  /** id → action of the menu last sent to the host: `run` messages can only run what this app offered. */
  private sharedMenuRun = new Map<string, string>();
  private sharedMenuText = '';
  private sharedMenuTimer: ReturnType<typeof setTimeout> | null = null;
  /** live lists as last loaded (refreshed on a host's request and every minute, not on every state change) */
  private sharedMenuLists = new Map<string, CompiledMenuItem[]>();

  /** Send the menu soon after start, after state changes (debounced) and every minute (live lists). */
  private startMenuShare(): void {
    // never keeps a non-browser host (tests, Node) alive
    const unref = (t: unknown) => (t as { unref?: () => void } | null)?.unref?.();
    const later = (ms: number, refresh = false) => {
      if (this.sharedMenuTimer) clearTimeout(this.sharedMenuTimer);
      this.sharedMenuTimer = setTimeout(() => { this.sharedMenuTimer = null; void this.shareAppMenu({ refresh }); }, ms);
      unref(this.sharedMenuTimer);
    };
    unref(setTimeout(() => { later(0, true); this.subscribe(() => later(1500)); }, 600));
    unref(setInterval(() => later(0, true), 60_000));
  }

  /**
   * Send this app's application menu to the host that took it over (`menu` message): data only (ids, labels, icons,
   * check marks, counts, locks); the actions stay here. Unchanged menus aren't sent again unless `force`.
   */
  async shareAppMenu(opts: { force?: boolean; refresh?: boolean } = {}): Promise<boolean> {
    if (!this.hostTakes('app-menu') || this.embedded?.page) return false;
    const run = new Map<string, string>();
    const MAX_DEPTH = 4;
    const list = async (provider: string): Promise<CompiledMenuItem[]> => {
      if (!opts.refresh && this.sharedMenuLists.has(provider)) return this.sharedMenuLists.get(provider)!;
      let items: CompiledMenuItem[] = [];
      try { items = await this.loadAppMenuProvider(provider); } catch { items = this.sharedMenuLists.get(provider) ?? []; }
      this.sharedMenuLists.set(provider, items);
      return items;
    };
    const conv = async (it: CompiledMenuItem, id: string, depth: number): Promise<EmbedMenuItem | null> => {
      if (it.separator) return { id, label: '', separator: true };
      const kids = depth < MAX_DEPTH ? (it.provider ? await list(it.provider) : it.items ?? []) : [];
      const out: EmbedMenuItem = { id, label: it.label };
      if (it.icon) out.icon = it.icon;
      if (it.locked) out.locked = true;
      if (typeof it.check === 'boolean') out.check = it.check;
      if (it.count) out.count = it.count;
      if (kids.length) {
        const sub = (await Promise.all(kids.map((k, i) => conv(k, `${id}.${i}`, depth + 1)))).filter((k): k is EmbedMenuItem => !!k);
        if (sub.some((k) => !k.separator)) out.items = sub;
      }
      if (!out.items) {
        if (!it.action) return null;
        if (!it.locked) run.set(id, it.action);
      }
      return out;
    };
    const menus: EmbedMenu[] = [];
    for (const [mi, m] of this.appMenu().menus.entries()) {
      const items = (await Promise.all(m.items.map((it, i) => conv(it, `m${mi}.${i}`, 1)))).filter((k): k is EmbedMenuItem => !!k);
      if (items.some((k) => !k.separator)) menus.push({ id: `m${mi}`, label: m.label, items });
    }
    const msg: EmbedMessage = { $axf: EMBED_MESSAGE, type: 'menu', menus };
    const text = JSON.stringify(msg);
    this.sharedMenuRun = run;
    if (!opts.force && text === this.sharedMenuText) return false;
    this.sharedMenuText = text;
    return this.postToHost(msg);
  }

  /** The host's menu picked one of this app's items (`run` message): run it here, if this app offered it. */
  runSharedMenuItem(id: string): boolean {
    const action = this.sharedMenuRun.get(id);
    if (!action) { this.terminal.warn('menus', `the host asked to run menu item "${id}", which this app didn't offer`); return false; }
    return this.dispatch(action);
  }

  /* ---------------- rendering ---------------- */

  /** Compile every active asset into CSS vars + root data-attributes. */
  compileStyles(): { vars: VarMap; attrs: Record<string, string> } {
    const color = this.asset('color-theme').data;
    const parts = [
      buttonStyle(this.asset('button').data),
      sliderStyle(this.asset('slider').data),
      containerStyle(this.asset('container').data),
      dialogStyle(this.asset('dialog').data),
      popupStyle(this.asset('popup').data),
      contextMenuStyle(this.asset('context-menu').data),
      toolbarStyle(this.asset('toolbar').data),
      navMenuStyle(this.asset('nav-menu').data),
      appMenuStyle(this.asset('app-menu').data),
      // optional control types (older apps without them get the defaults)
      gaugeStyle(this.assetOrNull('gauge')?.data),
      meterStyle(this.assetOrNull('meter')?.data),
      tabGroupStyle(this.assetOrNull('tab-group')?.data, this.slotHidden('tab-group')),
    ];
    const vars: VarMap = {
      ...colorThemeVars(color),
      ...styleThemeVars(this.asset('style-theme').data, this.spacing()),
      ...layoutVars(this.asset('layout').data, this.hiddenSlots()),
      ...bannerVars(this.assetOrNull('banner')?.data, this.slotHidden('banner')),
      // branding package (optional): palette slots as --fx-brand-1/2/3, the brand name, the accent when it asks for it
      ...brandingVars(this.assetOrNull('branding' as AssetType)?.data ?? { brand: { name: '' }, marks: {} }),
    };
    // behaviour last among the theme vars: its motion speed (when not "theme") wins over the style theme's
    const reducedMotion = this.prefersReducedMotion();
    const behavior = this.assetOrNull('behavior-theme' as AssetType)?.data;
    parts.push(behaviorStyle(behavior, reducedMotion));
    // the window manager follows the behaviour theme's `windows` group (stack / snap / minimize) from the same compile
    this.windows.setPlacement(normalizeBehavior(behavior).windows);
    const attrs: Record<string, string> = { 'data-fx-scheme': color.scheme };
    const brandId = this.state.active['branding' as AssetType];
    if (brandId) attrs['data-fx-brand'] = brandId;
    if (this.busyCount > 0 && normalizeBehavior(behavior).feedback.busyCursor) attrs['data-fx-busy'] = '1';
    for (const p of parts) {
      Object.assign(vars, p.vars);
      Object.assign(attrs, p.attrs);
    }
    return { vars, attrs };
  }

  /* ---------------- interfaces + scopes (core/engines/interface.ts) ---------------- */

  private readonly scopes = new Map<string, AxfRuntime>();

  /** The interface scope the user is working in ('' = the app itself); dialogs, context menus, toasts and new windows are stamped with it. */
  uiScope = '';

  /** Called by a scope's root (pointer / focus / key, capture phase) and by scoped views before they open anything. */
  enterScope(id: string): void {
    const next = isScopeId(id) ? id : '';
    this.uiScope = next;
    this.windows.scopeHint = next;
  }

  /** The registry view the interface engine resolves against. */
  private interfaceRegistry() {
    return { has: (t: string, id: string) => this.registry.has(t as AssetType, id), designPackage: (id: string) => this.registry.get(DESIGN_PACKAGE_TYPE as AssetType, id)?.data, stylePackage: (id: string) => this.registry.get(STYLE_PACKAGE_TYPE as AssetType, id)?.data };
  }

  /** An interface asset resolved against what this app ships (null when there is no such interface). */
  resolveInterface(id: string): ResolvedInterface | null {
    const a = this.registry.get(INTERFACE_TYPE as AssetType, id);
    return a ? resolveInterface(a.data, this.interfaceRegistry()) : null;
  }

  /** The current look as an interface over the applied design package (for the roller and Save as interface). */
  captureInterface(tab?: { label: string; icon: string }): InterfaceData {
    const hidden: Record<string, boolean> = {};
    for (const t of ASSET_TYPES) { const v = this.settings.get(HIDE_KEY(t)); if (typeof v === 'boolean') hidden[t] = v; }
    return captureInterface({ active: this.state.active as Record<string, string>, types: ASSET_TYPES, spacing: this.spacing(), hidden, values: this.settings.savedValues(), design: this.appliedDesignPackage() ?? '' }, tab);
  }

  /** The interface applied to the whole app, if any. */
  appliedInterface(): string | undefined {
    const v = this.settings.get(INTERFACE_SETTING_KEY);
    return typeof v === 'string' && this.registry.has(INTERFACE_TYPE as AssetType, v) ? v : undefined;
  }

  /** Apply interface `id` to the whole app: its design package (whole look), then its own slots, spacing, hidden chrome, settings and branding. */
  applyInterface(id: string): boolean {
    if (!this.can('assets.swap')) { this.toast('Your role cannot change the look.', 'danger', 'Permission denied'); return false; }
    const a = this.registry.get(INTERFACE_TYPE as AssetType, id);
    if (!a) { this.toast(`No interface "${id}".`, 'warning', 'Interface'); return false; }
    const r = resolveInterface(a.data, this.interfaceRegistry());
    if (r.design && this.registry.has(DESIGN_PACKAGE_TYPE as AssetType, r.design)) this.applyDesignPackage(r.design);
    for (const [k, v] of Object.entries(r.settings)) this.settings.set(k, v as SettingValue);
    for (const [t, want] of Object.entries(r.hidden)) if (hideable(t as AssetType) && !this.slotOwnedByHost(t as AssetType)) this.setSlotHidden(t as AssetType, want);
    this.setSpacing(r.spacing as Spacing);
    const slots: Record<string, string> = {};
    for (const [t, sid] of Object.entries(r.active)) if (t !== DESIGN_PACKAGE_TYPE) slots[t] = sid;
    this.swapAll({ ...(slots as Partial<ActiveAssets>), [INTERFACE_TYPE]: id } as Partial<ActiveAssets>);
    this.settings.set(INTERFACE_SETTING_KEY, id);
    for (const m of r.missing) this.terminal.warn('hot-swap', `interface ${id}: ${m} isn't in this app, kept the current one`);
    this.terminal.ok('hot-swap', `interface ${id} applied (${Object.keys(r.active).length} slots)`);
    this.toast(`${a.name} applied.`, 'success', 'Interface');
    return true;
  }

  /**
   * A scoped view of this runtime: the same app, drawn under interface `interfaceId` inside the element that
   * carries `data-fx-scope="<scopeId>"`. Reads of the look (active assets, spacing, hidden chrome, appearance
   * settings, compiled styles) come from the interface; everything else (actions, windows, dialogs, settings
   * writes, swaps) is the shared runtime, so a swap inside a scope changes the app, never the scope's interface.
   * Views are cached per scope id; `dropScope` forgets one. Refused (null) for a bad scope id or unknown interface.
   */
  scoped(scopeId: string, interfaceId: string): AxfRuntime | null {
    if (!isScopeId(scopeId) || !this.registry.has(INTERFACE_TYPE as AssetType, interfaceId)) return null;
    const cached = this.scopes.get(scopeId);
    if (cached && (cached as unknown as { scopeInterface: string }).scopeInterface === interfaceId) return cached;
    const base = this;
    let memo: { rev: number; r: ResolvedInterface } | null = null;
    let snap: { base: AxfState; value: AxfState } | null = null;
    const resolved = (): ResolvedInterface => {
      const rev = base.state.rev;
      if (!memo || memo.rev !== rev) memo = { rev, r: base.resolveInterface(interfaceId)! };
      return memo.r;
    };
    const view = Object.create(base) as AxfRuntime & { scopeId: string; scopeInterface: string };
    // Reads of look keys come from the interface; everything else (set, clear, reload, watchers, groups, …) is the
    // shared registry itself. A prototype copy (Object.create) is not enough: SettingsRegistry.set() assigns
    // `this.values`, which would land on the copy, so a switch or tab button inside a scope never reached the app
    // (fix Oct 28 2026: Settings → Appearance switches and the interface tab buttons did nothing inside a GizmoX tab).
    const scopedGet = (key: string): SettingValue => (key in resolved().settings ? (resolved().settings[key] as SettingValue) : key === SPACING_KEY ? resolved().spacing : base.settings.get(key));
    const settings = new Proxy(base.settings, {
      get(target, prop) {
        if (prop === 'get') return scopedGet;
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
      set(target, prop, value) { return Reflect.set(target, prop, value, target); },
    }) as SettingsRegistry;
    Object.defineProperties(view, {
      scopeId: { value: scopeId },
      scopeInterface: { value: interfaceId },
      settings: { value: settings },
      // one snapshot per base state: useSyncExternalStore needs getState to return the same object until something
      // changes, or React loops (error #185) the moment a whole app shell renders inside a scope
      state: { get: () => {
        const bs = base.state;
        if (!snap || snap.base !== bs) snap = { base: bs, value: { ...bs, active: { ...bs.active, ...resolved().active, [INTERFACE_TYPE]: interfaceId } } };
        return snap.value;
      }, set: () => { /* writes go through set(), which the base owns */ } },
      getState: { value: () => view.state },
      set: { value: (patch: Partial<AxfState>, persist = false) => (base as unknown as { set(p: Partial<AxfState>, persist?: boolean): void }).set(patch, persist) },
      hiddenSlots: { value: () => hiddenSlots({ ...resolved().hidden }, base.defaultHiddenSlots(), base.embedHiddenSlots()) as AssetType[] },
      slotHidden: { value: (type: AssetType) => hideable(type) && view.hiddenSlots().includes(type) },
      spacing: { value: () => spacingOf(resolved().spacing) },
      appliedInterface: { value: () => interfaceId },
      scoped: { value: (sid: string, iid: string) => base.scoped(sid, iid) },
      // anything opened through the scoped view belongs to the scope (its own hosts draw it)
      openDialog: { value: (did: string, props?: Record<string, unknown>) => { base.enterScope(scopeId); base.openDialog(did, props); } },
      openContext: { value: (x: number, y: number, target: string, payload?: string) => { base.enterScope(scopeId); base.openContext(x, y, target, payload); } },
      toast: { value: (message: string, kind?: Toast['kind'], title?: string) => { base.enterScope(scopeId); base.toast(message, kind, title); } },
    });
    this.scopes.set(scopeId, view);
    return view;
  }

  /** Forget a scoped view (its element left the page). */
  dropScope(scopeId: string): void { this.scopes.delete(scopeId); }

  /** The CSS a scope's root needs: its compiled vars under its selector, plus the engine sheets re-rooted there. */
  scopeCss(): string {
    const id = (this as unknown as { scopeId?: string }).scopeId;
    if (!id) return '';
    const { vars } = this.compileStyles();
    return [scopeVarsCss(id, vars), scopeSheet(this.customSheet(), id)].filter(Boolean).join('\n');
  }

  /** The attributes a scope's root element carries. */
  scopeRootAttrs(): Record<string, string> {
    const id = (this as unknown as { scopeId?: string; scopeInterface?: string }).scopeId;
    if (!id) return {};
    return scopeAttrs(id, (this as unknown as { scopeInterface: string }).scopeInterface, this.compileStyles().attrs);
  }

  /* ---------------- branding (core/engines/brand.ts) ---------------- */

  /** The active branding package resolved against the registry, or null when the app has none. */
  branding(): ResolvedBrand | null {
    const b = this.assetOrNull('branding' as AssetType);
    return b ? resolveBranding(b.data, this.registry) : null;
  }

  /**
   * What a UI piece draws at a brand slot: the mode (`mark`, `wordmark`, `lockup`, `animated`, `accent-edge`,
   * `watermark`), the resolved asset's data, the inline SVG at `height` (sanitised by the engine: path data + one text
   * node, colours as tokens) and, for an animated mark, its CSS animation (null under reduced motion). `null` when the
   * slot draws nothing (no branding package, mode `none`, or the asset is missing).
   */
  brandPlace(slot: string, height = 20): BrandPlace | null {
    const b = this.branding();
    const p = b?.places[slot];
    if (!b || !p || p.mode === 'none') return null;
    if (p.mode === 'accent-edge') return { mode: p.mode, name: b.name, asset: '', svg: '', animation: null };
    if (!p.asset || !p.type) return null;
    let markId = p.asset;
    let animation: MarkAnimation | null = null;
    if (p.type === 'animated-logo') {
      const anim = this.registry.get('animated-logo' as AssetType, p.asset);
      if (!anim) return null;
      const a = anim.data as { mark?: string };
      markId = a.mark ?? '';
      animation = animationFor(anim.data, this.prefersReducedMotion());
    }
    const mark = this.registry.get('logo-mark' as AssetType, markId);
    if (!mark) return null;
    return { mode: p.mode, name: b.name, asset: p.asset, svg: markSvg(mark.data, { height, text: p.mode !== 'mark' && p.mode !== 'watermark', title: b.name }), animation };
  }

  /** The glyph an icon name resolves to in the active icon pack, or null = the framework's own icon. */
  brandGlyph(name: string): { glyph: Glyph; pack: unknown } | null {
    const b = this.branding();
    if (!b?.iconPack) return null;
    const pack = this.registry.get('icon-pack' as AssetType, b.iconPack);
    if (!pack) return null;
    const glyph = glyphFor(pack.data, name);
    return glyph ? { glyph, pack: pack.data } : null;
  }

  private prefersReducedMotion(): boolean {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** The saved extra tokens of a slot (Settings → Appearance → Assets; engines/customize.ts). */
  customSlot(type: AssetType): CustomSlot {
    return normalizeCustomSlot(this.settings.get(CUSTOM_KEY(type)), type);
  }

  /** Save a slot's extra tokens (needs assets.swap). */
  setCustomSlot(type: AssetType, slot: CustomSlot): boolean {
    if (this.gate('assets.swap') !== 'allow') return false;
    this.settings.set(CUSTOM_KEY(type), slot as unknown as SettingValue);
    return true;
  }

  /** One CSS sheet: each customizable slot's values for its active asset (empty when nothing is customized). */
  customSheet(): string {
    if (this.appearanceLocked()) return '';
    const per: Record<string, CustomValues> = {};
    for (const t of customizableTypes()) {
      const id = (this.getState().active as Record<string, string | undefined>)[t];
      per[t] = effectiveCustom(this.customSlot(t as AssetType), id);
    }
    return customizeSheet(per);
  }

  applyTo(el: HTMLElement) {
    const { vars, attrs } = this.compileStyles();
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.style.colorScheme = attrs['data-fx-scheme'] ?? 'light';
  }

  /* ---------------- built-in actions ---------------- */

  private registerBuiltinActions() {
    const a = this.actions;
    for (const [id, meta] of Object.entries(STANDARD_ACTIONS)) {
      a.register(id, () => this.toast(`${meta.label} has no handler in this app yet.`, 'info', meta.label), { ...meta, stub: true });
    }
    a.register('swap', ([type, target = 'next']) => {
      if (type && (ASSET_TYPES as readonly string[]).includes(type)) this.swap(type as AssetType, target);
      else this.toast(`Unknown asset type "${type}".`, 'warning');
    }, { label: 'Swap asset', params: true });
    a.register('nav', ([view]) => view && this.navigate(view), { label: 'Navigate', params: true });
    a.register('dialog', ([id, ...rest]) => id && this.openDialog(id, rest.length ? { arg: rest.join(':') } : undefined), { label: 'Open dialog', params: true });
    a.register('toast', ([kind = 'info', ...msg]) => this.toast(msg.join(':') || 'Hello from AmberX AXF', kind as Toast['kind']), { label: 'Show toast', params: true });
    a.register('role', ([id]) => id && this.setRole(id), { label: 'Switch role', params: true });
    a.register('assets.random', () => this.randomize(), { label: 'Randomize assets', requires: 'assets.swap' });
    // Rolls from code, menus or MCP: roll.slot:<type>:on|off|default · roll.asset:<type>:<id>:on|off|default
    const onOff = (v?: string) => (v === 'on' ? true : v === 'off' ? false : null);
    a.register('roll.slot', ([type, v]) => {
      if (type && (ASSET_TYPES as readonly string[]).includes(type)) this.setRollSlot(type as AssetType, onOff(v));
    }, { label: 'Include a slot in randomize rolls', requires: 'assets.swap', params: true });
    a.register('roll.asset', ([type, id, v]) => {
      if (type && id && (ASSET_TYPES as readonly string[]).includes(type)) this.setRollAsset(type as AssetType, id, onOff(v));
    }, { label: 'Include an asset in randomize rolls', requires: 'assets.swap', params: true });
    // Hidden slots from code, menus or MCP: slot.hide:<type>:on|off
    // slot.hide:<type>:on|off|toggle (the menu's chrome toggles use `toggle`)
    a.register('slot.hide', ([type, v]) => {
      if (type && (ASSET_TYPES as readonly string[]).includes(type)) this.setSlotHidden(type as AssetType, v === 'toggle' ? !this.slotHidden(type as AssetType) : v !== 'off');
    }, { label: 'Hide or show a slot', requires: 'assets.swap', params: true });
    // spacing:tight|compact|regular (Settings → Appearance → Spacing)
    a.register('spacing', ([v]) => { if (v) this.setSpacing(spacingOf(v) === v ? (v as Spacing) : this.spacing()); }, { label: 'Change spacing (tight, compact, regular)', requires: 'assets.swap', params: true });
    // widgets.arrange[:<host>] toggles arrange mode (banner when no host) · widgets.arrange.done · widgets.reset[:<host>]
    a.register('widgets.arrange', ([host]) => { const h = host || 'banner'; this.setArranging(this.arranging(h) ? null : h); }, { label: 'Arrange widgets (drag to move)', requires: 'assets.swap', params: true });
    a.register('widgets.arrange.done', () => this.setArranging(null), { label: 'Done arranging widgets', searchable: false });
    a.register('widgets.reset', ([host]) => this.resetHostArrangement(host || 'banner'), { label: 'Put widgets back where they were', requires: 'assets.swap', params: true });
    a.register('assets.reset', () => this.reset(), { label: 'Reset to defaults' });
    // design.package:<id> · design.package:next|prev|random steps through the registered packages and applies one
    // (swap:design-package:next would only move the slot, never apply the package's themes).
    a.register('design.package', ([id]) => {
      if (!id) return;
      if (id === 'next' || id === 'prev' || id === 'random') {
        const list = this.registry.list(DESIGN_PACKAGE_TYPE as AssetType);
        if (!list.length) return;
        const cur = list.findIndex((p) => p.id === this.state.active[DESIGN_PACKAGE_TYPE as AssetType]);
        const step = id === 'random' ? 1 + Math.floor(Math.random() * Math.max(1, list.length - 1)) : id === 'next' ? 1 : -1;
        id = list[((cur < 0 ? (step > 0 ? -1 : 0) : cur) + step + list.length * 2) % list.length]?.id ?? id;
      }
      this.applyDesignPackage(id);
    }, { label: 'Apply a design package (id, next, prev or random)', requires: 'assets.swap', params: true });
    // style.package:<id> · style.package:next|prev|random — a matched set of controls in one go
    a.register('style.package', ([id]) => {
      if (!id) return;
      const ids = this.registry.list(STYLE_PACKAGE_TYPE as AssetType).map((p) => p.id);
      const pick = id === 'next' || id === 'prev' || id === 'random' ? stepPackage(ids, this.state.active[STYLE_PACKAGE_TYPE as AssetType], id) : id;
      if (pick && this.swap(STYLE_PACKAGE_TYPE as AssetType, pick)) {
        const a = this.registry.get(STYLE_PACKAGE_TYPE as AssetType, pick);
        if (a) this.toast(`${a.name} applied.`, 'success', 'Style package');
      }
    }, { label: 'Apply a style package (id, next, prev or random)', requires: 'assets.swap', params: true });
    a.register('appearance.package', ([id]) => { if (id) this.applyDesignPackage(id); }, { label: 'Apply a design package (old name)', requires: 'assets.swap', params: true, searchable: false });
    a.register('appearance.restore', () => this.restoreDefaultAppearance(), { label: 'Restore default appearance', requires: 'assets.swap' });
    // No `requires`: these must work while the lock greys out every assets.swap control (setAppearanceLocked checks the role).
    const turn = (arg: string | undefined, cur: boolean) => (arg === 'on' ? true : arg === 'off' ? false : !cur);
    a.register('appearance.lock', ([v]) => { this.setAppearanceLocked(turn(v, this.appearanceLocked())); }, { label: 'Lock the look', params: true });
    a.register('appearance.hub', ([v]) => { this.setAppearanceFollowing(turn(v, this.appearanceFollowing())); }, { label: 'Read the look from axHub', params: true });
    a.register('asset.json', ([type, id]) => this.openDialog('asset-json', { type, id }), { label: 'View asset JSON', params: true });
    a.register('asset.copy', ([type, id]) => {
      const json = type && id ? this.exportAsset(type as AssetType, id) : '';
      navigator.clipboard?.writeText(json).then(
        () => this.toast('Asset JSON copied to clipboard.', 'success', 'Copied'),
        () => this.toast('Clipboard is not available here.', 'warning'),
      );
    }, { label: 'Copy asset JSON', params: true });
    a.register('noop', () => {}, { label: 'Nothing', searchable: false });
    // windowing engine
    const wm = this.windows;
    a.register('windows.undock', ([g]) => g && wm.undock(g), { label: 'Undock tab group', params: true });
    a.register('windows.split', ([g, mode = 'vertical', r = '2', c = '2']) => g && wm.split(g, mode as import('./engines/windows').SplitMode, Number(r), Number(c)), { label: 'Split tab group', params: true });
    a.register('windows.closeGroup', ([g]) => g && wm.closeGroup(g), { label: 'Close tab group', params: true });
    a.register('windows.redock', ([w]) => w && wm.redock(w), { label: 'Redock window', params: true });
    a.register('windows.close', ([w]) => w && wm.close(w), { label: 'Close window', params: true });
    a.register('windows.minimizeCorner', ([w]) => w && wm.minimizeToNextCorner(w), { label: 'Minimize to corner', params: true });
    a.register('windows.minimizeToolbar', ([w, x = '24', y = '24']) => w && wm.minimize(w, 'floating-toolbar', Number(x), Number(y)), { label: 'Minimize to floating toolbar', params: true });
    a.register('windows.restore', ([w]) => w && wm.restore(w), { label: 'Restore window', params: true });
    a.register('windows.maximize', ([w]) => w && wm.toggleMaximize(w), { label: 'Maximize / restore window', params: true });
    a.register('windows.snap', ([w, zone = 'left']) => w && wm.snapTo(w, zone as import('./engines/windows').SnapZone), { label: 'Snap window to a zone', params: true });
    a.register('windows.focus', ([w]) => w && wm.focus(w), { label: 'Focus window', params: true });
    a.register('windows.openFloating', ([kind = 'placeholder', title = 'Window', payload = '']) => wm.openFloating([{ id: `tab-${Date.now()}`, title, kind, payload }], title), { label: 'Open floating window', searchable: false });
    a.register('terminal.open', ([channel = '']) => wm.openFloating([{ id: `terminal-${Date.now()}`, title: 'Output', kind: 'terminal', payload: channel, icon: 'terminal' }], 'Output terminal', 'floating', 520, 320), { label: 'Open output terminal' });
    a.register('terminal.dialog', ([channel = '']) => this.openDialog('terminal', { channel }), { label: 'Output terminal (dialog)' });
    // Right-click a widget host (banner, toolbar): arrange its widgets (drag + snap) or put them back.
    this.contextExtras.set('*:widgets', (target) => {
      const host = target && hostSpec(target) ? target : null;
      if (!host || !this.canArrange() || !Object.values(this.hostPlaced(host)).some((l) => l.length)) return [];
      const items: import('./engines/windows').MenuEntry[] = [{ id: `widgets-arrange-${host}`, label: this.arranging(host) ? 'Done arranging widgets' : 'Arrange widgets…', icon: 'move', action: `widgets.arrange:${host}` }];
      if (Object.keys(this.hostArrangement(host)).length) items.push({ id: `widgets-reset-${host}`, label: 'Put widgets back', icon: 'undo', action: `widgets.reset:${host}` });
      return items;
    });
    this.contextExtras.set('tab-group', () => wm.groupMenu());
    this.contextExtras.set('window-title', () => wm.windowMenu());
  }
}

/** The embed marker on the current page (browser only; nothing elsewhere). */
function detectPageEmbed(): Embed | null {
  const g = globalThis as { location?: { search?: string }; navigator?: { userAgent?: string } };
  try { return detectEmbedFull(g.location?.search ?? null, g.navigator?.userAgent ?? null); } catch { return null; }
}

export function createAxf(opts: AxfRuntimeOptions): AxfRuntime {
  const rt = new AxfRuntime(opts);
  // Expose the runtime as a cross-application API (devtools, MCP bridges, other AmberX AXF apps in the page).
  (globalThis as unknown as { AXF?: AxfRuntime }).AXF = rt;
  return rt;
}
