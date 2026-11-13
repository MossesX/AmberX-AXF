#!/usr/bin/env node
/**
 * Context menus self-test: the store (menus.mjs) in a temp folder — zones scan, levels, prompt (zero tokens), a fixed
 * model reply → draft with preview and diff, apply → saved + in use, snapshot + restore, filters, use / delete, voice
 * sentences, the api() every server route calls, and the CLI.
 *
 *   node apps/console-web/plugins/context-menus/test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'ctxm-'));
process.env.AXF_CONTEXT_MENUS_DIR = DIR;
const M = await import('./menus.mjs');
const R = M.rules;

let n = 0;
const ok = (v, what) => { assert.ok(v, what); n++; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };

/* ---- store location */
eq(M.storeDir(), DIR, 'AXF_CONTEXT_MENUS_DIR wins');
eq(M.onHub(), false, 'not on the hub in tests');

/* ---- zones: the code scan finds the console's real targets + the implicit ones */
const z = M.zones({ scan: true });
ok(z.items.length > 10, `zones found (${z.items.length})`);
ok(z.items.some((x) => x.id === 'default' && x.implicit), 'default zone is implicit');
ok(z.items.some((x) => x.id === 'banner' && x.weight === 'core'), 'banner is a core zone');
const pluginZone = z.items.find((x) => x.owner.kind === 'plugin');
ok(pluginZone && pluginZone.owner.id, 'a plugin-owned zone carries its plugin folder');
eq(M.reportZones([{ id: 'asset-card', elements: ['Skin card'] }, { id: 'brand-new-zone', label: 'Brand new' }], 'theme-manager').ok, true, 'a console reports zones');
const z2 = M.zones();
ok(z2.items.find((x) => x.id === 'asset-card').pages.includes('theme-manager'), 'reported page remembered');
ok(z2.items.find((x) => x.id === 'brand-new-zone'), 'a zone only a console reported is in the registry');

/* ---- levels + actions */
eq(Object.keys(R.LEVELS), ['beginner', 'amateur', 'pro', 'advanced'], 'four levels');
ok(R.LEVELS.beginner.perTarget < R.LEVELS.pro.perTarget && R.LEVELS.pro.perTarget < R.LEVELS.advanced.perTarget, 'higher level = more items');
const acts = M.inventoryActions();
ok(acts.length > 50, `inventory actions (${acts.length})`);
ok(acts.some((a) => a.id === 'nav:home'), 'views are reachable as nav:<view>');

/* ---- prompt (zero tokens) */
const p = M.promptFor({ level: 'beginner' });
ok(p.system.includes('BEGINNER') && p.messages[0].content.includes('ZONES'), 'prompt names the level and lists zones');
ok(!p.zones.includes(pluginZone.id) || pluginZone.weight === 'core', 'beginner maps only core zones');
const pa = M.promptFor({ level: 'advanced' });
ok(pa.zones.length >= p.zones.length && pa.actions.includes('console.inspect'), 'advanced maps every zone and adds developer actions');
assert.throws(() => M.promptFor({ level: 'ninja' }), /level must be/);
n++;

/* ---- a fixed reply → draft (preview, warnings, diff) → apply */
const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({ name: 'Console basics', variant: 'compact', targets: {
  default: [
    { id: 'home', label: 'Home', icon: 'home', action: 'nav:home' },
    { id: 'settings', label: 'Settings', icon: 'settings', action: 'nav:settings' },
    { id: 'bogus', label: 'Bogus', action: 'made.up' },
    { id: 's', separator: true },
    { id: 'a1', label: 'A1', action: 'nav:home' }, { id: 'a2', label: 'A2', action: 'nav:home', rare: true }, { id: 'a3', label: 'A3', action: 'nav:home' }, { id: 'a4', label: 'A4', action: 'nav:home' }, { id: 'a5', label: 'A5', action: 'nav:home' },
  ],
  toolbar: [{ id: 'grp', label: 'Group', items: [{ id: 'x', label: 'Home', action: 'nav:home' }] }],
  'no-such-zone': [{ id: 'q', label: 'Q', action: 'nav:home' }],
} })}\n\`\`\``;
const d = M.draftFromReply(reply, { level: 'beginner', by: 'test', model: 'fixed' });
ok(d.ok, 'draft made');
const draft = d.draft;
eq(draft.$axf, 'ctx-draft@1');
eq(draft.menu.$axf, 'context-menu@1');
eq(draft.menu.asset.type, 'context-menu');
eq(draft.menu.asset.id, 'ctx-console-web-beginner', 'asset id from the menu id');
ok(draft.warnings.some((w) => w.includes('made.up')), 'unknown action dropped with a warning');
ok(draft.warnings.some((w) => w.includes('no-such-zone')), 'unknown zone dropped with a warning');
const def = draft.menu.asset.data.targets.default;
const visible = def.filter((x) => !x.separator);
ok(visible.length <= R.LEVELS.beginner.perTarget, `beginner default fits the budget (${visible.length})`);
const more = visible.find((x) => x.id === 'more');
ok(more && more.items.some((x) => x.id === 'a2'), 'rare item folded under More…');
eq(R.depthOf(draft.menu.asset.data.targets.toolbar), 0, 'beginner has no submenus (group flattened)');
eq(draft.diff.find((x) => x.target === 'default').status, 'new', 'diff against no active menu: new');
eq(M.loadMenus().length, 0, 'nothing saved before apply');
const applied = M.applyDraft(draft.id, { by: 'test' });
ok(applied.ok && applied.menu.active, 'applied and in use');
eq(M.activeMap()['console-web'], 'console-web-beginner');
eq(M.drafts().length, 0, 'draft consumed');
eq(R.validateMenu(M.getMenu('console-web-beginner')), [], 'saved menu is valid');

/* ---- a second generation at pro: the diff is against the menu in force; save without switching */
const d2 = M.draftFromReply(JSON.stringify({ name: 'Pro set', targets: { default: [{ id: 'home', label: 'Home', action: 'nav:home', shortcut: 'Ctrl+H' }], 'asset-card': [{ id: 'c', label: 'Copy', action: 'nav:home' }] } }), { level: 'pro', by: 'test' });
ok(d2.ok && d2.draft.diff.some((x) => x.target === 'default' && x.status === 'changed'), 'pro diff shows changes against the beginner menu');
eq(d2.draft.menu.asset.data.showShortcuts, true, 'pro shows shortcuts');
const a2 = M.applyDraft(d2.draft.id, { by: 'test', use: false });
ok(a2.ok && !a2.menu.active, 'saved without switching');
eq(M.activeMap()['console-web'], 'console-web-beginner', 'beginner still in use');
eq(M.loadMenus().map((m) => m.id), ['console-web-beginner', 'console-web-pro'], 'listed by level order');

/* ---- edit → snapshot → restore */
const m = M.getMenu('console-web-beginner');
const edited = { ...m, asset: { ...m.asset, data: { ...m.asset.data, targets: { ...m.asset.data.targets, default: [{ id: 'only', label: 'Only', action: 'nav:home' }] } } } };
ok(M.saveMenu(edited, { by: 'editor' }).ok, 'edit saved');
const h = M.history('console-web-beginner');
eq(h.versions.length, 1, 'one snapshot kept');
eq(h.versions[0].doc.asset.data.targets.default.length, def.length, 'snapshot holds the previous items');
ok(M.restore('console-web-beginner', 1, 'test').ok, 'restored');
eq(M.getMenu('console-web-beginner').asset.data.targets.default.length, def.length, 'restore brought the items back');
eq(M.history('console-web-beginner').versions.length, 2, 'the edit became a snapshot too');
eq(M.saveMenu({ id: 'bad id!', level: 'amateur', asset: {} }).menu.id, 'bad-id', 'ids are slugged, never refused');
eq(M.saveMenu({ id: 'x', level: 'amateur', asset: { data: { variant: 'neon' } } }).menu.asset.data.variant, 'compact', 'bad variant falls back');

/* ---- filters, use, delete */
eq(R.filterMenus(M.loadMenus(), { level: 'pro' }).map((x) => x.id), ['console-web-pro']);
eq(R.filterMenus(M.loadMenus(), { zone: 'asset-card' }).map((x) => x.id), ['console-web-pro']);
eq(R.filterMenus(M.loadMenus(), { q: 'ctrl+h' }).map((x) => x.id), ['console-web-pro'], 'search reaches into items');
ok(M.useMenu('console-web-pro').ok, 'use pro');
eq(M.activeFor('console-web').id, 'console-web-pro');
ok(M.deleteMenu('console-web-pro').ok, 'deleted');
eq(M.activeMap()['console-web'], undefined, 'deleting the menu in use clears the choice');
eq(M.deleteMenu('console-web-pro').ok, false, 'deleting twice says no');

/* ---- voice */
eq(R.matchPhrase('generate pro context menus'), { op: 'generate', level: 'pro', app: 'console-web', preview: false });
eq(R.matchPhrase('make beginner menus for the console'), { op: 'generate', level: 'beginner', app: 'console-web', preview: false });
eq(R.matchPhrase('preview advanced coder context menu'), { op: 'generate', level: 'advanced', app: 'console-web', preview: true });
eq(R.matchPhrase('apply'), { op: 'apply' });
eq(R.matchPhrase('list context menus'), { op: 'list' });
eq(R.matchPhrase('use context menu console-web-pro'), { op: 'use', id: 'console-web-pro' });
eq(R.matchPhrase('what is the weather'), null);

/* ---- api(): what every server route calls */
const st = await M.api({ op: 'state' });
ok(st.ok && st.levels.length === 4 && st.zones.length > 10 && Array.isArray(st.menus), 'state');
eq((await M.api({ op: 'get', id: 'nope' })).ok, false);
eq((await M.api({ op: 'voice', text: 'generate amateur menus' })).level, 'amateur');
eq((await M.api({ op: 'nope' })).ok, false);
ok((await M.api({ op: 'prompt', level: 'pro', actions: [{ id: 'x.y', label: 'X' }] })).prompt.actions.includes('x.y'), 'live actions from the open console are used');

/* ---- CLI */
const cli = (...args) => spawnSync('node', [join(HERE, 'menus.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, AXF_CONTEXT_MENUS_DIR: DIR } });
ok(cli('levels').stdout.includes('advanced'), 'cli levels');
ok(cli('where').stdout.includes(DIR), 'cli where');
const rf = join(DIR, 'reply.json');
writeFileSync(rf, JSON.stringify({ name: 'CLI', targets: { default: [{ id: 'h', label: 'Home', action: 'nav:home' }] } }));
const gen = JSON.parse(cli('generate', '--level', 'amateur', '--reply-file', rf, '--apply', '--json').stdout.trim().split('\n').pop());
ok(gen.ok && gen.menu.level === 'amateur' && gen.menu.active, 'cli generate --apply from a fixed reply');
ok(cli('list').stdout.includes('console-web-amateur'), 'cli list');
eq(JSON.parse(cli('voice', 'generate', 'pro', 'context', 'menus', '--json').stdout).level, 'pro', 'cli voice');
eq(cli('generate', '--level', 'pro').status, 1, 'cli generate without a reply file says what to do');

rmSync(DIR, { recursive: true, force: true });
console.log(`context-menus: ${n} checks passed`);
