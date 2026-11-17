#!/usr/bin/env node
/**
 * Every plugin REST route has an MCP twin and a voice twin.
 *
 *  - MCP: each route command of every console plugin (plugin-commands@1 registry) projects to an MCP tool
 *    (`pluginCommandTools`). A route the registry can't expose fails in check-plugin-commands.mjs; this checks the tool
 *    is really there.
 *  - Voice: a plugin with a `voice.json` (phrases the console's voice endpoint hands it through plugin_services
 *    `axf.voice-phrases@1:<folder>`) covers every one of its route commands with a phrase (`covers`) or says why not
 *    (`skip`). Phrases are well formed, ids unique, every `covers` / `skip` names a real command.
 *  - Ratchet: plugins with REST routes and no voice.json yet are listed in `plugin-voice-baseline.json` (reachable by
 *    voice only through Amber picking their MCP tool). A plugin with routes that is not in the baseline must ship a
 *    voice.json; a baseline entry that now has one, or has no routes, fails until it is taken off the list.
 *
 *   node framework/spec/check-plugin-voice.mjs [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginCommandTools } from '../core/engines/plugin-commands.mjs';
import { ROOT, registry } from '../cli/plugin-commands.mjs';

const json = process.argv.includes('--json');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const BASELINE_FILE = join(ROOT, 'framework/spec/plugin-voice-baseline.json');
const baseline = new Set(readJson(BASELINE_FILE).plugins);
const SLOT = /\{([a-z][a-zA-Z0-9]*)\}/g;

/** Problems in one plugin's voice.json against its commands (exported shape kept small so tests can call it). */
export function voiceProblems(doc, commandIds, routeIds) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.commands)) return ['voice.json needs a commands array'];
  const ids = new Set(); const covered = new Set();
  doc.commands.forEach((c, i) => {
    const at = `commands[${i}]${c?.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c.id)) errors.push(`${at}: id must be lower case words with dashes`);
    else if (ids.has(c.id)) errors.push(`${at}: id used twice`); else ids.add(c.id);
    if (typeof c?.op !== 'string' || !c.op) errors.push(`${at}: needs an op`);
    if (!Array.isArray(c?.phrases) || !c.phrases.length) errors.push(`${at}: needs at least one phrase`);
    for (const p of c?.phrases ?? []) {
      if (typeof p !== 'string' || !p.trim()) { errors.push(`${at}: empty phrase`); continue; }
      if (!p.replace(SLOT, '').trim()) errors.push(`${at}: "${p}" has no words of its own, only slots`);
      if (/\}\s*\{/.test(p)) errors.push(`${at}: "${p}" has two slots side by side (no word between them to split on)`);
    }
    if (!Array.isArray(c?.covers) || !c.covers.length) errors.push(`${at}: covers must name the plugin commands it drives`);
    for (const id of c?.covers ?? []) { if (!commandIds.has(id)) errors.push(`${at}: covers ${id}, which is not one of the plugin's commands`); else covered.add(id); }
  });
  const skip = doc.skip && typeof doc.skip === 'object' ? doc.skip : {};
  for (const [id, why] of Object.entries(skip)) {
    if (!commandIds.has(id)) errors.push(`skip names ${id}, which is not one of the plugin's commands`);
    if (typeof why !== 'string' || why.trim().length < 10) errors.push(`skip ${id} must say why`);
  }
  for (const id of routeIds) if (!covered.has(id) && !(id in skip)) errors.push(`route command ${id} has no voice phrase: add it to a command's covers in voice.json, or to skip with why`);
  return errors;
}

const reg = registry({ apps: ['console-web'] });
const tools = new Set(pluginCommandTools(reg).map((t) => `${t.plugin}/${t.command}`));
const out = []; let failed = 0;
for (const p of reg.plugins) {
  const routeCmds = p.commands.filter((c) => c.run?.route);
  const errors = [];
  for (const c of routeCmds) if (!tools.has(`${p.folder}/${c.id}`)) errors.push(`route command ${c.id} has no MCP tool`);
  const vf = join(ROOT, 'apps/console-web/plugins', p.folder, 'voice.json');
  const hasVoice = existsSync(vf);
  if (hasVoice) {
    let doc = null;
    try { doc = readJson(vf); } catch (e) { errors.push(`voice.json is not JSON: ${e.message}`); }
    if (doc) errors.push(...voiceProblems(doc, new Set(p.commands.map((c) => c.id)), routeCmds.map((c) => c.id)));
    if (baseline.has(p.folder)) errors.push('has a voice.json now: take it off framework/spec/plugin-voice-baseline.json');
  } else if (routeCmds.length && !baseline.has(p.folder)) {
    errors.push(`${routeCmds.length} REST route commands and no voice twin: ship voice.json (phrases → commands, see todo-manager) so it can be driven by voice`);
  }
  if (!routeCmds.length && baseline.has(p.folder)) errors.push('has no REST routes: take it off framework/spec/plugin-voice-baseline.json');
  if (errors.length) failed++;
  out.push({ folder: p.folder, routes: routeCmds.length, voice: hasVoice ? 'phrases' : routeCmds.length ? 'amber-only (baseline)' : 'none needed', ok: !errors.length, errors });
}
for (const b of baseline) if (!reg.plugins.some((p) => p.folder === b)) { failed++; out.push({ folder: b, ok: false, errors: ['in plugin-voice-baseline.json but no such plugin: take it off'] }); }

if (json) console.log(JSON.stringify(out, null, 2));
else {
  for (const r of out.filter((x) => !x.ok)) console.log(`✗ ${r.folder}\n${r.errors.map((e) => `    ${e}`).join('\n')}`);
  const withVoice = out.filter((x) => x.voice === 'phrases').length;
  console.log(`plugin voice twins: ${out.length} plugins, ${withVoice} with phrases, ${baseline.size} on the baseline (voice through Amber only), ${failed} failing`);
}
process.exit(failed ? 1 : 0);
