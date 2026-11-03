// @ts-nocheck: a Node test, not part of the console's build
/*
 * Theme editor model test, on the real starter assets and the real token tree (the Theme manager's roll engine,
 * which provides axf.token-tree@1). Skips with a note when the Theme manager isn't installed.
 *   npx -y tsx apps/console-web/plugins/theme-editor/test.mts
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categories, categoryOf, diffPaths, everyToken, filterCategories, parseThemes, themeAsset, tokenLabel, tokenTree, TOKEN_TREE, type Data, type TokenTree, type TypeSpec } from './web/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const engine = join(HERE, '../theme-manager/web/rollEngine.ts');
if (!existsSync(engine)) { console.log('- skipped: the Theme manager (axf.token-tree@1) is not installed'); process.exit(0); }
const tm = await import(engine) as TokenTree;
let fails = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${JSON.stringify(detail)}`}`); if (!cond) fails++; };

ok('no service before it is published', tokenTree() === null);
(globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices = { [TOKEN_TREE]: { version: 1, buildTree: tm.buildTree, leaves: tm.leaves, getAt: tm.getAt, setAt: tm.setAt } };
const tt = tokenTree()!;
ok('service found once published', !!tt);

const specs = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8')).types as Record<string, TypeSpec>;
const load = (t: string) => readdirSync(join(ROOT, 'framework/assets', t)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'framework/assets', t, f), 'utf8')) as { id: string; data: Data });
const colors = load('color-theme'), styles = load('style-theme');
const hub = styles.find((s) => s.id === 'hub')!;

// every possible token: the union over every known theme + the asset type's fields
const all = new Set<string>();
for (const a of styles) { const w = (o: Data, p: string) => { for (const [k, v] of Object.entries(o)) { const x = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) w(v as Data, x); else all.add(x); } }; w(a.data, ''); }
const sparse = { fontSize: 14, radius: { sm: 2 } } as Data;
const cs = categories(tt, 'style-theme', specs, sparse, styles);
const paths = cs.flatMap((c) => c.tokens.map((t) => t.path));
ok('style: every token any theme has is listed', [...all].every((p) => paths.includes(p)), [...all].filter((p) => !paths.includes(p)));
ok('style: draft value wins', tt.getAt(everyToken('style-theme', specs['style-theme'], sparse, styles).data, 'fontSize') === 14);
ok('style: unset tokens are marked', cs.flatMap((c) => c.tokens).filter((t) => !t.set).length === paths.length - 2);
ok('style: set tokens are marked', cs.flatMap((c) => c.tokens).filter((t) => t.set).map((t) => t.path).sort().join() === 'fontSize,radius.sm');
ok('style: categories in rule order', cs.map((c) => c.id).slice(0, 3).join() === 'typography,spacing,shape', cs.map((c) => c.id));
ok('style: no Other for the known tokens', !cs.some((c) => c.id === 'other'));
ok('style: optional field from the spec', everyToken('style-theme', { label: 'x', optional_fields: { newFlag: 'boolean, default false' } }, {}, []).data.newFlag === false);

const cc = categories(tt, 'color-theme', specs, colors[0]!.data, colors);
ok('colour: 6 categories', cc.map((c) => c.id).join() === 'scheme,surfaces,text,accent,status,effects', cc.map((c) => c.id));
ok('colour: every nested token listed', specs['color-theme']!.nested!.tokens!.every((k) => cc.some((c) => c.tokens.some((t) => t.path === `tokens.${k}`))));
ok('colour: scheme is an enum', cc[0]!.tokens[0]!.leaf.kind === 'enum');
ok('colour: tokens are colours', cc.find((c) => c.id === 'surfaces')!.tokens.every((t) => t.leaf.kind === 'color'));

// new tokens show up by themselves
const future = { ...hub.data, glow: { sm: 3 }, sparkle: 2 } as Data;
const fc = categories(tt, 'style-theme', specs, future, styles);
ok('a new nested group gets its own category', fc.some((c) => c.id === 'group:glow' && c.label === 'Glow'));
ok('a new flat token goes to Other, last', fc[fc.length - 1]!.id === 'other' && fc[fc.length - 1]!.tokens[0]!.path === 'sparkle');
ok('category of an unknown colour token', categoryOf('color-theme', 'tokens.glow').label === 'Tokens');

ok('labels', tokenLabel('tokens.surface2') === 'Surface2' && tokenLabel('radius.sm') === 'Radius sm' && tokenLabel('fontSize') === 'Font Size');
ok('filter by token', filterCategories(cc, 'surface2').flatMap((c) => c.tokens).map((t) => t.path).join() === 'tokens.surface2');
ok('filter by category keeps it whole', filterCategories(cc, 'status')[0]!.tokens.length === 4);
ok('filter: nothing', filterCategories(cc, 'zzz').length === 0);

const tokens = cs.flatMap((c) => c.tokens);
const other = styles.find((s) => s.id !== 'hub')!;
const d = diffPaths(tt, hub.data, other.data, tokens);
ok('diff finds differences', d.length > 0);
ok('diff of itself is empty', diffPaths(tt, hub.data, hub.data, tokens).length === 0);

const a = themeAsset('style-theme', 'My Look!', hub.data, { from: 'Hub' });
ok('asset envelope', a.$axf === 'asset@1' && a.id === 'my-look' && a.type === 'style-theme' && a.tags.includes('edited'));
ok('parse one', parseThemes(JSON.stringify(a)).length === 1);
ok('parse list + items', parseThemes(JSON.stringify([a, a])).length === 2 && parseThemes(JSON.stringify({ items: [a] })).length === 1);
let threw = false; try { parseThemes('{"$axf":"asset@1","type":"layout","id":"x","data":{}}'); } catch { threw = true; }
ok('parse refuses other types', threw);

console.log(fails ? `${fails} failed` : 'all good');
process.exit(fails ? 1 : 0);
