#!/usr/bin/env node
/**
 * check-banner-widgets: every chip on the banner comes through the one widget registry (rt.attachToBanner or the banner
 * asset's `attach` list), so it shows up in the Widgets picker and takes the person's size, hide and overflow choices.
 *
 *   1. fails on a hard-coded chip: `fx-banner__item` or `fx-banner__side` outside the framework's own banner components;
 *   2. warns on an attachToBanner call with no `widget:` hint (it still works, its picker name is the asset's name).
 *
 *   node framework/cli/check-banner-widgets.mjs [--json]
 * Exit 1 on any failure. Baked framework copies (`src/axf`), node_modules and tests are skipped.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OWNERS = new Set(['framework/react/components/Banner.tsx', 'framework/react/components/BannerWidgets.tsx', 'framework/react/components/BannerStrip.tsx']);
const SKIP = new Set(['node_modules', 'dist', 'axf', '.git', 'build']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/(^|\.)test\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const apps = readdirSync(join(ROOT, 'apps')).flatMap((a) => [join(ROOT, 'apps', a, 'src'), join(ROOT, 'apps', a, 'plugins')]);
const files = [...walk(join(ROOT, 'framework/react')), ...walk(join(ROOT, 'framework/libs')), ...apps.flatMap((d) => walk(d))];
const failures = [];
const warnings = [];
for (const f of files) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (!OWNERS.has(rel) && /fx-banner__(item|side)\b/.test(line)) failures.push({ file: rel, line: i + 1, why: 'hard-coded banner chip: attach it with rt.attachToBanner({ type, id, at, origin, widget: { label } })' });
    if (/\.attachToBanner\(\{/.test(line) && !/widget:/.test(line)) warnings.push({ file: rel, line: i + 1, why: 'no `widget:` hint: give it a label and a size for the Widgets picker' });
  });
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ failures, warnings }, null, 2));
else {
  for (const w of warnings) console.log(`warn ${w.file}:${w.line} ${w.why}`);
  for (const w of failures) console.log(`FAIL ${w.file}:${w.line} ${w.why}`);
  console.log(failures.length ? `check-banner-widgets: ${failures.length} hard-coded chip(s)` : `check-banner-widgets: ok, ${files.length} files, ${warnings.length} without a hint`);
}
process.exit(failures.length ? 1 : 0);
