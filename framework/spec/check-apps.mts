/**
 * lib-apps (app-directory@1): the generated directory is in sync with the manifests, and the picker rules hold.
 *   npx -y tsx framework/spec/check-apps.mts
 */
import { execFileSync } from 'node:child_process';
import { availableApps, customApps, customEntry, decodeCustomApp, directoryApps, encodeCustomApp, moveApp, pickedApps, safeOrigin, toggleApp, appOrigin } from '../libs/apps/apps';

let n = 0;
const check = (ok: boolean, what: string) => { if (!ok) { console.error(`✗ ${what}`); process.exit(1); } n++; console.log(`  ✓ ${what}`); };

execFileSync('node', ['framework/cli/app-directory.mjs', '--check'], { stdio: 'inherit' });
check(true, 'directory.json matches the project manifests + external.json');

const dir = directoryApps();
const tabs = dir.map((a) => a.tab);
check(['console', 'pilot', 'axhub'].every((t, i) => tabs[i] === t), 'Console, Pilot, axHub lead the directory');
check(new Set(tabs).size === tabs.length && new Set(dir.map((a) => a.origin)).size === dir.length, 'one entry per tab id and per address');
check(dir.every((a) => a.origin.startsWith('https://') && !a.origin.slice(8).includes('/')), 'every address is an https origin');
check(dir.some((a) => a.tab === 'walkthrough') && dir.some((a) => a.host && a.tab === 'patches'), 'Walkthrough Studio listed; Patches marked as a host');

check(!availableApps([]).some((a) => a.host), 'hosts are never offered as tabs');
check(!availableApps([], 'https://console.amberxai.com').some((a) => a.tab === 'console'), 'the page’s own app is left out');

check(safeOrigin('https://x.example/a?b') === 'https://x.example' && safeOrigin('http://x.example') === null && safeOrigin('https://u:p@x.example') === null && safeOrigin('http://localhost:5173') === 'http://localhost:5173', 'addresses: https only (http for localhost), no credentials');
check('error' in customEntry({ label: 'X', url: 'javascript:alert(1)' }) && 'error' in customEntry({ label: '', url: 'https://a.example' }), 'custom apps: bad address or no name refused');
check('error' in customEntry({ label: 'Console', url: 'https://c.example' }, new Set(['console'])), 'custom apps: a taken tab id is refused');
const c = customEntry({ label: 'My Site', url: 'https://my.example/start', embed: 'axf' });
check(!('error' in c) && c.tab === 'my-site' && c.path === '/start' && c.settingsPath === '/' && c.from === 'custom', 'custom apps: id from the name, start path kept, AXF apps get a settings page');
const enc = encodeCustomApp({ tab: 'my-site', label: 'My | Site', url: 'https://my.example/', embed: 'none' });
check(decodeCustomApp(enc)?.label === 'My   Site' && decodeCustomApp(enc)?.url === 'https://my.example/', 'custom apps round-trip through one settings string');
check(customApps([enc, enc, 'junk', 42]).length === 1, 'saved custom apps: duplicates and junk dropped');
check(availableApps([encodeCustomApp({ tab: 'dup', label: 'Dup', url: 'https://console.amberxai.com' })]).filter((a) => a.origin === 'https://console.amberxai.com').length === 1, 'a custom app at a directory address is not listed twice');

const all = availableApps([]);
check(pickedApps(all, undefined, ['console', 'pilot', 'axhub']).map((a) => a.tab).join() === 'console,pilot,axhub', 'nothing saved = the defaults');
check(pickedApps(all, ['walkthrough', 'gone', 'console', 'walkthrough'], []).map((a) => a.tab).join() === 'walkthrough,console', 'saved order kept; unknown and repeated ids dropped');
check(pickedApps(all, [], ['console']).length === 0, 'an empty saved list stays empty');
check(toggleApp(['a', 'b'], 'c', true).join() === 'a,b,c' && toggleApp(['a', 'b'], 'a', false).join() === 'b', 'toggle adds at the end / removes');
check(moveApp(['a', 'b', 'c'], 'c', -1).join() === 'a,c,b' && moveApp(['a', 'b'], 'a', -1).join() === 'a,b', 'move up / down, out of range unchanged');
check(appOrigin(dir[0]!, 'https://other.example/x') === 'https://other.example' && appOrigin(dir[0]!, 'ftp://x') === dir[0]!.origin, 'a saved address replaces the directory’s only when it is https');
console.log(`all ${n} checks passed`);
