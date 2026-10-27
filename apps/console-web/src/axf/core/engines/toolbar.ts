/*
 * toolbar-binding@1 (Oct 27 2026, Brett): a toolbar asset can be ATTACHED to any element (a list, grid, chart, image …)
 * so its items act on that element, and BOUND to a plugin so its look settings appear in that plugin's settings tab.
 *
 *   data.attach = { target, kind, at?, order? }   the element it controls (pages register it: rt.registerAttachTarget)
 *   data.owner  = { kind, plugin?, app?, settingsTab? }   who ships it; a plugin toolbar names its plugin + attach
 *   items[].kind  action | toggle | sort | filter   items[].value   items[].count (a count the element supplies)
 *   data.itemStyle  button | tile | chip            data.label  (text before the items)
 *
 * Rules (one definition: asset-types.json → types.toolbar.binding): mirrored by the CLI validator
 * (framework/cli/build-engine.mjs → validateToolbarBinding) and the Pydantic model
 * (framework/python/axf/contracts/toolbar.py); all three replay spec/fixtures/toolbar-binding.json.
 * Kotlin twin deferred (Android on hold): framework/spec/PORTING.md.
 */
import spec from '../../schemas/asset-types.json';

export interface ToolbarBindingSpec {
  owners: string[];
  attachKinds: string[];
  attachAt: string[];
  itemKinds: string[];
  kindPattern: string;
  targetPattern: string;
  pluginPattern: string;
  countPattern: string;
  settingsFields: string[];
}

export const TOOLBAR_BINDING = (spec.types.toolbar as unknown as { binding: ToolbarBindingSpec }).binding;

export type ToolbarItemKind = 'action' | 'toggle' | 'sort' | 'filter';
export type ToolbarItemStyle = 'button' | 'tile' | 'chip';

/** The element a toolbar controls. `kind` is an open registry (TOOLBAR_BINDING.attachKinds are the known ones). */
export interface ToolbarAttach {
  target: string;
  kind: string;
  at?: 'top' | 'bottom' | 'start' | 'end' | 'overlay';
  order?: number;
}

/** Who ships the toolbar. A plugin toolbar must name its plugin (and attach); its settings join that plugin's tab. */
export interface ToolbarOwner {
  kind: 'app' | 'plugin' | 'library' | 'framework';
  plugin?: string;
  app?: string;
  settingsTab?: string;
}

/** What an attached element is asked to do when an item is picked. */
export interface ToolbarItemCall {
  toolbar: string;
  item: string;
  kind: ToolbarItemKind;
  action: string;
  value?: string;
}

/** How an item looks right now, as the attached element sees it. */
export interface ToolbarItemState {
  /** pressed / on (sort key in use, filter on, toggle on) */
  active?: boolean;
  /** sort direction while active */
  dir?: 'asc' | 'desc';
  /** the corner badge (items[].count); hidden at 0 */
  count?: number;
  disabled?: boolean;
  /** replaces the item's label (e.g. "Pending only") */
  label?: string;
}

/**
 * An element a toolbar can attach to. The page that draws the element registers it under the toolbar's
 * `attach.target`.
 */
export interface AttachTarget {
  kind: string;
  label?: string;
  /** handle a picked item; return false to pass it on to the action bus (payload = the target id) */
  run(call: ToolbarItemCall): boolean | void;
  state?(call: ToolbarItemCall): ToolbarItemState | undefined;
}

export interface BindingContext {
  /** validating an asset a plugin ships: it must be a plugin toolbar of this plugin */
  plugin?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const re = (p: string) => new RegExp(p);

/** Every toolbar-binding@1 problem in a toolbar's `data` (empty = fine). Same messages in the CLI and Pydantic. */
export function validateToolbarBinding(data: Record<string, unknown>, ctx: BindingContext = {}): string[] {
  const b = TOOLBAR_BINDING;
  const errors: string[] = [];
  const attach = data.attach;
  const owner = data.owner;

  if ('attach' in data) {
    if (!isObj(attach)) errors.push('data.attach must be an object');
    else {
      if (typeof attach.target !== 'string' || !re(b.targetPattern).test(attach.target)) errors.push(`data.attach.target must match ${b.targetPattern}`);
      if (typeof attach.kind !== 'string' || !re(b.kindPattern).test(attach.kind)) errors.push(`data.attach.kind must match ${b.kindPattern} (known: ${b.attachKinds.join(', ')})`);
      if ('at' in attach && !b.attachAt.includes(attach.at as string)) errors.push(`data.attach.at must be one of: ${b.attachAt.join(', ')}`);
      if ('order' in attach && (typeof attach.order !== 'number' || !Number.isFinite(attach.order))) errors.push('data.attach.order must be a number');
    }
  }

  let ownerKind = 'app';
  if ('owner' in data) {
    if (!isObj(owner)) errors.push('data.owner must be an object');
    else {
      ownerKind = typeof owner.kind === 'string' ? owner.kind : '';
      if (!b.owners.includes(ownerKind)) errors.push(`data.owner.kind must be one of: ${b.owners.join(', ')}`);
      if (ownerKind === 'plugin') {
        if (typeof owner.plugin !== 'string' || !re(b.pluginPattern).test(owner.plugin)) errors.push('a plugin toolbar must name its plugin: data.owner.plugin');
        if (!isObj(attach)) errors.push('a plugin toolbar must name the element it controls: data.attach');
      } else if ('plugin' in owner) errors.push('data.owner.plugin is only for plugin toolbars (owner.kind "plugin")');
      if ('settingsTab' in owner && (typeof owner.settingsTab !== 'string' || !owner.settingsTab)) errors.push('data.owner.settingsTab must be a settings tab id');
      if ('app' in owner && (typeof owner.app !== 'string' || !owner.app)) errors.push('data.owner.app must be a string');
    }
  }

  if (ctx.plugin !== undefined) {
    if (ownerKind !== 'plugin' || !isObj(owner)) errors.push(`toolbar shipped by plugin "${ctx.plugin}" must be a plugin toolbar: data.owner.kind "plugin"`);
    else if (owner.plugin !== ctx.plugin) errors.push(`data.owner.plugin must be "${ctx.plugin}", the plugin that ships it`);
  }

  const groups = Array.isArray(data.groups) ? data.groups : [];
  groups.forEach((g, gi) => {
    const items = isObj(g) && Array.isArray(g.items) ? g.items : [];
    items.forEach((it, ii) => {
      if (!isObj(it)) return;
      const at = `data.groups[${gi}].items[${ii}]`;
      const kind = 'kind' in it ? it.kind : 'action';
      if (!b.itemKinds.includes(kind as string)) errors.push(`${at}.kind must be one of: ${b.itemKinds.join(', ')}`);
      if ('value' in it && typeof it.value !== 'string') errors.push(`${at}.value must be a string`);
      if ('count' in it && (typeof it.count !== 'string' || !re(b.countPattern).test(it.count))) errors.push(`${at}.count must match ${b.countPattern}`);
      const needsTarget = kind !== 'action' || 'count' in it;
      if (needsTarget && !isObj(attach)) errors.push(`${at} acts on the attached element (kind ${String(kind)}${'count' in it ? ', count' : ''}): data.attach is required`);
    });
  });
  return errors;
}

/** Is this toolbar attached to `target`? */
export function attachedTo(data: { attach?: ToolbarAttach }, target: string): boolean {
  return data.attach?.target === target;
}

/** Toolbars attached to one element, at one side, in order (attach.order, then id). */
export function toolbarsAttachedTo<T extends { id: string; data: { attach?: ToolbarAttach } }>(all: T[], target: string, at?: string): T[] {
  return all
    .filter((t) => attachedTo(t.data, target) && (!at || (t.data.attach?.at ?? 'top') === at))
    .sort((a, b) => (a.data.attach?.order ?? 100) - (b.data.attach?.order ?? 100) || a.id.localeCompare(b.id));
}

/** Toolbars a plugin ships (owner.kind plugin, owner.plugin = id). */
export function pluginToolbars<T extends { id: string; data: { owner?: ToolbarOwner } }>(all: T[], plugin: string): T[] {
  return all.filter((t) => t.data.owner?.kind === 'plugin' && t.data.owner.plugin === plugin).sort((a, b) => a.id.localeCompare(b.id));
}

/** The per-device setting key for one of a toolbar's look fields (variant, itemStyle, density, surface, hidden). */
export function toolbarSettingKey(id: string, field: string): string {
  return `axf.toolbar.${id}.${field}`;
}
