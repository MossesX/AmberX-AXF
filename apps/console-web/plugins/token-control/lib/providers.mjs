/**
 * Cross-plugin parts through capabilities, never folder names (plugin-lifecycle@1): the planner targets need a plugin
 * that provides `service:plans@1` (its Node module `plans.mjs`, the same one its server part runs) and one that
 * provides `service:orchestrator@1` (`orchestrator.mjs`: load + act over the one builds store). Missing = the target
 * answers not_implemented and names the capability.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, ControlError } from './common.mjs';

const PLUGINS = join(ROOT, 'apps', 'console-web', 'plugins');
/** Capability → the Node module its provider exposes (the provider's own CLI module, which every transport shares). */
export const NODE_MODULES = { 'plans@1': 'plans.mjs', 'orchestrator@1': 'orchestrator.mjs' };

export function providerDir(capability) {
  let dirs = [];
  try { dirs = readdirSync(PLUGINS, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort(); } catch { return null; }
  for (const d of dirs) {
    try {
      const p = JSON.parse(readFileSync(join(PLUGINS, d, 'plugin.json'), 'utf8'));
      if ((p.provides ?? []).includes(`service:${capability}`) && existsSync(join(PLUGINS, d, NODE_MODULES[capability]))) return join(PLUGINS, d);
    } catch { /* not a plugin */ }
  }
  return null;
}

const cache = new Map();
export async function provider(capability) {
  if (!cache.has(capability)) {
    const dir = providerDir(capability);
    cache.set(capability, dir ? await import(pathToFileURL(join(dir, NODE_MODULES[capability])).href) : null);
  }
  const m = cache.get(capability);
  if (!m) throw new ControlError('not_implemented', `no installed plugin provides ${capability}`);
  return m;
}
