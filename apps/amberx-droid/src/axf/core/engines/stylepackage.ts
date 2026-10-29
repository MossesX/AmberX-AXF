/**
 * style-package@1 (enterprise-branding s19–s20, Opus, Oct 27 2026; Fable rebuild parked as `style-package-fable`):
 * a Style Package (type `style-package`) is one matched set of control assets — buttons, containers, sliders,
 * dialogs, pop-ups, tab groups, gauges, meters — picked in one go. Where a style theme sets the shared tokens (type,
 * radii, spacing, shadows), a style package decides how each kind of control is built on them.
 *
 *   data.slots   member type → asset id (at least one); members are listed in asset-types.json →
 *                `style-package.members` (an open list: a new control type joins by being added there)
 *   data.tone    optional one-word character for pickers and the roller (e.g. "crisp", "soft", "glass")
 *
 * Applying a package swaps every named member at once and records the package as the active `style-package`; a
 * member the app doesn't ship is skipped with a warning, never a broken look. A design package's `extras.slots` may
 * name a style package: its members apply first, the design package's own extras slots win over them.
 * Pure: the runtime applies (`applyStylePackage`, action `style.package:<id|next|prev|random>`, `swap('style-package', …)`).
 * Android twin deferred (port on hold): `StylePackageEngine.kt` + `AxfRuntime.applyStylePackage` (PORTING.md).
 */
import spec from '../../schemas/asset-types.json';

export const STYLE_PACKAGE_TYPE = 'style-package';

type Spec = { types: Record<string, { members?: string[] }> };
/** Control types a style package may set, from the spec (open list). */
export const STYLE_PACKAGE_MEMBERS: readonly string[] = (spec as unknown as Spec).types[STYLE_PACKAGE_TYPE]?.members ?? [];

export interface StylePackageData {
  slots: Record<string, string>;
  tone?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const TONE = /^[a-z][a-z-]{1,23}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Problems with a style package's data (empty = valid). Mirrored by the CLI validator (build-engine.mjs). */
export function stylePackageErrors(data: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(data)) return ['data must be an object'];
  if (!isObj(data.slots)) errors.push('data.slots must be an object of control type → asset id');
  else {
    const entries = Object.entries(data.slots);
    if (!entries.length) errors.push('data.slots must name at least one control');
    for (const [t, id] of entries) {
      if (!STYLE_PACKAGE_MEMBERS.includes(t)) errors.push(`data.slots.${t}: not a style-package member (${STYLE_PACKAGE_MEMBERS.join(', ')})`);
      else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.slots.${t} must be an asset id`);
    }
  }
  if ('tone' in data && (typeof data.tone !== 'string' || !TONE.test(data.tone))) errors.push('data.tone must be one lowercase word');
  return errors;
}

/** The member slots a package sets, members only, in spec order (unknown keys dropped). */
export function stylePackageSlots(data: Partial<StylePackageData> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const slots = isObj(data?.slots) ? (data!.slots as Record<string, unknown>) : {};
  for (const t of STYLE_PACKAGE_MEMBERS) { const id = slots[t]; if (typeof id === 'string' && ID.test(id)) out[t] = id; }
  return out;
}

/** next / prev / random over a list of package ids from the current one (random never repeats it when it can). */
export function stepPackage(ids: readonly string[], current: string | undefined, how: 'next' | 'prev' | 'random', rnd = Math.random): string | undefined {
  if (!ids.length) return undefined;
  const at = current ? ids.indexOf(current) : -1;
  if (how === 'random') {
    const others = ids.filter((x) => x !== current);
    return others.length ? others[Math.floor(rnd() * others.length)] : ids[0];
  }
  if (at < 0) return how === 'next' ? ids[0] : ids[ids.length - 1];
  return ids[(at + (how === 'next' ? 1 : -1) + ids.length) % ids.length];
}
