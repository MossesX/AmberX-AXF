#!/usr/bin/env node
/**
 * check-conform — self-test for the asset-conformance checks (shared rule "Handwritten code conforms to the asset
 * system", Brett, Oct 31 2026; build asset-conform):
 *   1. check-theme.mjs fails on non-conformant web CSS / TSX and Kotlin UI in a generated app (outside the repo), and
 *      names the token to use;
 *   2. scale-adopt's adoptLine moves those literals onto tokens, and the adopted code passes;
 *   3. the frozen-code baseline only lists frozen code (Android Kotlin, Patches), never anything else.
 *
 *   node framework/spec/check-conform.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { adoptLine } from '../cli/scale-adopt.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let n = 0, bad = 0;
const ok = (c, msg) => { n += 1; if (!c) { bad += 1; console.log(`✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };
const theme = (dir) => spawnSync(process.execPath, [join(ROOT, 'framework/cli/check-theme.mjs'), dir], { encoding: 'utf8' });

const CSS = [
  '.x { padding: 6px 12px; margin: 0.5em 0; gap: 1px }',
  '.y { font-size: 0.8rem; border-radius: 8px; border: 2px solid var(--fx-border) }',
  '.z { font-family: Menlo, Consolas, monospace }',
];
const TSX = [
  "export const A = () => <div style={{ padding: 8, fontSize: 12, borderRadius: 4, gap: 6 }} />;",
  "export const B = () => <div style={{ borderLeft: '3px solid var(--fx-accent)', margin: '4px 8px' }} />;",
];
const tmp = mkdtempSync(join(tmpdir(), 'axf-conform-'));
try {
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(join(tmp, 'src/a.css'), CSS.join('\n'));
  writeFileSync(join(tmp, 'src/a.tsx'), TSX.join('\n'));
  writeFileSync(join(tmp, 'Bad.kt'), 'package a\nimport androidx.compose.ui.unit.dp\nval m = Modifier.padding(12.dp)\nval c = Color(0xFF00FF00)\nval s = 14.sp\n@Composable fun X() { Button(onClick = {}) {} }\n');
  const r = theme(tmp);
  ok(r.status === 1, 'non-conformant generated code fails the check');
  for (let i = 1; i <= CSS.length; i++) ok(r.stdout.includes(`src/a.css:${i}`), `css line ${i} is named file:line`);
  for (let i = 1; i <= TSX.length; i++) ok(r.stdout.includes(`src/a.tsx:${i}`), `tsx line ${i} is named file:line`);
  ok(/→ use .*var\(--fx-dens-gap-lg\)/.test(r.stdout) && r.stdout.includes('var(--fx-font-mono)'), 'findings name the token to use');
  for (const l of [3, 4, 5, 6]) ok(r.stdout.includes(`Bad.kt:${l}`), `kotlin line ${l} (padding dp / Color / sp / raw Button) is flagged`);
  ok(r.stdout.includes('Axf.space.x(1.5)'), 'kotlin dp finding names Axf.space.x(n)');

  // adopt the web files, then they pass
  rmSync(join(tmp, 'Bad.kt'));
  writeFileSync(join(tmp, 'src/a.css'), CSS.map(adoptLine).join('\n'));
  writeFileSync(join(tmp, 'src/a.tsx'), TSX.map(adoptLine).join('\n'));
  const after = theme(tmp);
  ok(after.status === 0, `scale-adopt makes them conform${after.status ? `\n${after.stdout}` : ''}`);
  ok(adoptLine('font-family: var(--fx-font-mono);') === 'font-family: var(--fx-font-mono);' && adoptLine("fontFamily: 'basic'") === "fontFamily: 'basic'", 'adopt leaves tokens and non-font values alone');
  ok(adoptLine('push(`font-family: ${f}`)') === 'push(`font-family: ${f}`)', 'adopt leaves template-literal CSS builders alone');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const base = JSON.parse(readFileSync(join(ROOT, 'framework/spec/conform-baseline.json'), 'utf8'));
const stray = Object.keys(base.files ?? {}).filter((f) => !(f.endsWith('.kt') && !/^framework\/(templates|library-templates|boilerplates)\//.test(f)) && !/^apps\/patches(-web)?\//.test(f));
ok(!stray.length, `baseline only holds frozen code (Android Kotlin, Patches)${stray.length ? `: ${stray.join(', ')}` : ''}`);

console.log(bad ? `✗ ${bad} of ${n} conformance self-checks failed` : `✓ conformance self-test — ${n} checks`);
process.exit(bad ? 1 : 0);
