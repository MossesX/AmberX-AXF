#!/usr/bin/env node
/**
 * `skins.mjs config` end to end on a scratch hub folder (skin-config@1 + the AI skin maker):
 *   node framework/spec/check-skins-config-cli.mjs
 * get / allow / lock / ask / inherit / depth / mode / reset / put / default / brief / hold / make / made, with a fake
 * generator (AXF_SKIN_MAKER_CMD) so no model runs. Checks the brief carries no locked option, the made skin keeps every
 * locked part as the Default skin has it, and every dropped change is listed back.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'framework/cli/skins.mjs');
const hub = mkdtempSync(join(tmpdir(), 'axf-skins-config-'));
mkdirSync(join(hub, 'settings'));
writeFileSync(join(hub, 'settings/appearance.json'), JSON.stringify({ slots: {}, spacing: 'regular' }));
const gen = join(hub, 'gen.sh');
writeFileSync(gen, `cat >/dev/null\necho 'Sure: {"skin":{"colorTheme":"aurora-night","iconPack":"amberx-filled","wallpaper":"x","extras":{"spacing":"compact"}}}'\n`);
const env = { ...process.env, AXF_APPEARANCE_FILE: join(hub, 'settings/appearance.json'), AXF_LOOKS_DIR: join(hub, 'settings/looks'), AXF_SKINS_DIR: join(hub, 'settings/skins'), AXF_SKIN_CONFIG_DIR: join(hub, 'settings/skin-config'), AXF_SKIN_MAKER_CMD: `sh ${gen}` };
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { env, encoding: 'utf8' });
  const out = JSON.parse(r.stdout || '{}');
  return out;
};
const ok = (...args) => { const o = run(...args); assert.ok(o.ok, `${args.join(' ')}: ${o.error}`); return o.result; };
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const APP = 'global';

t('a new config allows everything and is stored per app on the hub only when changed', () => {
  const s = ok('config', 'get', APP);
  assert.equal(s.config.app, APP);
  assert.equal(s.counts.lock, 0);
  assert.ok(!existsSync(join(hub, 'settings/skin-config/global.json')));
});
t('lock / ask / allow / inherit a category, group or option', () => {
  let s = ok('config', 'lock', APP, 'color-theme');
  assert.equal(s.options['color-theme/pick/asset'].mode, 'lock');
  s = ok('config', 'ask', APP, 'button/pick');
  assert.equal(s.options['button/pick/asset'].mode, 'ask');
  s = ok('config', 'inherit', APP, 'button/pick');
  assert.equal(s.options['button/pick/asset'].mode, 'allow');
  assert.equal(JSON.parse(readFileSync(join(hub, 'settings/skin-config/global.json'), 'utf8')).$axf, 'skin-config@1');
  assert.equal(run('config', 'lock', APP, 'nowhere').ok, false);
});
t('depth: set, clamp, default', () => {
  assert.equal(ok('config', 'depth', APP, 'context-menu', '1').limits['context-menu/depth'], 1);
  assert.equal(ok('config', 'depth', APP, 'nav-menu', '99').limits['nav-menu/depth'], 4);
  assert.equal(ok('config', 'depth', APP, 'nav-menu', 'default').limits['nav-menu/depth'], 2);
  assert.equal(run('config', 'depth', APP, 'context-menu', 'deep').ok, false);
});
t('the brief carries only allowed options and the limits', () => {
  const b = ok('config', 'brief', APP, '--wish', 'calm dark');
  assert.equal(b.contract, 'skin-maker@1');
  assert.equal(b.wish, 'calm dark');
  assert.ok(!b.allowed.some((a) => a.path.startsWith('color-theme')));
  assert.ok(!b.lines.join(' ').includes('Colour theme'));
  assert.equal(b.limits.find((l) => l.path === 'context-menu/depth').max, 1);
  assert.ok(!('color-theme' in b.choices));
});
t('make: the locked colour theme stays the Default\'s, the rest is applied, every drop is listed', () => {
  const j = ok('config', 'make', APP, '--wish', 'calm dark');
  assert.equal(j.status, 'done');
  const skin = JSON.parse(readFileSync(join(hub, 'settings/skin-config/made/skins', `${j.skin}.json`), 'utf8'));
  const def = ok('config', 'get', APP).defaultSkin;
  assert.ok(def.id);
  assert.notEqual(skin.data.colorTheme, 'aurora-night');
  assert.equal(skin.data.iconPack, 'amberx-filled');
  assert.equal(skin.data.extras.spacing, 'compact');
  assert.ok(j.dropped.some((d) => d.why === 'locked' && d.path === 'color-theme/pick/asset'));
  assert.ok(j.dropped.some((d) => d.why === 'unknown' && d.path === 'skin/wallpaper'));
  assert.ok(j.droppedLines.length === j.dropped.length);
  assert.equal(ok('config', 'made', APP)[0].id, j.id);
  assert.ok(ok('list').some((r) => r.id === j.skin && r.madeBy === 'ai'));
});
t('hold checks an output without saving; dry make is the brief only', () => {
  const f = join(hub, 'out.json');
  writeFileSync(f, JSON.stringify({ skin: { colorTheme: 'aurora-night' } }));
  const h = ok('config', 'hold', APP, '--from', f);
  assert.equal(h.dropped[0].why, 'locked');
  assert.equal(ok('config', 'make', APP, '--dry').status, 'brief');
});
t('mode, put, reset', () => {
  assert.equal(ok('config', 'mode', APP, 'lock').default, 'lock');
  const s = ok('config', 'put', APP, '--json-doc', JSON.stringify({ $axf: 'skin-config@1', app: APP, default: 'lock', categories: { button: { mode: 'allow' } } }));
  assert.equal(s.options['button/pick/asset'].mode, 'allow');
  assert.equal(s.options['color-theme/pick/asset'].mode, 'lock');
  assert.equal(run('config', 'put', APP, '--json-doc', JSON.stringify({ $axf: 'skin-config@1', categories: { ghost: {} } })).ok, false);
  assert.deepEqual(ok('config', 'reset', APP).config.categories, {});
});
t('save the current look as the Default skin (idempotent)', () => {
  const a = ok('config', 'default', APP);
  assert.equal(a.skin, 'default-global');
  assert.ok(['create', 'update', 'keep'].includes(a.action));
  assert.equal(ok('config', 'default', APP).action, 'keep');
});
t('no generator: make says so and returns the brief', () => {
  const r = spawnSync(process.execPath, [CLI, 'config', 'make', APP, '--json'], { env: { ...env, AXF_SKIN_MAKER_CMD: 'off' }, encoding: 'utf8' });
  const o = JSON.parse(r.stdout).result;
  assert.equal(o.status, 'brief');
  assert.match(o.error, /AXF_SKIN_MAKER_CMD/);
});

console.log(`✓ skins.mjs config: ${n} checks passed`);
