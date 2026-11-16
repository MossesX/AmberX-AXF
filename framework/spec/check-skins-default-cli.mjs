#!/usr/bin/env node
/**
 * `skins.mjs` hub default skin, backups and capture end to end on a scratch hub folder:
 *   node framework/spec/check-skins-default-cli.mjs
 * default get / set (backups first) / set --adopt / adopt / off, backup / backups / restore --backup / restore-backup,
 * snapshot --from --as, and the compile diff of the shipped Console (default) skin against its look snapshot.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'framework/cli/skins.mjs');
const SNAP = join(ROOT, '_claude/builds/reports/console-look-becomes-default-axhub-skin/snapshot-before.json');
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const hub = mkdtempSync(join(tmpdir(), 'axf-skins-default-'));
mkdirSync(join(hub, 'looks'));
writeFileSync(join(hub, 'appearance.json'), JSON.stringify(snap.raw.appearance));
writeFileSync(join(hub, 'looks/axf-console.json'), JSON.stringify(snap.raw.look));
// a second app with its own edit (a hidden toolbar) and an override-only look
writeFileSync(join(hub, 'looks/axhub-web.json'), JSON.stringify({ $axf: 'app-look@1', app: 'axhub-web', default: { slots: { 'color-theme': 'hub-night' } }, own: { hidden: { toolbar: true }, slots: { 'nav-menu': 'amber-signature' } }, skin: { use: false, inherit: false, id: 'windows', overrides: {} }, scopes: {}, undo: null }));
const env = { ...process.env, AXF_APPEARANCE_FILE: join(hub, 'appearance.json'), AXF_LOOKS_DIR: join(hub, 'looks'), AXF_SKINS_DIR: join(hub, 'skins'), AXF_SKIN_CONFIG_DIR: join(hub, 'skin-config') };
const run = (...args) => JSON.parse(spawnSync(process.execPath, [CLI, ...args, '--json'], { env, encoding: 'utf8' }).stdout || '{}');
const ok = (...args) => { const o = run(...args); assert.ok(o.ok, `${args.join(' ')}: ${o.error}`); return o.result; };
const bad = (...args) => { const o = run(...args); assert.ok(!o.ok, `${args.join(' ')} should fail`); return o.error; };
const look = (app) => JSON.parse(readFileSync(join(hub, `looks/${app}.json`), 'utf8'));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('no default yet', () => { const g = ok('default', 'get'); assert.equal(g.defaultSkin, null); assert.ok(g.apps.every((a) => !a.inherit)); });
t('an unknown skin is refused', () => assert.match(bad('default', 'set', 'nope'), /no skin/));
t('set without adopt: backups first, pointer, looks untouched', () => {
  const r = ok('default', 'set', 'console-default');
  assert.equal(r.defaultSkin.id, 'console-default');
  assert.deepEqual(r.backups.map((b) => b.app).sort(), ['axf-console', 'axhub-web']);
  assert.equal(look('axf-console').skin.use, true, 'Use skin stays on without --adopt');
  assert.equal(look('axf-console').backups.length, 1);
  assert.equal(JSON.parse(readFileSync(join(hub, 'appearance.json'), 'utf8')).defaultSkin.id, 'console-default');
});
t('an app with Use skin on keeps its own skin; one without stands on the floor', () => {
  const g = ok('default', 'get');
  assert.equal(g.apps.find((a) => a.app === 'axf-console').from, 'app');
  assert.equal(g.apps.find((a) => a.app === 'axhub-web').inherit, true);
});
t('adopt all: picks the floor draws dropped, real edits kept, backups not doubled', () => {
  const r = ok('default', 'adopt', '--all');
  const con = look('axf-console'); const hubw = look('axhub-web');
  assert.equal(con.skin.use, false); assert.equal(con.skin.id, 'arctic-calm');
  assert.deepEqual(con.own, {}, 'every console pick equals Console (default)');
  assert.deepEqual(hubw.own, { hidden: { toolbar: true } }, 'axhub-web keeps its hidden toolbar, drops the nav pick the floor draws');
  assert.equal(con.backups.length, 1, 'the twin of the newest backup is not added');
  assert.ok(r.every((x) => x.from === 'default'));
});
t('adopt again changes nothing', () => { const before = JSON.stringify(look('axf-console').own); ok('default', 'adopt', 'console'); assert.equal(JSON.stringify(look('axf-console').own), before); });
t('--keep-equal keeps the picks', () => {
  ok('restore', 'console', '--backup');
  ok('default', 'adopt', 'console', '--keep-equal');
  assert.equal(look('axf-console').own.slots['nav-menu'], 'amber-signature');
});
t('restore --backup puts the old skin back with one undo', () => {
  const r = ok('restore', 'console', '--backup');
  assert.equal(r.inForce, 'arctic-calm'); assert.equal(r.useSkin, true); assert.ok(r.canUndo);
  assert.equal(look('axf-console').undo.action, 'restore-backup');
});
t('restore-backup by id, unknown id refused', () => {
  const id = ok('backups', 'console').backups[0].id;
  assert.equal(ok('restore-backup', 'console', id).restored, id);
  assert.match(bad('restore-backup', 'console', 'nope'), /no backup/);
});
t('backup by hand, newest first', () => {
  ok('use', 'console', 'clinic');
  const r = ok('backup', 'console', '--reason', 'before a test');
  assert.ok(r.added); assert.equal(r.backups[0].reason, 'before a test'); assert.equal(r.backups[0].skin, 'clinic');
});
t('snapshot --from --as captures the look as a skin', () => {
  ok('restore', 'console', '--backup', ok('backups', 'console').backups.at(-1).id);
  const r = ok('snapshot', '--from', 'console', '--as', 'console-capture', '--name', 'Captured');
  const a = JSON.parse(readFileSync(r.path, 'utf8'));
  assert.equal(a.type, 'skin'); assert.equal(a.name, 'Captured'); assert.equal(a.data.colorTheme, 'arctic-daylight');
  assert.equal(a.data.assets['nav-menu'], 'amber-signature');
  assert.ok(ok('list').some((s) => s.id === 'console-capture'), 'listed like any skin');
  assert.match(bad('snapshot', '--from', 'console', '--as', 'console-default'), /framework or Default skin/);
});
t('off clears the default', () => { assert.equal(ok('default', 'off').defaultSkin, null); assert.ok(!('defaultSkin' in JSON.parse(readFileSync(join(hub, 'appearance.json'), 'utf8')))); });
t('Console (default) compiles to the snapshot 1:1', () => {
  const r = spawnSync('npx', ['-y', 'tsx', join(ROOT, 'framework/spec/skin-snapshot-diff.mts'), 'console-default', SNAP], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
assert.ok(existsSync(join(ROOT, 'framework/assets/skin/console-default.json')));
console.log(`check-skins-default-cli: ${n} checks passed`);
