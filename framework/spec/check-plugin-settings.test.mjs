#!/usr/bin/env node
/**
 * Unit test for framework/cli/check-plugin-settings.mjs (build every-plugin-screen-gets-a-settings-gear): fixture plugin
 * trees in a temporary folder, the check run against them with --root.
 *
 *   node framework/spec/check-plugin-settings.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = resolve(dirname(fileURLToPath(import.meta.url)), '../cli/check-plugin-settings.mjs');
let n = 0;
const ok = (c, what) => { if (!c) { console.error(`✗ ${what}`); process.exit(1); } n++; };

function tree({ host = true, plugins }) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-settings-'));
  mkdirSync(join(root, 'apps/console-web/src'), { recursive: true });
  if (host) {
    writeFileSync(join(root, 'apps/console-web/src/PluginSettingsGear.tsx'), 'export function PluginViewHost() {}\n');
    writeFileSync(join(root, 'apps/console-web/src/pluginLoader.tsx'), "import { PluginViewHost } from './PluginSettingsGear';\n");
  }
  for (const [folder, p] of Object.entries(plugins)) {
    const dir = join(root, 'apps/console-web/plugins', folder);
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ $axf: 'plugin@1', id: `ai.test.${folder}`, name: folder, ...(p.manifest ?? {}) }, null, 2));
    writeFileSync(join(dir, 'web/index.tsx'), p.web);
  }
  return root;
}

function run(root, ...args) {
  try { return { code: 0, out: execFileSync('node', [CHECK, `--root=${root}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
}

const VIEW = "export const plugin = {\n  views: { a: { title: 'A', render: () => null } },\n";
const TAB = "  settingsTabs: [{ id: 'a', label: 'A', parent: 'plugins' }],\n";
const roots = [];
try {
  // 1. a screen with a sub-tab, under the host gear: passes
  let root = tree({ plugins: { good: { web: `${VIEW}${TAB}};\n` } } });
  roots.push(root);
  let r = run(root);
  ok(r.code === 0, `a screen with a tab and the host gear passes (${r.out})`);

  // 2. a screen with no settings sub-tab: fails with file:line
  root = tree({ plugins: { notab: { web: `${VIEW}};\n` } } });
  roots.push(root);
  r = run(root);
  ok(r.code === 1, 'a screen without a sub-tab fails');
  ok(/apps\/console-web\/plugins\/notab\/web\/index\.tsx:2: notab has a screen but no settings sub-tab/.test(r.out), `names file:line (${r.out})`);
  ok(run(root, '--report').code === 0, '--report never fails');

  // 3. plugin.json settingsTab.default counts as the sub-tab
  root = tree({ plugins: { deflt: { manifest: { settingsTab: { default: true } }, web: `${VIEW}};\n` } } });
  roots.push(root);
  ok(run(root).code === 0, 'settingsTab: { default: true } is a sub-tab');

  // 4. no host gear and no gear of its own: fails
  root = tree({ host: false, plugins: { nogear: { web: `${VIEW}${TAB}};\n` } } });
  roots.push(root);
  r = run(root);
  ok(r.code === 1 && /nogear has a screen with no settings gear/.test(r.out), `no gear fails (${r.out})`);

  // 5. a hand-made gear next to the host gear: fails (two gears on one screen)
  const own = "const X = () => <IconButton icon=\"settings\" label=\"S\" onClick={() => rt.dispatch('settings.open:a')} />;\n";
  root = tree({ plugins: { twogears: { web: `${own}${VIEW}${TAB}};\n` } } });
  roots.push(root);
  r = run(root);
  ok(r.code === 1 && /twogears\/web\/index\.tsx:1: twogears draws its own settings gear/.test(r.out), `a second gear fails (${r.out})`);

  // 6. opt-out with a reason passes, without a reason fails
  root = tree({ plugins: { optout: { manifest: { settingsGear: false, settingsGearReason: 'full-screen canvas' }, web: `${VIEW}${TAB}};\n` } } });
  roots.push(root);
  ok(run(root).code === 0, 'settingsGear: false with a reason passes');
  root = tree({ plugins: { bare: { manifest: { settingsGear: false }, web: `${VIEW}${TAB}};\n` } } });
  roots.push(root);
  r = run(root);
  ok(r.code === 1 && /bare sets "settingsGear": false without a "settingsGearReason"/.test(r.out), `opt-out without a reason fails (${r.out})`);

  // 7. a settings-only plugin (no views) is not held to the gear; a type literal named views is not a screen
  root = tree({ plugins: { headless: { web: `type T = { views: { id: string; title: string } };\nexport const plugin = {\n${TAB}};\n` } } });
  roots.push(root);
  r = run(root, '--json');
  const j = JSON.parse(r.out);
  ok(j.withView === 0 && j.problems.length === 0, 'no screen, nothing to check');

  console.log(`✓ check-plugin-settings — ${n} checks`);
} finally {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
