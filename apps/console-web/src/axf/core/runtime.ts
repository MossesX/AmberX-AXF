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
import { OutputTerminal } from './terminal';
import {
  ASSET_TYPES,
  type ActiveAssets,
  type Asset,
  type AssetType,
  type AxfManifest,
  type AxfState,
  type Gate,
  type Toast,
} from './types';
import { assetTypeSpecs, type ValidationResult } from './validate';

export interface AxfRuntimeOptions {
  manifest: AxfManifest;
  assets: unknown[];
  /** localStorage key for persisting the user's hot-swap choices */
  storageKey?: string;
}

type Persisted = { active?: Partial<ActiveAssets>; role?: string };

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
  /** Extra context-menu items apps contribute per target (e.g. `tab-group`, `window-title`); `{payload}` in actions is substituted. */
  readonly contextExtras = new Map<string, () => import('./engines/windows').MenuEntry[]>();
  /** Nav sections contributed by libraries and plugins (keyed, so re-adding replaces). Shown after the nav-menu asset's sections. */
  private readonly navSections = new Map<string, NavExtraSection>();
  /** Settings schema, panels and values (see settings.ts); the settings library renders them. */
  readonly settings: SettingsRegistry;
  /** Libraries installed with installLibraries, for the settings About / Plugins tabs. */
  readonly libraries: { id: string; label: string; version: string; template?: string }[] = [];
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
    for (const raw of opts.assets) {
      const r = this.registry.register(raw, 'builtin');
      if (!r.ok) this.loadErrors.push({ id: String((raw as { id?: string })?.id), errors: r.errors });
    }
    const saved = safeStorage.get(this.storageKey);
    const active = {} as ActiveAssets;
    for (const t of ASSET_TYPES) {
      const candidates = [saved?.active?.[t], opts.manifest.defaults[t], this.registry.list(t)[0]?.id];
      const pick = candidates.find((id) => id && this.registry.has(t, id));
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

  private set(patch: Partial<AxfState>, persist = false) {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1 };
    if (persist) safeStorage.set(this.storageKey, { active: this.state.active, role: this.state.role });
    for (const l of this.listeners) l();
  }

  /* ---------------- assets ---------------- */

  asset<K extends AssetType>(type: K): Asset<K> {
    return this.registry.get(type, this.state.active[type])!;
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

  randomize() {
    if (!this.can('assets.swap')) return this.toast('Your role cannot swap assets.', 'danger', 'Permission denied');
    const targets: Partial<ActiveAssets> = {};
    for (const t of ASSET_TYPES) {
      const list = this.registry.list(t);
      targets[t] = list[Math.floor(Math.random() * list.length)]?.id;
    }
    this.swapAll(targets);
  }

  reset() {
    const active = { ...this.manifest.defaults };
    for (const t of ASSET_TYPES) if (!this.registry.has(t, active[t])) active[t] = this.registry.list(t)[0]!.id;
    const policy = this.registry.get('uac-policy', active['uac-policy'])!.data;
    this.set({ active, role: policy.defaultRole, swaps: this.state.swaps + 1 }, true);
  }

  importAsset(raw: unknown, activate = true): ValidationResult {
    if (!this.can('assets.import')) {
      return { ok: false, errors: ['Your role needs "assets.import" to import assets.'] };
    }
    const r = this.registry.register(raw, 'imported');
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
      ...styleThemeVars(this.asset('style-theme').data),
      ...layoutVars(this.asset('layout').data),
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
    }, { label: 'Swap asset' });
    a.register('nav', ([view]) => view && this.navigate(view), { label: 'Navigate' });
    a.register('dialog', ([id, ...rest]) => id && this.openDialog(id, rest.length ? { arg: rest.join(':') } : undefined), { label: 'Open dialog' });
    a.register('toast', ([kind = 'info', ...msg]) => this.toast(msg.join(':') || 'Hello from AmberX AXF', kind as Toast['kind']), { label: 'Show toast' });
    a.register('role', ([id]) => id && this.setRole(id), { label: 'Switch role' });
    a.register('assets.random', () => this.randomize(), { label: 'Randomize assets', requires: 'assets.swap' });
    a.register('assets.reset', () => this.reset(), { label: 'Reset to defaults' });
    a.register('asset.json', ([type, id]) => this.openDialog('asset-json', { type, id }), { label: 'View asset JSON' });
    a.register('asset.copy', ([type, id]) => {
      const json = type && id ? this.exportAsset(type as AssetType, id) : '';
      navigator.clipboard?.writeText(json).then(
        () => this.toast('Asset JSON copied to clipboard.', 'success', 'Copied'),
        () => this.toast('Clipboard is not available here.', 'warning'),
      );
    }, { label: 'Copy asset JSON' });
    a.register('noop', () => {}, { label: 'Nothing' });
    // windowing engine
    const wm = this.windows;
    a.register('windows.undock', ([g]) => g && wm.undock(g), { label: 'Undock tab group' });
    a.register('windows.split', ([g, mode = 'vertical', r = '2', c = '2']) => g && wm.split(g, mode as import('./engines/windows').SplitMode, Number(r), Number(c)), { label: 'Split tab group' });
    a.register('windows.closeGroup', ([g]) => g && wm.closeGroup(g), { label: 'Close tab group' });
    a.register('windows.redock', ([w]) => w && wm.redock(w), { label: 'Redock window' });
    a.register('windows.close', ([w]) => w && wm.close(w), { label: 'Close window' });
    a.register('windows.minimizeCorner', ([w]) => w && wm.minimizeToNextCorner(w), { label: 'Minimize to corner' });
    a.register('windows.minimizeToolbar', ([w, x = '24', y = '24']) => w && wm.minimize(w, 'floating-toolbar', Number(x), Number(y)), { label: 'Minimize to floating toolbar' });
    a.register('windows.restore', ([w]) => w && wm.restore(w), { label: 'Restore window' });
    a.register('windows.focus', ([w]) => w && wm.focus(w), { label: 'Focus window' });
    a.register('windows.openFloating', ([kind = 'placeholder', title = 'Window', payload = '']) => wm.openFloating([{ id: `tab-${Date.now()}`, title, kind, payload }], title), { label: 'Open floating window' });
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
