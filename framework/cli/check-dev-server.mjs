#!/usr/bin/env node
/**
 * check-dev-server — `axf dev` against a temp project (framework/cli/dev-server.mjs).
 *
 *   node framework/cli/check-dev-server.mjs
 *
 * Copies the demo's manifests and two assets into a temp folder, starts the server on a free port and checks:
 * a valid edit is announced and served; an invalid edit is announced `ok: false` with `error` (and /events carries a
 * top-level `error`) while the last good version is still served; editor temp files are ignored; a rename is one
 * `renamed` record with `from`; a delete is `removed`; editor temp names are rejected by `isTempFile`. Exit 1 on any failure.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetChange, isTempFile, startDevServer } from './dev-server.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fails = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'axf-dev-check-'));
const themeDir = join(dir, 'src', 'assets', 'color-theme');
mkdirSync(themeDir, { recursive: true });
for (const f of ['axf.manifest.json', 'project.manifest.json']) cpSync(join(REPO, 'apps', 'demo', f), join(dir, f));
const src = JSON.parse(readFileSync(join(REPO, 'framework', 'assets', 'color-theme', 'arctic-daylight.json'), 'utf8'));
const write = (name, obj) => writeFileSync(join(themeDir, name), typeof obj === 'string' ? obj : `${JSON.stringify(obj, null, 2)}\n`);
write('one.json', { ...src, id: 'one', name: 'One' });
write('two.json', { ...src, id: 'two', name: 'Two' });

const server = startDevServer({ dir, port: 0, host: '127.0.0.1', log: () => undefined });
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
let rev = (await get('/')).body.rev;
/** Runs an edit and returns the next /events answer (long-poll started first, so nothing is missed). */
const after = async (edit) => {
  const p = get(`/events?since=${rev}`);
  await sleep(50);
  edit();
  await p;
  await sleep(250); // let the rest of the batch land
  const all = (await get(`/events?since=${rev}`)).body;
  rev = all.rev;
  return all;
};

try {
  check((await get('/assets.json')).body.assets.length === 2, 'snapshot serves the two assets');

  let ev = await after(() => write('one.json', { ...src, id: 'one', name: 'One edited' }));
  check(ev.changed.length === 1 && ev.changed[0].action === 'changed' && ev.changed[0].ok && !ev.error, 'valid edit → one `changed` record');
  check((await get('/assets/color-theme/one.json')).body.name === 'One edited', 'the edited asset is served');

  ev = await after(() => write('one.json', '{ "broken": '));
  check(ev.changed.length === 1 && ev.changed[0].ok === false && /JSON/.test(ev.changed[0].error ?? ''), 'broken JSON → `ok: false` with `error`');
  check(typeof ev.error === 'string' && ev.error.includes('color-theme/one'), '/events carries a top-level `error`');
  check((await get('/assets.json')).body.assets.length === 1, 'the invalid file is left out of the snapshot');

  ev = await after(() => write('one.json', { ...src, id: 'one', name: '' }));
  check(ev.changed[0]?.ok === false && /name/.test(ev.changed[0]?.error ?? ''), 'schema error → `ok: false` naming the field');
  write('one.json', { ...src, id: 'one', name: 'One' });
  await sleep(300); rev = (await get('/')).body.rev;

  const p = get(`/events?since=${rev}`);
  for (const n of ['.one.json.swp', 'one.json~', '.#one.json', 'one.json___jb_tmp___', '4913']) write(n, '{}');
  const raced = await Promise.race([p.then(() => 'announced'), sleep(600).then(() => 'quiet')]);
  check(raced === 'quiet', 'editor temp files are ignored');
  ev = await after(() => write('one.json', { ...src, id: 'one', name: 'One again' }));
  check(ev.changed.length === 1 && ev.changed[0].id === 'one', 'the next real edit still lands alone');

  ev = await after(() => renameSync(join(themeDir, 'two.json'), join(themeDir, 'two-renamed.json')));
  const ren = ev.changed.find((c) => c.action === 'renamed');
  check(!!ren && ren.from?.id === 'two' && ren.id === 'two' && ev.changed.length === 1, 'rename → one `renamed` record with `from`');

  ev = await after(() => unlinkSync(join(themeDir, 'two-renamed.json')));
  check(ev.changed.length === 1 && ev.changed[0].action === 'removed' && ev.changed[0].id === 'two', 'delete → `removed` with the asset id');
  check((await get('/assets/color-theme/two.json')).status === 404, 'a removed asset is no longer served');

  check(['.x.json', 'x.json~', '#x.json#', 'x.json.tmp', 'x.bak.json', 'x.json.crswap'].every(isTempFile) && !isTempFile('x.json'), 'isTempFile names');
  check(assetChange(join(themeDir, 'nope.json'), 'removed').ok === true, 'assetChange of a removed file needs no read');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n✗ dev-server: ${fails.length} check(s) failed` : '\n✓ dev-server: all checks passed');
process.exit(fails.length ? 1 : 0);
