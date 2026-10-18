/**
 * AxfRuntime — the single source of truth for a AmberX AXF app.
 * Holds the asset registry, the active asset per slot, UAC role, view,
 * overlays, and compiles everything into document-level CSS through the
 * engines. Framework-agnostic: the React layer only subscribes to it.
 */
import { SettingsRegistry } from './settings';
import { AssetRegistry, serializeAsset } from './registry';
import { ActionBus, STANDARD_ACTIONS, type ActionContext } from './engines/actions';
import { colorThemeVars, styleThemeVars, type VarMap } from './engines/theme';
import { layoutVars } from './engines/layout';
import { appMenuStyle, buttonStyle, containerStyle, contextMenuStyle, dialogStyle, navMenuStyle, popupStyle, sliderStyle, toolbarStyle } from './engines/components';
import { gateFor, hasPermission, resolvePermissions } from './engines/uac';
import { WindowManager } from './engines/windows';
import { hideable, hiddenSlots } from './engines/hide';
import { spacingOf, type Spacing } from './engines/spacing';
import { attachmentKey, bannerVars, placeAttachments, type BannerAttachment, type PlacedBanner } from './engines/banner';
import { rollAssetIncluded, rollAssetKey, rollNever, rollPlan, rollSlotIncluded, type RollRules } from './engines/roll';
import { SearchIndex } from './engines/search';
import { Diagnostics } from './diagnostics';
import { OutputTerminal } from './terminal';
import {
  ASSET_TYPES,
  OPTIONAL_TYPES,
  type ActiveAssets,
  type Asset,
  type AssetType,
  type AxfManifest,
  type AxfState,
  type Gate,
  type Toast,
} from './types';
import { assetTypeSpecs, attachable, type ValidationResult } from './validate';

export interface AxfRuntimeOptions {
  manifest: AxfManifest;
  assets: unknown[];
  /** localStorage key for persisting the user's hot-swap choices */
  storageKey?: string;
}

/** Settings keys for roll overrides (values: true | false; absent = built-in default). */
export const ROLL_SLOT_KEY = (type: string) => `axf.roll.slot.${type}`;
export const ROLL_ASSET_KEY = (type: string, id: string) => `axf.roll.asset.${type}.${id}`;
/** Hidden slot override (Settings → Appearance → Assets → Hidden); only hideable types (core/engines/hide.ts). */
export const HIDE_KEY = (type: string) => `axf.hide.${type}`;
/** Spacing choice (Settings → Appearance → Spacing): tight | compact | regular; absent = tight (engines/spacing.ts). */
export const SPACING_KEY = 'axf.appearance.spacing';

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

/** A nav section a library or plugin contributes; items point at views it registers. */
export interface NavExtraSection {
  /** Usually the contributing library's id. */
  id: string;
  label?: string;
  items: import('./types').NavItem[];
}

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
  readonly libraries: { id: string; label: string; version: string; template?: string }[] = [];
  /** Conflicts (two modules, same asset id / setting key / settings id) and crashes; see diagnostics.ts. */
  readonly diagnostics = new Diagnostics();
  /** Named counters toolbar items show as badges (`badge` on a toolbar item), e.g. `alerts.unread`. */
  private readonly badgeCounts = new Map<string, number>();
  readonly manifest: AxfManifest;
  readonly loadErrors: { id: string; errors: string[] }[] = [];
  private state: AxfState;
  private listeners = new Set<() => void>();
  private storageKey: string;
  private toastSeq = 0;

  constructor(opts: AxfRuntimeOptions) {
    this.manifest = opts.manifest;
    this.storageKey = opts.storageKey ?? `axf:${opts.manifest.app.id}`;
    this.settings = new SettingsRegistry(`${this.storageKey}:settings`);
    this.registry.onReplace = (r) => this.diagnostics.report({ kind: 'asset-conflict', ...r });
    this.settings.onConflict = (c) => this.diagnostics.report(
      c.what === 'setting'
        ? { kind: 'setting-conflict', key: c.id, was: c.was, now: c.now }
        : { kind: 'contribution-conflict', what: `settings ${c.what}`, id: c.id, was: c.was, now: c.now },
    );
    // The Spacing choice recompiles the styles (the provider re-applies them on any state change it sees).
    this.settings.onChange(SPACING_KEY, () => { this.terminal.ok('hot-swap', `spacing: ${this.spacing()}`); this.set({}); });
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
    };
    this.registerBuiltinActions();
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

  /* ---------------- contributed context-menu items ---------------- */

  /** Add or replace a contribution (same id replaces). The context-menu asset stays untouched, so swapping it keeps them. */
  addContextItems(c: ContextContribution): void {
    this.contextContributions.set(c.id, c);
  }

  /** Remove every contribution of a module (a plugin was disabled or removed). */
  removeContextItems(module: string): void {
    for (const [id, c] of this.contextContributions) if (c.module === module) this.contextContributions.delete(id);
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
    const role = Boolean(saved?.role && saved.role !== this.state.role && policy.roles.some((r) => r.id === saved.role));
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
    return this.registry.get(type, this.state.active[type])!;
  }

  /** The active asset of an optional type (banner, clock, badge), or null when the app has none. */
  assetOrNull<K extends AssetType>(type: K): Asset<K> | null {
    const id = this.state.active[type];
    return id ? this.registry.get(type, id) ?? null : null;
  }

  /* ---------------- banner (core/engines/banner.ts) ---------------- */

  private bannerExtra: BannerAttachment[] = [];
  private bannerPopupTimer: ReturnType<typeof setTimeout> | null = null;

  /** Attach an asset (badge, clock) to the banner at run time. Same type + id replaces the earlier one. Returns detach. */
  attachToBanner(a: BannerAttachment & { origin: string }): () => void {
    const key = attachmentKey(a.type, a.id);
    this.bannerExtra = [...this.bannerExtra.filter((x) => attachmentKey(x.type, x.id) !== key), { ...a }];
    this.set({});
    return () => this.detachFromBanner(key);
  }

  /** Remove run-time attachments by key (`type:id`) or by origin (a module / plugin id). */
  detachFromBanner(keyOrOrigin: string): void {
    const before = this.bannerExtra.length;
    this.bannerExtra = this.bannerExtra.filter((x) => attachmentKey(x.type, x.id) !== keyOrOrigin && x.origin !== keyOrOrigin);
    if (this.bannerExtra.length !== before) this.set({});
  }

  /** The banner to draw: its data (null = no banner or hidden) and where every attachment goes. */
  banner(): { data: Asset<'banner'>['data'] | null; placed: PlacedBanner } {
    const b = this.slotHidden('banner') ? null : this.assetOrNull('banner')?.data ?? null;
    const placed = placeAttachments(b, b ? this.bannerExtra : [], (t, id) => this.registry.has(t as AssetType, id));
    return { data: b, placed };
  }

  /** Pop a short message out of a banner attachment for `ms` (default 5 s), e.g. a status badge on load. */
  showBannerPopup(key: string, text: string, ms = 5000): void {
    if (this.bannerPopupTimer) clearTimeout(this.bannerPopupTimer);
    this.set({ bannerPopup: { key, text, until: Date.now() + ms } });
    this.bannerPopupTimer = setTimeout(() => { this.bannerPopupTimer = null; this.set({ bannerPopup: null }); }, ms);
  }

  /** Hot-swap the active asset of a slot. `target` = asset id | "next" | "prev" | "random". */
  swap(type: AssetType, target: string): boolean {
    const need = type === 'uac-policy' ? 'uac.manage' : 'assets.swap';
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
    } else next = target;
    if (!next || !this.registry.has(type, next)) {
      this.terminal.error('hot-swap', `${type} → "${target}": no such asset`);
      this.toast(`No ${type} asset with id "${target}".`, 'warning', 'Swap failed');
      return false;
    }
    if (next === this.state.active[type]) return true;
    this.terminal.ok('hot-swap', `${type}: ${this.state.active[type]} → ${next}`);

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
    return true;
  }

  swapAll(targets: Partial<ActiveAssets>) {
    const active = { ...this.state.active };
    for (const [t, id] of Object.entries(targets) as [AssetType, string][]) {
      if (t !== 'uac-policy' && this.registry.has(t, id)) active[t] = id;
    }
    this.set({ active, swaps: this.state.swaps + 1 }, true);
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

  /* ---------------- hidden slots (core/engines/hide.ts) ---------------- */

  /** Is this slot hidden? Only hideable types (the chrome) can be. */
  slotHidden(type: AssetType): boolean {
    return hideable(type) && this.settings.get(HIDE_KEY(type)) === true;
  }

  /** Every hidden slot. */
  hiddenSlots(): AssetType[] {
    const o: Record<string, boolean> = {};
    for (const t of ASSET_TYPES) if (this.settings.get(HIDE_KEY(t)) === true) o[t] = true;
    return hiddenSlots(o) as AssetType[];
  }

  /** Hide or show a slot's chrome. Ignored for types that aren't hideable. */
  setSlotHidden(type: AssetType, hidden: boolean): void {
    if (!hideable(type) || this.slotHidden(type) === hidden) return;
    if (!this.can('assets.swap')) return this.toast('Your role cannot change the layout.', 'danger', 'Permission denied');
    if (hidden) this.settings.set(HIDE_KEY(type), true);
    else this.settings.clear(HIDE_KEY(type));
    if (hidden && type === 'context-menu') this.closeContext();
    this.terminal.ok('hot-swap', `${type} ${hidden ? 'hidden' : 'shown'}`);
    this.set({});
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
    const active = { ...this.manifest.defaults };
    for (const t of ASSET_TYPES) if (!this.registry.has(t, active[t])) active[t] = this.registry.list(t)[0]?.id ?? '';
    const policy = this.registry.get('uac-policy', active['uac-policy'])!.data;
    this.set({ active, role: policy.defaultRole, swaps: this.state.swaps + 1 }, true);
  }

  importAsset(raw: unknown, activate = true, origin?: string): ValidationResult {
    if (!this.can('assets.import')) {
      return { ok: false, errors: ['Your role needs "assets.import" to import assets.'] };
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
    return hasPermission(this.permissions(), perm);
  }

  gate(requires?: string): Gate {
    return gateFor(this.asset('uac-policy').data, this.permissions(), requires);
  }

  setRole(id: string) {
    const policy = this.asset('uac-policy').data;
    if (!policy.roles.some((r) => r.id === id)) return;
    this.set({ role: id }, true);
    this.toast(`Now acting as ${policy.roles.find((r) => r.id === id)!.label}.`, 'info', 'Role switched');
  }

  /* ---------------- views & overlays ---------------- */

  navigate(view: string) {
    this.set({ view, context: null });
  }

  openDialog(id: string, props?: Record<string, unknown>) {
    this.set({ dialog: { id, props }, context: null });
  }

  closeDialog() {
    this.set({ dialog: null });
  }

  toast(message: string, kind: Toast['kind'] = 'info', title?: string) {
    const popup = this.asset('popup').data;
    const t: Toast = { id: ++this.toastSeq, kind, title, message };
    const toasts = [...this.state.toasts, t].slice(-popup.maxVisible);
    this.set({ toasts });
    if (popup.duration > 0) setTimeout(() => this.dismissToast(t.id), popup.duration);
  }

  dismissToast(id: number) {
    if (!this.state.toasts.some((t) => t.id === id)) return;
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  openContext(x: number, y: number, target: string, payload?: string) {
    if (this.slotHidden('context-menu')) return;
    this.set({ context: { x, y, target, payload } });
  }

  closeContext() {
    if (this.state.context) this.set({ context: null });
  }

  dispatch(spec: string, ctx: Omit<ActionContext, 'runtime'> = {}): boolean {
    return this.actions.dispatch(spec, { runtime: this, ...ctx });
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
    ];
    const vars: VarMap = {
      ...colorThemeVars(color),
      ...styleThemeVars(this.asset('style-theme').data, this.spacing()),
      ...layoutVars(this.asset('layout').data, this.hiddenSlots()),
      ...bannerVars(this.assetOrNull('banner')?.data, this.slotHidden('banner')),
    };
    const attrs: Record<string, string> = { 'data-fx-scheme': color.scheme };
    for (const p of parts) {
      Object.assign(vars, p.vars);
      Object.assign(attrs, p.attrs);
    }
    return { vars, attrs };
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
    a.register('slot.hide', ([type, v]) => {
      if (type && (ASSET_TYPES as readonly string[]).includes(type)) this.setSlotHidden(type as AssetType, v !== 'off');
    }, { label: 'Hide or show a slot', requires: 'assets.swap', params: true });
    // spacing:tight|compact|regular (Settings → Appearance → Spacing)
    a.register('spacing', ([v]) => { if (v) this.setSpacing(spacingOf(v) === v ? (v as Spacing) : this.spacing()); }, { label: 'Change spacing (tight, compact, regular)', params: true });
    a.register('assets.reset', () => this.reset(), { label: 'Reset to defaults' });
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
    a.register('windows.focus', ([w]) => w && wm.focus(w), { label: 'Focus window', params: true });
    a.register('windows.openFloating', ([kind = 'placeholder', title = 'Window', payload = '']) => wm.openFloating([{ id: `tab-${Date.now()}`, title, kind, payload }], title), { label: 'Open floating window', searchable: false });
    a.register('terminal.open', ([channel = '']) => wm.openFloating([{ id: `terminal-${Date.now()}`, title: 'Output', kind: 'terminal', payload: channel, icon: 'terminal' }], 'Output terminal', 'floating', 520, 320), { label: 'Open output terminal' });
    a.register('terminal.dialog', ([channel = '']) => this.openDialog('terminal', { channel }), { label: 'Output terminal (dialog)' });
    this.contextExtras.set('tab-group', () => wm.groupMenu());
    this.contextExtras.set('window-title', () => wm.windowMenu());
  }
}

export function createAxf(opts: AxfRuntimeOptions): AxfRuntime {
  const rt = new AxfRuntime(opts);
  // Expose the runtime as a cross-application API (devtools, MCP bridges, other AmberX AXF apps in the page).
  (globalThis as unknown as { AXF?: AxfRuntime }).AXF = rt;
  return rt;
}
