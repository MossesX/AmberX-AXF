/**
 * lib-hubstore against a fake axHub data server (GET/PUT, ETag / If-Match → 409, 64 KB cap, 401 signed out).
 *   npx -y tsx framework/spec/check-hubstore.mts
 */
import { configureHubstore, createHubData, createHubSettings, HubError } from '../libs/hubstore/index.ts';
import { chunkRows, dataUrl, hubOriginOf, isSafePath, mergeSettings, emptySettings, resolveHubstoreConfig, tableOnHub } from '../libs/hubstore/core.ts';
import { SettingsRegistry } from '../core/settings.ts';

let ok = 0;
const fail: string[] = [];
const check = (c: unknown, m: string) => { if (c) ok++; else fail.push(m); };

// a tiny localStorage for the device tables + the settings registry
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

/* ---------- fake hub ---------- */
const files = new Map<string, { body: string; v: number }>();
let signedIn = true;
let puts = 0;
let sneak: (() => void) | null = null; // runs once before the next PUT (another device saving first)
const fakeFetch = (async (input: string, init: RequestInit = {}) => {
  const u = new URL(input);
  if (init.redirect !== 'error' || init.credentials !== 'include') return new Response('', { status: 400 });
  if (!signedIn) return new Response('{}', { status: 401 });
  const path = u.pathname.replace(/^\/data\//, '');
  const f = files.get(path);
  if ((init.method ?? 'GET') === 'GET') return f ? new Response(f.body, { status: 200, headers: { etag: `"${f.v}"` } }) : new Response('{}', { status: 404 });
  if (sneak) { const s = sneak; sneak = null; s(); }
  const cur = files.get(path);
  const want = (init.headers as Record<string, string>)['if-match'];
  if (cur && want !== `"${cur.v}"`) return new Response('{}', { status: 409 });
  const body = String(init.body);
  if (body.length > 64_000) return new Response('{}', { status: 413 });
  puts++;
  const v = (cur?.v ?? 0) + 1;
  files.set(path, { body, v });
  return new Response('{}', { status: 200, headers: { etag: `"${v}"` } });
}) as unknown as typeof fetch;
const HUB = 'https://hub.example';

/* ---------- pure rules ---------- */
check(hubOriginOf('https://axhub.amberxai.com/x') === 'https://axhub.amberxai.com', 'https hub kept as its origin');
check(hubOriginOf('http://evil.example') === null && hubOriginOf('http://localhost:7000') === 'http://localhost:7000', 'http only for localhost');
check(hubOriginOf('https://u:p@hub.example') === null, 'no credentials in the hub address');
check(isSafePath('settings/app.json') && !isSafePath('../x.json') && !isSafePath('a/../b.json') && !isSafePath('settings/app'), 'safe paths only');
let threw = false; try { dataUrl(HUB, '..', 'a.json'); } catch { threw = true; }
check(threw, 'a bad project name is refused');

const def = resolveHubstoreConfig(null, 'my-app');
check(def.settings && def.settings.file === 'settings/app.json' && def.settings.mirror && def.data === false && def.project === 'my-app', 'defaults: settings on (mirror), data off, project = the app');
const onlySettings = resolveHubstoreConfig({ parts: { settings: {} } });
check(onlySettings.settings && !onlySettings.data, 'settings only');
const all = resolveHubstoreConfig({ project: 'p', parts: { settings: {}, data: { mode: 'all' } } });
check(tableOnHub(all, 'anything'), 'all data: every table on axHub');
const some = resolveHubstoreConfig({ project: 'p', parts: { data: { mode: 'some', tables: 'lists, notes,../bad' } } });
check(!some.settings && some.data && some.data.tables.join() === 'lists,notes', 'some data: picked tables (bad names dropped), settings left out');
check(tableOnHub(some, 'lists') && !tableOnHub(some, 'drafts'), 'a table not picked stays on the device');
check(!tableOnHub(onlySettings, 'lists'), 'data part off: every table on the device');

const m = mergeSettings(mergeSettings(emptySettings(), { a: 1, b: 2 }, 'x', 't1'), { a: 3, b: null, c: undefined }, 'y', 't2');
check(m.values.a === 3 && !('b' in m.values) && !('c' in m.values) && m.updatedBy === 'y', 'merge: per key, null removes, undefined ignored');
const big: Record<string, { t: string }> = {}; for (let i = 0; i < 300; i++) big[`r${i}`] = { t: 'x'.repeat(400) };
const ch = chunkRows(big, 48_000);
check(ch.length > 1 && ch.every((c) => JSON.stringify(c).length <= 48_000) && ch.reduce((n, c) => n + Object.keys(c).length, 0) === 300, 'rows split into chunks under the limit, none lost');

// the CLI installer (axf install … --parts) writes what the runtime reads
const { libraryInfo, resolveParams } = (await import('../cli/libraries.mjs')) as { libraryInfo: (id: string) => unknown; resolveParams: (lib: unknown, a: unknown) => Parameters<typeof resolveHubstoreConfig>[0] };
const lib = libraryInfo('ai.amberx.axf.hubstore');
const cliSome = resolveHubstoreConfig(resolveParams(lib, { project: 'p', parts: { settings: true, data: { mode: 'some', tables: 'lists,notes' } } }));
check(cliSome.settings && cliSome.data && cliSome.data.mode === 'some' && cliSome.data.tables.join() === 'lists,notes', 'installer: settings + some tables read back by the runtime');
const cliOnly = resolveHubstoreConfig(resolveParams(lib, { project: 'p', parts: { settings: true } }));
check(cliOnly.settings && !cliOnly.data, 'installer: settings only');
const cliDef = resolveHubstoreConfig(resolveParams(lib, { project: 'p' }));
check(cliDef.settings && !cliDef.data && cliDef.hub === 'https://axhub.amberxai.com', 'installer defaults: settings on, data off, the real hub');

/* ---------- HubSettings ---------- */
configureHubstore({ hub: HUB, project: 'proj', parts: { settings: { file: 'settings/t.json' }, data: { mode: 'some', tables: ['lists', 'big'] } } });
const s = createHubSettings({ fetchImpl: fakeFetch, appId: 'test' });
check(s.url === `${HUB}/data/proj/settings/t.json`, 'settings URL from the installed config');
check(Object.keys(await s.load()).length === 0 && s.state().status === 'ready', 'missing document = empty, ready');
await s.set('beep', true);
check(JSON.parse(files.get('proj/settings/t.json')!.body).values.beep === true, 'set writes hub-settings@1 to the hub');
sneak = () => { const f = files.get('proj/settings/t.json')!; const d = JSON.parse(f.body); d.values.other = 'theirs'; files.set('proj/settings/t.json', { body: JSON.stringify(d), v: f.v + 1 }); };
await s.set('tone', 880);
const after = JSON.parse(files.get('proj/settings/t.json')!.body).values;
check(after.other === 'theirs' && after.tone === 880 && after.beep === true, '409: re-read, merge again, the other device\'s key is kept');
const s2 = createHubSettings({ fetchImpl: fakeFetch });
await s2.load();
check(s2.get('tone', 0) === 880 && s2.get('missing', 'fb') === 'fb', 'a second app reads the same values');

// mirror the Settings screen
const reg = new SettingsRegistry('test-settings');
reg.addGroup({ id: 'g', label: 'G', tab: 'general', settings: [{ key: 'tone', label: 'Tone', kind: 'number', default: 440 }, { key: 'local', label: 'L', kind: 'toggle', default: false }, { key: 'pw', label: 'P', kind: 'secret' }] });
const stop = s2.mirror(reg);
check(reg.get('tone') === 880, 'mirror: the hub value wins at start');
reg.set('local', true);
await new Promise((r) => setTimeout(r, 20));
check(JSON.parse(files.get('proj/settings/t.json')!.body).values.local === true, 'mirror: a Settings screen save goes to the hub');
reg.set('pw', 'secret');
await new Promise((r) => setTimeout(r, 20));
check(!('pw' in JSON.parse(files.get('proj/settings/t.json')!.body).values), 'mirror: secrets never go to the hub');
stop();

/* ---------- HubData ---------- */
const d = createHubData({ fetchImpl: fakeFetch });
check(d.where('lists') === 'hub' && d.where('drafts') === 'device', 'where(): picked table on axHub, the rest on the device');
const lists = d.table<{ name: string }>('lists');
await lists.put('1', { name: 'Groceries' });
await lists.put('2', { name: 'Work' });
check(Object.keys(await lists.rows()).join() === '1,2' && JSON.parse(files.get('proj/data/lists/head.json')!.body).$axf === 'hub-table@1', 'hub table: rows saved as hub-table@1');
sneak = () => { const f = files.get('proj/data/lists/head.json')!; const t = JSON.parse(f.body); t.rows['3'] = { name: 'Theirs' }; files.set('proj/data/lists/head.json', { body: JSON.stringify(t), v: f.v + 1 }); };
await lists.remove('2');
const lr = await lists.rows();
check(lr['3']?.name === 'Theirs' && !lr['2'] && lr['1']?.name === 'Groceries', '409 on a table: the change is applied on top of the other save');
const drafts = d.table('drafts');
await drafts.put('a', { t: 'x' });
check(drafts.where === 'device' && mem.has('axf-hubstore:data:drafts') && ![...files.keys()].some((k) => k.includes('drafts')), 'device table: stays in this browser, nothing sent to the hub');
const bt = d.table('big');
await bt.replace(big);
const head = JSON.parse(files.get('proj/data/big/head.json')!.body);
check(head.chunks > 1 && Object.keys(await createHubData({ fetchImpl: fakeFetch }).table('big').rows()).length === 300, 'big table: chunked under 64 KB and read back whole');
let bad = false; try { d.table('../x'); } catch { bad = true; }
check(bad, 'bad table name refused');

/* ---------- hub down / signed out ---------- */
signedIn = false;
let kind = '';
try { await createHubSettings({ fetchImpl: fakeFetch }).load(); } catch (e) { kind = e instanceof HubError ? e.kind : 'other'; }
check(kind === 'unauthorized', 'signed out: HubError unauthorized, no local copy');
const down = createHubSettings({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
try { await down.load(); } catch { /* expected */ }
check(down.state().status === 'unreachable', 'hub down: state unreachable');
signedIn = true;
check(puts > 0, 'the fake hub saw writes');

if (fail.length) { console.error(`hubstore: ${fail.length} failed\n - ${fail.join('\n - ')}`); process.exit(1); }
console.log(`hubstore: all ${ok} checks passed`);
