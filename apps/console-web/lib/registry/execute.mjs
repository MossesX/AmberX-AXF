/**
 * From a resolution to a call (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s4).
 *
 * The dispatcher answers which entry, which action and which validated parameters; this module turns that answer (or an
 * entry's state read) into the one call that does it. Every console-side ref becomes a control@1 command, so the
 * permission rules, the confirm-token flow for deletes and the write audit of control@1 apply unchanged whichever
 * surface asked (REST, MCP, `axf ctl`, voice):
 *
 *   <plugin>/<command>                    → plugins.commands act run (a read: plugins.reads act read), input = params
 *   view:<id> · dialog:<id> · settings:<tab> → console.screens / console.dialogs / console.settings act open
 *   action:<id>[:args]                    → console.actions act run, input.args
 *   control:<target>/<op>[/<verb>][/<path>] → that control@1 command; params map onto path / value / select / input
 *   provider:<connection>/<op>            → a provider call through axHub (the bridge registered by providers)
 *   channel:<op> · intent:<uri> · url:<address> → handed back to the caller (the app channel, an Android intent, a link)
 *
 * Nothing here runs anything: `planCall` returns the plan, the surface runs it with what it has (the console's control
 * runner, the CLI's local runner). No AI here.
 */
import { getEntry } from '../../../../framework/core/engines/control-registry.mjs';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const CONTROL_RE = /^control:([a-z]+\.[a-z]+)\/(list|get|set|reset|add|remove|act)(?:\/([a-z][a-z0-9-]*))?(?:\/(.+))?$/;
const PLUGIN_RE = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;
/** Parameters that steer the call itself rather than the thing called. */
export const CALL_PARAMS = Object.freeze(['to', 'confirm', 'reason']);

/** Split a ref into its kind and the rest. */
export function parseRef(ref) {
  const s = String(ref ?? '');
  if (!s || s === 'none') return { kind: 'none' };
  const m = /^(view|dialog|settings|action|value|control|rest|mcp|cli|intent|url|provider|channel|element):(.*)$/.exec(s);
  if (m) return { kind: m[1], rest: m[2] };
  if (PLUGIN_RE.test(s)) return { kind: 'plugin', rest: s };
  return { kind: 'unknown', rest: s };
}

const pick = (o, keys) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => keys.includes(k)));
const omit = (o, keys) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !keys.includes(k)));
const withTo = (input, params) => ({ ...input, ...(params.to && params.to !== 'recent' ? { to: params.to } : {}) });

/** A control@1 command for `control:` refs, with the action's params placed where control@1 wants them. */
function controlCommand(ref, params) {
  const m = CONTROL_RE.exec(ref);
  if (!m) return null;
  const [, target, op, verb, fixedPath] = m;
  const p = { ...params };
  const cmd = { $axf: 'control@1', op, target };
  const path = fixedPath ?? (p.path !== undefined ? String(p.path) : undefined);
  delete p.path;
  if (path !== undefined && path !== '') cmd.path = path;
  const rest = omit(p, CALL_PARAMS);
  if (op === 'act') { cmd.action = verb; const input = withTo(rest, p); if (Object.keys(input).length) cmd.input = input; }
  else if (op === 'set') cmd.value = 'value' in rest && Object.keys(rest).length === 1 ? rest.value : rest;
  else if (op === 'add') cmd.value = 'value' in rest && Object.keys(rest).length === 1 ? rest.value : rest;
  else if (op === 'list') { if (Object.keys(rest).length) cmd.select = rest; }
  return cmd;
}

/** The plan for running `ref` with `params` (effect = the action's effect). → { via, command?, … } | { via: 'none', why }. */
export function planRef(ref, params = {}, { effect = 'write', confirm = '', reason = '', by = 'registry', plugin = '', title = '' } = {}) {
  const r = parseRef(ref);
  const extra = { by, ...(confirm ? { confirm } : {}), ...(reason ? { reason } : {}) };
  const control = (cmd) => ({ via: cmd.target.startsWith('console.') ? 'console' : 'control', command: { ...cmd, ...extra } });
  switch (r.kind) {
    case 'control': { const c = controlCommand(ref, params); return c ? control(c) : { via: 'none', why: `"${ref}" is not a control@1 ref (control:<target>/<op>[/<verb>][/<path>])` }; }
    case 'plugin': {
      const read = effect === 'read';
      const input = omit(params, CALL_PARAMS);
      return control({ $axf: 'control@1', op: 'act', target: read ? 'plugins.reads' : 'plugins.commands', path: r.rest, action: read ? 'read' : 'run', ...(Object.keys(input).length ? { input } : {}) });
    }
    case 'view': return control({ $axf: 'control@1', op: 'act', target: 'console.screens', path: r.rest, action: 'open', input: withTo({}, params) });
    case 'dialog': return control({ $axf: 'control@1', op: 'act', target: 'console.dialogs', path: r.rest, action: 'open', input: withTo(params.arg !== undefined ? { arg: params.arg } : {}, params) });
    case 'settings': return control({ $axf: 'control@1', op: 'act', target: 'console.settings', path: r.rest, action: 'open', input: withTo(params.anchor ? { anchor: params.anchor } : {}, params) });
    case 'action': {
      const [id, ...fixed] = r.rest.split(':');
      const given = params.args === undefined ? [] : Array.isArray(params.args) ? params.args : String(params.args).split(':').filter(Boolean);
      const named = Object.entries(params).filter(([k, v]) => k !== 'args' && !CALL_PARAMS.includes(k) && v !== undefined).map(([, v]) => v);
      const args = [...fixed, ...named.map(String), ...given.map(String)];
      return control({ $axf: 'control@1', op: 'act', target: 'console.actions', path: id, action: 'run', input: withTo(args.length ? { args } : {}, params) });
    }
    case 'provider': {
      const i = r.rest.indexOf('/');
      if (i < 1) return { via: 'none', why: `"${ref}" needs provider:<connection>/<op>` };
      const hash = r.rest.indexOf('#');
      if (hash > i) {
        // provider:<conn>/<op>#<command template>: an allow-listed command; each {param} is shell-quoted after the
        // registry validated it, nothing else from the caller reaches the command line
        const template = r.rest.slice(hash + 1);
        const missing = [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).filter((k) => params[k] === undefined || params[k] === '');
        if (missing.length) return { via: 'none', why: `the command needs ${missing.join(', ')}` };
        return { via: 'provider', provider: r.rest.slice(0, i), op: r.rest.slice(i + 1, hash), params: { command: shellFill(template, params) }, effect, ...(title ? { title } : {}), ...extra };
      }
      return { via: 'provider', provider: r.rest.slice(0, i), op: r.rest.slice(i + 1), params: omit(params, CALL_PARAMS), effect, ...(title ? { title } : {}), ...extra };
    }
    case 'channel': { const i = r.rest.indexOf('/'); return { via: 'channel', app: i > 0 ? r.rest.slice(0, i) : '', op: i > 0 ? r.rest.slice(i + 1) : r.rest, params: omit(params, CALL_PARAMS) }; }
    case 'intent': return { via: 'intent', uri: fill(r.rest, params) };
    case 'url': return { via: 'url', url: fill(r.rest, params) };
    case 'rest': { const [method, ...p] = r.rest.split(' '); return { via: 'rest', method, path: fill(p.join(' '), params), body: omit(params, CALL_PARAMS) }; }
    case 'mcp': return { via: 'mcp', tool: r.rest, args: omit(params, CALL_PARAMS) };
    case 'cli': return { via: 'cli', command: r.rest, params: omit(params, CALL_PARAMS) };
    case 'value': {
      // a settings-registry key: read through the owning plugin's GET settings/{key}, written through PUT settings { values }
      if (!plugin) return { via: 'value', key: r.rest, ...(effect === 'read' ? {} : { value: params.value }) };
      if (effect === 'read') return control({ $axf: 'control@1', op: 'act', target: 'plugins.reads', path: `${plugin}/settings-by-key`, action: 'read', input: { key: r.rest } });
      return control({ $axf: 'control@1', op: 'act', target: 'plugins.commands', path: `${plugin}/settings-set`, action: 'run', input: { values: { [r.rest]: params.value } } });
    }
    case 'none': return { via: 'none', why: 'this action has nothing to run (ref "none")' };
    default: return { via: 'none', why: `no runner for ref "${ref}"` };
  }
}

/** A value as one shell word: single-quoted, embedded quotes escaped. */
export const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
/** `{name}` slots in a command template, each value shell-quoted. */
export const shellFill = (template, params = {}) => String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (params[k] === undefined ? m : shellQuote(params[k])));

/** `{name}` slots in a template filled from params (URL-encoded). */
export function fill(template, params = {}) {
  const out = String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (params[k] === undefined || params[k] === '' ? '' : String(params[k]).split('/').map(encodeURIComponent).join('/')));
  return out.replace(/([^:/])\/{2,}/g, '$1/').replace(/\/+$/, '') || out;
}

/** The plan for a resolution from dispatch(). A failed resolution plans nothing. */
export function planResolution(res, opts = {}) {
  if (!res?.ok) return { via: 'none', why: res?.message ?? 'not resolved' };
  return planRef(res.run, res.params ?? {}, { effect: res.effect, ...opts });
}

/**
 * The plan for reading an entry's state: its `state.read` ref, else the first read action, else (a page) where the
 * console is. → { entry, read, plan } | null when the id is unknown.
 */
export function planState(index, id, params = {}, opts = {}) {
  const e = getEntry(index, id);
  if (!e) return null;
  const readRef = e.state?.read || e.actions.find((a) => a.effect === 'read')?.run || '';
  if (readRef) return { entry: e.id, read: readRef, fields: e.state?.fields ?? [], plan: planRef(readRef, params, { effect: 'read', plugin: e.where?.plugin ?? '', ...opts }) };
  if (e.open?.kind && ['screen', 'dialog', 'settings'].includes(e.open.kind)) return { entry: e.id, read: 'control:console.nav/get/here', fields: [], plan: planRef('control:console.nav/get', { path: 'here' }, { effect: 'read', ...opts }), note: 'no state read declared: answering where the console is' };
  return { entry: e.id, read: '', fields: e.state?.fields ?? [], plan: { via: 'none', why: 'this entry declares no state read' } };
}

/**
 * The console tools that open an entry, kept in step with its deep link: `open.kind` + `open.target` is exactly what
 * console_open / console_dialog / console_settings / console_action take, and `console_show` takes it as kind:target.
 * → { tool, args, show, deepLink } | null (nothing to open in the console: an app intent, a URL or nothing).
 */
export function consoleTargets(entry) {
  const o = entry?.open;
  if (!o?.target) return null;
  const map = { screen: ['console_open', { screen: o.target }], dialog: ['console_dialog', { dialog: o.target }], settings: ['console_settings', { tab: o.target }], action: ['console_action', { action: o.target }] };
  const m = map[o.kind ?? 'screen'];
  if (!m) return { tool: null, args: {}, show: null, deepLink: o.deepLink ?? null, kind: o.kind };
  return { tool: m[0], args: m[1], show: `${o.kind ?? 'screen'}:${o.target}`, deepLink: o.deepLink ?? null, kind: o.kind ?? 'screen' };
}

/** The deep link deep-link@1 gives each console open kind. */
export const DEEP_LINK = Object.freeze({ screen: (t) => `?axf-view=${t}`, settings: (t) => `?axf-settings=${t}`, dialog: (t) => `?axf-dialog=${t}`, action: (t) => `?axf-action=${t}` });

/** Entries whose console target and deep link disagree (console_open / console_show must open what the link opens). */
export function consoleSyncProblems(index) {
  const out = [];
  for (const e of index.entries) {
    const t = consoleTargets(e);
    if (!t?.tool) continue;
    const want = DEEP_LINK[t.kind]?.(e.open.target);
    if (want && t.deepLink && t.deepLink !== want && !t.deepLink.startsWith(`${want}&`)) out.push({ entry: e.id, open: t.show, deepLink: t.deepLink, want });
    if (!t.deepLink) out.push({ entry: e.id, open: t.show, deepLink: null, want });
  }
  return out;
}

/** Apps with a remote command channel the surfaces can hand a `channel:` plan to (AmberX joins in s13). */
export const CHANNEL_APPS = new Set();
/** Why a channel plan can't run from here, or '' when it can. */
export const channelGap = (plan) => (plan.via === 'channel' && !CHANNEL_APPS.has(plan.app) ? `${plan.app || 'this app'} has no remote command channel yet: this runs only inside its own window` : '');

/** A provider bridge: providers register `{ id, call(op, params, ctx) }` here (axHub step s9 onwards). */
const providers = new Map();
export const registerProvider = (p) => { if (isObj(p) && p.id && typeof p.call === 'function') providers.set(p.id, p); return providers; };
export const providerOf = (id) => providers.get(id) ?? null;
export const providerIds = () => [...providers.keys()].sort();

export { pick };
