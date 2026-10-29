/**
 * Plugins menu, the pure part (no React, no fetch): the right-click "Plugins" submenu, the settings browser's own
 * parameters, the placeholder parameter catalogue and the installer's list rules. test.mts replays these.
 */

export const ID = 'ai.amberx.axf.console.plugins-menu';
export const FOLDER = 'plugins-menu';
export const SETTINGS_DIALOG = 'plugins-menu.settings';
export const INSTALL_DIALOG = 'plugins-menu.install';
export const TAB = 'plugins-menu';
/** The settings browser's own settings (rt.settings keys). */
export const K = {
  column: 'plugins-menu.column.width',
  collapsed: 'plugins-menu.column.collapsed',
  side: 'plugins-menu.column.side',
  density: 'plugins-menu.style.density',
  badges: 'plugins-menu.style.badges',
  icons: 'plugins-menu.style.icons',
  showOff: 'plugins-menu.list.showOff',
  showBare: 'plugins-menu.list.showBare',
  search: 'plugins-menu.list.search',
  remember: 'plugins-menu.behaviour.remember',
  onOpen: 'plugins-menu.behaviour.onOpen',
  sort: 'plugins-menu.behaviour.sort',
  last: 'plugins-menu.last',
  /** the ladder's Disable item: 'check' (a check mark while the plugin is off) or 'toggle' (Disable / Enable, no check mark) */
  disableStyle: 'plugins-menu.ladder.disableStyle',
} as const;

export interface PluginRow {
  folder: string; name: string; enabled: boolean; model?: string; builtAt?: string; version?: string;
  /** its settings tab (registered only while it is on) */
  tab?: string; problem?: string | null;
}

export interface MenuEntry { id: string; label?: string; icon?: string; action?: string; separator?: boolean; items?: MenuEntry[] }

/** The right-click "Plugins" submenu: Install, Settings, Manage, Enable ▸ (switched-off plugins), Disable ▸ (switched-on). */
export function pluginsSubmenu(rows: PluginRow[], opts: { manage?: string; self?: string } = {}): MenuEntry {
  const self = opts.self ?? FOLDER;
  const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const off = byName.filter((r) => !r.enabled);
  const on = byName.filter((r) => r.enabled && r.folder !== self);
  const none = (id: string, label: string): MenuEntry => ({ id, label, icon: 'check' });
  return {
    id: 'plugins', label: 'Plugins', icon: 'package', items: [
      { id: 'plugins.install', label: 'Install…', icon: 'download', action: 'plugins-menu.install' },
      { id: 'plugins.settings', label: 'Settings…', icon: 'settings', action: 'plugins-menu.settings' },
      { id: 'plugins.manage', label: 'Manage', icon: 'sliders', action: opts.manage ?? 'plugins-menu.manage' },
      { id: 'plugins.s1', separator: true },
      { id: 'plugins.enable', label: `Enable${off.length ? ` (${off.length})` : ''}`, icon: 'play', items: off.length
        ? off.map((r) => ({ id: `plugins.enable.${r.folder}`, label: r.name, icon: 'play', action: `plugins-menu.enable:${r.folder}` }))
        : [none('plugins.enable.none', 'Every plugin is on')] },
      { id: 'plugins.disable', label: `Disable${on.length ? ` (${on.length})` : ''}`, icon: 'pause', items: on.length
        ? on.map((r) => ({ id: `plugins.disable.${r.folder}`, label: r.name, icon: 'pause', action: `plugins-menu.disable:${r.folder}` }))
        : [none('plugins.disable.none', 'Every plugin is off')] },
    ],
  };
}

export type SortKey = 'name' | 'model' | 'enabled' | 'built';

/** The settings browser's column: filtered and sorted by its own settings. */
export function columnRows(rows: PluginRow[], o: { showOff: boolean; showBare: boolean; sort: SortKey; q?: string }): PluginRow[] {
  const q = (o.q ?? '').trim().toLowerCase();
  const out = rows.filter((r) => (o.showOff || r.enabled) && (o.showBare || !r.enabled || !!r.tab) && (!q || `${r.name} ${r.folder}`.toLowerCase().includes(q)));
  const cmp: Record<SortKey, (a: PluginRow, b: PluginRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    model: (a, b) => (a.model ?? '~').localeCompare(b.model ?? '~') || a.name.localeCompare(b.name),
    enabled: (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
    built: (a, b) => (b.builtAt ?? '').localeCompare(a.builtAt ?? '') || a.name.localeCompare(b.name),
  };
  return out.sort(cmp[o.sort] ?? cmp.name);
}

/** Which plugin the browser shows when it opens. */
export function initialPick(rows: PluginRow[], o: { onOpen: string; remember: boolean; last?: string; asked?: string }): string {
  if (o.asked && rows.some((r) => r.folder === o.asked)) return o.asked;
  if (o.onOpen === 'self') return FOLDER;
  if (o.onOpen === 'last' && o.remember && o.last && rows.some((r) => r.folder === o.last)) return o.last;
  if (o.onOpen === 'none') return '';
  return rows[0]?.folder ?? '';
}

/**
 * Every feasible parameter / token type a plugin setting could take (Brett, Oct 23 2026: "all advanced parameters and
 * every single feasible token or parameter type has placeholders"). `built` = the settings library renders it today
 * (SettingKind); the rest are placeholders the browser shows greyed out until a kind is built for them.
 */
export interface ParamType { id: string; label: string; group: 'value' | 'choice' | 'style' | 'reference' | 'structured' | 'time' | 'security'; built: boolean; example: string }
export const PARAM_TYPES: ParamType[] = [
  { id: 'toggle', label: 'Switch (boolean)', group: 'value', built: true, example: 'on / off' },
  { id: 'text', label: 'Text', group: 'value', built: true, example: 'a word or sentence' },
  { id: 'number', label: 'Number', group: 'value', built: true, example: '42' },
  { id: 'slider', label: 'Range (slider)', group: 'value', built: true, example: '0 – 100' },
  { id: 'choice', label: 'One of a list', group: 'choice', built: true, example: 'compact / regular' },
  { id: 'multi_choice', label: 'Several of a list', group: 'choice', built: true, example: 'tags' },
  { id: 'color', label: 'Colour', group: 'style', built: true, example: 'a picked colour' },
  { id: 'secret', label: 'Secret (kept on the device)', group: 'security', built: true, example: '••••' },
  { id: 'asset_slot', label: 'Asset pick', group: 'reference', built: true, example: 'style-theme' },
  { id: 'action', label: 'Action button', group: 'reference', built: true, example: 'run something' },
  { id: 'link', label: 'Link to a page', group: 'reference', built: true, example: 'open a view' },
  { id: 'integer', label: 'Whole number with step', group: 'value', built: false, example: '1, 2, 3' },
  { id: 'percent', label: 'Percentage', group: 'value', built: false, example: '75 %' },
  { id: 'multiline', label: 'Long text', group: 'value', built: false, example: 'paragraphs' },
  { id: 'markdown', label: 'Markdown', group: 'value', built: false, example: '**bold**' },
  { id: 'code', label: 'Code / script', group: 'structured', built: false, example: 'snippet' },
  { id: 'json', label: 'JSON object', group: 'structured', built: false, example: '{ "a": 1 }' },
  { id: 'list', label: 'List of values', group: 'structured', built: false, example: 'a, b, c' },
  { id: 'map', label: 'Key → value table', group: 'structured', built: false, example: 'name = value' },
  { id: 'record', label: 'Record (several fields)', group: 'structured', built: false, example: 'host + port' },
  { id: 'regex', label: 'Pattern (regex)', group: 'structured', built: false, example: '^v\\d+' },
  { id: 'expression', label: 'Expression / formula', group: 'structured', built: false, example: 'count > 3' },
  { id: 'token', label: 'Theme token', group: 'style', built: false, example: '--fx-accent' },
  { id: 'font', label: 'Font family', group: 'style', built: false, example: 'Inter' },
  { id: 'font-size', label: 'Font size', group: 'style', built: false, example: '14 px' },
  { id: 'spacing', label: 'Spacing', group: 'style', built: false, example: '8 px' },
  { id: 'radius', label: 'Corner radius', group: 'style', built: false, example: '6 px' },
  { id: 'opacity', label: 'Opacity', group: 'style', built: false, example: '0.6' },
  { id: 'shadow', label: 'Shadow', group: 'style', built: false, example: 'raised' },
  { id: 'gradient', label: 'Gradient', group: 'style', built: false, example: 'accent → info' },
  { id: 'border', label: 'Border', group: 'style', built: false, example: '1 px solid' },
  { id: 'icon', label: 'Icon pick', group: 'style', built: false, example: 'package' },
  { id: 'image', label: 'Image', group: 'reference', built: false, example: 'logo.png' },
  { id: 'file', label: 'File', group: 'reference', built: false, example: 'upload' },
  { id: 'path', label: 'Path on the server', group: 'reference', built: false, example: '/srv/data' },
  { id: 'url', label: 'Web address', group: 'reference', built: false, example: 'https://…' },
  { id: 'plugin', label: 'Another plugin', group: 'reference', built: false, example: 'another-plugin' },
  { id: 'service', label: 'Capability service', group: 'reference', built: false, example: 'axf.llm@1' },
  { id: 'asset', label: 'Asset (any type)', group: 'reference', built: false, example: 'banner/amberx-thin' },
  { id: 'view', label: 'Page', group: 'reference', built: false, example: 'some-page' },
  { id: 'keybinding', label: 'Keyboard shortcut', group: 'reference', built: false, example: 'Ctrl+K' },
  { id: 'breakpoint', label: 'Screen size', group: 'style', built: false, example: 'phone ≤ 480 px' },
  { id: 'duration', label: 'Duration', group: 'time', built: false, example: '30 s' },
  { id: 'date', label: 'Date', group: 'time', built: false, example: '2026-10-23' },
  { id: 'time', label: 'Time of day', group: 'time', built: false, example: '09:00' },
  { id: 'schedule', label: 'Schedule (cron)', group: 'time', built: false, example: 'every hour' },
  { id: 'credential', label: 'Credential (kept on the server)', group: 'security', built: false, example: 'token' },
  { id: 'permission', label: 'Permission', group: 'security', built: false, example: 'console.plugin.x' },
  { id: 'role', label: 'Role', group: 'security', built: false, example: 'admin' },
];
export const PARAM_GROUPS: Record<ParamType['group'], string> = {
  value: 'Values', choice: 'Choices', style: 'Style and tokens', reference: 'References', structured: 'Structured data', time: 'Time', security: 'Security',
};

/** The installer's list: sorted by its own setting. */
export interface CatalogRow { folder: string; name: string; archive: string; archiveLabel?: string; version: string; model?: string | null; publishedAt?: string; installed?: string | null; clash?: string | null }
export function sortCatalog(rows: CatalogRow[], sort: string): CatalogRow[] {
  const by: Record<string, (a: CatalogRow, b: CatalogRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name) || a.archive.localeCompare(b.archive),
    archive: (a, b) => a.archive.localeCompare(b.archive) || a.name.localeCompare(b.name),
    newest: (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.name.localeCompare(b.name),
    model: (a, b) => (a.model ?? '~').localeCompare(b.model ?? '~') || a.name.localeCompare(b.name),
  };
  return [...rows].sort(by[sort] ?? by.name);
}

/** What the installer's button says for a catalog row. */
export function installAction(r: CatalogRow & { otherModel?: boolean; readOnly?: boolean }): { kind: 'install' | 'update' | 'replace' | 'installed' | 'blocked' | 'readOnly'; label: string } {
  if (r.readOnly) return { kind: 'readOnly', label: 'Not for this console' };
  if (r.clash) return { kind: 'blocked', label: 'Already installed as another build' };
  if (r.otherModel) return { kind: 'replace', label: 'Replace…' };
  if (!r.installed) return { kind: 'install', label: 'Install' };
  const cmp = compareVersions(r.version, r.installed);
  return cmp > 0 ? { kind: 'update', label: `Update to ${r.version}` } : { kind: 'installed', label: 'Installed' };
}

export function compareVersions(a: string, b: string): number {
  const n = (v: string) => v.split(/[-+]/, 1)[0]!.split('.').map((x) => Number(x) || 0);
  const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

/* ------------------------------------------------------------------ the Plugins ladder (application menu) */

/** Live list behind Plugins ▸ All plugins (application menu). */
export const LADDER = 'plugins-menu.ladder';
export const INFO_DIALOG = 'plugins-menu.info';
/** Counter that is 1 while a plugin is switched off (drives the Disable check mark). */
export const offCounter = (folder: string) => `plugins-menu.off:${folder}`;

export interface LadderPlugin {
  folder: string; name: string; enabled: boolean; icon?: string;
  /** what Interface runs: its first page, dialog or own menu entry (none = greyed) */
  ui?: string;
  /** its settings tab */
  tab?: string;
}
export interface LadderItem { id: string; label: string; icon?: string; action?: string; checked?: string; separator?: boolean; items?: LadderItem[] }

/**
 * One submenu per plugin (sorted by name): Interface, Settings, Documentation, About, then Disable. The Disable item
 * is a check mark (checked while off) or a plain Disable / Enable toggle, per `style`. A plugin can't switch off the
 * menu it lives in (`self`), and nothing switches while the console API is offline.
 */
export function ladderItems(list: LadderPlugin[], o: { style: 'check' | 'toggle'; self?: string; offline?: boolean }): LadderItem[] {
  const self = o.self ?? FOLDER;
  return [...list].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const sub = `plugins-menu.ladder.${p.folder}`;
    const off = !p.enabled;
    const disable: LadderItem = p.folder === self
      ? { id: `${sub}.disable`, label: "Can't switch itself off", icon: 'lock' }
      : o.offline
        ? { id: `${sub}.disable`, label: 'Disable (console offline)', icon: 'lock' }
        : o.style === 'check'
          ? { id: `${sub}.disable`, label: 'Disable', icon: 'pause', action: `plugins-menu.toggle:${p.folder}`, checked: `counter:${offCounter(p.folder)}` }
          : { id: `${sub}.disable`, label: off ? 'Enable' : 'Disable', icon: off ? 'play' : 'pause', action: `plugins-menu.toggle:${p.folder}` };
    return {
      id: sub, label: off ? `${p.name} (off)` : p.name, icon: p.icon ?? 'package', items: [
        { id: `${sub}.ui`, label: p.ui && !off ? 'Interface' : off ? 'Interface (switched off)' : 'Interface (none)', icon: 'layout', ...(p.ui && !off ? { action: p.ui } : {}) },
        { id: `${sub}.settings`, label: p.tab && !off ? 'Settings' : 'Settings (none)', icon: 'settings', ...(p.tab && !off ? { action: `settings.open:${p.tab}` } : {}) },
        { id: `${sub}.docs`, label: 'Documentation', icon: 'file', action: `plugins-menu.info:${p.folder}:docs` },
        { id: `${sub}.about`, label: 'About', icon: 'info', action: `plugins-menu.info:${p.folder}:about` },
        { id: `${sub}.s1`, label: '', separator: true },
        disable,
      ],
    };
  });
}
