#!/usr/bin/env node
/**
 * Build the harness page: esbuild bundles test/harness.ts (+ the fixture page test/page.html) into a temp folder
 * with framework/ui/axf.css. Prints the folder. Used by themed-controls.spec.ts and by hand:
 *   node apps/console-web/plugins/themed-controls/test/run.mjs [outDir]
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../../..');
export async function buildHarness(out = mkdtempSync(join(tmpdir(), 'tc-harness-'))) {
  mkdirSync(out, { recursive: true });
  await build({ entryPoints: [join(here, 'harness.ts')], bundle: true, outfile: join(out, 'harness.js'), format: 'esm', target: 'es2022', alias: { '@console': join(app, 'src') }, logLevel: 'error', jsx: 'automatic' });
  copyFileSync(join(app, 'src/axf/ui/axf.css'), join(out, 'axf.css'));
  writeFileSync(join(out, 'index.html'), readFileSync(join(here, 'page.html'), 'utf8'));
  return out;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildHarness(process.argv[2]));
