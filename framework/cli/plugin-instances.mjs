/**
 * One instance per plugin (Brett, Oct 23 2026): "only allow one instance of a plugin. Do not allow, under any
 * circumstance, the same plugin to be installed twice but built by different models."
 *
 * Two installed plugins are the same plugin when any of these holds:
 *   - they have the same id (plugin@1 `id`)
 *   - one lists the other's id in `builtWith.replaces` (a rebuild that took a new id)
 *   - their folders are the same once a model or "-plugin" suffix is taken off (`theme-manager-fable` = `theme-manager`)
 *   - they have the same name (case and spaces ignored)
 * A rebuild with another model therefore always *replaces* the installed build (Plugin Update's confirmed swap,
 * plugin-catalog.mjs swapConsole), never installs next to it. Used by plugins.mjs --check (CI), plugin-catalog install,
 * and the console's plugin loader (Python twin `instance_clash` in apps/console-web/server/main.py, same rules).
 */

const SUFFIX = /-(fable|opus|sonnet|haiku|plugin)$/;
export const folderStem = (folder) => { let f = String(folder).split('/').pop(); while (SUFFIX.test(f)) f = f.replace(SUFFIX, ''); return f; };
const nameKey = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Why `a` and `b` (each {folder, manifest}) are the same plugin, or null. */
export function samePlugin(a, b) {
  const ma = a.manifest ?? {}, mb = b.manifest ?? {};
  if (ma.id && ma.id === mb.id) return `the same id (${ma.id})`;
  const ra = Array.isArray(ma.builtWith?.replaces) ? ma.builtWith.replaces : [];
  const rb = Array.isArray(mb.builtWith?.replaces) ? mb.builtWith.replaces : [];
  if (mb.id && ra.includes(mb.id)) return `${ma.id} replaces ${mb.id}`;
  if (ma.id && rb.includes(ma.id)) return `${mb.id} replaces ${ma.id}`;
  if (folderStem(a.folder) === folderStem(b.folder)) return `the same plugin folder (${folderStem(a.folder)})`;
  if (nameKey(ma.name) && nameKey(ma.name) === nameKey(mb.name)) return `the same name (${ma.name})`;
  return null;
}

const model = (m) => m?.builtWith?.model || 'an unknown model';

/** Every pair of installed plugins that are one plugin. → [{ a, b, why, message }] */
export function instanceClashes(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const why = samePlugin(list[i], list[j]);
    if (why) out.push({ a: list[i].folder, b: list[j].folder, why, message: `${list[i].folder} (built with ${model(list[i].manifest)}) and ${list[j].folder} (built with ${model(list[j].manifest)}) are one plugin: ${why}. Only one instance of a plugin may be installed; replace one with the other instead (Plugin Update).` });
  }
  return out;
}

/**
 * May `incoming` ({folder, manifest}) be installed next to `installed` ([{folder, manifest}])? Its own folder (an update
 * or a swap in place) doesn't count. → null, or the reason it may not.
 */
export function installClash(incoming, installed) {
  for (const p of installed) {
    if (p.folder === incoming.folder) continue;
    const why = samePlugin(incoming, p);
    if (why) return `${incoming.manifest?.name ?? incoming.folder} (built with ${model(incoming.manifest)}) is the same plugin as the installed ${p.folder} (built with ${model(p.manifest)}): ${why}. Only one instance of a plugin may be installed: replace ${p.folder} with it (Plugin Update → Replace), never both.`;
  }
  return null;
}
