/**
 * Quick settings (quick-settings@1; Brett, Nov 13 2026: "every settings interface has a collapsible pane at the very
 * top, header Quick settings, doesn't scroll, everything scrolls underneath it; current skin and override console
 * skin; default assets like navigation menu; it says it's overriding the current skin").
 *
 * Pure rules behind the pane every settings interface draws first (react/components/QuickSettings.tsx): the settings
 * keys it keeps per interface, the default-asset types each kind of interface lists, the override list the notice
 * reads, and the action grammar (`quick.*`) the console API, MCP, CLI and voice all drive.
 *
 * One interface = one scope id (`settings`, `plugin.<tab>`, `chrome.<type>.<instance>`, `banner.<id>`): its skin
 * override is the skin-coverage@1 UI level `ui:qs.<scope>`, its default-asset overrides are a map saved under
 * `axf.quick.<scope>.assets`, its collapsed state under `axf.quick.<scope>.collapsed`. The handle style is one app
 * setting, `axf.quick.handle`.
 */

/** How the collapse handle looks (Settings → Appearance → Quick settings handle). */
export const QUICK_HANDLES = ['arrow', 'chevron', 'bar', 'text'];
export const QUICK_HANDLE_LABEL = { arrow: 'Arrow', chevron: 'Chevron button', bar: 'Grab bar', text: 'Text (Hide / Show)' };
export const QUICK_HANDLE_KEY = 'axf.quick.handle';
export const QUICK_DEFAULT_HANDLE = 'arrow';

/** The default-asset types a quick-settings pane lists, by kind of interface (navigation menu first, as Brett named it). */
export const QUICK_ASSET_TYPES = {
  settings: ['nav-menu', 'toolbar', 'tab-group', 'settings'],
  plugin: ['nav-menu', 'toolbar', 'tab-group', 'settings'],
  chrome: ['toolbar', 'tab-group', 'settings'],
  banner: ['toolbar', 'tab-group', 'settings'],
};
export const QUICK_ASSET_LABEL = { 'nav-menu': 'Navigation menu', toolbar: 'Toolbar', 'tab-group': 'Tab group', settings: 'Settings interface', 'app-menu': 'Menu bar', banner: 'Banner' };

const SCOPE_RE = /^[a-z0-9][a-z0-9._-]{0,100}$/;

/** A scope id from free text (an instance id, a tab id): lower case, unsafe characters folded to '-'. '' = not usable. */
export function quickScopeId(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 100);
  return SCOPE_RE.test(s) ? s : '';
}

export function isQuickScope(v) { return typeof v === 'string' && SCOPE_RE.test(v); }

/** The kind of interface a scope belongs to (decides the asset list). */
export function quickKindOf(scope) {
  const head = String(scope ?? '').split('.')[0];
  return head === 'plugin' || head === 'chrome' || head === 'banner' ? head : 'settings';
}

export function quickAssetTypes(scope) { return QUICK_ASSET_TYPES[quickKindOf(scope)]; }

export const quickCollapsedKey = (scope) => `axf.quick.${scope}.collapsed`;
export const quickAssetsKey = (scope) => `axf.quick.${scope}.assets`;
/** The skin-coverage@1 UI level a scope's "Override console skin" writes to. */
export const quickSkinScopeKey = (scope) => `ui:qs.${scope}`;
/** The UI id <SkinScope kind="ui"> draws the interface under. */
export const quickSkinUiId = (scope) => `qs.${scope}`;

export function quickHandleOf(v) { return QUICK_HANDLES.includes(v) ? v : QUICK_DEFAULT_HANDLE; }

/** The saved asset-override map, kept to the types this scope lists and to string ids. */
export function normalizeQuickAssets(raw, scope) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const types = quickAssetTypes(scope);
  for (const [k, v] of Object.entries(raw)) if (types.includes(k) && typeof v === 'string' && v) out[k] = v;
  return out;
}

/** The map with one type set (id) or cleared (null / '' / 'off'). */
export function setQuickAsset(raw, scope, type, id) {
  const cur = normalizeQuickAssets(raw, scope);
  if (!quickAssetTypes(scope).includes(type)) return cur;
  if (!id || id === 'off' || id === 'default') delete cur[type];
  else cur[type] = id;
  return cur;
}

/**
 * Everything one pane overrides: `{ kind: 'skin', id }` when the interface draws under its own skin, then one
 * `{ kind: 'asset', type, id }` per default-asset override. Empty = the interface follows the console.
 */
export function quickOverrides({ skin = null, assets = {} } = {}) {
  const out = [];
  if (skin && typeof skin === 'string') out.push({ kind: 'skin', id: skin });
  for (const [type, id] of Object.entries(assets ?? {})) if (typeof id === 'string' && id) out.push({ kind: 'asset', type, id });
  return out;
}

/** The notice line: '' when nothing is overridden. */
export function quickNotice(list) {
  const skin = list.some((o) => o.kind === 'skin');
  const assets = list.some((o) => o.kind === 'asset');
  if (!skin && !assets) return '';
  return `This is overriding the current ${skin && assets ? 'skin and defaults' : skin ? 'skin' : 'defaults'}.`;
}

/**
 * The action grammar (one table: console actions, MCP console_action, CLI `axf quick`, voice):
 *   quick.open:<scope>                          open that settings interface at its quick pane
 *   quick.collapse:<scope>:<on|off|toggle>      fold / unfold the pane (remembered)
 *   quick.skin:<scope>:<skin id|off>            override the console skin for this interface only / follow it again
 *   quick.asset:<scope>:<type>:<asset id|off>   override one default asset for this interface / follow the console
 *   quick.reset:<scope>                         drop every override of this interface
 *   quick.handle:<arrow|chevron|bar|text>       the collapse handle style (every pane)
 *   quick.state[:<scope>]                       read: the pane state (returned to the caller)
 */
export const QUICK_ACTIONS = ['quick.open', 'quick.collapse', 'quick.skin', 'quick.asset', 'quick.reset', 'quick.handle', 'quick.state'];

export function parseQuickAction(id, args = []) {
  const [a = '', b = '', c = ''] = args.map((x) => String(x ?? ''));
  switch (id) {
    case 'quick.handle': return QUICK_HANDLES.includes(a) ? { op: 'handle', handle: a } : { error: `handle must be one of ${QUICK_HANDLES.join(', ')}` };
    case 'quick.state': return a && !isQuickScope(a) ? { error: `"${a}" is not a quick-settings scope` } : { op: 'state', scope: a || '' };
  }
  if (!QUICK_ACTIONS.includes(id)) return { error: `unknown action ${id}` };
  if (!isQuickScope(a)) return { error: `"${a}" is not a quick-settings scope (settings, plugin.<tab>, chrome.<type>.<instance>, banner.<id>)` };
  switch (id) {
    case 'quick.open': return { op: 'open', scope: a };
    case 'quick.reset': return { op: 'reset', scope: a };
    case 'quick.collapse': return ['on', 'off', 'toggle', ''].includes(b) ? { op: 'collapse', scope: a, value: b || 'toggle' } : { error: 'collapse takes on, off or toggle' };
    case 'quick.skin': return b ? { op: 'skin', scope: a, skin: b === 'off' || b === 'inherit' ? null : b } : { error: 'quick.skin needs a skin id or off' };
    case 'quick.asset':
      if (!quickAssetTypes(a).includes(b)) return { error: `${a} lists ${quickAssetTypes(a).join(', ')}, not "${b}"` };
      return c ? { op: 'asset', scope: a, type: b, id: c === 'off' || c === 'default' ? null : c } : { error: 'quick.asset needs an asset id or off' };
  }
  return { error: `unknown action ${id}` };
}
