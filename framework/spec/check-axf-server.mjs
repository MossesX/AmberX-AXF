#!/usr/bin/env node
/**
 * CI: the cross-language contracts of framework/python/axf_server, replayed in Node.
 *
 *   node framework/spec/check-axf-server.mjs           replay both fixtures (exit 1 on any difference)
 *   node framework/spec/check-axf-server.mjs --write   rewrite them from the references below (then review the diff)
 *
 * fixtures/wall-signature.json  axHub's sign-in wall signature (axHub decision #80): X-Auth-Sig =
 *   "v1.<ts>.<hex HMAC-SHA256(secret, v1|ts|user|role|perms|host-lowercased)>", ±120 s, secret ≥ 32 characters; plus
 *   how the headers become a caller. Reference: the scheme below (= axHub's signer); replayed by axf_server.wall
 *   (framework/python/axf_server/test.py) and here.
 * fixtures/plugin-package.json  plugin-package@1 checks. Reference: framework/cli/plugin-catalog.mjs verifyPackage;
 *   replayed by axf_server.plugin_package (Python) and here against the .mjs itself, so the two can't drift.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const write = process.argv.includes('--write');
process.env.AXF_PLUGIN_CATALOG = 'off'; // the catalog module only needs its pure checks here
const cat = await import('../cli/plugin-catalog.mjs');

let ok = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) ok++; else { fail++; console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`); } };

/* ------------------------------------------------------------------ wall signature (reference implementation) */

const MAX_AGE_S = 120, MIN_SECRET = 32;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/, PERM_RE = /^[a-z0-9][a-z0-9._*-]{0,63}$/;
const message = (ts, user, role, perms, host) => `v1|${ts}|${user}|${role}|${perms}|${host.toLowerCase()}`;
const mac = (secret, ts, user, role, perms, host) => createHmac('sha256', secret).update(message(ts, user, role, perms, host)).digest('hex');
const sign = (secret, user, role, perms, host, ts) => `v1.${ts}.${mac(secret, ts, user, role, perms, host)}`;

function verify(secret, sig, user, role, perms, host, now) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET || typeof sig !== 'string') return false;
  const parts = sig.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{1,12}$/.test(parts[1]) || parts[2].length !== 64) return false;
  const ts = Number(parts[1]);
  if (Math.abs(now - ts) > MAX_AGE_S) return false;
  const want = Buffer.from(mac(secret, ts, user, role, perms, host));
  const got = Buffer.from(parts[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}

function caller(env, h, now) {
  const secret = (env.WALL_SECRET ?? '').trim();
  if ((env.TRUST_WALL ?? '').trim() !== '1' || secret.length < MIN_SECRET || h['x-auth-via'] !== 'session') return null;
  const user = h['x-auth-user'] ?? '', role = h['x-auth-role'] ?? '', perms = h['x-auth-perms'] ?? '';
  if (!verify(secret, h['x-auth-sig'] ?? '', user, role, perms, h.host ?? '', now)) return null;
  const name = user.trim().toLowerCase(), r = role.trim().toLowerCase();
  if (!NAME_RE.test(name) || !['admin', 'user'].includes(r)) return null;
  let ps = [...new Set(perms.split(',').map((p) => p.trim().toLowerCase()).filter((p) => PERM_RE.test(p)))].sort();
  if (r === 'admin') ps = ['*'];
  return { name, role: r, perms: ps, via: 'session' };
}

function wallFixture() {
  const secret = 's3cret-shared-with-axhub-0123456789abcdef';
  const now = 1_790_000_000;
  const host = 'console.amberxai.com';
  const good = (o = {}) => ({ user: 'conrad', role: 'user', perms: 'console.themes,assistant.chat', host, ts: now, ...o });
  const S = (c) => sign(c.secret ?? secret, c.user, c.role, c.perms, c.signHost ?? c.host, c.ts);
  const raw = [
    ['valid user', good(), true],
    ['valid admin', good({ user: 'admin', role: 'admin', perms: '*' }), true],
    ['host compared lowercased (header in capitals)', good({ host: 'Console.AmberXAI.com' }), true],
    ['empty perms', good({ perms: '' }), true],
    ['120 s old is still fresh', good({ ts: now - 120 }), true],
    ['stale: 121 s old', good({ ts: now - 121 }), false],
    ['from the future: 121 s ahead', good({ ts: now + 121 }), false],
    ['wrong host (signed for another site)', good({ signHost: 'buildpilot.amberxai.com' }), false],
    ['tampered perms', { ...good(), tamper: { perms: 'console.themes,assistant.chat,console.plugin.sample-terminal' } }, false],
    ['tampered role (user → admin)', { ...good(), tamper: { role: 'admin' } }, false],
    ['tampered user', { ...good(), tamper: { user: 'admin' } }, false],
    ['wrong secret', good({ secret: 'another-secret-0123456789abcdef0123456789' }), false],
  ];
  const cases = raw.map(([name, c, expect]) => {
    const sig = S(c);
    const t = c.tamper ?? {};
    return { name, sig, user: t.user ?? c.user, role: t.role ?? c.role, perms: t.perms ?? c.perms, host: c.host, expect };
  });
  const v = good();
  const sigOk = S(v);
  cases.push(
    { name: 'version other than v1', sig: sigOk.replace(/^v1\./, 'v2.'), user: v.user, role: v.role, perms: v.perms, host, expect: false },
    { name: 'non-numeric timestamp', sig: sigOk.replace(`.${now}.`, '.17x9.'), user: v.user, role: v.role, perms: v.perms, host, expect: false },
    { name: 'short mac', sig: sigOk.slice(0, -2), user: v.user, role: v.role, perms: v.perms, host, expect: false },
    { name: 'upper-case hex is not the signature', sig: `v1.${now}.${sigOk.split('.')[2].toUpperCase()}`, user: v.user, role: v.role, perms: v.perms, host, expect: /[a-f]/.test(sigOk.split('.')[2]) ? false : true },
    { name: 'extra part', sig: `${sigOk}.x`, user: v.user, role: v.role, perms: v.perms, host, expect: false },
    { name: 'empty signature', sig: '', user: v.user, role: v.role, perms: v.perms, host, expect: false },
  );
  const shortSecret = 'too-short-secret';
  cases.push({ name: 'a secret under 32 characters verifies nothing', secret: shortSecret, sig: sign(shortSecret, v.user, v.role, v.perms, host, now), user: v.user, role: v.role, perms: v.perms, host, expect: false });

  const env = { TRUST_WALL: '1', WALL_SECRET: secret };
  const hdr = (user, role, perms, o = {}) => ({ 'x-auth-via': 'session', 'x-auth-user': user, 'x-auth-role': role, 'x-auth-perms': perms, host, 'x-auth-sig': sign(secret, user, role, perms, host, now), ...o });
  const callers = [
    { name: 'signed user', env, headers: hdr('conrad', 'user', 'console.themes, Assistant.Chat ,bad perm!,console.plugin.sample-plugin') },
    { name: 'signed admin: perms become *', env, headers: hdr('admin', 'admin', 'console.themes') },
    { name: 'name and role are lowercased after the check', env, headers: hdr('Conrad', 'User', '') },
    { name: 'wall not trusted (TRUST_WALL unset)', env: { WALL_SECRET: secret }, headers: hdr('conrad', 'user', '') },
    { name: 'secret too short', env: { TRUST_WALL: '1', WALL_SECRET: 'short' }, headers: hdr('conrad', 'user', '') },
    { name: 'not a browser session (x-auth-via token)', env, headers: hdr('conrad', 'user', '', { 'x-auth-via': 'token' }) },
    { name: 'unsigned headers', env, headers: (({ 'x-auth-sig': _s, ...h }) => h)(hdr('conrad', 'user', '')) },
    { name: 'name too short', env, headers: hdr('c', 'user', '') },
    { name: 'unknown role', env, headers: hdr('conrad', 'root', '') },
    { name: 'signed for another host', env, headers: { ...hdr('conrad', 'user', ''), host: 'evil.example' } },
  ].map((c) => ({ ...c, expect: caller(c.env, c.headers, now) }));
  return { $axf: 'wall-signature-fixture@1', scheme: 'X-Auth-Sig = "v1.<ts>.<hex HMAC-SHA256(secret, v1|<ts>|<user>|<role>|<perms>|<host lowercased>)>", |now - ts| ≤ 120 s, secret ≥ 32 characters', secret, now, maxAgeS: MAX_AGE_S, minSecret: MIN_SECRET, cases, callers };
}

/* ------------------------------------------------------------------ plugin-package@1 (reference: plugin-catalog.mjs) */

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const file = (path, text) => ({ path, b64: b64(text) });
const pilotManifest = { $axf: 'pilot-plugin@1', id: 'ai.amberx.pilot.extra-steps', name: 'Extra steps', version: '1.2.0' };
const consoleManifest = { $axf: 'plugin@1', id: 'ai.amberx.axf.console.hello-world', name: 'Hello world', version: '1.0.0', builtWith: { model: 'opus', builtAt: '2026-10-23' } };

function packageCases() {
  const pilot = (files, o = {}) => ({ $axf: 'plugin-package@1', kind: 'pilot', folder: 'extra-steps', files, ...o });
  const con = (files, o = {}) => ({ $axf: 'plugin-package@1', kind: 'console', folder: 'hello-world', files, ...o });
  const pf = (m = pilotManifest) => file('plugin.json', JSON.stringify(m));
  const cf = (m = consoleManifest) => file('plugin.json', JSON.stringify(m));
  const base = [pf(), file('README.md', '# Extra steps\n'), file('web/index.tsx', 'export const plugin = {};\n')];
  const sorted = [file('web/zed.ts', 'z'), file('web/Alpha.ts', 'A'), file('web/_x.ts', '_'), file('web/a/z.ts', 'z'), file('README.md', 'r'), file('web/a-b.ts', '-'), file('web/a.b.ts', '.')];
  const hashOf = (files) => cat.contentHash(files);
  const cases = [
    ['valid pilot plugin', pilot(base)],
    ['valid console plugin with a server part and binary bytes', con([cf(), file('web/index.tsx', 'x'), { path: 'server/__init__.py', b64: Buffer.from([0, 255, 128, 10]).toString('base64') }, file('assets/logo.svg', '<svg/>')])],
    ['hash order follows UTF-16 code units (capitals before lower case, _ between)', con([...sorted, cf()])],
    ['matching sha256 in the package', pilot(base, { sha256: hashOf(base) })],
    ['sha256 in the package does not match', pilot(base, { sha256: '0'.repeat(64) })],
    ['catalog entry hash does not match', pilot(base), '1'.repeat(64)],
    ['catalog entry hash matches', pilot(base), hashOf(base)],
    ['secret-looking file (.env)', con([cf(), file('.env', 'X=1')])],
    ['secret-looking file (key.pem deep inside)', con([cf(), file('server/certs/key.pem', 'k')])],
    ['secrets.env', con([cf(), file('secrets.env', 'X=1')])],
    ['credentials.json', con([cf(), file('server/credentials.json', '{}')])],
    ['ssh key', con([cf(), file('id_ed25519', 'k')])],
    ['path climbing out (..)', con([cf(), file('../outside.txt', 'x')])],
    ['dot segment', con([cf(), file('web/./a.ts', 'x')])],
    ['dot-file', con([cf(), file('web/.hidden', 'x')])],
    ['absolute path', con([cf(), file('/etc/passwd', 'x')])],
    ['backslash', con([cf(), file('web\\a.ts', 'x')])],
    ['node_modules never shipped', con([cf(), file('node_modules/x/index.js', 'x')])],
    ['__pycache__ never shipped', con([cf(), file('server/__pycache__/a.pyc', 'x')])],
    ['non-ASCII segment', con([cf(), file('web/ünï.txt', 'x')])],
    ['path over 200 characters', con([cf(), file(`web/${'a'.repeat(198)}`, 'x')])],
    ['pilot plugins carry web files only', pilot([...base, file('server/__init__.py', 'x')])],
    ['listed twice (any case)', con([cf(), file('web/A.ts', '1'), file('web/a.ts', '2')])],
    ['both a file and a folder', con([cf(), file('web', 'x'), file('web/a.ts', 'y')])],
    ['no plugin.json', con([file('web/index.tsx', 'x')])],
    ['plugin.json not JSON', con([file('plugin.json', '{nope'), file('web/index.tsx', 'x')])],
    ['plugin.json not an object', con([file('plugin.json', '[1,2]')])],
    ['wrong manifest tag for the kind', pilot([pf({ ...pilotManifest, $axf: 'plugin@1' }), file('web/x.ts', 'x')])],
    ['manifest tag missing', pilot([pf((({ $axf: _a, ...m }) => m)(pilotManifest)), file('web/x.ts', 'x')])],
    ['bad id, empty name, bad version', con([cf({ $axf: 'plugin@1', id: 'Hello', name: '  ', version: '1.0', builtWith: consoleManifest.builtWith })])],
    ['manifest folder differs', con([cf({ ...consoleManifest, folder: 'other' })])],
    ['package version differs from plugin.json', con([cf(), file('web/x.ts', 'x')], { version: '9.9.9' })],
    ['package id differs from plugin.json', con([cf(), file('web/x.ts', 'x')], { id: 'ai.amberx.other' })],
    ['malformed file entry (b64 with spaces)', con([cf(), { path: 'web/x.ts', b64: 'eA== ' }])],
    ['several problems at once (all reported, in order)', con([cf({ $axf: 'plugin@1', id: 'x', name: 'n', version: 'v', builtWith: consoleManifest.builtWith }), file('../a', 'x'), file('.env', 'x')])],
    ['unknown kind', { $axf: 'plugin-package@1', kind: 'desktop', folder: 'hello-world', files: [cf()] }],
    ['kind missing', { $axf: 'plugin-package@1', folder: 'hello-world', files: [cf()] }],
    ['bad folder name', { $axf: 'plugin-package@1', kind: 'console', folder: 'Hello_World', files: [cf()] }],
    ['folder missing', { $axf: 'plugin-package@1', kind: 'console', files: [cf()] }],
    ['not a package', { $axf: 'plugin@1', kind: 'console', folder: 'hello-world', files: [] }],
    ['no files', con([])],
    ['files is not a list', con({})],
  ];
  return cases.map(([name, pkg, expectSha256]) => {
    let expect;
    try {
      const v = cat.verifyPackage(structuredClone(pkg), expectSha256 ? { sha256: expectSha256 } : {});
      expect = { ok: true, id: v.id, name: v.name, version: v.version, sha256: v.sha256, bytes: v.bytes };
    } catch (e) {
      expect = { ok: false, error: e.message };
    }
    return { name, pkg, ...(expectSha256 ? { expectSha256 } : {}), expect };
  });
}

function packageFixture() {
  return {
    $axf: 'plugin-package-fixture@1',
    reference: 'framework/cli/plugin-catalog.mjs verifyPackage (Python port: framework/python/axf_server/plugin_package.py)',
    limits: cat.LIMITS,
    kinds: Object.fromEntries(Object.entries(cat.KINDS).map(([k, v]) => [k, { label: v.label, manifest: v.manifest, allow: v.allow ? v.allow.source : null }])),
    pathProblems: ['plugin.json', 'web/a b.ts', 'web/ok-1_2@3+4.ts', 'dist/x.js', 'a//b', '', 'web/app.KEY', 'README.md'].flatMap((p) =>
      ['console', 'pilot'].map((kind) => ({ kind, path: p, expect: cat.pathProblem(kind, p) }))),
    cases: packageCases(),
  };
}

/* ------------------------------------------------------------------ write or replay */

const wallFile = join(FIX, 'wall-signature.json');
const pkgFile = join(FIX, 'plugin-package.json');
if (write) {
  writeFileSync(wallFile, JSON.stringify(wallFixture(), null, 2) + '\n');
  writeFileSync(pkgFile, JSON.stringify(packageFixture(), null, 2) + '\n');
  console.log(`wrote ${wallFile} and ${pkgFile}`);
}

const wall = JSON.parse(readFileSync(wallFile, 'utf8'));
for (const c of wall.cases) {
  check(`wall: ${c.name}`, verify(c.secret ?? wall.secret, c.sig, c.user, c.role, c.perms, c.host, wall.now) === c.expect);
}
for (const c of wall.callers) {
  const got = caller(c.env, c.headers, wall.now);
  check(`wall caller: ${c.name}`, JSON.stringify(got) === JSON.stringify(c.expect), `${JSON.stringify(got)} vs ${JSON.stringify(c.expect)}`);
}
check('wall: sign() reproduces the valid case', sign(wall.secret, 'conrad', 'user', 'console.themes,assistant.chat', 'console.amberxai.com', wall.now) === wall.cases[0].sig);

const pk = JSON.parse(readFileSync(pkgFile, 'utf8'));
check('package: limits unchanged in plugin-catalog.mjs', JSON.stringify(pk.limits) === JSON.stringify(cat.LIMITS));
for (const p of pk.pathProblems) check(`package path: ${p.kind} ${JSON.stringify(p.path)}`, cat.pathProblem(p.kind, p.path) === p.expect);
for (const c of pk.cases) {
  let got;
  try {
    const v = cat.verifyPackage(structuredClone(c.pkg), c.expectSha256 ? { sha256: c.expectSha256 } : {});
    got = { ok: true, id: v.id, name: v.name, version: v.version, sha256: v.sha256, bytes: v.bytes };
  } catch (e) {
    got = { ok: false, error: e.message };
  }
  check(`package: ${c.name}`, JSON.stringify(got) === JSON.stringify(c.expect), `${JSON.stringify(got)} vs ${JSON.stringify(c.expect)}`);
}
// the hash the .mjs computes is plain sha256 over path\0size\0bytes (what the Python port implements)
{
  const files = [file('b.txt', 'B'), file('a.txt', 'A')];
  const h = createHash('sha256');
  for (const f of [files[1], files[0]]) { const b = Buffer.from(f.b64, 'base64'); h.update(f.path); h.update('\0'); h.update(String(b.length)); h.update('\0'); h.update(b); }
  check('package: content hash definition', cat.contentHash(files) === h.digest('hex'));
}

console.log(`axf_server fixtures (wall-signature, plugin-package): ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
