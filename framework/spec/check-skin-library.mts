/**
 * The skin library (core/skin-library.ts): skins as a category of the asset store. Search and filter, favourites,
 * duplicate, save as new / overwrite, delete, import (taken ids get a free one), export, the editor's draft preview,
 * a host store (axf.skin-store@1) taking over persistence, and the skins.* actions.
 *
 *   npx -y tsx framework/spec/check-skin-library.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AxfRuntime } from '../core/runtime';
import { SkinLibrary, filterSkins, freeSkinId, skinAsset, skinAssetErrors, skinSlug, SKIN_ACTIONS, SKIN_CUSTOM_KEY, SKIN_DRAFT_ID, type LibraryEntry, type SkinStore } from '../core/skin-library';
import type { AssetEnvelope, AxfManifest } from '../core/types';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

/* ---- pure helpers ---- */
eq(skinSlug('My Night  Skin!'), 'my-night-skin', 'slug');
eq(skinSlug('***'), 'skin', 'slug of nothing');
eq(freeSkinId('windows', new Set(['windows', 'windows-2'])), 'windows-3', 'free id');
eq(freeSkinId('fresh', new Set(['windows'])), 'fresh', 'a free id stays');
const e = (id: string, x: Partial<LibraryEntry> = {}): LibraryEntry => ({ id, name: id, kind: 'skin', description: '', data: { layoutTheme: 'a', colorTheme: 'b', styleTheme: 'c', assets: {} }, custom: false, favourite: false, tags: [], author: '', ...x });
const rows = [e('windows', { tags: ['desktop'] }), e('night', { custom: true, favourite: true, description: 'dark' }), e('hub', { kind: 'design-package' })];
eq(filterSkins(rows, { q: 'desk' }).map((r) => r.id), ['windows'], 'search reads tags');
eq(filterSkins(rows, { q: 'dark' }).map((r) => r.id), ['night'], 'search reads descriptions');
eq(filterSkins(rows, { show: 'favourites' }).map((r) => r.id), ['night'], 'favourites');
eq(filterSkins(rows, { show: 'custom' }).map((r) => r.id), ['night'], 'mine');
eq(filterSkins(rows, { show: 'packages' }).map((r) => r.id), ['hub'], 'design packages');
eq(filterSkins(rows, { show: 'skins' }).map((r) => r.id), ['windows', 'night'], 'skins only');
ok(skinAssetErrors({ $axf: 'asset@1', type: 'skin', id: SKIN_DRAFT_ID, name: 'x', data: {} }).some((m) => m.includes('reserved')), 'the draft id is reserved');
ok(skinAssetErrors({ $axf: 'asset@1', type: 'color-theme', id: 'x', name: 'x', data: {} }).includes('type must be skin'), 'only skins');

/* ---- the runtime ---- */
const assets: Record<string, unknown>[] = [];
for (const t of readdirSync(join(root, 'assets'))) {
  const dir = join(root, 'assets', t);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) assets.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = (id: string): AxfManifest => ({ $axf: 'manifest@1', app: { id, name: id, version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults } as unknown as AxfManifest);
const boot = (key: string) => new AxfRuntime({ manifest: manifest('lib-app'), assets: assets as never, storageKey: key });

const rt = boot('skin-lib-a');
const lib = rt.skins;
const all = lib.entries();
ok(all.some((x) => x.id === 'windows' && x.kind === 'skin' && !x.custom), 'the built-in Windows skin is listed, not mine');
ok(all.some((x) => x.kind === 'design-package'), 'design packages are listed as skins');
ok(lib.exportJson('windows').includes('"type": "skin"'), 'export writes skin@1');
const pkg = all.find((x) => x.kind === 'design-package')!;
eq(lib.asSkinAsset(pkg.id)?.type, 'skin', 'a design package exports as a skin');

const dup = await lib.duplicate('windows');
ok(dup.ok, `duplicate: ${dup.errors.join('; ')}`);
eq(dup.id, 'windows-copy', 'the copy gets a free id');
ok(lib.entry('windows-copy')?.custom, 'the copy is mine');
const dup2 = await lib.duplicate('windows');
eq(dup2.id, 'windows-copy-2', 'a second copy gets the next id');
ok(String(rt.settings.get(SKIN_CUSTOM_KEY)).includes('windows-copy-2'), 'without a store, saved skins live in settings');

const taken = await lib.save(skinAsset('windows', 'Windows', lib.asSkinAsset('windows')!.data));
ok(!taken.ok && taken.errors.some((m) => m.includes('taken')), 'save as new never takes a used id');
const builtin = await lib.save(skinAsset('windows', 'Windows', lib.asSkinAsset('windows')!.data), true);
ok(!builtin.ok && builtin.errors.some((m) => m.includes('built-in')), 'a built-in skin is never overwritten');
const edited = { ...lib.asSkinAsset('windows-copy')!, name: 'Windows edited' };
ok((await lib.save(edited, true)).ok, 'overwrite a saved skin');
eq(lib.entry('windows-copy')?.name, 'Windows edited', 'the overwrite shows');

ok(await lib.setFavourite('windows', true), 'favourite');
ok(lib.entry('windows')?.favourite, 'favourite shows');
eq(lib.list({ show: 'favourites' }).map((x) => x.id), ['windows'], 'favourites filter');

const imp = await lib.importJson(lib.exportJson('windows-copy'));
eq(imp.errors, [], 'import has no errors');
eq(imp.ok, ['windows-copy-3'], 'an imported skin with a taken id gets a free one');
eq((await lib.importJson('not json')).errors, ['That is not valid JSON.'], 'bad JSON is refused');

ok(lib.previewDraft({ ...lib.asSkinAsset('windows')!.data, colorTheme: 'aurora-night' }), 'the editor draft previews');
eq(rt.previewedSkin(), SKIN_DRAFT_ID, 'the draft is what shows');
ok(!rt.skinList().some((x) => x.id === SKIN_DRAFT_ID), 'the draft is never listed');
lib.previewDraft(null);
eq(rt.previewedSkin(), null, 'closing the editor puts the look back');
ok(!rt.registry.has('skin' as never, SKIN_DRAFT_ID), 'and drops the draft');

ok(lib.apply('windows-copy'), 'apply a saved skin in this app');
ok(!(await lib.remove('windows-copy')), 'a skin in use is not deleted');
ok(!(await lib.remove('windows')), 'a built-in skin is not deleted');
ok(await lib.remove('windows-copy-2'), 'delete a saved skin');
ok(!lib.entry('windows-copy-2'), 'it is gone');
ok(!String(rt.settings.get(SKIN_CUSTOM_KEY)).includes('windows-copy-2'), 'and gone from settings');

/* saved skins come back after a reload */
const again = boot('skin-lib-c');
again.settings.set(SKIN_CUSTOM_KEY, rt.settings.get(SKIN_CUSTOM_KEY));
ok(new SkinLibrary(again).entry('windows-copy-3')?.custom, 'saved skins load on start');

/* ---- a host store takes over ---- */
class MemStore implements SkinStore {
  saved = new Map<string, AssetEnvelope>(); favs: string[] = []; global: string | null = null;
  async list() { return [...this.saved.values()]; }
  async save(a: AssetEnvelope) { this.saved.set(a.id, a); return a; }
  async remove(id: string) { this.saved.delete(id); }
  async favourites() { return this.favs; }
  async setFavourite(id: string, on: boolean) { this.favs = on ? [...new Set([...this.favs, id])] : this.favs.filter((x) => x !== id); return this.favs; }
  async setGlobal(id: string | null) { this.global = id; }
}
const host = new MemStore();
host.saved.set('hosted', skinAsset('hosted', 'Hosted', lib.asSkinAsset('windows')!.data));
const rt2 = boot('skin-lib-b');
await rt2.skins.useStore(host);
ok(rt2.skins.entry('hosted')?.custom, 'the host store\'s skins are registered');
const d = await rt2.skins.duplicate('hosted', 'Hosted two');
ok(d.ok && host.saved.has('hosted-two'), 'saving goes to the host store');
eq(rt2.settings.get(SKIN_CUSTOM_KEY), null, 'and not to settings');
await rt2.skins.setFavourite('hosted', true);
eq(host.favs, ['hosted'], 'favourites go to the host store');
ok(rt2.skins.canSetGlobal() && await rt2.skins.applyEverywhere('hosted'), 'apply everywhere');
eq(host.global, 'hosted', 'the hub-wide skin is set through the host');
ok(await rt2.skins.remove('hosted-two') && !host.saved.has('hosted-two'), 'delete goes to the host store');

/* ---- every browser and editor action is an action (console_action, MCP, voice, palette) ---- */
const ids = rt.actions.list().map((x) => x.id);
for (const id of Object.values(SKIN_ACTIONS)) ok(ids.includes(id), `action ${id}`);

console.log(`check-skin-library: ${n} checks passed`);
