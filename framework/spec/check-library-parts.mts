/**
 * library@1 parts (features inside a library) on the web port + the CLI installer, against spec/fixtures/library-parts.json.
 * CI: npx -y tsx framework/spec/check-library-parts.mts. Kotlin twin deferred (PORTING.md).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { includedParts, partDefaults, partErrors, partNeededBy, partOn, resolvePartConfig, type LibraryPart } from '../core/library';
import { resolveParts } from '../cli/libraries.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/library-parts.json'), 'utf8'));
const parts: LibraryPart[] = f.parts;
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

eq(partDefaults(parts), f.defaults, 'defaults');
for (const c of f.cases) {
  eq(partErrors(parts, c.answers), c.errors, `${c.name}: errors`);
  if (c.errors.length) {
    let threw = false; try { resolveParts(parts, c.answers); } catch { threw = true; }
    eq(threw, true, `${c.name}: CLI refuses`);
    continue;
  }
  eq(includedParts(parts, c.answers), c.included, `${c.name}: included`);
  eq(resolvePartConfig(parts, c.answers), c.config, `${c.name}: config`);
  eq(resolveParts(parts, c.answers ?? undefined), c.config, `${c.name}: CLI config`);
}
for (const c of f.neededBy) eq(partNeededBy(parts, c.included, c.id), c.by, `needed by ${c.id}`);
for (const c of f.runtime) eq(partOn(c.config, c.id, parts), c.on, `partOn ${c.id} ${JSON.stringify(c.config)}`);
console.log(`check-library-parts: ${n} checks ok`);
