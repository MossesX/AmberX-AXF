/**
 * control@1 token overrides (build token-control s5): where a `control set tokens.<x> <path> <value>` lands and how
 * every app applies it. Pure (no IO, no DOM); shared by the runtime (compileStyles), the Token control plugin's runner
 * (REST, MCP, CLI) and the tests.
 *
 * An override is a look setting, so it rides the axHub appearance document like every other look change (Brett,
 * Nov 1 2026: "Any theme change applies to all"): one settings key per token set,
 *
 *   axf.tokens.theme | axf.tokens.style | axf.tokens.layout | axf.tokens.typography | axf.tokens.density | axf.tokens.sizing |
 *   axf.tokens.nav | axf.tokens.jump
 *     = { "*": { "<path>": value, … }, "<asset id>"?: { … } }
 *
 * `*` applies on top of whichever asset is active in the slot (what the control API writes today); an asset id entry
 * applies only while that asset is active and wins over `*` (room for per-asset overrides later). The appearance
 * engine caps one setting at 4 KB, so a set that would not fit is refused by name.
 */
export const CONTROL_TOKENS_PREFIX = 'axf.tokens.';
export const CONTROL_TOKENS_ALL = '*';
/** The appearance engine's per-setting cap (engines/appearance.ts APPEARANCE_SETTING_MAX_BYTES). */
export const CONTROL_TOKENS_MAX_BYTES = 4 * 1024;

/** Token target → the asset slot it overrides and its settings key. Static token targets only. */
export const CONTROL_TOKEN_SLOTS = {
  'tokens.theme': { slot: 'color-theme', key: `${CONTROL_TOKENS_PREFIX}theme`, root: 'tokens' },
  'tokens.style': { slot: 'style-theme', key: `${CONTROL_TOKENS_PREFIX}style`, root: '' },
  'tokens.layout': { slot: 'layout', key: `${CONTROL_TOKENS_PREFIX}layout`, root: '' },
  'tokens.typography': { slot: 'typography', key: `${CONTROL_TOKENS_PREFIX}typography`, root: '' },
  'tokens.density': { slot: 'density', key: `${CONTROL_TOKENS_PREFIX}density`, root: '' },
  'tokens.sizing': { slot: 'sizing', key: `${CONTROL_TOKENS_PREFIX}sizing`, root: '' },
  'tokens.nav': { slot: 'nav-style', key: `${CONTROL_TOKENS_PREFIX}nav`, root: '' },
  'tokens.jump': { slot: 'jump-menu', key: `${CONTROL_TOKENS_PREFIX}jump`, root: '' },
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const SCALAR = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const PATH = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

export const tokenSettingsKey = (target) => CONTROL_TOKEN_SLOTS[target]?.key ?? null;
export const isTokenSettingsKey = (key) => typeof key === 'string' && Object.values(CONTROL_TOKEN_SLOTS).some((s) => s.key === key);

/** A saved settings value shaped: `{ [asset|'*']: { [path]: scalar } }`; anything else dropped. */
export function normalizeTokenOverrides(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [asset, map] of Object.entries(raw)) {
    if (!(asset === CONTROL_TOKENS_ALL || /^[a-z0-9][a-z0-9-]{0,79}$/.test(asset)) || !isObj(map)) continue;
    const m = {};
    for (const [p, v] of Object.entries(map)) if (PATH.test(p) && p.length <= 80 && SCALAR(v)) m[p] = v;
    if (Object.keys(m).length) out[asset] = m;
  }
  return out;
}

/** The overrides in force for an active asset: `*` first, then the asset's own. */
export function effectiveTokenOverrides(raw, assetId) {
  const o = normalizeTokenOverrides(raw);
  return { ...(o[CONTROL_TOKENS_ALL] ?? {}), ...(assetId && o[assetId] ? o[assetId] : {}) };
}

/** Asset data with the overrides written in (a copy; the registry's asset is never touched). */
export function applyTokenOverrides(target, data, overrides) {
  const spec = CONTROL_TOKEN_SLOTS[target];
  if (!spec || !isObj(overrides) || !Object.keys(overrides).length) return data;
  const out = structuredClone(isObj(data) ? data : {});
  for (const [path, value] of Object.entries(overrides)) {
    const parts = (spec.root ? [spec.root, ...path.split('.')] : path.split('.'));
    let at = out;
    for (const p of parts.slice(0, -1)) { if (!isObj(at[p])) at[p] = {}; at = at[p]; }
    at[parts[parts.length - 1]] = value;
  }
  return out;
}

/** The value a path has in asset data (before overrides), or undefined. */
export function tokenValueIn(target, data, path) {
  const spec = CONTROL_TOKEN_SLOTS[target];
  if (!spec) return undefined;
  let at = data;
  for (const p of (spec.root ? [spec.root, ...path.split('.')] : path.split('.'))) { if (!isObj(at)) return undefined; at = at[p]; }
  return at;
}

/** A settings value with one override set (asset `*` unless given). Throws when the result is over the cap. */
export function withTokenOverride(raw, path, value, asset = CONTROL_TOKENS_ALL) {
  const o = normalizeTokenOverrides(raw);
  o[asset] = { ...(o[asset] ?? {}), [path]: value };
  if (JSON.stringify(o).length > CONTROL_TOKENS_MAX_BYTES) throw new Error(`too many overrides in one token set (over ${CONTROL_TOKENS_MAX_BYTES} bytes): reset some first`);
  return o;
}

/** A settings value with one override dropped (or every override of the set when path is empty); null = nothing left. */
export function withoutTokenOverride(raw, path, asset = CONTROL_TOKENS_ALL) {
  if (!path) return null;
  const o = normalizeTokenOverrides(raw);
  for (const a of asset === CONTROL_TOKENS_ALL ? Object.keys(o) : [asset]) {
    if (!o[a]) continue;
    delete o[a][path];
    if (!Object.keys(o[a]).length) delete o[a];
  }
  return Object.keys(o).length ? o : null;
}
