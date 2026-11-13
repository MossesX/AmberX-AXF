/**
 * asset-gate@1 — the gate every picked asset passes before it is applied (build quick-settings-pinned-collapsible-pane,
 * Brett, Nov 13 2026: "Any picked asset must have a manifest and pass schema conformance before applying").
 *
 * A pick is `{ type, id }`: the skin or the default asset a Quick settings pane, Settings → Appearance, a chrome
 * instance picker or a `swap:<type>:<id>` action wants to put in force. It may be applied only when
 *   1. the type is a registered asset type,
 *   2. the id is an asset id (the envelope's idPattern),
 *   3. an asset@1 document is registered under that type and id: its manifest ($axf, type, id, name, version, data),
 *      and the manifest names the same type and id as the pick,
 *   4. that document still passes the shared type spec (schemas/asset-types.json) — the same rule as `axf validate`.
 *
 * Pure: the caller hands in the registry (`get`), the type test (`isType`) and the validator (`validate`), so the web
 * runtime (AxfRuntime.checkAsset), the build engine / console API (gateAppAsset, engine-rpc `asset-gate`) and the
 * spec check share one decision. Nothing here applies anything.
 */

export const ASSET_GATE_CONTRACT = 'asset-gate@1';
export const ASSET_FRAME = 'asset@1';
/** The envelope's idPattern (schemas/asset-types.json); check-asset-gate.mjs keeps them equal. */
export const ASSET_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,47}$';
/** Every manifest field a pick needs, in the order the envelope lists them. */
export const MANIFEST_FIELDS = ['$axf', 'type', 'id', 'name', 'version', 'data'];
/** Why a pick was refused, or 'ok'. */
export const GATE_REASONS = ['ok', 'bad-type', 'bad-id', 'no-manifest', 'invalid'];
export const GATE_LABELS = {
  ok: 'Ready to apply',
  'bad-type': 'Unknown asset type',
  'bad-id': 'Not an asset id',
  'no-manifest': 'No manifest',
  invalid: 'Fails schema conformance',
};

const ID = new RegExp(ASSET_ID_PATTERN);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

const result = (type, id, reason, errors) => ({ contract: ASSET_GATE_CONTRACT, ok: reason === 'ok', type, id, reason, label: GATE_LABELS[reason], errors });

/** The manifest problems of a registered document against the pick it should answer: [] when it is the pick's manifest. */
export function manifestErrors(raw, type, id) {
  if (!isObj(raw)) return [`no ${type} asset "${id}" is registered: nothing to apply`];
  const errors = [];
  for (const k of MANIFEST_FIELDS) if (!(k in raw)) errors.push(`manifest is missing "${k}"`);
  if ('$axf' in raw && raw.$axf !== ASSET_FRAME) errors.push(`manifest "$axf" must be "${ASSET_FRAME}"`);
  if ('type' in raw && raw.type !== type) errors.push(`manifest is a ${String(raw.type)}, the pick wants a ${type}`);
  if ('id' in raw && raw.id !== id) errors.push(`manifest id "${String(raw.id)}" is not the picked "${id}"`);
  if ('name' in raw && !str(raw.name).trim()) errors.push('manifest "name" is empty');
  if ('version' in raw && !str(raw.version).trim()) errors.push('manifest "version" is empty');
  if ('data' in raw && !isObj(raw.data)) errors.push('manifest "data" must be an object');
  return errors;
}

/**
 * Decide one pick. `ctx`: `isType(type)`, `get(type, id)` → the registered document or null, `validate(raw)` → the
 * shared validator's `{ ok, errors }`. Returns `{ ok, type, id, reason, label, errors }`; never throws.
 */
export function gateAsset(pick, ctx) {
  const type = str(pick?.type).trim();
  const id = str(pick?.id).trim();
  if (!type || !ctx?.isType?.(type)) return result(type, id, 'bad-type', [`unknown asset type "${type}"`]);
  if (!id || !ID.test(id)) return result(type, id, 'bad-id', [`"${id}" is not an asset id (${ASSET_ID_PATTERN})`]);
  let raw = null;
  try { raw = ctx.get?.(type, id) ?? null; } catch { raw = null; }
  const manifest = manifestErrors(raw, type, id);
  if (manifest.length) return result(type, id, 'no-manifest', manifest);
  let v;
  try { v = ctx.validate?.(raw) ?? { ok: true, errors: [] }; } catch (e) { v = { ok: false, errors: [`validator failed: ${e?.message ?? e}`] }; }
  if (!v.ok) return result(type, id, 'invalid', v.errors?.length ? [...v.errors] : ['fails the type spec']);
  return result(type, id, 'ok', []);
}

/** Decide a set of picks at once (a Quick settings pane applies its skin and default assets together): nothing applies unless every pick passes. */
export function gatePicks(picks, ctx) {
  const results = (Array.isArray(picks) ? picks : []).map((p) => gateAsset(p, ctx));
  const blocked = results.filter((r) => !r.ok);
  return { contract: ASSET_GATE_CONTRACT, ok: !blocked.length, results, blocked };
}

/** One line a toast or terminal shows: `nav-menu "x": No manifest: no nav-menu asset "x" is registered: nothing to apply`. */
export function gateMessage(r) {
  if (!r) return '';
  const head = `${r.type || 'asset'} "${r.id}"`;
  if (r.ok) return `${head}: ${GATE_LABELS.ok}`;
  return `${head}: ${r.label}${r.errors?.length ? `: ${r.errors.join('; ')}` : ''}`;
}

/** The gate as a read for control@1 / the console API: the same fields, no functions. */
export function gateState(r) {
  return { contract: ASSET_GATE_CONTRACT, ok: !!r?.ok, type: r?.type ?? '', id: r?.id ?? '', reason: r?.reason ?? 'bad-type', label: r?.label ?? GATE_LABELS['bad-type'], errors: [...(r?.errors ?? [])], message: gateMessage(r) };
}
