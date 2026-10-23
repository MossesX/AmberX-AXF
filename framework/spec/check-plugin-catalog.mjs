#!/usr/bin/env node
/** CI: plugin-catalog@1 engine (framework/cli/plugin-catalog.mjs) on a scratch catalog and a scratch console clone. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'axf-catalog-'));
process.env.AXF_PLUGIN_CATALOG = join(tmp, 'catalog');
// a scratch console clone, so installing never touches this repo
const root = join(tmp, 'clone');
mkdirSync(join(root, 'apps/console-web/plugins'), { recursive: true });
process.env.AXF_ROOT = root;
process.env.AXF_STATE = join(root, '.axf-console/state.json');
const cat = await import('../cli/plugin-catalog.mjs');

let ok = 0, fail = 0;
const check = (name, cond) => { if (cond) ok++; else { fail++; console.error(`✗ ${name}`); } };
const throws = (name, fn, re) => { try { fn(); check(name, false); } catch (e) { check(name, !re || re.test(e.message)); } };

// a small console plugin to publish
const src = join(tmp, 'src', 'hello-world');
mkdirSync(join(src, 'web'), { recursive: true });
const man = { $axf: 'plugin@1', id: 'ai.amberx.axf.console.hello-world', name: 'Hello world', version: '1.0.0', builtWith: { model: 'opus', builtAt: '2026-10-23' }, lifecycle: { $axf: 'plugin-lifecycle@1' } };
writeFileSync(join(src, 'plugin.json'), JSON.stringify(man));
writeFileSync(join(src, 'web/index.tsx'), 'export const plugin = {};');
writeFileSync(join(src, '.env'), 'SECRET=1');
writeFileSync(join(src, 'secrets.env'), 'SECRET=1');
mkdirSync(join(src, 'node_modules/x'), { recursive: true });
writeFileSync(join(src, 'node_modules/x/i.js'), '');

// build-defaults@1: a console plugin that doesn't say which model built it is refused
writeFileSync(join(src, 'plugin.json'), JSON.stringify({ ...man, builtWith: undefined }));
throws('package without builtWith.model refused', () => cat.pack(src, 'console'), /builtWith\.model/);
writeFileSync(join(src, 'plugin.json'), JSON.stringify(man));
const pkg = cat.pack(src, 'console');
check('pack leaves out secrets and node_modules', pkg.files.map((f) => f.path).sort().join(',') === 'plugin.json,web/index.tsx');
check('pack hashes the content', /^[0-9a-f]{64}$/.test(pkg.sha256));
check('publish', cat.publishPackage(pkg, { from: 'test' }).published === true);
check('same version, same content: nothing to do', cat.publishPackage(pkg).published === false);
writeFileSync(join(src, 'web/index.tsx'), 'export const plugin = { changed: true };');
throws('same version, other content refused', () => cat.publishPackage(cat.pack(src, 'console')), /raise the version/);
writeFileSync(join(src, 'plugin.json'), JSON.stringify({ ...man, version: '1.1.0' }));
check('new version published', cat.publishPackage(cat.pack(src, 'console')).item.version === '1.1.0');
const e = cat.entry('console', 'hello-world');
check('index shows newest + all versions', e.version === '1.1.0' && e.versions.join() === '1.0.0,1.1.0');
check('index records the model per version', e.builtWith?.model === 'opus' && e.models?.['1.0.0'] === 'opus' && e.models?.['1.1.0'] === 'opus');
check('old version still readable', cat.getPackage('console', 'hello-world', '1.0.0').version === '1.0.0');
throws('id under another folder refused', () => cat.publishPackage({ ...cat.pack(src, 'console'), folder: 'hello-two' }), /already in the catalog/);
check('list filters by kind', cat.list({ kind: 'pilot' }).items.length === 0 && cat.list({ kind: 'console' }).items.length === 1);

// tampering with a stored package is caught on read
const pf = join(process.env.AXF_PLUGIN_CATALOG, 'packages/console/hello-world/1.1.0.json');
const stored = JSON.parse(readFileSync(pf, 'utf8'));
const orig = JSON.stringify(stored);
stored.files[1].b64 = Buffer.from('evil').toString('base64');
writeFileSync(pf, JSON.stringify(stored));
throws('tampered package refused', () => cat.getPackage('console', 'hello-world'), /hash/);
writeFileSync(pf, orig);

// hostile packages
const bad = (files) => ({ $axf: 'plugin-package@1', kind: 'console', folder: 'bad-one', files: [{ path: 'plugin.json', b64: Buffer.from(JSON.stringify({ ...man, id: 'ai.x.bad-one' })).toString('base64') }, ...files] });
throws('path traversal refused', () => cat.verifyPackage(bad([{ path: '../x', b64: '' }])));
throws('absolute path refused', () => cat.verifyPackage(bad([{ path: '/etc/x', b64: '' }])));
throws('secret file refused', () => cat.verifyPackage(bad([{ path: 'server/id_rsa', b64: '' }])));
throws('dot segment refused', () => cat.verifyPackage(bad([{ path: 'a/./b', b64: '' }])));
throws('duplicate path refused', () => cat.verifyPackage(bad([{ path: 'web/a.ts', b64: '' }, { path: 'WEB/a.ts', b64: '' }])));
throws('pilot plugin with server code refused', () => cat.verifyPackage({ ...bad([{ path: 'server/x.py', b64: '' }]), kind: 'pilot' }));
throws('unknown kind refused', () => cat.verifyPackage({ ...bad([]), kind: 'other' }), /unknown plugin kind/);
throws('wrong manifest schema refused', () => cat.verifyPackage({ ...bad([]), kind: 'pilot' }), /pilot-plugin@1/);
const linkDir = join(tmp, 'linked');
mkdirSync(linkDir);
writeFileSync(join(linkDir, 'plugin.json'), JSON.stringify(man));
symlinkSync('/etc/hostname', join(linkDir, 'x.txt'));
throws('pack refuses symlinks', () => cat.pack(linkDir, 'console', 'linked-one'), /symlink/);

// install into the scratch console clone
const r = await cat.installConsole('hello-world', { noState: true });
const dest = join(root, 'apps/console-web/plugins/hello-world');
check('console install unpacks', existsSync(join(dest, 'web/index.tsx')) && JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8')).version === '1.1.0');
check('console install runs the lifecycle install', existsSync(join(root, '.axf-console/plugins/hello-world')) && r.published === null);
let again = null; try { await cat.installConsole('hello-world', { noState: true }); } catch (x) { again = x; }
check('second install refused without update', /already installed/.test(again?.message ?? ''));
check('update over the same plugin', (await cat.installConsole('hello-world', { noState: true, update: true, version: '1.0.0' })).updated === true);
check('install fills the build defaults (opens)', JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8')).opens === false);

// one instance per plugin (Brett, Oct 23 2026): a Fable rebuild is a replacement, never a second install
writeFileSync(join(src, 'plugin.json'), JSON.stringify({ ...man, version: '2.0.0', builtWith: { model: 'fable', builtAt: '2026-10-24' } }));
check('Fable rebuild published', cat.publishPackage(cat.pack(src, 'console')).item.models['2.0.0'] === 'fable');
let swapNeeded = null; try { await cat.installConsole('hello-world', { noState: true, update: true }); } catch (x) { swapNeeded = x; }
check('update to another model refused without the swap', /confirmed swap/.test(swapNeeded?.message ?? ''));
const twin = join(tmp, 'src', 'hello-world-fable');
mkdirSync(twin, { recursive: true });
writeFileSync(join(twin, 'plugin.json'), JSON.stringify({ ...man, id: 'ai.amberx.axf.console.hello-world-fable', version: '1.0.0', builtWith: { model: 'fable', builtAt: '2026-10-24' } }));
throws('same plugin under another folder (another model) refused', () => cat.unpack(cat.pack(twin, 'console'), join(root, 'apps/console-web/plugins')), /Only one instance/);
writeFileSync(join(root, '.axf-console/plugins/hello-world/note.txt'), 'old data');
const sw = await cat.swapConsole('hello-world', { noState: true });
const after = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
check('swap installs the other build in place', sw.swapped && after.version === '2.0.0' && after.builtWith.model === 'fable' && sw.from.model === 'opus' && sw.to.model === 'fable');
check('swap removes the old build\'s data (backed up)', !existsSync(join(root, '.axf-console/plugins/hello-world/note.txt')) && !!sw.removed?.backup);
const inst = await import('../cli/plugin-instances.mjs');
check('folder stem drops model suffixes', inst.folderStem('theme-manager-fable') === 'theme-manager' && inst.folderStem('a-plugin-opus') === 'a');
check('instanceClashes finds two builds of one plugin', inst.instanceClashes([{ folder: 'x', manifest: { id: 'a.b.x', name: 'X', builtWith: { model: 'opus' } } }, { folder: 'x-fable', manifest: { id: 'a.b.x2', name: 'X two', builtWith: { model: 'fable' } } }]).length === 1);
check('replaces counts as the same plugin', !!inst.samePlugin({ folder: 'n', manifest: { id: 'a.b.n', name: 'N', builtWith: { replaces: ['a.b.o'] } } }, { folder: 'o', manifest: { id: 'a.b.o', name: 'O' } }));
check('different plugins are fine', inst.instanceClashes([{ folder: 'x', manifest: { id: 'a.b.x', name: 'X' } }, { folder: 'y', manifest: { id: 'a.b.y', name: 'Y' } }]).length === 0);

// a different plugin in that folder is never overwritten
const other = join(root, 'apps/console-web/plugins/someone-else');
mkdirSync(other);
writeFileSync(join(other, 'plugin.json'), JSON.stringify({ ...man, id: 'ai.x.someone-else', name: 'Someone else' }));
const p2 = cat.pack(src, 'console', 'someone-else');
throws('different plugin in the folder not overwritten', () => cat.unpack({ ...p2 }, join(root, 'apps/console-web/plugins'), { update: true }), /another plugin|already installed as/);
const linkPlugins = join(tmp, 'link-plugins');
mkdirSync(linkPlugins);
symlinkSync(tmp, join(linkPlugins, 'hello-world'));
throws('symlinked plugin folder not touched', () => cat.unpack(pkg, linkPlugins, { update: true }), /symlink/);
// the console route copies (bundled) is checked in server tests; the server must skip dot folders while installing
check('console server skips dot folders', /startswith\(\("_", "\."\)\)/.test(readFileSync(join(REPO, 'apps/console-web/server/main.py'), 'utf8')));

console.log(`plugin catalog: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
