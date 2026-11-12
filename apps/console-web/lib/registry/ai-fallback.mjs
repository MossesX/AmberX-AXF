/**
 * The AI-fallback gate (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, Nov 10 2026, Brett:
 * "Anything that can possibly be done without AI needs to be, with AI only as a fallback by default unless you have made
 * Claude available to the console in Claude settings").
 *
 * Whether Claude may be asked is one owner-only Claude setting, `console.claudeAvailable` ("Make Claude available to
 * the console", default off). It is read through the plugin that provides `service:axf.claude-settings@1` (found by
 * capability, never by folder name) with its own CLI, so the hub-shared value every Claude session reads is the one used
 * here. `AXF_CLAUDE_AVAILABLE=1|0` overrides it (tests, offline). The answer is cached for a few seconds: a burst of
 * commands does not spawn a process each.
 *
 * Nothing here calls a model. `askClaude` is the seam the surfaces (REST s4, MCP s5, CLI s6) fill with the console's
 * assistant: it receives the fallback brief (the phrase, the closest entries, their actions and allowed values) and must
 * answer { id, action, params } or { none }. The registry validates whatever comes back before anything runs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './collect.mjs';

export const SETTING_KEY = 'console.claudeAvailable';
export const SETTING_LABEL = 'Make Claude available to the console';
export const CAPABILITY = 'service:axf.claude-settings@1';
export const CACHE_MS = 5000;
const PLUGINS = join(ROOT, 'apps', 'console-web', 'plugins');

let cache = { at: 0, value: null };

/** The CLI of the plugin that provides the Claude settings capability, or '' when none is installed. */
export function settingsCli(root = ROOT) {
  const dir = join(root, 'apps', 'console-web', 'plugins');
  if (!existsSync(dir)) return '';
  for (const d of readdirSync(dir).sort()) {
    try {
      const m = JSON.parse(readFileSync(join(dir, d, 'plugin.json'), 'utf8'));
      if (!m.provides?.includes(CAPABILITY)) continue;
      for (const f of [`${d}.mjs`, 'cli.mjs', 'settings.mjs']) if (existsSync(join(dir, d, f))) return join(dir, d, f);
    } catch { /* not a plugin */ }
  }
  return '';
}

/** The setting's value from the provider (spawns its CLI once per CACHE_MS). → { available, source } ; source = plugin | none. */
export function readSetting({ now = Date.now(), root = ROOT, cli = settingsCli(root) } = {}) {
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  let value = { available: false, source: 'none', why: 'no plugin provides the Claude settings capability' };
  if (cli) {
    try {
      const out = execFileSync('node', [cli, 'get', SETTING_KEY, '--json'], { cwd: root, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
      const j = JSON.parse(out.trim().split('\n').pop() || '{}');
      const v = j?.setting?.key === SETTING_KEY ? j.setting.value : j?.value ?? j?.settings?.find?.((s) => s.key === SETTING_KEY)?.value ?? j?.[SETTING_KEY];
      value = { available: v === true, source: 'plugin', ...(v === undefined ? { why: `${SETTING_KEY} is not in the Claude settings registry` } : {}) };
    } catch (e) { value = { available: false, source: 'none', why: `could not read Claude settings: ${String(e.message ?? e).slice(0, 160)}` }; }
  }
  cache = { at: now, value };
  return value;
}

/** Is Claude available to the console? env override first, then the setting. → { available, source: env | plugin | none, why? }. */
export function aiAvailable({ env = process.env, ...opts } = {}) {
  const o = env.AXF_CLAUDE_AVAILABLE;
  if (o !== undefined && o !== '') return { available: ['1', 'true', 'on', 'yes'].includes(String(o).toLowerCase()), source: 'env' };
  return readSetting(opts);
}

/** Forget the cached setting (after a change). */
export const forgetSetting = () => { cache = { at: 0, value: null }; };

/**
 * Ask the model, through the seam the surface provides. `ask(brief)` → { id, action, params } | { none } | a Promise of
 * one. With no `ask` attached the answer is { none: 'no model attached …' }: the gate was open, nobody was there to ask.
 */
export function askClaude(brief, { ask = null } = {}) {
  if (typeof ask !== 'function') return { none: 'no model is attached to this surface yet (the REST, MCP and CLI steps attach the console assistant)' };
  try { return ask(brief) ?? { none: 'the model answered nothing' }; } catch (e) { return { none: `the model failed: ${String(e.message ?? e).slice(0, 200)}` }; }
}
