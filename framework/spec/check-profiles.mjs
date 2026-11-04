#!/usr/bin/env node
// Build profiles registry guard (Brett, Oct 31 2026): every build profile folder must be registered in
// framework/plan/profiles.json, or the Console never sees it (Angel and Breakroom sat unregistered).
// Fails when a folder under _claude/builds/profiles/ or framework/plan/profiles/ has no registry entry,
// or when the registry has duplicate ids.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(readFileSync(join(ROOT, 'framework/plan/profiles.json'), 'utf8'));
const errors = [];
if (registry.$axf !== 'build-profiles@1') errors.push('framework/plan/profiles.json: $axf must be build-profiles@1');
const ids = (registry.profiles ?? []).map((p) => p.id);
const seen = new Set();
for (const id of ids) {
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`registry: bad profile id "${id}"`);
  if (seen.has(id)) errors.push(`registry: duplicate profile id "${id}"`);
  seen.add(id);
}
if (registry.active && !seen.has(registry.active)) errors.push(`registry: active profile "${registry.active}" is not registered`);

const folders = ['_claude/builds/profiles', 'framework/plan/profiles'];
let checked = 0;
for (const rel of folders) {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!statSync(join(dir, name)).isDirectory()) continue;
    checked++;
    if (!seen.has(name)) errors.push(`${rel}/${name}/ exists but "${name}" is not in framework/plan/profiles.json`);
  }
}

if (errors.length) {
  console.error(`check-profiles: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-profiles: ok (${ids.length} registered, ${checked} profile folders checked)`);
