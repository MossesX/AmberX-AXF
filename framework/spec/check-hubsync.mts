/**
 * lib-hubsync: config layers, errors, paths, the follow source (never blocks), HubSync settings + data on a fake hub.
 *   npx -y tsx framework/spec/check-hubsync.mts
 */
import { CONNECTION_KEY, dataFolderFor, describeSync, followState, hubSyncErrors, resolveHubSync, settingsFileFor } from '../libs/hubsync/core.ts';
import { FollowSource, HubSync, savedConnection } from '../libs/hubsync/sync.ts';
import { SettingsRegistry } from '../core/settings.ts';

let ok = 0;
const fail: string[] = [];
const check = (c: unknown, m: string) => { if (c) ok++; else fail.push(m); };
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

/* ---------- config ---------- */
const d = resolveHubSync(null);
check(d.hub === 'https://axhub.amberxai.com' && d.project === 'shared' && d.look === 'follow' && d.settings && d.data === 'off', 'defaults');
const m = resolveHubSync({ hub: 'https://hub.example/x', look: 'required', data: ['notes', '../bad', 'lists'] });
check(m.hub === 'https://hub.example' && m.look === 'required' && m.data === 'some' && m.tables.join() === 'notes,lists', 'manifest layer: origin, look, table array → some');
check(resolveHubSync({ hub: 'http://evil.example' }).hub === 'https://axhub.amberxai.com', 'http hub refused');
check(resolveHubSync({ hub: 'http://localhost:7000' }).hub === 'http://localhost:7000', 'localhost http ok');
const s = resolveHubSync({ look: 'required', data: 'all' }, { look: 'off', settings: false, project: 'mine' });
check(s.look === 'off' && !s.settings && s.data === 'all' && s.project === 'mine', 'saved layer wins');
check(resolveHubSync(null, { look: 'nope', project: '../x' }).look === 'follow' && resolveHubSync(null, { project: '../x' }).project === 'shared', 'bad saved values fall back');
check(resolveHubSync(null, { data: true }).data === 'all' && resolveHubSync(null, { data: false }).data === 'off', 'data booleans');
check(hubSyncErrors({ hub: 'ftp://x' }).length === 1 && hubSyncErrors({ project: 'a/b' }).length === 1 && hubSyncErrors({ data: 'some', tables: '' }).length === 1, 'errors');
check(hubSyncErrors({ hub: 'https://a.b', project: 'p', data: 'some', tables: 'x' }).length === 0, 'no errors');
check(settingsFileFor('voice-vault') === 'settings/apps/voice-vault.json' && settingsFileFor('../x') === 'settings/apps/app.json', 'settings file');
check(dataFolderFor('voice-vault') === 'data-voice-vault', 'data folder');
check(describeSync(m).includes('look (waits for axHub)') && describeSync({ ...d, look: 'off', settings: false }) === 'Nothing syncs with axHub', 'summary');

/* ---------- follow state ---------- */
check(followState({ status: 'unreachable', reason: 'x' }).status === 'ready', 'unreachable → ready');
check(followState({ status: 'ready', version: '"3"' } as { status: string }).version === '"3"', 'version kept');

type Ev = Parameters<FollowSource['subscribe']>[0] extends (e: infer E) => void ? E : never;
let push: ((e: Ev) => void) | null = null;
const inner = { origin: 'https://hub.example', st: { status: 'connecting' } as { status: 'connecting' }, saved: 0,
  state() { return this.st; }, subscribe(l: (e: Ev) => void) { push = l; return () => { push = null; }; }, start() {}, stop() {}, refresh() {}, save() { this.saved++; } };
const fs = new FollowSource(inner as never);
const seen: Ev[] = [];
fs.subscribe((e) => seen.push(e));
let realChanged = 0;
fs.onReal(() => realChanged++);
push!({ state: { status: 'unauthorized', reason: 'signed out' } });
push!({ doc: null, version: null });
check(fs.state().status === 'ready' && fs.real().status === 'unauthorized' && realChanged === 1, 'follow source hides the real state from the runtime');
check('state' in seen[0] && (seen[0] as { state: { status: string } }).state.status === 'ready' && 'doc' in seen[1], 'events: state mapped, doc passed');
fs.save({}); check(inner.saved === 1 && fs.origin === 'https://hub.example', 'save + origin pass through');

/* ---------- HubSync on a fake hub ---------- */
const files = new Map<string, { body: string; v: number }>();
let signedIn = true;
const fakeFetch = (async (input: string, init: RequestInit = {}) => {
  if (init.redirect !== 'error' || init.credentials !== 'include') return new Response('', { status: 400 });
  if (!signedIn) return new Response('{}', { status: 401 });
  const path = new URL(input).pathname.replace(/^\/data\//, '');
  const f = files.get(path);
  if ((init.method ?? 'GET') === 'GET') return f ? new Response(f.body, { status: 200, headers: { etag: `"${f.v}"` } }) : new Response('{}', { status: 404 });
  const cur = files.get(path);
  const want = (init.headers as Record<string, string>)['if-match'];
  if (cur && want !== `"${cur.v}"`) return new Response('{}', { status: 409 });
  const v = (cur?.v ?? 0) + 1;
  files.set(path, { body: String(init.body), v });
  return new Response('{}', { status: 200, headers: { etag: `"${v}"` } });
}) as unknown as typeof fetch;

const reg = new SettingsRegistry('t');
reg.addTab({ id: 'general', label: 'General' } as never);
reg.addGroup({ id: 'g', label: 'G', tab: 'general', settings: [{ key: 'app.beep', label: 'Beep', kind: 'toggle', default: true }, { key: 'app.token', label: 'T', kind: 'secret', default: '' }] } as never);
let attached = 0;
const rt = {
  manifest: { app: { id: 'voice-vault' } }, settings: reg,
  terminal: { log() {}, warn() {}, ok() {} },
  hasAppearanceSource: () => false, attachAppearanceSource() { attached++; }, detachAppearanceSource() { attached--; }, appearanceHub: () => undefined,
};
const sync = new HubSync(rt as never, { hub: 'https://hub.example', look: 'off', data: ['notes'], fetchImpl: fakeFetch }).start();
await new Promise((r) => setTimeout(r, 20));
check(attached === 0 && sync.state().look.status === 'off', 'look off: nothing attached');
check(sync.state().settings.status === 'ready', 'settings loaded');
reg.set('app.beep', false); reg.set('app.token', 'secret!');
await new Promise((r) => setTimeout(r, 20));
const doc = JSON.parse(files.get('shared/settings/apps/voice-vault.json')?.body ?? '{}');
check(doc.values?.['app.beep'] === false && !('app.token' in (doc.values ?? {})), 'setting mirrored to the app file, secret never');
check(sync.data.where('notes') === 'hub' && sync.data.where('other') === 'device', 'data: picked tables on the hub');
await sync.data.table('notes').put('n1', { text: 'hi' });
check(files.has('shared/data-voice-vault/notes/head.json') || [...files.keys()].some((k) => k.startsWith('shared/data-voice-vault/')), 'table written under the app data folder');
check((await sync.test()).ok, 'test: connected');
signedIn = false;
check(!(await sync.test()).ok, 'test: signed out');
signedIn = true;
sync.restart({ look: 'follow' });
check(attached === 1 && sync.config.look === 'follow', 'restart attaches the follow source');
sync.stop();
check(attached === 0 && sync.settings === null && sync.data.where('notes') === 'device', 'stop detaches everything');
const own = new HubSync({ ...rt, hasAppearanceSource: () => true } as never, { look: 'required', settings: false }).start();
check(own.state().look.status === 'own' && attached === 0, 'an app with its own source keeps it');
reg.set(CONNECTION_KEY, JSON.stringify({ look: 'off' }));
check((savedConnection(rt as never) as { look: string }).look === 'off', 'saved connection read back');

if (fail.length) { console.error(`check-hubsync: ${fail.length} failed\n  ${fail.join('\n  ')}`); process.exit(1); }
console.log(`check-hubsync: ${ok} checks ok`);
