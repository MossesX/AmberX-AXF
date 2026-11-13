#!/usr/bin/env node
// The Android hold is lifted (Nov 13 2026): no rules brief, rules file or brief template may tell a build to skip
// its Android/Kotlin twin; the headless rules brief tells it to build the twin in parallel instead.
//   node framework/spec/check-rules-android.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const BANNED = [
  /no new Android or Kotlin work/i,
  /All Android work is on hold/i,
  /Android work is on hold except/i,
  /framework Android code is on hold/i,
  /record the twin as a deferred gap/i,
];
const PARALLEL = /Android\/Kotlin twin[s]? (?:is |are )?(?:built )?in parallel|Build the Android\/Kotlin twin in parallel/i;

const FILES = [
  'framework/schemas/rules-briefs.json',
  '_claude/rules/RULES.md',
  '_claude/shared/rules/RULES.md',
];
// Plugin brief templates and agent skill/notes files: scanned without naming any plugin folder.
const PLUGINS = 'apps/console-web/plugins';
const walk = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((e) => {
  const r = `${rel}/${e.name}`;
  if (e.isDirectory()) return ['node_modules', 'dist', 'data', '.cache'].includes(e.name) ? [] : walk(r);
  return /\.(md|mjs|py)$/.test(e.name) ? [r] : [];
});
FILES.push(...walk(PLUGINS));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

for (const f of FILES) {
  t(`${f} carries no Android hold`, () => {
    const s = read(f);
    for (const re of BANNED) assert.ok(!re.test(s), `${f} still says ${re}`);
  });
}

t('rules brief seed says build the twin in parallel', () => {
  assert.match(read('framework/schemas/rules-briefs.json'), PARALLEL);
});

t('composed headless rules brief has no hold and says parallel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-android-'));
  const brief = join(dir, 'brief.md');
  writeFileSync(brief, '# Build: demo\n\n## What to build\nChange a reference engine and its Compose screen.\n');
  const out = execFileSync(process.execPath, [join(ROOT, 'framework/cli/rules-brief.mjs'), 'compose', '--brief', brief, '--model', 'opus', '--build', 'demo'], {
    encoding: 'utf8',
    env: { ...process.env, AXF_RULES_BRIEFS_FILE: join(dir, 'none.json') },
  });
  for (const re of BANNED) assert.ok(!re.test(out), `composed brief still says ${re}`);
  assert.match(out, PARALLEL);
});

t('RULES.md carries the parallel rule', () => {
  assert.match(read('_claude/rules/RULES.md'), /Android\/Kotlin twins are built in parallel/);
});

console.log(`✓ rules-android: ${n} checks`);
