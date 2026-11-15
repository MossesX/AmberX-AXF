#!/usr/bin/env node
/**
 * upgrade-policy — reads the owner-only Claude setting "Fable upgrades need my approval" (`builds.fableUpgradeApproval`,
 * default off; Brett, Nov 4 2026) and sets it on framework/core/model-switch.mjs for this process.
 *
 * The setting lives in the Claude settings document on axHub (`/projects/_shared/_data/claude/settings.json`, or
 * AXF_CLAUDE_SETTINGS_FILE). A missing document or key = the default (off: upgrades run by themselves).
 * AXF_FABLE_UPGRADE_APPROVAL=1 forces approvals on (tests, a stricter run); nothing in the environment can turn them
 * off when Brett has them on.
 *
 *   node framework/cli/upgrade-policy.mjs [--json]     what is in force and where it came from
 *   node framework/cli/upgrade-policy.mjs --rule       the model-switch line a brief carries for it (claude-headless.sh)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPGRADE_SETTING, setUpgradePolicy, switchRule } from '../core/model-switch.mjs';

export function settingsFile(env = process.env) {
  if (env.AXF_CLAUDE_SETTINGS_FILE) return env.AXF_CLAUDE_SETTINGS_FILE;
  const projects = env.AXHUB_PROJECTS_DIR || '/projects';
  return join(projects, '_shared', '_data', 'claude', 'settings.json');
}

/** { approvalRequired, source } from the setting (no side effects). */
export function readUpgradePolicy(env = process.env) {
  if (['1', 'true', 'on'].includes(String(env.AXF_FABLE_UPGRADE_APPROVAL ?? '').toLowerCase())) return { approvalRequired: true, source: 'AXF_FABLE_UPGRADE_APPROVAL' };
  const f = settingsFile(env);
  let v;
  try { if (existsSync(f)) v = JSON.parse(readFileSync(f, 'utf8'))?.values?.[UPGRADE_SETTING]; } catch { v = undefined; }
  if (typeof v === 'boolean') return { approvalRequired: v, source: `${UPGRADE_SETTING} (${f})` };
  return { approvalRequired: false, source: `${UPGRADE_SETTING} default (off)` };
}

/** Read the setting and put it in force for this process. */
export const loadUpgradePolicy = (env = process.env) => setUpgradePolicy(readUpgradePolicy(env));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = readUpgradePolicy();
  if (process.argv.includes('--rule')) { console.log(switchRule(p.approvalRequired)); process.exit(0); }
  console.log(process.argv.includes('--json') ? JSON.stringify({ ok: true, ...p })
    : `Fable upgrades need Brett's approval: ${p.approvalRequired ? 'ON (an upgrade waits for his console click or axHub approval)' : 'off (an upgrade runs by itself and is recorded)'} — ${p.source}`);
}
