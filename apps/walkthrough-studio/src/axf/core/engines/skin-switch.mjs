/**
 * skin-switch@1: the action contract of the Skins screen (build skins-plugin-its-own-removable-console-plugin-and-
 * screen-for-changing-skins-ga, Fable, Nov 13 2026). One command shape for every way a skin is switched: the Skins
 * plugin's gallery, the banner's quick switcher, the console API, MCP, the CLI and voice all send the same command and
 * read the same state, so a tap in the UI and a call from outside are the same change.
 *
 * Actions, each for one scope:
 *   use              pick a skin at the scope and turn it on (a different skin starts clean, the same one keeps its
 *                    overrides and colour theme)
 *   back-to-skin     Back: the scope shows its skin as it ships. With `slot`, only that overridden part goes (the
 *                    colour theme slot = the skin's own colours); without, every override and the colour pick at that
 *                    scope. Nothing else moves: not the skin, not Use skin, not another scope, not the app's own look.
 *   restore-default  Restore to Default: the hub-wide skin is cleared (hub), the app goes back to its snapshot with
 *                    every scope inheriting (app: `restoreAppDefault`), a UI / plugin scope goes back to inherit.
 *   undo             the one step back: the record the last use / back-to-skin / restore-default left. A second undo
 *                    does nothing (`nothing-to-undo`).
 *
 * Scopes, as the API spells them: `hub` (the hub-wide skin on the shared appearance document, the `global` level),
 * `app:<id>` (the app level of that app's look document; `app` alone = the document's own app), `ui:<view>` and
 * `plugin:<id>` (sub scopes kept in the document). Precedence is the skin chain plugin → ui → app → global
 * (`resolveLookSkin`): a switch at a scope shows only where that scope decides.
 *
 * State: `{ look, global }`, the app-look@1 document of the acting app and the hub-wide skin (`globalSkinOf` of the
 * shared document, or null). Every action returns the new pair plus `changed`; the caller saves the document when
 * `changed.look` and merges `{ skin: global }` into the shared document when `changed.global`.
 *
 * Undo: one record, kept in the acting app's look document (`look.undo`): the own look, skin state and scopes before
 * the action, `action` and `scope` for the Undo label, `at`, and for the hub scope the hub-wide skin before
 * (`global`, null = none). It is the same record Restore has always left (`restoreAppDefault`, `undoRestore` read it),
 * so an older reader undoes it too. The record is the acting app's: an app undoing a hub switch puts back the hub-wide
 * skin it saw, whatever another app did since.
 *
 * Pure, plain JS: shared by the TS engine (skin.ts), the console server, the CLI and the runtime. Kotlin twin deferred
 * (spec/PORTING.md). Fixture `spec/fixtures/skin-switch.json`, check `spec/check-skin-switch.mts`.
 */
import { backToSkin, normalizeScopeState, pickSkin, resolveLookSkin, restoreAppDefault, scopeState, setScopeOverride, setScopeSkin, setSkinColorTheme, setUseSkin, SKIN_COLOR_SLOT } from './skin-rules.mjs';
import { isSubScopeKey, SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL, skinScopeOf } from './skin-coverage.mjs';

export const SKIN_SWITCH_CONTRACT = 'skin-switch@1';
/** The four actions, in the order a toolbar shows them. */
export const SKIN_SWITCH_ACTIONS = ['use', 'back-to-skin', 'restore-default', 'undo'];
/** The four kinds of scope a switch names. */
export const SKIN_SWITCH_SCOPES = ['hub', 'app', 'ui', 'plugin'];
/** The scope string of the hub-wide skin. */
export const SKIN_SWITCH_HUB = 'hub';
/** Error codes a refused command carries. */
export const SKIN_SWITCH_ERRORS = ['bad-action', 'bad-scope', 'other-app', 'no-skin', 'unknown-skin', 'bad-slot', 'no-document', 'nothing-to-undo'];

const ID = /^[a-z0-9][a-z0-9-]*$/;
const SCOPE_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/* ---------------------------------------------------------------- scopes */

/**
 * Read a scope string. `{ kind, key, id, scope }`: `kind` one of hub | app | ui | plugin, `key` the skin-chain key
 * (`global`, `app`, `ui:<view>`, `plugin:<id>`), `id` the app / view / plugin named, `scope` the canonical string
 * (`app:<id>` carries the app it names, `app` alone stays `app`). null when the string is not a scope.
 */
export function parseSwitchScope(raw) {
  const s = str(raw);
  if (!s) return null;
  if (s === SKIN_SWITCH_HUB || s === SKIN_SCOPE_GLOBAL) return { kind: 'hub', key: SKIN_SCOPE_GLOBAL, id: '', scope: SKIN_SWITCH_HUB };
  if (s === SKIN_SCOPE_APP) return { kind: 'app', key: SKIN_SCOPE_APP, id: '', scope: SKIN_SCOPE_APP };
  const m = /^(app|ui|plugin):(.+)$/.exec(s);
  if (!m || !SCOPE_ID.test(m[2])) return null;
  if (m[1] === 'app') return { kind: 'app', key: SKIN_SCOPE_APP, id: m[2], scope: `app:${m[2]}` };
  return { kind: m[1], key: `${m[1]}:${m[2]}`, id: m[2], scope: `${m[1]}:${m[2]}` };
}

/** The scope string of a skin-chain key for app `app` (`global` → `hub`, `app` → `app:<app>`). */
export function switchScopeOf(key, app = '') {
  if (key === SKIN_SCOPE_GLOBAL) return SKIN_SWITCH_HUB;
  if (key === SKIN_SCOPE_APP) return app ? `app:${app}` : SKIN_SCOPE_APP;
  return isSubScopeKey(key) ? key : '';
}

/** The scopes a document names, as scope strings: the hub, the app, then every UI / plugin scope it holds. */
export function switchScopes(look) {
  const out = [SKIN_SWITCH_HUB];
  if (look?.app) out.push(`app:${look.app}`);
  for (const key of Object.keys(look?.scopes ?? {})) if (isSubScopeKey(key)) out.push(key);
  return out;
}

/* ---------------------------------------------------------------- commands */

/**
 * The command as the engine takes it: `{ action, scope, skin?, slot?, at? }`. Returns `{ command, errors }`: a command
 * with every field read (`scope` canonical) and the problems found, in order. `use` needs `skin`; `slot` is kept only
 * for back-to-skin.
 */
export function normalizeSkinSwitch(raw) {
  const d = isObj(raw) ? raw : {};
  const errors = [];
  const action = str(d.action);
  if (!SKIN_SWITCH_ACTIONS.includes(action)) errors.push({ code: 'bad-action', message: `action must be one of ${SKIN_SWITCH_ACTIONS.join(', ')}` });
  const sc = parseSwitchScope(d.scope);
  if (!sc) errors.push({ code: 'bad-scope', message: 'scope must be hub, app:<id>, ui:<view> or plugin:<id>' });
  const skin = str(d.skin);
  if (skin && !ID.test(skin)) errors.push({ code: 'unknown-skin', message: `"${skin}" is not a skin id` });
  if (action === 'use' && !skin) errors.push({ code: 'no-skin', message: 'use needs the skin to use' });
  const slot = str(d.slot);
  if (slot && !ID.test(slot)) errors.push({ code: 'bad-slot', message: `"${slot}" is not a slot` });
  const command = { action, scope: sc?.scope ?? str(d.scope) };
  if (action === 'use' && skin) command.skin = skin;
  if (action === 'back-to-skin' && slot) command.slot = slot;
  if (str(d.at)) command.at = str(d.at);
  return { command, errors };
}

const refuse = (look, global, code, message) => ({ ok: false, error: code, message, look, global, changed: { look: false, global: false }, undo: null });
/** Key-order-free equality: two documents that hold the same picks are the same change-wise. */
const stable = (v) => (isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : JSON.stringify(v ?? null));
const same = (a, b) => stable(a ?? null) === stable(b ?? null);

/** A hub-wide skin with nothing but its id and overrides read (null when none). */
function normGlobal(g) {
  if (!isObj(g) || typeof g.id !== 'string' || !ID.test(g.id)) return null;
  const overrides = {};
  if (isObj(g.overrides)) for (const [k, v] of Object.entries(g.overrides)) if (ID.test(k) && typeof v === 'string' && ID.test(v) && k !== SKIN_COLOR_SLOT) overrides[k] = v;
  const pick = typeof g.colorTheme === 'string' && ID.test(g.colorTheme) ? g.colorTheme : '';
  return pick ? { id: g.id, overrides, colorTheme: pick } : { id: g.id, overrides };
}

/** The undo record an action leaves: what the look held, the action and scope, and the hub-wide skin when the hub moved. */
function record(look, global, command, at) {
  const rec = { own: look.own, skin: look.skin, scopes: look.scopes ?? {}, at, action: command.action, scope: command.scope };
  if (command.scope === SKIN_SWITCH_HUB) rec.global = normGlobal(global);
  return rec;
}

/**
 * Run one command. `state` = `{ look, global }` (the acting app's document, the hub-wide skin or null); `ctx` =
 * `{ has?(id) → boolean` (the skins this app knows; an unknown skin is refused), `now` (the `at` stamp) }`.
 * Returns `{ ok, look, global, changed: { look, global }, undo, error?, message? }`: `undo` is the record left (null
 * for undo itself and for a refused command). A command that changes nothing is ok and leaves no record.
 */
export function skinSwitch(state, raw, ctx = {}) {
  const look = state?.look ?? null;
  const global0 = normGlobal(state?.global);
  const { command, errors } = normalizeSkinSwitch(raw);
  if (errors.length) return refuse(look, global0, errors[0].code, errors[0].message);
  const sc = parseSwitchScope(command.scope);
  if (!look) return refuse(look, global0, 'no-document', 'no look document to switch in');
  if (sc.kind === 'app' && sc.id && sc.id !== look.app) return refuse(look, global0, 'other-app', `the document is ${look.app}'s, not ${sc.id}'s`);
  if (command.skin && ctx.has && !ctx.has(command.skin)) return refuse(look, global0, 'unknown-skin', `no skin "${command.skin}" here`);
  const at = command.at || ctx.now || '';
  const scope = sc.kind === 'app' ? `app:${look.app}` : command.scope;
  const cmd = { ...command, scope };
  const done = (nextLook, nextGlobal) => {
    const lookChanged = !same({ ...nextLook, undo: null }, { ...look, undo: null });
    const globalChanged = !same(nextGlobal, global0);
    if (!lookChanged && !globalChanged) return { ok: true, look, global: global0, changed: { look: false, global: false }, undo: null };
    const undo = record(look, global0, cmd, at);
    return { ok: true, look: { ...nextLook, undo }, global: nextGlobal, changed: { look: true, global: globalChanged }, undo };
  };

  if (cmd.action === 'undo') {
    const rec = look.undo;
    if (!rec) return refuse(look, global0, 'nothing-to-undo', 'nothing to undo');
    const nextLook = { ...look, own: rec.own, skin: rec.skin, scopes: rec.scopes ?? {}, undo: null };
    const nextGlobal = rec.scope === SKIN_SWITCH_HUB && 'global' in rec ? normGlobal(rec.global) : global0;
    return { ok: true, look: nextLook, global: nextGlobal, changed: { look: true, global: !same(nextGlobal, global0) }, undo: null };
  }

  if (sc.kind === 'hub') {
    if (cmd.action === 'use') return done(look, global0?.id === cmd.skin ? global0 : { id: cmd.skin, overrides: {} });
    if (cmd.action === 'restore-default') return done(look, null);
    // back-to-skin
    if (!global0) return done(look, null);
    if (!cmd.slot) return done(look, { id: global0.id, overrides: {} });
    if (cmd.slot === SKIN_COLOR_SLOT) return done(look, { id: global0.id, overrides: global0.overrides });
    const overrides = { ...global0.overrides };
    delete overrides[cmd.slot];
    return done(look, global0.colorTheme ? { id: global0.id, overrides, colorTheme: global0.colorTheme } : { id: global0.id, overrides });
  }

  if (sc.kind === 'app') {
    if (cmd.action === 'use') return done(setUseSkin(pickSkin(look, cmd.skin), true), global0);
    if (cmd.action === 'restore-default') { const r = restoreAppDefault(look, at); return done({ ...r, undo: null }, global0); }
    if (cmd.slot) return done(backToSkin(look, cmd.slot), global0);
    const cleared = setSkinColorTheme(look, '');
    return done({ ...cleared, skin: { ...cleared.skin, overrides: {} } }, global0);
  }

  // ui / plugin
  const key = sc.key;
  if (cmd.action === 'use') return done(setScopeSkin(look, key, 'on', cmd.skin), global0);
  if (cmd.action === 'restore-default') { const scopes = { ...(look.scopes ?? {}) }; delete scopes[key]; return done({ ...look, scopes }, global0); }
  if (cmd.slot) return done(setScopeOverride(look, key, cmd.slot, null), global0);
  const cur = scopeState(look, key);
  const next = normalizeScopeState({ use: cur.use, id: cur.id, overrides: {} });
  const scopes = { ...(look.scopes ?? {}) };
  if (next.use === 'inherit' && !next.id) delete scopes[key]; else scopes[key] = next;
  return done({ ...look, scopes }, global0);
}

/* ---------------------------------------------------------------- state */

/** The state of one scope as the API reads it: `{ use, id, overrides, colorTheme? }` (the hub-wide skin reads as on | off). */
export function switchScopeState(look, global, scope) {
  const sc = parseSwitchScope(scope);
  if (!sc) return null;
  if (sc.kind === 'hub') { const g = normGlobal(global); return g ? { use: 'on', ...g } : { use: 'off', id: '', overrides: {} }; }
  if (!look) return null;
  return scopeState(look, sc.key);
}

/**
 * What the Skins screen and the API show for one scope: the scope's own state, the skin in force there (the chain
 * resolved: `inForce.from` says which level decided), the slots overridden at this level, and the undo on offer
 * (`{ action, scope, at }` or null). `ctx.has(id)` marks a skin the app lacks (`known: false`).
 */
export function skinSwitchState(look, global, scope, ctx = {}) {
  const sc = parseSwitchScope(scope);
  if (!sc) return null;
  if (sc.kind === 'app' && sc.id && look && sc.id !== look.app) return null;
  const state = switchScopeState(look, global, scope);
  if (!state) return null;
  const g = normGlobal(global);
  const inForce = sc.kind === 'hub' ? (g ? { id: g.id, overrides: g.overrides, from: SKIN_SCOPE_GLOBAL, ...(g.colorTheme ? { colorTheme: g.colorTheme } : {}) } : { id: '', overrides: {}, from: SKIN_SCOPE_GLOBAL }) : resolveLookSkin(look, g, skinScopeOf(sc.key, look?.app ?? ''));
  const rec = look?.undo ?? null;
  const undo = rec ? { action: rec.action || 'restore-default', scope: rec.scope || (look?.app ? `app:${look.app}` : SKIN_SCOPE_APP), at: rec.at || '' } : null;
  return {
    contract: SKIN_SWITCH_CONTRACT,
    scope: sc.kind === 'app' ? (look?.app ? `app:${look.app}` : SKIN_SCOPE_APP) : sc.scope,
    key: sc.key,
    state,
    inForce,
    known: !inForce.id || !ctx.has ? true : !!ctx.has(inForce.id),
    overridden: state.use === 'on' ? Object.keys(state.overrides ?? {}) : [],
    canUndo: !!rec,
    undo,
  };
}
