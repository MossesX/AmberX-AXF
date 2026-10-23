/**
 * Self-test for the hub rules the AXHub web app uses (lib-hub `framework/libs/hub/apps.ts`, harvested from this app
 * Oct 23 2026): what a reply from the hub means, what is thrown away, and how times and sizes are shown.
 *
 *   npx -y tsx apps/axhub-web/test.mjs
 *
 * Nothing here touches the network: every case is a hand-written reply.
 */
import { expiry, formatSize, formatWhen, interpretApps, shortSha, statusNote, APPS_MAX, VERSIONS_MAX } from '../../framework/libs/hub/apps.ts';

let checks = 0;
let failed = 0;
const ok = (cond, what) => {
  checks += 1;
  if (!cond) {
    failed += 1;
    console.error(`  ✗ ${what}`);
  }
};
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const HUB = 'https://axhub.amberxai.com';
const SHA = 'a'.repeat(64);
const buildOf = (over = {}) => ({ version: '0.1.0', build: 12, file: 'patches-0.1.0-b12.apk', size: 7_340_032, sha256: SHA, builtAt: '2026-10-21T18:00:00.000Z', ...over });
const appOf = (over = {}) => ({ project: 'patches', name: 'Patches', platform: 'android', latest: buildOf(), versions: [buildOf()], ...over });
const feed = (apps, updatedAt = '2026-10-21T18:05:00.000Z') => JSON.stringify({ updatedAt, apps });

console.log('AXHub web — hub rules');

/* ---------------------------------------------------------------- what a reply means */
eq(interpretApps(HUB, 401, '').status, 'signed-out', '401 is signed out');
eq(interpretApps(HUB, 403, '').status, 'not-admin', '403 needs a permission');
eq(interpretApps(HUB, 500, '').status, 'unreachable', '500 is unreachable');
ok(interpretApps(HUB, 500, '').error.includes('500'), 'the status is in the error');
eq(interpretApps(HUB, 200, 'not json').status, 'unreachable', 'a non-JSON body is unreachable');
eq(interpretApps(HUB, 200, '[]').status, 'unreachable', 'a list instead of an object is unreachable');
eq(interpretApps(HUB, 200, '{}').apps, [], 'an empty object has no apps');

const good = interpretApps(HUB, 200, feed([appOf()]));
eq(good.status, 'ok', 'a good reply is ok');
eq(good.apps.length, 1, 'one app');
eq(good.updatedAt, '2026-10-21T18:05:00.000Z', 'the catalog time is kept');
eq(good.apps[0].latest.url, `${HUB}/apps/download/patches/patches-0.1.0-b12.apk`, 'the download link is built from the hub and the file name');
eq(good.apps[0].earlier, [], 'the latest build is not repeated as an earlier one');

/* ---------------------------------------------------------------- what is thrown away */
const noName = interpretApps(HUB, 200, feed([appOf({ name: undefined })]));
eq(noName.apps[0].name, 'patches', 'an app without a name falls back to its project');

eq(interpretApps(HUB, 200, feed([appOf({ project: 'Patches' })])).apps, [], 'a project name that is not lowercase is dropped');
eq(interpretApps(HUB, 200, feed([appOf({ project: '../etc' })])).apps, [], 'a project name with dots is dropped');
eq(interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ file: 'evil.sh' }), versions: [] })])).apps, [], 'a file that is not an apk is dropped');
eq(interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ file: '../../etc/passwd' }), versions: [] })])).apps, [], 'a file name with traversal is dropped');
eq(interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ size: -5 }), versions: [] })])).apps, [], 'a negative size is dropped');
eq(interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ size: 9e15 }), versions: [] })])).apps, [], 'an absurd size is dropped');

// A reply that tries to point the download somewhere else: the link is rebuilt, so the attempt is ignored.
const foreign = interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ url: 'https://evil.example/x.apk' }) })]));
eq(foreign.apps[0].latest.url, `${HUB}/apps/download/patches/patches-0.1.0-b12.apk`, 'a link in the reply is never used');

const badSha = interpretApps(HUB, 200, feed([appOf({ latest: buildOf({ sha256: 'nope' }) })]));
eq(badSha.apps[0].latest.sha256, '', 'a malformed hash is left empty');
eq(shortSha('nope'), '', 'a malformed hash is not shortened');
eq(shortSha(SHA), 'a'.repeat(12), 'a hash shows its first 12 characters');

/* ---------------------------------------------------------------- caps and tidiness */
const many = interpretApps(HUB, 200, feed(Array.from({ length: APPS_MAX + 20 }, (_, i) => appOf({ project: `app${i}`, name: `App ${String(i).padStart(3, '0')}` }))));
eq(many.apps.length, APPS_MAX, `at most ${APPS_MAX} apps`);

const versions = Array.from({ length: VERSIONS_MAX + 4 }, (_, i) => buildOf({ build: 20 - i, file: `patches-0.1.0-b${20 - i}.apk` }));
const capped = interpretApps(HUB, 200, feed([appOf({ latest: versions[0], versions })]));
eq(capped.apps[0].earlier.length, VERSIONS_MAX - 1, `at most ${VERSIONS_MAX} builds per app, latest apart`);

const dupes = interpretApps(HUB, 200, feed([appOf(), appOf({ name: 'Patches again' })]));
eq(dupes.apps.length, 1, 'the same project twice is listed once');

const dupeFiles = interpretApps(HUB, 200, feed([appOf({ versions: [buildOf(), buildOf()] })]));
eq(dupeFiles.apps[0].earlier.length, 0, 'the same file twice is listed once');

const sorted = interpretApps(HUB, 200, feed([appOf({ project: 'zed', name: 'Zed' }), appOf({ project: 'alpha', name: 'Alpha' })]));
eq(sorted.apps.map((a) => a.name), ['Alpha', 'Zed'], 'apps are sorted by name');

const noLatest = interpretApps(HUB, 200, feed([appOf({ latest: null, versions: [buildOf()] })]));
eq(noLatest.apps[0].latest.file, 'patches-0.1.0-b12.apk', 'a missing latest falls back to the newest listed build');

/* ---------------------------------------------------------------- sizes and times */
eq(formatSize(0), '0 B', 'zero bytes');
eq(formatSize(900), '900 B', 'bytes');
eq(formatSize(1024), '1.0 KB', 'kilobytes');
eq(formatSize(7_340_032), '7.0 MB', 'megabytes');
eq(formatSize(2.5 * 1024 ** 3), '2.5 GB', 'gigabytes');
eq(formatSize(-1), '—', 'a nonsense size shows a dash');

const now = Date.parse('2026-10-21T18:00:00.000Z');
eq(formatWhen(null, now), '—', 'no time shows a dash');
eq(formatWhen('rubbish', now), '—', 'an unparsable time shows a dash');
eq(formatWhen('2026-10-21T17:59:30.000Z', now), 'just now', 'seconds ago');
eq(formatWhen('2026-10-21T17:45:00.000Z', now), '15 min ago', 'minutes ago');
eq(formatWhen('2026-10-21T14:00:00.000Z', now), '4 h ago', 'hours ago');
eq(formatWhen('2026-10-19T18:00:00.000Z', now), '2 d ago', 'days ago');
ok(!formatWhen('2026-09-01T18:00:00.000Z', now).includes('ago'), 'older than a week shows a date');
eq(formatWhen('2026-10-21T18:00:30.000Z', now), 'just now', 'a time slightly in the future is "just now"');

/* ---------------------------------------------------------------- approvals */
eq(expiry({ expiresAt: '' }, now).text, '—', 'no expiry shows a dash');
eq(expiry({ expiresAt: '2026-10-21T17:59:00.000Z' }, now), { text: 'expired', soon: false, expired: true }, 'past its expiry');
eq(expiry({ expiresAt: '2026-10-21T18:28:00.000Z' }, now), { text: '28 min left', soon: false, expired: false }, 'half an hour left');
eq(expiry({ expiresAt: '2026-10-21T18:03:00.000Z' }, now), { text: '3 min left', soon: true, expired: false }, 'under five minutes is soon');
eq(expiry({ expiresAt: '2026-10-21T18:00:20.000Z' }, now).text, '20s left', 'seconds left');

ok(statusNote('signed-out', '').includes('Sign in'), 'signed out asks for a sign-in');
ok(statusNote('not-admin', '').includes('users page'), 'no permission points at the users page');
eq(statusNote('unreachable', 'Boom.'), 'Boom.', 'unreachable shows why');
eq(statusNote('ok', ''), '', 'nothing to say when it worked');

// The look comes from axHub's shared appearance document, so this app must ship every colour and style theme
// the console (the other app in Patches) ships: a missing one would fall back to this app's default.
{
  const { readdirSync, existsSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  for (const type of ['color-theme', 'style-theme', 'gauge', 'meter']) {
    const mine = existsSync(`${here}src/assets/${type}`) ? readdirSync(`${here}src/assets/${type}`) : [];
    for (const f of readdirSync(`${here}../console-web/src/assets/${type}`)) ok(mine.includes(f), `ships the console's ${type} ${f}`);
  }
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
