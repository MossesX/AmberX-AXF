/**
 * Capability lookup for the watchdog: which console plugin provides a service (plugin@1 `provides`), never by folder
 * name. The merge queue is service:axf.merge-queue@1, UI Review service:ui-review@1; a later provider (axf-molly, a
 * renamed plugin) is found the same way. AXF_WATCHDOG_PLUGINS_DIR points at another plugins folder (tests).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../../../..');
export const pluginsDir = () => process.env.AXF_WATCHDOG_PLUGINS_DIR || join(REPO, 'apps/console-web/plugins');
/** Where plugin data folders live: AXF_CONSOLE_ROOT (the VPS console, /opt/axf) else this checkout. */
export const consoleRoot = () => process.env.AXF_CONSOLE_ROOT || REPO;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The first plugin (sorted) that provides `service:<cap>`: { id, dir, dataDir (absolute or ''), manifest } or null. */
export function providerOf(cap, root = pluginsDir()) {
  const want = cap.startsWith('service:') ? cap : `service:${cap}`;
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).sort()) {
    const m = readJson(join(root, d, 'plugin.json'));
    if (m && Array.isArray(m.provides) && m.provides.includes(want)) {
      return { id: m.id, dir: join(root, d), dataDir: m.lifecycle?.dataDir ? join(consoleRoot(), m.lifecycle.dataDir) : '', manifest: m };
    }
  }
  return null;
}

/** The first of `names` that exists in the provider's folder ('' when none). */
export const entryOf = (p, names) => (p ? names.map((n) => join(p.dir, n)).find((f) => existsSync(f)) ?? '' : '');
