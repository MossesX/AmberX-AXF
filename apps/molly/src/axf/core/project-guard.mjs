#!/usr/bin/env node
/**
 * project-guard — the AmberX build rule for apps: no project is loaded or compiled without a validated manifest.
 * Baked into every app with core/ and run before dev and build (npm predev/prebuild for Next.js; React/Vite apps
 * use the axfProjectGuard plugin from core/project.ts instead). Exits 1 with the problems when the manifest is
 * missing or fails the rules in ../schemas/project-rules.json.
 *
 *   node src/axf/core/project-guard.mjs [project dir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT_MANIFEST_FILE, formatProjectValidation, validateProjectManifest } from './project-check.mjs';

const dir = resolve(process.argv[2] ?? '.');
const rules = JSON.parse(readFileSync(new URL('../schemas/project-rules.json', import.meta.url), 'utf8'));
const file = join(dir, PROJECT_MANIFEST_FILE);
if (!existsSync(file)) {
  console.error(`AXF: no ${PROJECT_MANIFEST_FILE} in ${dir}. A project can't be loaded or compiled without a validated manifest.`);
  process.exit(1);
}
let raw;
try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`AXF: ${PROJECT_MANIFEST_FILE} is not valid JSON (${e.message})`); process.exit(1); }
const v = validateProjectManifest(raw, rules, { exists: (p) => existsSync(join(dir, p)) });
if (!v.ok) {
  console.error(`AXF: the project manifest failed validation, so this project can't be loaded or compiled:\n${formatProjectValidation(v)}`);
  process.exit(1);
}
if (v.warnings.length) console.warn(formatProjectValidation(v));
