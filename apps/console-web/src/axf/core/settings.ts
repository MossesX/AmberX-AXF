/*
 * Settings contract + store (web port). Mirrors the Android kernel's SettingsGroup / SettingSpec
 * (axf-kernel contract/Contracts.kt) so a settings schema means the same thing on every port.
 *
 * Libraries and plugins contribute groups (schema → generated UI) and panels (custom UI) to settings
 * tabs; the settings library renders them. Values persist per app in localStorage, except `secret`
 * settings, which the framework never stores (an owner handles them through `onChange`).
 */

export type SettingKind =
  | 'toggle' | 'text' | 'secret' | 'number' | 'slider' | 'choice' | 'multi_choice'
  | 'color' | 'asset_slot' | 'action' | 'link' | 'section' | 'custom';

export type SettingScope = 'app' | 'user' | 'device' | 'role' | 'remote_locked';

export type SettingValue = string | number | boolean | string[] | null;

/** One setting. `key` is namespaced (e.g. `axf.display.fontScale`); `kind` drives the generated control. */
export interface SettingSpec {
  key: string;
  label: string;
  kind: SettingKind;
  description?: string;
  default?: SettingValue;
  scope?: SettingScope;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** asset_slot: the asset type · action: the action spec · link: the view id */
  target?: string;
  /** UAC permission needed to change it */
  requires?: string;
  icon?: string;
  restartRequired?: boolean;
}

/** A group of settings shown as one card. `tab` picks the settings tab (default `general`). */
export interface SettingsGroup {
  id: string;
  label: string;
  icon?: string;
  module?: string;
  order?: number;
  description?: string;
  tab?: string;
  settings: SettingSpec[];
}

/** A settings tab. The settings library declares the standard ones; anyone may add more. */
export interface SettingsTab {
  id: string;
  label: string;
  icon: string;
  order: number;
  description?: string;
}

/** Custom UI inside a tab (a framework-agnostic render function; the React layer calls it). */
export interface SettingsPanel {
  id: string;
  tab: string;
  title: string;
  icon?: string;
  order?: number;
  module?: string;
  render: () => unknown;
}

type Listener = () => void;

/** Groups, panels, tabs and values. Observable, so the UI re-renders when anything is contributed or changed. */
export class SettingsRegistry {
  private readonly groups = new Map<string, SettingsGroup>();
  private readonly panels = new Map<string, SettingsPanel>();
  private readonly tabs = new Map<string, SettingsTab>();
  private readonly values: Record<string, SettingValue>;
  private readonly secrets: Record<string, SettingValue> = {};
  private readonly listeners = new Set<Listener>();
  private readonly watchers = new Map<string, Set<(value: SettingValue) => void>>();
  private rev = 0;

  constructor(private readonly storageKey: string) {
    this.values = readValues(storageKey);
  }

  /* ---- contributions ---- */

  addTab(tab: SettingsTab): void { this.tabs.set(tab.id, tab); this.changed(); }
  addGroup(group: SettingsGroup): void { this.groups.set(group.id, group); this.changed(); }
  removeGroup(id: string): void { if (this.groups.delete(id)) this.changed(); }
  addPanel(panel: SettingsPanel): void { this.panels.set(panel.id, panel); this.changed(); }
  removePanel(id: string): void { if (this.panels.delete(id)) this.changed(); }

  /** Remove every group and panel a module contributed (a plugin was disabled). */
  removeModule(module: string): void {
    let changed = false;
    for (const [id, g] of this.groups) if (g.module === module) { this.groups.delete(id); changed = true; }
    for (const [id, p] of this.panels) if (p.module === module) { this.panels.delete(id); changed = true; }
    if (changed) this.changed();
  }

  listTabs(): SettingsTab[] { return [...this.tabs.values()].sort((a, b) => a.order - b.order); }
  groupsIn(tab: string): SettingsGroup[] {
    return [...this.groups.values()].filter((g) => (g.tab ?? 'general') === tab).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  panelsIn(tab: string): SettingsPanel[] {
    return [...this.panels.values()].filter((p) => p.tab === tab).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  spec(key: string): SettingSpec | undefined {
    for (const g of this.groups.values()) for (const s of g.settings) if (s.key === key) return s;
    return undefined;
  }

  /* ---- values ---- */

  get(key: string): SettingValue {
    const spec = this.spec(key);
    const store = spec?.kind === 'secret' ? this.secrets : this.values;
    return Object.hasOwn(store, key) ? store[key]! : spec?.default ?? null;
  }

  set(key: string, value: SettingValue): void {
    const spec = this.spec(key);
    if (spec?.kind === 'secret') {
      this.secrets[key] = value;
    } else {
      this.values[key] = value;
      writeValues(this.storageKey, this.values);
    }
    for (const w of this.watchers.get(key) ?? []) w(value);
    this.changed();
  }

  /** Forget a value (back to its default). */
  clear(key: string): void {
    delete this.values[key];
    delete this.secrets[key];
    writeValues(this.storageKey, this.values);
    for (const w of this.watchers.get(key) ?? []) w(this.get(key));
    this.changed();
  }

  /** Call `fn` whenever `key` changes. Returns an unsubscribe function. */
  onChange(key: string, fn: (value: SettingValue) => void): () => void {
    const set = this.watchers.get(key) ?? new Set();
    set.add(fn);
    this.watchers.set(key, set);
    return () => { set.delete(fn); };
  }

  /* ---- observable ---- */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getRevision = (): number => this.rev;

  private changed(): void {
    this.rev += 1;
    for (const l of this.listeners) l();
  }
}

function readValues(key: string): Record<string, SettingValue> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, SettingValue>) : {};
  } catch {
    return {};
  }
}

function writeValues(key: string, values: Record<string, SettingValue>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(values));
  } catch {
    /* storage unavailable: values last for this session only */
  }
}
