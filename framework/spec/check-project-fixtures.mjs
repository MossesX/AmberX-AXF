#!/usr/bin/env node
/** Conformance: the build engine's project validator (cli/project.mjs) must report what the reference did. */
import { readFileSync } from 'node:fs';
import { baseRules, validateProjectManifest } from '../cli/project.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/project-manifest.json', import.meta.url), 'utf8'));
const rules = baseRules();
let failed = 0;
for (const [name, f] of Object.entries(fixtures)) {
  const v = validateProjectManifest(f.manifest, rules, f.existing ? { exists: (p) => f.existing.includes(p) } : {});
  const got = { ok: v.ok, errors: v.errors.map((e) => e.rule), warnings: v.warnings.map((w) => w.rule) };
  const want = { ok: f.ok, errors: f.errors, warnings: f.warnings };
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed += 1; console.error(`✗ ${name}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`); }
}
console.log(failed ? `${failed} project-manifest fixture(s) differ` : `✓ project-manifest fixtures: ${Object.keys(fixtures).length} cases match the reference`);
process.exit(failed ? 1 : 0);
