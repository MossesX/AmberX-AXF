/**
 * Self-test for the hub rules the AXHub web app uses (lib-hub `framework/libs/hub/apps.ts`, harvested from this app
 * Oct 23 2026): what a reply from the hub means, what is thrown away, and how times and sizes are shown.
 *
 *   npx -y tsx apps/axhub-web/test.mjs
 *
 * Nothing here touches the network: every case is a hand-written reply.
 */
import { afterPick, bashCommand, clipboardFor, clock, errorText, handoffGauges, localToUtcMinute, parseRoute, platformOf, relTime, routeHash, safeFilePath, sessionsFor, signInUrl, stepGroups } from './src/hub/core.ts';
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

// Its own chrome: banner, toolbar, context menu, navigation menu and application menu are all picked in the manifest
// and ship with the app. It runs inside Patches, so it installs only what it needs (no plugin shared with the
// console or Pilot).
{
  const { readFileSync, existsSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const man = JSON.parse(readFileSync(`${here}axf.manifest.json`, 'utf8'));
  const own = { banner: 'amberx-thin', toolbar: 'axhub-web', 'context-menu': 'axhub-web', 'nav-menu': 'axhub-web', 'app-menu': 'axhub-web' };
  for (const [type, id] of Object.entries(own)) {
    eq(man.defaults[type], id, `default ${type} is ${id}`);
    ok(existsSync(`${here}src/assets/${type}/${id}.json`), `ships ${type}/${id}`);
    ok(!(man.hidden ?? []).includes(type), `${type} is not hidden`);
  }
  const app = readFileSync(`${here}src/App.tsx`, 'utf8');
  const libs = [...app.matchAll(/from '\.\/axf\/libs\/([a-z-]+)/g)].map((m) => m[1]).sort();
  for (const l of libs) ok(['hub', 'hubsync', 'settings'].includes(l), `library ${l} is one it needs`);
  ok(!/plugins\//.test(app), 'no console plugin is imported');
}

/* ---------------------------------------------------------------- the hub's pages (decision #96) */
{
  const ID = '0123abcd-0123-4567-89ab-0123456789ab';
  const RUN = '20261022-143005-ab12';
  eq(parseRoute(''), { view: 'home', params: {} }, 'no hash is the approvals page');
  eq(parseRoute('#/approvals'), { view: 'home', params: {} }, '#/approvals is home');
  eq(parseRoute('#/approvals?status=pending'), { view: 'home', params: { status: 'pending' } }, 'a filter is kept');
  eq(parseRoute('#/approvals?status=bogus'), { view: 'home', params: {} }, 'an unknown filter is dropped');
  eq(parseRoute('#/approvals?status=all'), { view: 'home', params: {} }, '"all" is no filter');
  eq(parseRoute(`#/approvals/${ID}`), { view: 'approval', params: { id: ID } }, 'one request (the hub redirects /auth/admin/approvals/<id> here)');
  eq(parseRoute('#/approvals/not-an-id'), { view: 'home', params: {} }, 'a bad id is the list');
  eq(parseRoute('#/approvals/log'), { view: 'approvals-log', params: {} }, 'the log');
  eq(parseRoute('#/users'), { view: 'users', params: {} }, 'users');
  eq(parseRoute('#/account'), { view: 'account', params: {} }, 'account');
  eq(parseRoute('#/apps'), { view: 'apps', params: {} }, 'apps');
  eq(parseRoute('#/handoff'), { view: 'handoff', params: {} }, 'handoff list');
  eq(parseRoute(`#/handoff/${RUN}`), { view: 'handoff-run', params: { id: RUN } }, 'one handoff run');
  eq(parseRoute(`#/handoff/${RUN}?file=_claude%2Fhandoff%2FHANDOFF.md`), { view: 'handoff-run', params: { id: RUN, file: '_claude/handoff/HANDOFF.md' } }, 'a kit file');
  eq(parseRoute(`#/handoff/${RUN}?file=..%2Fsecret`), { view: 'handoff-run', params: { id: RUN } }, 'a traversing file is dropped');
  eq(parseRoute('#/handoff/../../x'), { view: 'home', params: {} }, 'a bad run id is home');
  eq(parseRoute('#/Settings'), { view: 'home', params: {} }, 'a view name with capitals is home');
  eq(parseRoute('#/a/b/c'), { view: 'home', params: {} }, 'deep unknown routes are home');
  eq(parseRoute('#/%E0%A4%A'), { view: 'home', params: {} }, 'a broken escape is home');
  for (const [view, params] of [['home', {}], ['home', { status: 'postponed' }], ['approval', { id: ID }], ['approvals-log', {}], ['users', {}], ['account', {}], ['handoff', {}], ['handoff-run', { id: RUN }], ['handoff-run', { id: RUN, file: 'a/b.md' }], ['settings', {}]]) {
    eq(parseRoute(routeHash(view, params)), { view, params }, `${view} ${JSON.stringify(params)} round-trips`);
  }
  eq(routeHash('approval', { id: 'x' }), '#/approvals', 'a bad id never goes into the hash');
  ok(safeFilePath('a/b.md') && !safeFilePath('/etc') && !safeFilePath('a//b') && !safeFilePath('a\\b') && !safeFilePath(''), 'kit file paths');

  eq(signInUrl(HUB, `${HUB}/#/approvals/${ID}`), `${HUB}/auth/login?rd=${encodeURIComponent(`${HUB}/#/approvals/${ID}`)}`, 'sign-in comes back to the same page');
  eq(signInUrl(HUB, 'https://evil.example/'), `${HUB}/auth/login?rd=${encodeURIComponent(`${HUB}/`)}`, 'sign-in never returns off the hub');

  eq(errorText(409, { error: { message: 'Someone decided it first.' } }), 'Someone decided it first.', "the hub's words come through");
  eq(errorText(0, null), "Can't reach the hub.", 'no answer');
  eq(errorText(502, 'x'), 'The hub answered 502.', 'a status without words');

  const now = Date.parse('2026-10-26T12:00:00Z');
  eq(relTime('2026-10-26T12:10:00Z', now), 'in 10 min', 'in 10 min');
  eq(relTime('2026-10-26T09:00:00Z', now), '3 h ago', '3 h ago');
  eq(relTime('2026-10-26T12:00:10Z', now), 'just now', 'just now');
  eq(relTime('nope', now), '—', 'no time');
  eq(clock(65_000), '1:05', 'm:ss');
  eq(clock(3_725_000), '1:02:05', 'h:mm:ss');
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localToUtcMinute('2026-10-27T09:30')), 'a local time becomes the UTC minute the hub takes');
  eq(localToUtcMinute('tomorrow'), '', 'a bad time is empty');

  eq(platformOf('Mozilla/5.0 (Linux; Android 16; SM-S948B)'), 'android', 'Android');
  eq(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows', 'Windows');
  eq(sessionsFor('android')[0].os, 'android', "this device's sessions come first");
  eq(sessionsFor('')[0].id, 'claude-code-web', 'otherwise Claude Code on the web first');
  eq(sessionsFor('', 'moshi').map((x) => x.id), ['android-moshi'], 'search finds Moshi');
  const moshi = sessionsFor('', 'moshi')[0];
  ok(clipboardFor(moshi, 'do $(rm -rf ~) it').includes("<<'AXF_HANDOFF_EOF'"), 'a command keeps the prompt in a quoted here-doc');
  eq(bashCommand('hi'), `claude "$(cat <<'AXF_HANDOFF_EOF'\nhi\nAXF_HANDOFF_EOF\n)"`, 'the ready command');
  ok(afterPick(moshi, true, false).includes('terminal'), 'what to do after a command pick');
  ok(afterPick(sessionsFor('', 'android · claude app')[0], false, false).includes("Couldn't reach the clipboard"), 'a blocked clipboard says so');

  const steps = [
    { id: 'a01', group: 'Assemble', label: 'Clicked', remaining: false, done: true, state: 'done', note: '', at: 0 },
    { id: 'h01', group: 'Handoff', label: 'Sent', remaining: true, done: true, state: 'done', note: '', at: 0 },
    { id: 'h02', group: 'Handoff', label: 'Read', remaining: true, done: false, state: 'running', note: '', at: 0 },
  ];
  const g0 = handoffGauges(steps, 0, now);
  eq([g0.total, g0.done, g0.remaining, g0.remDone, g0.live], [3, 2, 2, 1, false], 'not sent yet: counts, not live');
  ok(g0.status.startsWith('Waiting'), 'waiting for the prompt');
  const g1 = handoffGauges(steps, now - 120_000, now);
  eq([g1.live, g1.pace, Math.round(g1.left)], [true, 0.5, 120_000], 'live: pace and time left');
  eq(handoffGauges(steps.map((s) => ({ ...s, done: true })), now - 60_000, now).status, 'Handoff complete.', 'all done');
  eq(stepGroups(steps).map((x) => [x.name, x.done, x.steps.length]), [['Assemble', 1, 1], ['Handoff', 1, 2]], 'steps grouped in order');

  // The pages never hold a token and only talk to the hub's own /auth/api routes.
  const { readFileSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const api = readFileSync(`${here}src/hub/api.ts`, 'utf8');
  ok(api.includes("redirect: 'error'") && api.includes("credentials: 'include'") && api.includes("'X-AxHub-CSRF'"), 'the API client: session cookie, CSRF header, no redirects');
  ok(!/Authorization|Bearer/.test(api), 'the API client sends no token');
  for (const f of ['Approvals', 'ApprovalDetail', 'ApprovalLog', 'Users', 'HubAccount', 'Handoff']) {
    const src = readFileSync(`${here}src/views/${f}.tsx`, 'utf8');
    ok(src.includes('<HubGate'), `${f} is behind the sign-in gate`);
    ok(!/<button(?![^>]*className=\{?`?["']?fx-chip)/.test(src), `${f} draws no hand-styled buttons`);
  }
  const nav = JSON.parse(readFileSync(`${here}src/assets/nav-menu/axhub-web.json`, 'utf8'));
  const navViews = nav.data.sections.flatMap((x) => x.items.map((i) => i.view));
  for (const v of ['home', 'approvals-log', 'users', 'handoff', 'account', 'apps']) ok(navViews.includes(v), `the nav reaches ${v}`);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
