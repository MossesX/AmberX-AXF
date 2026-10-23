/**
 * Self-test for the library@1 parameter rules on the web port (CI: npx -y tsx framework/spec/check-library-params.mts).
 * Replays spec/fixtures/library-params.json through core/library.ts (the Kotlin LibraryParamsTest replays the same file)
 * and checks the CLI's coerceParam (cli/libraries.mjs) agrees with paramToJson / paramError on every case.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY_PARAM_TYPES, PARAM_TRUE_WORDS, paramBool, paramDefaultText, paramDefaults, paramError, paramToJson, type LibraryParam } from '../core/library';
import { coerceParam } from '../cli/libraries.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/library-params.json'), 'utf8'));
let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

eq([...LIBRARY_PARAM_TYPES], f.types, 'types');
eq([...PARAM_TRUE_WORDS], f.trueWords, 'true words');
const params: LibraryParam[] = f.params;
eq(paramDefaults(params), f.defaults, 'defaults');
for (const c of f.cases) {
  const p = params.find((x) => x.key === c.key)!;
  eq(paramDefaultText(p), c.defaultText, `${c.key} default text`);
  if (p.type === 'bool') eq(paramBool(p, c.text), c.bool, `${c.key} bool '${c.text}'`);
  eq(JSON.parse(JSON.stringify(paramToJson(p, c.text) ?? null)), c.json, `${c.key} json '${c.text}'`);
  eq(paramError(p, c.text), c.error, `${c.key} error '${c.text}'`);
  // The CLI installer coerces the same text: a case with an error throws, a valid one gives the same value (or the default for blank).
  let cli: unknown; let threw = false;
  try { cli = coerceParam(p, c.text.trim()); } catch { threw = true; }
  if (c.error) eq(threw, true, `${c.key} cli rejects '${c.text}'`);
  else if (!c.text.trim()) eq(cli, p.default, `${c.key} cli default for blank`);
  else eq(cli, c.json, `${c.key} cli value '${c.text}'`);
}
console.log(`check-library-params: ${checks} checks ok`);
