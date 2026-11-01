/**
 * Self-test for the hub rules the AmberX app uses (lib-hub `framework/libs/hub/apps.ts`, harvested from this app
 * Oct 23 2026): what a reply from the hub means, what is thrown away, and how times and sizes are shown.
 *
 *   npx -y tsx apps/amberx-droid/test.mjs
 *
 * Nothing here touches the network: every case is a hand-written reply.
 */
import * as voice from './src/plugins/voice/web/core.ts';
import * as mon from './src/plugins/monitor/web/core.ts';
import * as notes from './src/plugins/notes/web/core.ts';
import * as hf from './src/plugins/voice/web/handsfree.ts';
import { HOSTED_URL, sharesHubSite } from './src/hosted.ts';
import { readFileSync } from 'node:fs';
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

console.log('AmberX — hub rules, voice and monitoring rules');

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

// The look is axHub's shared appearance document (appearance@1), live: the app attaches the hub source at start, like
// the console and axhub-web (amberx-look-fix, Oct 31 2026).
{
  const { readFileSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const main = readFileSync(`${here}src/main.tsx`, 'utf8');
  const man = JSON.parse(readFileSync(`${here}axf.manifest.json`, 'utf8'));
  ok(/attachAppearanceSource\(new HubAppearanceSource\(/.test(main), 'main attaches the hub appearance source');
  eq(man.developer?.hub, 'https://axhub.amberxai.com', 'developer app: the look comes from axHub');
}

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
  const own = { banner: 'amberx-branded', toolbar: 'amberx-droid', 'context-menu': 'amberx-droid', 'nav-menu': 'amberx-droid', 'app-menu': 'amberx-droid' };
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

// Enterprise design language + branding (enterprise-branding s31, Oct 28 2026): the app names its own design package
// and the AmberX branding package; every asset they name ships with the app, and the banner stays one line (§11).
{
  const { readFileSync, existsSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const man = JSON.parse(readFileSync(`${here}axf.manifest.json`, 'utf8'));
  const read = (t, id) => JSON.parse(readFileSync(`${here}src/assets/${t}/${id}.json`, 'utf8'));
  eq(man.defaults['design-package'], 'amberx-app-day', 'default design package is AmberX · Day');
  eq(man.defaults.branding, 'amberx-app', 'default branding is the AmberX app branding package');
  for (const id of ['amberx-app-day', 'amberx-app-night']) {
    ok(existsSync(`${here}src/assets/design-package/${id}.json`), `ships design-package/${id}`);
    const d = read('design-package', id).data;
    for (const t of ['style-theme', 'color-theme', 'layout', 'behavior-theme']) ok(existsSync(`${here}src/assets/${t}/${d[t]}.json`), `${id}: ${t} ${d[t]} ships`);
    for (const [t, sid] of Object.entries(d.extras?.slots ?? {})) ok(existsSync(`${here}src/assets/${t}/${sid}.json`), `${id}: ${t} ${sid} ships`);
    if (id === 'amberx-app-day') for (const t of ['style-theme', 'color-theme', 'layout', 'behavior-theme']) eq(man.defaults[t], d[t], `default ${t} matches the default design package`);
  }
  const b = read('branding', 'amberx-app').data;
  for (const [slot, mode] of Object.entries({ banner: 'lockup', toolbar: 'none', container: 'none', 'tab-group': 'none', dialog: 'mark', window: 'mark' })) eq(b.decorations[slot], mode, `brand ${slot} = ${mode} (DESIGN-LANGUAGE §10)`);
  for (const [k, mid] of Object.entries(b.marks)) ok(existsSync(`${here}src/assets/${k === 'animated' ? 'animated-logo' : 'logo-mark'}/${mid}.json`), `branding ${k} ${mid} ships`);
  ok(existsSync(`${here}src/assets/icon-pack/${b.iconPack}.json`), `branding icon pack ${b.iconPack} ships`);
  eq(b.brand.name, 'AmberX', 'the brand is AmberX');
  const banner = read('banner', 'amberx-branded').data;
  ok(banner.height >= 24 && banner.height <= 40, 'the banner is one line, 24–40 px');
  ok(banner.logo.show === true, 'the banner shows the brand lockup');
  const tb = read('toolbar', 'amberx-droid').data;
  const tbItems = tb.groups.reduce((n, g) => n + g.items.length + (g.provider ? (g.max ?? 0) : 0), 0);
  ok(tbItems <= 12, `toolbar shows at most 12 items (${tbItems})`);
  ok(read('nav-menu', 'amberx-droid').data.sections.every((s) => typeof s.label === 'string' && s.label), 'every nav section has an eyebrow');
  ok(read('app-menu', 'amberx-droid').data.menus.length <= 9, 'at most 9 top menus');
  const sw = read('theme-switch', man.defaults['theme-switch']).data;
  ok(existsSync(`${here}src/assets/color-theme/${sw.light}.json`) && existsSync(`${here}src/assets/color-theme/${sw.dark}.json`), 'the day/night switch flips between colours the app ships');
}

// Windows (enterprise-branding s32): any page opens in a floating window on the framework's window engine, and the
// app's dialogs, containers, tab groups and popups are the Amber Signature set the design package names.
{
  const { readFileSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const app = readFileSync(`${here}src/App.tsx`, 'utf8');
  ok(app.includes('VIEW_TAB_KIND') && app.includes('registerWindowActions'), 'App registers the page window kind and its action');
  const win = readFileSync(`${here}src/windows/ViewWindow.tsx`, 'utf8');
  ok(win.includes("register('amberx.window'") && win.includes('windows.openFloating:'), 'amberx.window opens a floating window through the window engine');
  const ctx = JSON.parse(readFileSync(`${here}src/assets/context-menu/amberx-droid.json`, 'utf8')).data.targets['nav-item'];
  ok(ctx.some((i) => i.action === 'amberx.window:{payload}'), 'nav right-click offers Open in a window');
  const man = JSON.parse(readFileSync(`${here}axf.manifest.json`, 'utf8'));
  for (const t of ['dialog', 'container', 'tab-group', 'popup']) eq(man.defaults[t], 'amber-signature', `default ${t} is the Amber Signature one`);
  ok(!/#[0-9a-f]{3,8}\b/i.test(readFileSync(`${here}src/windows/windows.css`, 'utf8')), 'window CSS uses tokens only');
}

// Pages (enterprise-branding s33): every page head has an eyebrow, a title and one sentence; icons exist in the
// framework set (a missing name falls back to a box); Approvals shows skeletons while it reads and can pop out.
{
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const iconSrc = readFileSync(`${here}src/axf/react/components/Icon.tsx`, 'utf8');
  const names = new Set([...iconSrc.matchAll(/^\s+["']?([a-z0-9-]+)["']?:\s*["'`]M/gm)].map((m) => m[1]));
  const files = [`${here}src/views/Approvals.tsx`, ...readdirSync(`${here}src/plugins`).filter((p) => !p.startsWith('_') && existsSync(`${here}src/plugins/${p}/web`))
    .flatMap((p) => readdirSync(`${here}src/plugins/${p}/web`).filter((f) => f.endsWith('.tsx')).map((f) => `${here}src/plugins/${p}/web/${f}`))];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/icon="([a-z0-9-]+)"/g)) ok(names.has(m[1]), `${f.split('/src/')[1]}: icon ${m[1]} exists`);
    for (const head of src.matchAll(/<header className="fx-pagehead">([\s\S]*?)<\/header>/g)) {
      ok(head[1].includes('fx-eyebrow') && head[1].includes('<h1'), `${f.split('/src/')[1]}: page head has an eyebrow and a title`);
    }
  }
  const ap = readFileSync(`${here}src/views/Approvals.tsx`, 'utf8');
  ok(ap.includes('aria-busy') && ap.includes("amberx.window:home"), 'Approvals: skeleton while reading, pops out into a window');
}

// An empty shell for building and testing plugins (Oct 26 2026): Approvals is its only page; voice, monitor and any
// installed plugin bring the rest. No menu, toolbar or voice command may point at a page that isn't there.
{
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const here = new URL('.', import.meta.url).pathname;
  const app = readFileSync(`${here}src/App.tsx`, 'utf8');
  const own = [...app.slice(app.indexOf('const views'), app.indexOf('};', app.indexOf('const views'))).matchAll(/^\s{2}([a-z-]+):/gm)].map((m) => m[1]);
  eq(own, ['home'], 'Approvals (home) is the only page of its own');
  eq(readdirSync(`${here}src/views`).sort(), ['Approvals.tsx'], 'no other views are left');
  for (const gone of ['HubView', 'Planned', 'views/Apps', 'AssetStudio', 'AccountView']) ok(!app.includes(gone), `${gone} is gone`);
  for (const p of ['voice', 'monitor']) ok(existsSync(`${here}src/plugins/${p}/plugin.json`), `the ${p} plugin is kept`);
  ok(existsSync(`${here}src/plugins/_template/plugin.json`), 'the plugin template is kept');
  const plugViews = [];
  for (const p of readdirSync(`${here}src/plugins`).filter((f) => !f.startsWith('_') && existsSync(`${here}src/plugins/${f}/web/index.tsx`))) {
    plugViews.push(...[...readFileSync(`${here}src/plugins/${p}/web/index.tsx`, 'utf8').matchAll(/views: \{ ([a-z-]+):/g)].map((m) => m[1]));
  }
  ok(plugViews.includes('monitor') && plugViews.includes('voice'), 'Monitor and Voice pages come from their plugins');
  const pages = new Set(['home', 'settings', ...plugViews]);
  const targets = (text) => [...text.matchAll(/"(?:view|action)": "nav:([a-z-]+)"|"view": "([a-z-]+)"|action: 'nav:([a-z-]+)'/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  for (const f of ['nav-menu', 'app-menu', 'toolbar', 'context-menu']) {
    const t = targets(readFileSync(`${here}src/assets/${f}/amberx-droid.json`, 'utf8'));
    for (const v of t) ok(pages.has(v), `${f} points at a page that exists (${v})`);
  }
  for (const v of targets(readFileSync(`${here}src/plugins/voice/web/index.tsx`, 'utf8'))) ok(pages.has(v), `voice command opens a page that exists (${v})`);
  const nav = JSON.parse(readFileSync(`${here}src/assets/nav-menu/amberx-droid.json`, 'utf8'));
  eq(nav.data.sections.flatMap((s) => s.items.map((i) => i.view)), ['home', 'settings'], 'the nav menu holds Approvals and Settings (plugins add theirs)');
  const menu = JSON.parse(readFileSync(`${here}src/assets/app-menu/amberx-droid.json`, 'utf8'));
  eq(menu.data.menus.map((m) => m.id), ['axhub', 'approvals', 'view', 'help'], 'application menu: AmberX, Approvals, View, Help');
  ok(!JSON.stringify(menu).includes('hub.apps'), 'no app-catalog list in the menu');
  const dialogs = readFileSync(`${here}src/dialogs.tsx`, 'utf8');
  ok(!dialogs.includes('new-file') && !dialogs.includes('confirm-delete'), 'demo dialogs are gone');
}

/* ---------------------------------------------------------------- hands-free + detection overlay (plugins/voice/web/handsfree.ts) */
{
  const c = hf.voiceConfig({ handsFree: undefined, alwaysArmed: undefined, overlay: undefined, wake: ['hey amberx'], lang: '' });
  eq([c.handsFree, c.alwaysArmed, c.overlay, c.lang], [true, false, true, 'en-US'], 'defaults: hands-free on, always armed off, overlay on');
  ok(hf.listens(c), 'hands-free with a wake phrase listens');
  ok(!hf.listens({ ...c, handsFree: false }), 'hands-free off = no listening');
  ok(!hf.listens({ ...c, wakePhrases: [] }), 'no wake phrase and not always armed = nothing to listen for');
  ok(hf.listens({ ...c, wakePhrases: [], alwaysArmed: true }), 'always armed listens without a wake phrase');
  eq(hf.nativeColor('#abc'), '#aabbcc', 'short hex grows'); // theme-ok
  eq(hf.nativeColor('#11223380'), '#80112233', 'css #rrggbbaa becomes android #aarrggbb'); // theme-ok
  eq(hf.nativeColor('rgb(255, 0, 10)'), '#ff000a', 'rgb() becomes hex'); // theme-ok
  eq(hf.nativeColor('rgba(0,0,0,0.5)'), '#80000000', 'rgba() keeps its alpha'); // theme-ok
  eq(hf.nativeColor('var(--fx-x)'), null, 'anything else is refused');
  eq(hf.overlayColors({ accent: '#00ff00', bg: 'nope' }), { accent: '#00ff00' }, 'a token that can\'t be read is left out'); // theme-ok
  eq(hf.levelOf(-2, 'android'), 0, 'android silence = 0');
  eq(hf.levelOf(10, 'android'), 1, 'android loud = 1');
  eq(hf.levelOf(4, 'android'), 0.5, 'android middle');
  eq(hf.levelOf(-90, 'web'), 0, 'web floor clamps');
  eq(hf.levelOf(NaN, 'web'), 0, 'NaN reads as silence');
  eq(Math.round(hf.dbfs([0.5, -0.5, 0.5, -0.5])), -6, 'dBFS of a half-scale square');
  eq(hf.dbfs([0, 0]), -Infinity, 'silence is -Infinity dBFS');
  eq(hf.dbText(-6.4), '-6 dB', 'dB text rounds');
  eq(hf.dbText(-Infinity), '– dB', 'no level shows a dash');
  let h = [];
  for (let i = 0; i < 70; i++) h = hf.pushLevel(h, i / 70);
  eq(h.length, hf.HISTORY, 'history keeps the last 60');
  eq(hf.pushLevel([], 3), [1], 'levels clamp to 1');
  eq(hf.graphPoints([0, 1], 59, 10), '58,10 59,0', 'newest point on the right edge, louder is higher');
  eq(hf.graphPoints([], 59, 10), '', 'no history, no line');
  const n = voice.normalize;
  eq(hf.interpretHeard('Hey AmberX open approvals', ['hey amberx'], false, n), { kind: 'command', text: 'open approvals' }, 'wake phrase + command');
  eq(hf.interpretHeard('hey amberx', ['hey amberx'], false, n), { kind: 'wake' }, 'wake phrase alone');
  eq(hf.interpretHeard('open approvals', ['hey amberx'], false, n), { kind: 'ignore' }, 'no wake phrase is ignored');
  eq(hf.interpretHeard('open approvals', ['hey amberx'], true, n), { kind: 'command', text: 'open approvals' }, 'always armed acts on everything');
  eq(hf.interpretHeard('  ', [], true, n), { kind: 'ignore' }, 'nothing heard is ignored');
}

/* ---------------------------------------------------------------- voice control (plugins/voice/web/core.ts) */
{
  const cmds = [
    { id: 'a', phrases: ['approvals'], action: 'nav:home' },
    { id: 'b', phrases: ['open approvals on the hub'], action: 'hub.open:approvals' },
    { id: 'c', phrases: ['whats waiting'], action: 'axhub.check', reply: 'You have {waiting} waiting.' },
  ];
  eq(voice.normalize("  What's   WAITING?! "), 'whats waiting', 'normalize drops case, punctuation and extra spaces');
  ok(voice.contains('show me approvals now', 'approvals'), 'a phrase is found inside a sentence');
  ok(!voice.contains('disapprovals', 'approvals'), 'only whole words match');
  eq(voice.pickCommand('please open approvals on the hub', cmds)?.command.id, 'b', 'the most specific phrase wins');
  eq(voice.pickCommand("what's waiting", cmds)?.command.id, 'c', 'punctuation in what was heard is ignored');
  eq(voice.pickCommand('make coffee', cmds), null, 'nothing matches = no command');
  eq(voice.afterWake('Hey AmberX open apps', ['hey amberx']), 'open apps', 'the wake phrase is stripped');
  eq(voice.afterWake('open apps', ['hey amberx']), 'open apps', 'no wake phrase = the whole sentence');
  eq(voice.phraseList('hey amberx, Okay AmberX,,hey amberx'), ['hey amberx', 'okay amberx'], 'phrase list: split, normalized, no repeats');
  const u = voice.parseUserCommands('# mine\nopen alerts, alerts = nav:monitor | Here you go\nbad line\nx = rm -rf /\nhello = | Hi there');
  eq(u.commands.length, 2, 'two good user commands');
  eq(u.commands[0].phrases, ['open alerts', 'alerts'], 'user command phrases');
  eq(u.commands[0].reply, 'Here you go', 'user command reply');
  eq(u.commands[1].action, '', 'a reply-only command');
  eq(u.errors.length, 2, 'bad lines are reported, never used');
  eq(voice.fillReply('You have {waiting} waiting.', { waiting: 0 }), 'You have nothing waiting.', 'zero reads as nothing');
  eq(voice.fillReply('{waiting}', { waiting: 1 }), 'one approval', 'one');
  eq(voice.fillReply('{waiting}', { waiting: 4 }), '4 approvals', 'many');
}

/* ---------------------------------------------------------------- monitoring (plugins/monitor/web/core.ts = HubRules.java) */
{
  const p = mon.patterns('vps.logs, github.*;\n*x');
  eq(p, ['vps.logs', 'github.*', '*x'], 'patterns split on commas, spaces, semicolons, new lines');
  ok(mon.matches(p, 'github.pr'), 'a service pattern matches its tools');
  ok(!mon.matches(p, 'github'), 'a service pattern needs a tool');
  ok(mon.autoApproves(false, true, '', 'vps.logs'), 'approve everything covers vps.logs');
  ok(!mon.autoApproves(false, true, '', 'vps.run'), 'approve everything never covers vps.run');
  ok(mon.autoApproves(true, false, 'vps.run', 'vps.run'), 'naming vps.run in the list does');
  ok(!mon.autoApproves(false, false, '*', 'github.pr'), 'the list is off unless switched on');
  eq(mon.clampInterval(2), 15, 'interval floor');
  eq(mon.clampInterval(9999), 300, 'interval ceiling');
  eq(mon.clampInterval('x'), 30, 'interval default');
  const c = mon.watchConfig({ hub: HUB, interval: 60, listen: false, wake: ['hey amberx'], lang: '', autoApprove: true, autoApproveAll: false, autoApproveTools: 'github.*' });
  eq(c.wakePhrases, [], 'background listening off = no wake phrases sent');
  eq(c.lang, 'en-US', 'language default');
  eq(c.autoApprove, { on: true, all: false, tools: 'github.*' }, 'auto-approval config');
  eq(c.consoleAlerts, true, 'console alerts on by default (every push comes from AmberX)');
  eq(mon.watchConfig({ hub: HUB, interval: 60, listen: true, wake: [], lang: '', autoApprove: false, autoApproveAll: false, autoApproveTools: '', consoleAlerts: false }).consoleAlerts, false, 'console alerts can be switched off');
}

{
  ok(sharesHubSite(`${HOSTED_URL}/`, HUB), 'the hosted app shares the hub site');
  ok(sharesHubSite('https://amberxai.com/x', HUB), 'the parent domain itself counts');
  ok(!sharesHubSite('https://localhost/', HUB), 'a bundled copy (https://localhost) does not');
  ok(!sharesHubSite('http://amberx.amberxai.com/', HUB), 'plain http never does');
  ok(!sharesHubSite('https://evilamberxai.com/', HUB), 'a look-alike domain does not');
  ok(!sharesHubSite('https://amberxai.com.evil.io/', HUB), 'a suffix trick does not');
  ok(!sharesHubSite('not a url', HUB), 'garbage does not');
  const cap = JSON.parse(readFileSync(new URL('./capacitor.config.json', import.meta.url), 'utf8'));
  eq(cap.server?.url, HOSTED_URL, 'the shell loads the hosted app');
  ok((cap.server?.allowNavigation ?? []).includes(new URL(HUB).host), 'hub sign-in stays inside the app');
  eq((cap.server?.allowNavigation ?? []).length, 2, 'only the app and the hub may load in the shell');
  eq(cap.server?.errorPath, 'offline.html', 'offline page when the server is unreachable');
  ok(readFileSync(new URL('./public/offline.html', import.meta.url), 'utf8').includes(HOSTED_URL), 'the offline page retries the hosted app');
}


// tasks plugin
{
  const notes = await import('./src/plugins/notes/web/core.ts');
  const tk = await import('./src/plugins/tasks/web/core.ts');
  // Tuesday 27 Oct 2026, 10:00 local
  const now = new Date(2026, 9, 27, 10, 0, 0);
  const T = now.toISOString();
  // dueBucket edges
  eq(notes.dueBucket('', now), 'none', 'no due date');
  eq(notes.dueBucket('2026-10-26', now), 'overdue', 'yesterday is overdue');
  eq(notes.dueBucket('2026-10-27', now), 'today', 'today');
  eq(notes.dueBucket('2026-10-28', now), 'upcoming', 'tomorrow is upcoming');
  eq(notes.dueBucket('2026-11-03', now), 'upcoming', 'seven days out is still upcoming');
  eq(notes.dueBucket('2026-11-04', now), 'later', 'eight days out is later');
  // spokenDate
  eq(notes.spokenDate('today', now), '2026-10-27', 'spoken today');
  eq(notes.spokenDate('tomorrow', now), '2026-10-28', 'spoken tomorrow');
  eq(notes.spokenDate('friday', now), '2026-10-30', 'next friday');
  eq(notes.spokenDate('tuesday', now), '2026-11-03', 'same weekday = next week');
  eq(notes.spokenDate('in 3 days', now), '2026-10-30', 'in 3 days');
  eq(notes.spokenDate('in three days', now), '2026-10-30', 'in three days');
  eq(notes.spokenDate('next week', now), '2026-11-03', 'next week');
  eq(notes.spokenDate('someday', now), '', 'unknown phrase');
  eq(tk.parseDue('2026-11-02', now), '2026-11-02', 'date input passes through');
  eq(tk.parseDue('Friday', now), '2026-10-30', 'typed weekday');
  eq(tk.parseDue('', now), '', 'empty due');
  // a store with tasks
  const s = notes.emptyStore(T);
  const work = notes.addList(s, 'Work', null, T);
  const home = notes.addList(s, 'Home', null, T);
  const over = tk.quickAdd(s, { title: 'File taxes', kind: 'task', list: work.id, due: '2026-10-20', priority: 3 }, now);
  const today = tk.quickAdd(s, { title: 'Call mum', kind: 'todo', list: home.id, due: 'today' }, now);
  const soon = tk.quickAdd(s, { title: 'Ship build', kind: 'task', list: work.id, due: 'friday' }, now);
  const later = tk.quickAdd(s, { title: 'Plan trip', kind: 'task', list: home.id, due: '2026-12-01' }, now);
  const loose = tk.quickAdd(s, { title: 'Buy milk', kind: 'todo' }, now);
  const sub = tk.quickAdd(s, { title: 'Find receipts', kind: 'todo', parent: over.id }, now);
  notes.addItem(s, { kind: 'note', title: 'Just a note', due: '2026-10-27' }, T);
  eq(sub.kind, 'task', 'a subtask is a task');
  eq(sub.list, work.id, 'a subtask lives in its task\'s list');
  eq(sub.parent, over.id, 'subtask parent');
  eq(today.due, '2026-10-27', 'quick add reads spoken due');
  eq(loose.list, notes.SYS.inbox, 'no list = Inbox');
  let threw = false; try { tk.quickAdd(s, { title: '  ', kind: 'todo' }, now); } catch { threw = true; }
  ok(threw, 'quick add needs a title');
  eq(tk.tabItems(s, 'today', now).map((i) => i.title), ['File taxes', 'Call mum'], 'Today = overdue first, then today; notes left out');
  eq(tk.tabItems(s, 'upcoming', now).map((i) => i.title), ['Ship build'], 'Upcoming = the next 7 days');
  eq(tk.tabItems(s, 'todo', now).map((i) => i.title).sort(), ['Buy milk', 'Call mum'], 'Todo = quick todos');
  ok(!tk.tabItems(s, 'all', now).some((i) => i.id === sub.id), 'All shows a subtask under its task, not on its own');
  eq(tk.tabItems(s, 'all', now).length, 5, 'All = every open todo and task');
  eq(tk.todayCount(s, now), 2, 'badge counts overdue + today');
  eq(tk.todaySummary(s, now), '2 due today or overdue.', 'spoken summary');
  eq(tk.filterTasks(s, tk.tabItems(s, 'all', now), { list: work.id }).map((i) => i.title).sort(), ['File taxes', 'Ship build'], 'filter by list');
  eq(tk.filterTasks(s, tk.tabItems(s, 'all', now), { priority: 3 }).map((i) => i.title), ['File taxes'], 'filter by priority');
  eq(tk.filterTasks(s, tk.tabItems(s, 'all', now), { q: 'trip' }).map((i) => i.title), ['Plan trip'], 'search');
  eq(tk.subtaskProgress(s, over.id), { done: 0, total: 1 }, 'subtask progress');
  // done / reopen
  const t2 = new Date(2026, 9, 27, 11, 0, 0);
  const d1 = tk.setDone(s, today.id, true, t2);
  eq(d1.status, 'done', 'ticked done');
  eq(d1.doneAt, t2.toISOString(), 'doneAt stamped');
  const d2 = notes.updateItem(s, today.id, { title: 'Call mum back' }, new Date(2026, 9, 27, 12).toISOString());
  eq(d2.doneAt, t2.toISOString(), 'editing a done item keeps doneAt');
  const d3 = tk.setDone(s, today.id, false, t2);
  eq([d3.status, d3.doneAt], ['open', ''], 'reopen clears doneAt');
  eq(tk.cycleStatus(s, soon.id, now).status, 'doing', 'task open → doing');
  eq(tk.cycleStatus(s, soon.id, now).status, 'done', 'doing → done');
  eq(tk.cycleStatus(s, soon.id, now).status, 'open', 'done → open');
  eq(tk.cycleStatus(s, loose.id, now).status, 'done', 'a todo just ticks');
  eq(tk.tabItems(s, 'done', now).map((i) => i.title), ['Buy milk'], 'Done tab');
  eq(tk.cyclePriority(s, later.id, now).priority, 1, 'priority cycles up');
  eq(tk.nextPriority(3), 0, 'priority wraps');
  // subtasks travel with their task
  notes.moveItems(s, [over.id], home.id, T);
  eq(s.items[sub.id].list, home.id, 'moving a task moves its subtasks');
  eq(notes.removeItems(s, [over.id]), 2, 'removing a task removes its subtasks');
  // bulk
  eq(tk.setDueMany(s, [later.id, soon.id], 'tomorrow', now), 2, 'bulk set due');
  eq(s.items[later.id].due, '2026-10-28', 'bulk due applied');
  threw = false; try { tk.setDueMany(s, [later.id], 'blursday', now); } catch { threw = true; }
  ok(threw, 'bulk due refuses an unknown date');
  eq(tk.setDueMany(s, [later.id], '', now), 1, 'empty clears the due date');
  eq(s.items[later.id].due, '', 'due cleared');
  eq(tk.setDoneMany(s, [later.id, soon.id, loose.id], true, now), 2, 'bulk done skips the ones already done');
  // due labels
  eq(tk.dueLabel('2026-10-25', now).text, 'Overdue 2 d', 'overdue label');
  eq(tk.dueLabel('2026-10-25', now).tone, 'danger', 'overdue tone');
  eq(tk.dueLabel('2026-10-26', now).text, 'Yesterday', 'yesterday');
  eq(tk.dueLabel('2026-10-27', now).text, 'Today', 'today label');
  eq(tk.dueLabel('2026-10-28', now).text, 'Tomorrow', 'tomorrow label');
  eq(tk.dueLabel('2026-10-30', now).text, 'Fri', 'weekday this week');
  eq(tk.dueLabel('2026-11-09', now).text, 'Mon 9 Nov', 'a later date');
  eq(tk.dueLabel('2027-01-04', now).text, 'Mon 4 Jan 2027', 'another year');
  eq(tk.dueLabel('2026-10-20', now, true).overdue, false, 'done is never overdue');
  // checklist helpers
  let cl = tk.addCheck([], 'one');
  cl = tk.addCheck(cl, 'two');
  cl = tk.addCheck(cl, '   ');
  eq(cl.map((c) => c.text), ['one', 'two'], 'checklist add, blank ignored');
  ok(new Set(cl.map((c) => c.id)).size === 2, 'checklist ids are unique');
  cl = tk.toggleCheck(cl, cl[0].id);
  eq(cl[0].done, true, 'checklist tick');
  eq(tk.moveCheck(cl, cl[1].id, -1).map((c) => c.text), ['two', 'one'], 'checklist reorder');
  eq(tk.moveCheck(cl, cl[0].id, -1), cl, 'top item cannot go up');
  eq(tk.removeCheck(cl, cl[0].id).map((c) => c.text), ['two'], 'checklist remove');
  const id3 = tk.addCheck(tk.removeCheck(tk.addCheck(tk.addCheck([], 'a'), 'b'), 'c1'), 'c');
  ok(new Set(id3.map((c) => c.id)).size === id3.length, 'ids stay unique after a remove');
  eq(tk.nextStatus('open'), 'doing', 'status cycle');
  ok(tk.isTab('today') && !tk.isTab('bogus'), 'tab ids');
  // the plugin is wired
  const pj = JSON.parse(readFileSync(new URL('./src/plugins/tasks/plugin.json', import.meta.url), 'utf8'));
  eq([pj.$axf, pj.id, pj.name], ['amberx-plugin@1', 'ai.amberx.amberx.tasks', 'Tasks'], 'tasks plugin.json');
  const src = readFileSync(new URL('./src/plugins/tasks/web/index.tsx', import.meta.url), 'utf8');
  for (const a of ["'tasks.open'", "'tasks.add'", "badge: BADGE", "registerVoiceCommands(ID"]) ok(src.includes(a), `tasks plugin has ${a}`);
  for (const t of ['today', 'upcoming', 'todo', 'all', 'done']) ok(src.includes(`action: 'tasks.open:${t}'`), `voice opens ${t}`);
  ok(!/<button(?![^>]*(fx-chip|fx-tab|data-fx-row))/.test(src), 'every tasks <button> is a framework chip, tab or row');
  const css = readFileSync(new URL('./src/plugins/tasks/web/tasks.css', import.meta.url), 'utf8');
  ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(css), 'tasks CSS has no hard-coded colours');
}

// notes plugin
/* ---------------------------------------------------------------- notes (plugins/notes/web/core.ts) */
{
  const T = '2026-10-27T10:00:00.000Z';
  const now = new Date('2026-10-27T10:00:00');
  const s = notes.emptyStore(T);
  eq(notes.childrenOf(s, null).map((l) => l.id), ['inbox', 'plugins', 'voice-notes'], 'notes: Inbox, Plugins and Voice notes are built in');

  // one list per plugin, renamed when the plugin is, never removed
  const added = notes.syncPluginLists(s, [{ id: 'ai.amberx.amberx.voice', name: 'Voice control' }, { id: 'ai.amberx.amberx.notes', name: 'Notes' }], T);
  eq(added.length, 2, 'notes: a list is made for each plugin');
  eq(notes.childrenOf(s, 'plugins').map((l) => l.name), ['Voice control', 'Notes'], 'notes: plugin lists sit under Plugins');
  eq(notes.syncPluginLists(s, [{ id: 'ai.amberx.amberx.voice', name: 'Voice' }], T), [], 'notes: a second sync makes nothing new');
  eq(notes.childrenOf(s, 'plugins').map((l) => l.name), ['Voice', 'Notes'], 'notes: a renamed plugin renames its list, a missing one keeps it');

  // lists: add, sub-list, rename, move, reorder, remove
  const work = notes.addList(s, 'Work', null, T);
  const bugs = notes.addList(s, 'Bugs', work.id, T);
  const home = notes.addList(s, 'Home', null, T);
  eq(notes.pathOf(s, bugs.id), 'Work › Bugs', 'notes: a sub-list has a path');
  notes.renameList(s, home.id, 'House', T);
  eq(s.lists[home.id].name, 'House', 'notes: rename a list');
  let threw = ''; try { notes.renameList(s, 'inbox', 'Mine', T); } catch (e) { threw = e.message; }
  ok(threw.includes("can't be renamed"), 'notes: the Inbox can\'t be renamed');
  threw = ''; try { notes.removeList(s, 'plugins', undefined, T); } catch (e) { threw = e.message; }
  ok(threw.includes("can't be removed"), 'notes: Plugins can\'t be removed');
  ok(notes.canMoveList(s, work.id, bugs.id) !== null, 'notes: a list can\'t move inside itself');
  ok(notes.canMoveList(s, 'inbox', work.id) !== null, 'notes: the Inbox can\'t move');
  notes.moveList(s, home.id, work.id, T);
  eq(notes.pathOf(s, home.id), 'Work › House', 'notes: move a list under another');
  notes.reorderLists(s, [home.id, bugs.id], T);
  eq(notes.childrenOf(s, work.id).map((l) => l.name), ['House', 'Bugs'], 'notes: reorder siblings');
  const a = notes.addItem(s, { text: 'Leaky tap in the kitchen', list: home.id, tags: ['fix'] }, T);
  notes.removeList(s, home.id, 'inbox', T);
  ok(!s.lists[home.id], 'notes: remove a list');
  eq(s.items[a.id].list, 'inbox', 'notes: its items go where asked');

  // items: merge, search
  const b = notes.addItem(s, { text: 'Buy washers', list: 'inbox', tags: ['shop'] }, T);
  const m = notes.mergeItems(s, [a.id, b.id], T);
  ok(!s.items[b.id] && m.text.includes('Buy washers') && m.text.includes('Leaky tap'), 'notes: merge joins the texts and removes the rest');
  eq(m.tags, ['fix', 'shop'], 'notes: merge unites the tags');
  threw = ''; try { notes.mergeItems(s, [a.id], T); } catch (e) { threw = e.message; }
  ok(threw.includes('two or more'), 'notes: merging one is refused');
  notes.addItem(s, { text: 'Login button broken on phones', list: bugs.id }, T);
  eq(notes.search(s, { q: 'login phones' }).length, 1, 'notes: search needs every word');
  eq(notes.search(s, { q: 'bugs' }).length, 1, 'notes: search finds the list name');
  eq(notes.search(s, { list: work.id, deep: true }).length, 1, 'notes: search in a list and its sub-lists');
  eq(notes.search(s, { tag: 'shop' }).length, 1, 'notes: search by tag');
  eq(notes.search(s, { q: 'nothing like this' }).length, 0, 'notes: no match, nothing found');

  // spoken sentences → intents → the store
  const said = [
    ['create a list called groceries', { action: 'create-list', list: 'groceries', create: true }],
    ['rename list groceries to shopping', { action: 'rename-list', target: 'groceries', to: 'shopping' }],
    ['note buy milk', { action: 'add', kind: 'note', text: 'buy milk' }],
    ['move the last note to shopping', { action: 'move', target: 'last', kind: 'note', list: 'shopping' }],
    ['note in work: fix login', { action: 'add', kind: 'note', list: 'work', text: 'fix login' }],
    ['add todo call mom tomorrow', { action: 'add', kind: 'todo', due: '2026-10-28', text: 'call mom', title: 'call mom' }],
    ['remind me to pay rent by friday, urgent', { action: 'add', kind: 'todo', priority: 3, due: '2026-10-30', text: 'pay rent', title: 'pay rent' }],
    ['make a list sprints under work', { action: 'create-list', list: 'work', sublist: 'sprints', create: true }],
    ['mark call mom as done', { action: 'done', target: 'call mom' }],
    ['find milk', { action: 'search', text: 'milk' }],
    ['open the shopping list', { action: 'open', list: 'shopping' }],
  ];
  const sayings = [];
  for (const [heard, want] of said) {
    const intent = notes.parseIntent(heard, now);
    eq(intent, want, `notes: “${heard}” is understood`);
    const v = notes.validateIntent(intent);
    ok(v.ok, `notes: “${heard}” passes validation`);
    if (v.ok) sayings.push(notes.applyIntent(s, v.intent, { now: new Date(Date.parse(T) + 1000 * (sayings.length + 1)).toISOString(), transcript: heard }));
  }
  eq(notes.parseIntent('what is the weather', now), null, 'notes: not a notes sentence = null (for the AI)');
  ok(sayings.every((r) => r.ok), `notes: every sentence was carried out (${sayings.filter((r) => !r.ok).map((r) => r.say).join(' | ')})`);
  const shopping = notes.findList(s, 'shopping');
  ok(shopping && shopping.name === 'Shopping', 'notes: groceries became Shopping');
  ok(notes.findList(s, 'sprints')?.parent === work.id, 'notes: a sub-list made by voice sits under Work');
  ok(notes.itemsIn(s, shopping.id).some((i) => i.text === 'buy milk'), 'notes: the last note moved into Shopping');
  ok(notes.itemsIn(s, work.id).some((i) => i.text === 'fix login'), 'notes: “note in work:” lands in Work');
  ok(Object.values(s.items).find((i) => i.title === 'call mom')?.status === 'done', 'notes: call mom is done');
  eq(sayings.find((r) => r.open?.q === 'milk')?.items?.length, 1, 'notes: find milk finds it');
  ok(!notes.validateIntent({ action: 'rm -rf' }).ok, 'notes: an unknown action is refused');
  ok(!notes.validateIntent({ action: 'rename-list', target: 'x' }).ok, 'notes: rename without a new name is refused');
  ok(!notes.applyIntent(s, { action: 'rename-list', target: 'inbox', to: 'Mine' }, { now: T }).ok, 'notes: a voice rename of the Inbox is refused, not thrown');

  // export
  const md = notes.toMarkdown(s);
  ok(md.startsWith('# Inbox'), 'notes: Markdown starts with the first list');
  ok(md.includes('## Bugs') && md.includes('**Login button broken on phones**'), 'notes: sub-lists are sub-headings with their items');
  ok(md.includes('- [x] **call mom**') && md.includes('due 2026-10-28'), 'notes: todos are tick boxes with their due date');
  const one = notes.toMarkdown(s, work.id);
  ok(one.startsWith('# Work') && !one.includes('# Inbox'), 'notes: one list exports alone');
  const j = JSON.parse(notes.toJson(s));
  eq(j.$axf, 'amberx-notes@1', 'notes: JSON names its format');
  eq(j.items.length, Object.keys(s.items).length, 'notes: JSON has every item');
}

// voice + dictation (orchestrator s6–s8): commands manager, command vs notes sentence, dictation rules
{
  const notes = await import('./src/plugins/notes/web/core.ts');
  const dict = await import('./src/plugins/dictation/web/core.ts');

  /* commands built from the codebase */
  const nav = voice.navigationCommands([{ id: 'notes', title: 'Notes' }, { id: 'notes', title: 'Again' }, { id: '', title: 'x' }, { id: 'bad id', title: 'y' }, { id: 'tasks', title: '' }]);
  eq(nav.map((c) => c.id), ['nav.notes'], 'one navigation command per page (duplicates, blanks and bad ids dropped)');
  eq(nav[0].phrases, ['open notes', 'go to notes', 'show notes'], 'navigation phrases come from the page title');
  eq([nav[0].action, nav[0].group, nav[0].defaultOn], ['nav:notes', 'nav', true], 'navigation command runs nav:<id>, on by default');
  const acts = voice.actionCommands([
    { id: 'app.settings', meta: { label: 'Settings', module: 'axf.framework' } },
    { id: 'swap', meta: { label: 'Swap', params: true } },
    { id: 'demo.stub', meta: { label: 'Stub', stub: true } },
    { id: 'hidden.one', meta: { label: 'Hidden', searchable: false } },
    { id: 'nav', meta: { label: 'Navigate' } },
    { id: 'no.label', meta: { label: '  ' } },
    { id: 'notes.export', meta: { label: 'Export notes', module: 'ai.amberx.amberx.notes' } },
    { id: 'my.thing', meta: { label: 'My thing!' } },
  ]);
  eq(acts.map((c) => c.action), ['app.settings', 'notes.export', 'my.thing'].sort((a, b) => ({ 'app.settings': 'axf.framework', 'notes.export': 'ai.amberx.amberx.notes', 'my.thing': 'app' })[a].localeCompare(({ 'app.settings': 'axf.framework', 'notes.export': 'ai.amberx.amberx.notes', 'my.thing': 'app' })[b])), 'argument-free labelled actions only, grouped by owner');
  eq(acts.find((c) => c.action === 'app.settings').defaultOn, true, 'curated actions start on');
  eq(acts.find((c) => c.action === 'notes.export').defaultOn, false, 'other actions start off');
  eq(acts.find((c) => c.action === 'my.thing').phrases, ['my thing'], 'the phrase is the label, normalised');
  eq(acts.find((c) => c.action === 'my.thing').owner, 'app', "an action without a module is the app's");

  /* overrides */
  eq(voice.parseOverrides('not json'), {}, 'bad override JSON is ignored');
  eq(voice.parseOverrides('[1]'), {}, 'a list is not overrides');
  eq(voice.parseOverrides(JSON.stringify({ 'nav.notes': { on: false, phrases: ['My Notes!', ''], reply: 'Here.' }, 'bad id!': { on: true }, 'x.y': { on: 'yes' } })),
    { 'nav.notes': { on: false, phrases: ['my notes'], reply: 'Here.' } }, 'overrides are cleaned: bad ids and values dropped');
  const base = [...nav, ...acts];
  let ov = voice.setOverride({}, nav[0], { on: false });
  eq(ov, { 'nav.notes': { on: false } }, 'switching a command off is stored');
  ov = voice.setOverride(ov, nav[0], { on: true });
  eq(ov, {}, 'switching it back to its default stores nothing');
  ov = voice.setOverride(ov, nav[0], { phrases: ['open notes', 'go to notes', 'show notes'] });
  eq(ov, {}, 'phrases equal to the defaults store nothing');
  ov = voice.setOverride(ov, nav[0], { phrases: ['my notes'], reply: 'Notes.' });
  const eff = voice.applyOverrides(base, ov);
  eq(eff[0].phrases, ['my notes'], 'overridden phrases replace the defaults');
  eq([eff[0].reply, eff[0].edited, eff[0].on], ['Notes.', true, true], 'reply replaced, marked changed, still on');
  eq(eff.find((c) => c.action === 'notes.export').on, false, 'an untouched off-by-default action stays off');
  eq(voice.applyOverrides(base, { 'action.notes.export': { on: true } }).find((c) => c.action === 'notes.export').on, true, 'switching an action on');
  eq(voice.resetOverrides({ a: { on: true }, b: { on: false } }, ['a']), { b: { on: false } }, 'reset one tab drops only its overrides');
  eq(voice.resetOverrides({ a: { on: true } }), {}, 'reset all');

  /* your own commands */
  const mine = voice.parseMine(JSON.stringify([
    { id: 'mine.a1', phrases: ['Good morning', 'morning'], action: 'nav:home', reply: 'Morning.' },
    { id: 'mine.a1', phrases: ['dup'], action: 'nav:home' },
    { id: 'evil', phrases: ['x'], action: 'nav:home' },
    { id: 'mine.b2', phrases: ['x'], action: 'rm -rf /' },
    { id: 'mine.c3', phrases: ['hi'], action: '', reply: 'Hello.' },
    { id: 'mine.d4', phrases: ['nothing'], action: '' },
  ]));
  eq(mine.map((m) => m.id), ['mine.a1', 'mine.c3'], 'own commands: duplicates, bad ids, bad actions and empty ones dropped');
  eq(mine[0].phrases, ['good morning', 'morning'], 'own phrases normalised');
  eq(voice.parseMine('{oops'), [], 'bad JSON = no own commands');
  ok(voice.checkMine({ phrases: '', action: 'nav:home', reply: '' }).includes('phrase'), 'the form needs a phrase');
  ok(voice.checkMine({ phrases: 'x', action: 'not an action', reply: '' }).includes('action id'), 'the form refuses a bad action');
  ok(voice.checkMine({ phrases: 'x', action: '', reply: '' }).includes('reply'), 'the form needs an action or a reply');
  eq(voice.checkMine({ phrases: 'x', action: 'nav:home', reply: '' }), null, 'a good form passes');
  const users = voice.userCommands('old one = nav:monitor', mine);
  eq(users.map((u) => [u.id, u.group]), [['mine.a1', 'user'], ['mine.c3', 'user'], ['user.1', 'user']], 'the typed settings commands still work, under Yours');

  /* command or notes sentence */
  const cmds = [
    { id: 'settings', phrases: ['settings'], action: 'app.settings' },
    { id: 'dict', phrases: ['take a note'], action: 'dictation.start' },
    { id: 'appr', phrases: ['open approvals'], action: 'nav:home' },
  ];
  const route = (heard, ai = false) => voice.decide(heard, cmds, { localIntent: !!notes.parseIntent(heard), ai }).route;
  eq(voice.coverage('please open approvals', 'open approvals'), 2 / 3, 'coverage = phrase words / sentence words');
  eq(route('take a note'), 'command', 'a command phrase that is the whole sentence wins (starts dictation)');
  eq(voice.decide('settings', cmds, { localIntent: true }).route, 'command', 'the whole-sentence rule beats a notes parse');
  eq(route('note in settings: change the wifi password'), 'intent', 'a notes sentence beats a command phrase inside it');
  eq(route('take a note buy a new charger'), 'intent', 'a note with words after "take a note" is saved, not dictated');
  eq(route('please open approvals'), 'command', 'a command covering most of the sentence wins');
  eq(route('could you maybe tell me about the settings thing'), 'command', 'a weak match still runs without the AI');
  eq(route('could you maybe tell me about the settings thing', true), 'intent', 'with the AI a weak match goes to the AI');
  eq(voice.decide('make coffee', cmds).match, null, 'nothing matched');
  eq(route('make coffee'), 'intent', 'nothing matched = the notes path (AI or "didn\'t catch")');
  ok(voice.decide('settings', cmds).why.length > 0, 'every decision says why');

  /* previews and results */
  ok(voice.describeIntent(notes.parseIntent('add a todo call the bank to errands by friday')).startsWith('Add a todo “call the bank” in errands, due '), 'Try box: a todo with list and date');
  eq(voice.describeIntent(notes.parseIntent('create list bugs under work')), 'Make the list bugs under work.', 'Try box: a sub-list');
  eq(voice.describeIntent(notes.parseIntent('move the last note to shopping')), 'Move the last note to shopping.', 'Try box: move');
  eq(voice.describeIntent(null), 'Nothing: no notes sentence.', 'Try box: nothing');
  const has = (ids) => (id) => ids.includes(id);
  eq(voice.openSpec({ list: 'l-1' }, has(['notes.open'])), 'notes.open:l-1', 'a list result opens the list');
  eq(voice.openSpec({ q: 'wifi: router' }, has(['notes.search'])), 'notes.search:wifi router', 'a search opens search (no colons in the argument)');
  eq(voice.openSpec({ list: 'l-1' }, has([])), null, 'nothing opens when the notes plugin has no such action');
  eq(voice.openSpec(undefined, has(['notes.open'])), null, 'no open = nothing');
  for (const e of [...voice.NOTE_EXAMPLES, ...voice.TASK_EXAMPLES]) ok(notes.parseIntent(e.say) !== null, `example is understood by the notes parser: “${e.say}”`);
  eq(voice.GROUPS.map((g) => g.id), ['notes', 'tasks', 'nav', 'actions', 'plugins', 'user', 'builtin'], 'the Voice commands tabs');

  /* dictation: stop phrases */
  eq(dict.cutStop("Buy milk. That's it, thanks", dict.DEFAULT_STOP), { text: 'Buy milk.', stopped: true }, "“that's it” ends it and what follows is cut");
  eq(dict.cutStop('call mom stop note', dict.DEFAULT_STOP), { text: 'call mom', stopped: true }, 'a stop phrase at the end is cut');
  eq(dict.cutStop('END NOTE.', dict.DEFAULT_STOP), { text: '', stopped: true }, 'a turn that is only the stop phrase');
  eq(dict.cutStop('unstoppable notes stopnote', ['stop note']), { text: 'unstoppable notes stopnote', stopped: false }, 'only whole words stop');
  eq(dict.cutStop('a end note b stop note c', dict.DEFAULT_STOP).text, 'a', 'the earliest stop phrase wins');
  eq(dict.cutStop('fix the well-known bug, stop note', ['stop note']).text, 'fix the well-known bug', 'punctuation before the stop phrase is tidied, words kept as said');
  eq(dict.phrases('', dict.DEFAULT_STOP), dict.DEFAULT_STOP, 'no phrases set = the defaults');
  eq(dict.phrases("Stop Note, I'm done\n stop note", []), ['stop note', 'im done'], 'phrases are normalised, no repeats');
  eq([dict.clampMinutes('x'), dict.clampMinutes(0.1), dict.clampMinutes(99), dict.clampMinutes(3)], [5, 0.5, 30, 3], 'time limit clamped');

  /* dictation: turns */
  const cfg = { stops: dict.DEFAULT_STOP, maxMinutes: 1 };
  let s = dict.newSession(0);
  let r = dict.turn(s, 'buy milk', cfg, 1000);
  eq([r.session.parts, r.end], [['buy milk'], null], 'a turn is kept and listening goes on');
  r = dict.turn(r.session, '', cfg, 2000);
  eq(r.end, null, 'one quiet turn goes on');
  r = dict.turn(r.session, '', cfg, 3000);
  eq(r.end, 'silence', 'two quiet turns in a row end it');
  r = dict.turn(dict.turn(s, '', cfg, 1).session, 'and eggs', cfg, 2);
  eq(r.session.empties, 0, 'speaking resets the quiet count');
  r = dict.turn(s, 'and eggs end note please', cfg, 1000);
  eq([r.session.parts, r.end], [['and eggs'], 'stop'], 'the stop phrase ends it, cut out');
  eq(dict.turn(s, 'more', cfg, 61_000).end, 'max', 'the time limit ends it');
  eq(dict.turn(s, 'x'.repeat(dict.MAX_CHARS), cfg, 1).end, 'full', 'too long ends it');
  eq(dict.joinParts(['buy milk', 'then eggs.', '']), 'Buy milk. Then eggs.', 'turns join with capitals and full stops');
  eq(dict.sentences('One. Two!\nThree'), ['One.', 'Two!', 'Three'], 'sentences');

  /* dictation: drafts */
  const parse = (x) => notes.parseIntent(x);
  const lists = { work: 'l-work', errands: 'l-errands' };
  const resolveList = (spoken) => lists[notes.norm(spoken)] ?? null;
  let d = dict.draftFromText('Remind me to call mom.', parse, resolveList);
  eq([d.kind, d.title, d.text, d.tasks.length], ['todo', 'call mom', '', 0], 'one spoken todo = the item is that todo');
  d = dict.draftFromText('Meeting went well. Remind me to send the notes by friday.\n- [ ] book room\n- [x] invite bob', parse, resolveList);
  eq([d.kind, d.text, d.tasks.length, d.checklist], ['note', 'Meeting went well.', 1, [{ text: 'book room', done: false }, { text: 'invite bob', done: true }]], 'a note with checkboxes and a task pulled out');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d.tasks[0].due ?? ''), 'the task keeps its spoken date');
  eq(d.title, 'Meeting went well', 'title from the first sentence');
  d = dict.draftFromText('note in work: fix the login page', parse, resolveList);
  eq([d.list, d.text, d.listWhy !== ''], ['l-work', 'fix the login page', true], 'a list named in the sentence is suggested');
  eq(dict.draftFromText('note in work: fix it', parse, resolveList, 'l-errands').list, 'l-errands', 'the list passed to dictation.start wins');
  eq(dict.draftFromText('just thinking out loud', parse, resolveList).list, '', 'no list named = none picked (Inbox)');
  d = dict.draftFromIntent({ action: 'add', kind: 'note', title: 'Plan', text: 'Body\n- [ ] a', list: 'work', tasks: [{ content: 'ship it', due: '2026-11-01' }] }, 'heard', resolveList);
  eq([d.title, d.text, d.checklist.length, d.tasks, d.list], ['Plan', 'Body', 1, [{ content: 'ship it', due: '2026-11-01' }], 'l-work'], 'an AI intent becomes a draft');
  eq(dict.draftFromIntent({ action: 'add', text: 'x', list: 'nowhere' }, 'x', resolveList).list, '', 'an AI list that does not exist is not picked');
  const items = dict.draftToItems({ title: 'Plan', text: 'Body', kind: 'note', list: '', listWhy: '', checklist: [{ text: ' a ', done: false }, { text: ' ', done: true }], tasks: [{ content: 'ship it', due: '2026-11-01' }, { content: ' ' }] }, { fallback: 'inbox', transcript: 'heard' });
  eq(items.map((i) => [i.kind, i.list, i.title]), [['note', 'inbox', 'Plan'], ['task', 'inbox', 'ship it']], 'Save writes the note and each task, Inbox when no list');
  eq(items[0].checklist, [{ id: 'c1', text: 'a', done: false }], 'empty checkboxes are dropped');
  eq([items[0].source, items[0].transcript], ['voice', 'heard'], 'saved as a voice note with what was heard');
  eq(dict.draftToItems({ title: '', text: '', kind: 'note', list: '', listWhy: '', checklist: [], tasks: [] }, { fallback: 'inbox', transcript: '' }), [], 'an empty draft saves nothing');
  const st = notes.emptyStore('2026-10-27T00:00:00.000Z');
  for (const i of items) notes.addItem(st, i);
  eq(Object.values(st.items).length, 2, 'draft items are valid notes-store items');

  /* manifests */
  const pj = JSON.parse(readFileSync(new URL('./src/plugins/dictation/plugin.json', import.meta.url), 'utf8'));
  eq([pj.$axf, pj.id, pj.name, pj.builtWith.model], ['amberx-plugin@1', 'ai.amberx.amberx.dictation', 'Dictation', 'opus'], 'dictation manifest');
  const dsrc = readFileSync(new URL('./src/plugins/dictation/web/index.tsx', import.meta.url), 'utf8');
  for (const a of ["'dictation.start'", "'dictation.stop'"]) ok(dsrc.includes(`rt.actions.register(${a}`), `dictation registers ${a}`);
  ok(!/#[0-9a-f]{3,6}\b|\d+px/i.test(readFileSync(new URL('./src/plugins/dictation/web/dictation.css', import.meta.url), 'utf8')), 'dictation CSS uses tokens only');
}

// design language
/* ---------------------------------------------------------------- design language (framework/spec/DESIGN-LANGUAGE.md §11, §12) */
{
  const { readdirSync: dir } = await import('node:fs');
  const PLUGINS = ['notes', 'tasks', 'dictation', 'voice', 'web'];
  for (const p of PLUGINS) {
    const base = new URL(`./src/plugins/${p}/web/`, import.meta.url);
    const files = dir(base).filter((f) => f.endsWith('.tsx'));
    const srcs = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, base), 'utf8')]));
    const all = Object.values(srcs).join('\n');
    // every page (a view's component) opens with the page head: eyebrow, h1, one sentence
    const index = srcs['index.tsx'];
    const views = [...index.matchAll(/render: \(\) => <([A-Z][A-Za-z]+) \/>/g)].map((m) => m[1]);
    ok(views.length > 0, `${p}: has at least one page`);
    for (const v of views) {
      const file = Object.entries(srcs).find(([, src]) => new RegExp(`function ${v}\\(`).test(src));
      ok(!!file, `${p}: page ${v} is defined in the plugin`);
      if (!file) continue;
      const body = file[1].slice(file[1].search(new RegExp(`function ${v}\\(`)));
      const head = body.slice(body.indexOf('fx-pagehead'), body.indexOf('</header>'));
      ok(body.includes('<header className="fx-pagehead">'), `${p}: page ${v} starts with fx-pagehead`);
      ok(head.includes('className="fx-eyebrow"') && head.includes('<h1>') && head.includes('<p className="fx-muted">'), `${p}: page ${v} head has an eyebrow, a title and a description`);
    }
    ok(!/<table\b/.test(all), `${p}: tables go through the framework DataGrid, never <table>`);
    ok(!/import \{[^}]*\bSection\b[^}]*\} from '\.\.\/\.\.\/\.\.\/axf\/react'/.test(all), `${p}: sections are Container cards, not Section`);
    ok(!/className="fx-card"/.test(all), `${p}: no hand-written fx-card sections`);
    ok(!/className="fx-card (?!axp-notes-card")/.test(all), `${p}: only note cards are hand-made cards`);
    for (const f of dir(base).filter((x) => x.endsWith('.css'))) {
      const css = readFileSync(new URL(f, base), 'utf8');
      ok(!/font-size|#[0-9a-f]{3,8}\b|rgba?\(|\b\d+(\.\d+)?px\b/i.test(css), `${p}/${f}: layout and theme tokens only (no font sizes, colours or px)`);
      ok(!/text-transform:\s*uppercase/.test(css), `${p}/${f}: uppercase only in eyebrows`);
    }
  }
}


// voice fix (Oct 28 2026): loose wake phrases, swear words, beep/online/swears settings
{
  const sp = await import('./src/plugins/voice/web/speech.ts');
  const cases = JSON.parse(readFileSync(new URL('./src/plugins/voice/web/speech-cases.json', import.meta.url), 'utf8'));
  for (const [a, b] of cases.compact) eq(sp.compact(a), b, `speech: compact ${JSON.stringify(a)}`);
  for (const [a, b] of cases.wake.cases) eq(sp.wakeHit(a, cases.wake.phrases), b, `speech: wake in ${JSON.stringify(a)}`);
  for (const [a, b] of cases.unmask) eq(sp.unmask(a), b, `speech: unmask ${JSON.stringify(a)}`);
  eq(sp.splitWake('Hey Amber X, open approvals', ['hey amberx']), { phrase: 'hey amberx', rest: 'open approvals' }, 'speech: split loose wake');
  eq(sp.splitWake('hey ambrex', ['hey amberx']), { phrase: 'hey amberx', rest: '' }, 'speech: wake alone');
  eq(sp.splitWake('the chambers are open', ['hey amberx']), null, 'speech: no wake');
  eq(voice.afterWake('hey amber ex note in work: fix login', ['hey amberx']), 'note in work fix login', 'voice: afterWake strips a loosely spelled wake phrase');
  eq(hf.interpretHeard('Hey Amber X open approvals', ['hey amberx'], false, voice.normalize), { kind: 'command', text: 'open approvals' }, 'hands-free: loose wake → command');
  eq(hf.interpretHeard('hey ember x', ['hey amberx'], false, voice.normalize), { kind: 'wake' }, 'hands-free: loose wake alone');
  const cfg = hf.voiceConfig({ handsFree: undefined, alwaysArmed: undefined, overlay: undefined, wake: ['hey amberx'], lang: '' });
  eq([cfg.beep, cfg.online, cfg.swears], ['silence', true, true], 'voice config: tone silenced, online, swears shown by default');
  eq(hf.voiceConfig({ handsFree: 1, alwaysArmed: 0, overlay: 0, wake: [], lang: 'en', beep: 'loud', online: false, swears: false }).beep, 'silence', 'voice config: unknown tone mode → silenced');
  eq(sp.beepMode('silence-all'), 'silence-all', 'speech: beep mode kept');
  const java = readFileSync(new URL('./android/app/src/main/java/ai/amberx/droid/SpeechTuning.java', import.meta.url), 'utf8');
  for (const k of ['MASK_OFFENSIVE_WORDS', 'EXTRA_PARTIAL_RESULTS', 'ADJUST_MUTE', 'SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS']) ok(java.includes(k), `android: SpeechTuning sets ${k}`);
  const watch = readFileSync(new URL('./android/app/src/main/java/ai/amberx/droid/WatchService.java', import.meta.url), 'utf8');
  ok(watch.includes('SpeechTuning.quiet(') && watch.includes('SpeechTuning.loud('), 'android: hands-free silences the tone and restores it');
  ok(!/onPartialResults\(Bundle b\) \{ if \(heard/.test(watch), 'android: a wake phrase mid-sentence no longer cuts the command off');
  const plug = readFileSync(new URL('./android/app/src/main/java/ai/amberx/droid/AmberxNativePlugin.java', import.meta.url), 'utf8');
  ok(/onPartialResults[\s\S]{0,300}notifyListeners\("heard"/.test(plug), 'android: Speak / dictation stream live text');
  const dict = readFileSync(new URL('./src/plugins/dictation/web/index.tsx', import.meta.url), 'utf8');
  ok(dict.includes("addListener('heard'"), 'dictation shows live text');
}

// voice command center (Oct 28 2026, voice-command@1): matcher, overrides, recordings, library, ops, runner
{
  const cc = await import('./src/plugins/commands/web/core.ts');
  const { LIBRARY } = await import('./src/plugins/commands/web/library.ts');
  const ops = await import('./src/plugins/commands/web/ops.ts');
  const rn = await import('./src/plugins/commands/web/runner.ts');
  eq(cc.checkLibrary(LIBRARY), [], 'commands: library passes its own checks');
  const count = (cat, kinds) => LIBRARY.filter((c) => c.category === cat && kinds.includes(c.kind)).length;
  ok(count('notes', ['action']) >= 75, 'commands: 75+ notes actions');
  ok(count('tasks', ['action']) >= 65, 'commands: 65+ task actions');
  ok(count('notes', ['chain', 'wizard']) + count('tasks', ['chain', 'wizard']) >= 25, 'commands: 25+ notes/tasks chains and wizards');
  ok(count('developer', ['action', 'chain', 'wizard']) >= 50 && count('snippets', ['action']) >= 30, 'commands: developer 50+, AI snippets 30+');
  ok(LIBRARY.filter((c) => c.category === 'developer').every((c) => c.developer && c.needsAi), 'commands: every developer command goes through Molly');
  for (const c of LIBRARY) for (const st of c.steps) if (st.do === 'op') ok(ops.OP_NAMES.includes(st.op), `commands: ${c.id} uses a real op (${st.op})`);
  const clash = new Map();
  for (const c of LIBRARY) for (const ph of c.phrases) { const k = `${c.category}:${ph.replace(/\{[a-z0-9_]+\}/g, '{}')}`; ok(!clash.has(k), `commands: phrase "${ph}" only once (${c.id}, ${clash.get(k)})`); clash.set(k, c.id); }

  /* matching */
  eq(cc.matchPattern('add task {text} due {due}', 'add task buy milk due friday')?.slots, { text: 'buy milk', due: 'friday' }, 'match: slots');
  eq(cc.matchPattern('open notes', 'open the notes'), null, 'match: extra words fail');
  eq(cc.splitCategory('task add pay rent'), { category: 'tasks', rest: 'add pay rent' }, 'match: category trigger');
  const eff = cc.effective(LIBRARY, {});
  const hit = (h, ctx) => cc.findCommand(h, eff, ctx)?.command.id;
  eq(hit('add task buy milk due friday'), 'tasks.add-due', 'match: task with a date');
  eq(hit('note pin that'), 'notes.pin-last', 'match: notes trigger');
  eq(hit('task tag that task home'), 'tasks.tag-last', 'match: tasks trigger');
  eq(hit('dev merge pr 150'), 'dev.merge', 'match: developer trigger');
  eq(hit('ask what is a quark'), 'ai.ask', 'match: snippets trigger');
  eq(hit('good morning'), 'tasks.morning', 'match: chain');
  eq(hit('task wizard'), 'tasks.wiz-task', 'match: wizard');
  eq(hit('flibber the jabberwock'), undefined, 'match: nothing');

  /* overrides + recordings */
  const o1 = cc.setOverride({}, 'notes.open', { on: false });
  eq(hit('open notes', undefined), 'notes.open', 'override: on by default');
  eq(cc.findCommand('open notes', cc.effective(LIBRARY, o1))?.command.id, undefined, 'override: switched off = not matched');
  const o2 = cc.setOverride({}, 'notes.open', { recordings: [{ phrase: 'show me the notebook', at: '2026-10-28T00:00:00Z' }] });
  eq(cc.findCommand('show me the notebook', cc.effective(LIBRARY, o2))?.command.id, 'notes.open', 'override: a recorded phrase matches');
  eq(cc.resetOverride(o2, 'notes.open'), {}, 'override: reset');
  ok(cc.recordingsMatch('open my shopping list', 'open my shopping lists'), 'recordings: one word off matches');
  ok(!cc.recordingsMatch('open shopping', 'close the garage door'), 'recordings: different phrases do not');
  eq(cc.phraseTaken('open notes', eff, 'notes.manage-lists')?.id, 'notes.open', 'recordings: a phrase another command uses is flagged');
  eq(cc.cleanSteps([{ do: 'op', op: 'pin', args: { item: 'last' } }, { do: 'op', op: 'Bad Op!' }, { do: 'nope' }, { do: 'say', text: 'hi' }]).length, 2, 'cleanSteps: bad steps dropped');
  eq(cc.parseOverrides('{"x":{"on":false,"steps":[{"do":"say","text":"hi"},{"do":"evil"}]}}').x.steps.length, 1, 'overrides: steps cleaned on load');
  eq(cc.filterCommands(eff, { q: 'overdue', kind: 'chain' }).map((c) => c.id), ['tasks.morning', 'tasks.weekly-review', 'tasks.catch-up'], 'grid: filter by text + kind');
  eq(cc.sortCommands(eff.filter((c) => c.group === 'Wizards' && c.category === 'notes'), 'label').map((c) => c.label)[0], 'Export wizard', 'grid: sort by label');

  /* ops on a real store */
  const now = new Date(2026, 9, 28, 10, 0, 0);
  const s = notes.emptyStore(now.toISOString());
  notes.ensureSystemLists(s, now.toISOString());
  const work = notes.addList(s, 'Work', null, now.toISOString());
  notes.addItem(s, { kind: 'note', title: 'Meeting with Sam', text: 'call vendor\nsend deck\nbook room', list: work.id }, new Date(now.getTime() - 60_000).toISOString());
  notes.addItem(s, { kind: 'task', title: 'Pay rent', due: '2026-10-25' }, now.toISOString());
  eq(ops.runOp(s, 'pin', { item: 'meeting', kind: 'note' }).say, 'Pinned Meeting with Sam.', 'ops: pin by name');
  eq(ops.runOp(s, 'read-due', { when: 'overdue' }, now).say.startsWith('One task overdue: Pay rent'), true, 'ops: read overdue');
  eq(ops.runOp(s, 'overdue-to-today', {}, now).say, 'Moved One overdue task to today.'.replace('One', 'One'), 'ops: overdue to today');
  eq(notes.latest(s, 'task').due, '2026-10-28', 'ops: overdue now due today');
  eq(ops.runOp(s, 'priority', { item: 'last', priority: 'high' }).say, 'Pay rent: high priority.', 'ops: priority on the last task');
  eq(ops.runOp(s, 'tasks-from-note', { item: 'meeting' }, now).say, 'Made 3 tasks from Meeting with Sam.', 'ops: tasks from note lines');
  eq(ops.runOp(s, 'list-new', { name: 'bugs', parent: 'work' }, now).say, 'Made Work › Bugs.', 'ops: sub-list');
  eq(ops.runOp(s, 'tag', { item: 'pay rent', kind: 'task', tag: 'home bills' }).say, 'Tagged Pay rent #home-bills.', 'ops: tags');
  eq(ops.runOp(s, 'list-delete', { list: 'inbox' }).ok, false, 'ops: system lists stay');
  eq(ops.runOp(s, 'nonsense', {}).ok, false, 'ops: unknown op fails softly');
  eq(ops.runOp(s, 'count', { what: 'tasks' }).say, '4 open tasks.', 'ops: count');

  /* runner with a fake app */
  const fake = (answers, { ai = true } = {}) => {
    const log = [];
    const st = notes.emptyStore(now.toISOString()); notes.ensureSystemLists(st, now.toISOString());
    return {
      log, st,
      env: {
        action: (a) => { log.push(`action ${a}`); },
        intent: (i) => { const r = notes.applyIntent(st, notes.validateIntent(i).intent ?? i, { now: now.toISOString() }); return { ok: r.ok, say: r.say ?? r.message ?? '' }; },
        op: (n, a) => ops.runOp(st, n, a, now),
        say: (t) => { log.push(`say ${t}`); },
        listen: async (q) => { log.push(`ask ${q}`); return answers.shift() ?? ''; },
        ai: async (p) => { log.push(`ai ${p}`); return 'step one\nstep two'; },
        molly: async (t) => { log.push(`molly ${t}`); return 'ok'; },
        command: (id) => eff.find((c) => c.id === id),
        aiReady: () => ai,
      },
    };
  };
  const byId = (id) => eff.find((c) => c.id === id);
  {
    const f = fake([]);
    const r = await rn.runCommand({ command: byId('notes.new-project'), slots: { name: 'garden' } }, f.env);
    ok(r.ok && notes.findList(f.st, 'garden') && notes.findList(f.st, 'garden ideas'), 'runner: chain makes a project with sub-lists');
  }
  {
    const f = fake(['buy seeds', 'back', 'buy tulip bulbs', 'skip', 'high', 'inbox']);
    const r = await rn.runCommand({ command: byId('tasks.wiz-task'), slots: {} }, f.env);
    ok(r.ok, 'runner: wizard finishes');
    const t = notes.latest(f.st);
    eq([t?.title, t?.due, t?.priority], ['buy tulip bulbs', '', 3], 'runner: wizard went back, skipped the date, set priority');
  }
  {
    const f = fake(['cancel']);
    const r = await rn.runCommand({ command: byId('notes.wiz-note'), slots: {} }, f.env);
    eq([r.ok, r.did], [false, 'Cancelled.'], 'runner: cancel stops a wizard');
  }
  {
    const f = fake(['no']);
    const r = await rn.runCommand({ command: byId('tasks.clear-done'), slots: {} }, f.env);
    eq(r.did, 'Cancelled.', 'runner: confirm setting asks first');
  }
  {
    const f = fake([], { ai: false });
    const r = await rn.runCommand({ command: byId('dev.status'), slots: {} }, f.env);
    ok(!r.ok && r.said[0].includes('Molly'), 'runner: developer commands need Molly');
  }
  {
    const f = fake(['yes']);
    const r = await rn.runCommand({ command: byId('dev.morning'), slots: {} }, f.env);
    eq(f.log.filter((l) => l.startsWith('molly')).length, 4, 'runner: chain of chains runs every Molly task');
    ok(r.ok, 'runner: dev morning ok');
  }
  /* custom commands + the voice wizard */
  const custom = cc.parseCustom(JSON.stringify([{ id: 'mine.home', category: 'tasks', kind: 'chain', label: 'Home', phrases: ['im home'], steps: [{ do: 'say', text: 'hi' }, { do: 'evil' }] }, { id: 'bad id', category: 'tasks', kind: 'chain', phrases: ['x'], steps: [{ do: 'say', text: 'x' }] }, { id: 'mine.dev', category: 'developer', kind: 'chain', phrases: ['dev thing'], steps: [{ do: 'molly', task: 'x' }] }]));
  eq(custom.map((c) => [c.id, c.steps.length, !!c.developer]), [['mine.home', 1, false], ['mine.dev', 1, true]], 'custom: checked, bad ids and steps dropped, developer flagged');
  eq(cc.mineId('Good Night!', (id) => id === 'mine.good-night'), 'mine.good-night-2', 'custom: ids never clash');
  const vw = await import('./src/plugins/commands/web/voicewizard.ts');
  const io = (answers) => { const said = []; return { said, io: { ask: async (q) => { said.push(`? ${q}`); return answers.shift() ?? ''; }, say: (t) => { said.push(t); } } }; };
  {
    const t = io(['Garden day', 'start garden day', 'open the car door', 'start garden day', 'start garden day', 'tasks', 'add task water the tomatoes', 'flibber', 'say lets go', 'undo', 'say ready', 'whats due today', 'done', 'yes']);
    const r = await vw.recordChain(t.io, eff);
    ok(r.ok && r.command.phrases[0] === 'start garden day' && r.command.category === 'tasks' && r.command.settings.confirm === true, 'voice wizard: name, phrase recorded twice (retry on mismatch), tab, confirm');
    eq(r.ok && r.command.steps.map((s) => s.do), ['intent', 'say', 'op'], 'voice wizard: steps from what was said, unknown skipped, undo works');
    eq(r.ok && r.command.steps[0].intent.title, 'water the tomatoes', 'voice wizard: what was said fills the step');
    ok(cc.checkLibrary([...LIBRARY, r.command]).length === 0, 'voice wizard: the chain passes the library checks');
  }
  {
    const t = io(['Morning two', 'good morning', 'good morning']);
    const r = await vw.recordChain(t.io, eff);
    ok(!r.ok || r.command.phrases[0] !== 'good morning', 'voice wizard: a phrase another command uses is refused');
  }
  {
    const t = io(['cancel']);
    eq((await vw.recordChain(t.io, eff)).ok, false, 'voice wizard: cancel saves nothing');
  }
  {
    const t = io(['remove step 1', 'move step 2 up', 'add say all done', 'done']);
    const r = await vw.editChain(t.io, byId('tasks.morning'), eff);
    eq(r.steps.map((s) => s.do + (s.op ? `:${s.op}` : '')), ['op:read-priority', 'op:read-due', 'action', 'say'], 'voice wizard: edit removes, moves and adds');
  }
  eq(rn.readAnswer('number', 'three please'), '3', 'runner: spoken number');
  eq(rn.readAnswer('choice', 'the medium one', ['high', 'medium', 'low']), 'medium', 'runner: choice');
}

/* ---------------------------------------------------------------- veto@1 held calls (lib-hub veto.ts + plugins/approvals) */
{
  const vt = await import('../../framework/libs/hub/veto.ts');
  const ID1 = '11111111-2222-3333-4444-555555555555';
  const ID2 = '66666666-7777-8888-9999-000000000000';
  const NOW = Date.parse('2026-10-29T02:00:00.000Z');
  const held = (over = {}) => ({ id: ID1, tool: 'vps.run', summary: 'vps.run with arguments {"command":"docker restart \\"web\\""}', url: `${HUB}/auth/admin/approvals/${ID1}`, status: 'held',
    veto: { runsAt: '2026-10-29T02:03:00.000Z', secondsLeft: 180, countdownSeconds: 180 }, jobId: 'job_abc-1', denyUrl: `${HUB}/auth/api/approvals/${ID1}/deny`, streamUrl: `${HUB}/auth/api/jobs/job_abc-1/stream`, reason: { title: 'Restart web' }, ...over });
  const plain = { id: ID2, tool: 'github.merge', summary: 'merge', url: `${HUB}/auth/admin/approvals/${ID2}`, createdAt: '', expiresAt: '' };
  const body = JSON.stringify({ count: 2, pending: [held(), plain], held: [held()], heldCount: 1 });
  const calls = vt.interpretVeto(HUB, body, NOW);
  eq(calls.length, 1, 'veto: one held call (pending + held[] deduped)');
  eq(calls[0].command, 'docker restart "web"', 'veto: command from the summary');
  eq(calls[0].title, 'Restart web', 'veto: title from the reason');
  eq(calls[0].denyUrl, `${HUB}/auth/api/approvals/${ID1}/deny`, 'veto: deny link rebuilt');
  eq(calls[0].streamUrl, `${HUB}/auth/api/jobs/job_abc-1/stream`, 'veto: stream link rebuilt');
  eq(vt.interpretVeto(HUB, JSON.stringify({ pending: [held({ denyUrl: 'https://evil.example/x' })] }), NOW).length, 0, 'veto: a link off the hub is refused');
  eq(vt.interpretVeto(HUB, JSON.stringify({ pending: [held({ veto: undefined })] }), NOW).length, 0, 'veto: no timing = not held');
  eq(vt.interpretVeto(HUB, 'nope', NOW).length, 0, 'veto: bad body = nothing');
  const split = vt.splitFeed(HUB, 200, body, NOW);
  eq(split.feed.pending.map((p) => p.id), [ID2], 'veto: held calls taken out of the approvals list');
  eq(split.feed.count, 1, 'veto: count without the held one');
  eq(split.held.length, 1, 'veto: held list');
  eq(vt.splitFeed(HUB, 401, '', NOW).feed.status, 'signed-out', 'veto: 401 still signed out');
  const c = calls[0];
  eq(vt.secondsLeftNow(c, NOW + 10_500), 170, 'veto: local countdown');
  eq(vt.secondsLeftNow(c, NOW + 999_000), 0, 'veto: never below 0');
  eq([vt.vetoPhase(31), vt.vetoPhase(30), vt.vetoPhase(0)], ['held', 'warning', 'running'], 'veto: phases');
  eq(vt.formatCountdown(179), '2:59', 'veto: 2:59');
  {
    let p = vt.notifyPlan([], [c], NOW);
    eq(p.send.map((x) => x.phase), ['held'], 'notify: timer started');
    p = vt.notifyPlan(p.sent, [c], NOW + 1000);
    eq(p.send.length, 0, 'notify: once per phase');
    p = vt.notifyPlan(p.sent, [c], NOW + 151_000);
    eq(p.send.map((x) => x.phase), ['warning'], 'notify: time running out');
    p = vt.notifyPlan(p.sent, [c], NOW + 180_000);
    eq(p.send.map((x) => x.phase), ['running'], 'notify: running');
    eq(vt.notifyPlan([], [c], NOW + 170_000).send.map((x) => x.phase), ['warning'], 'notify: first seen late = one card');
    // Brett's Oct 31 recording ("dunk dunk dunk"): a read that misses the call must not make it ring again.
    let q = vt.notifyPlan([], [c], NOW);
    q = vt.notifyPlan(q.sent, [], NOW + 5_000);
    eq(vt.notifyPlan(q.sent, [c], NOW + 10_000).send.length, 0, 'notify: a call missing from one read does not ring again');
    q = vt.notifyPlan(q.sent, [c], NOW + 151_000);
    eq(q.send.map((x) => x.phase), ['warning'], 'notify: the warning still comes once');
    q = vt.notifyPlan(q.sent, [], NOW + 152_000);
    eq(vt.notifyPlan(q.sent, [c], NOW + 155_000).send.length, 0, 'notify: and not again after a miss');
  }
  const push = vt.vetoFromPush(HUB, JSON.stringify({ type: 'veto', phase: 'warning', id: ID1, jobId: 'job_abc-1', title: 'Restart web', command: 'docker restart web', runsAt: '2026-10-29T02:03:00.000Z', secondsLeft: 30, denyUrl: `${HUB}/auth/api/approvals/${ID1}/deny`, streamUrl: `${HUB}/auth/api/jobs/job_abc-1/stream`, approvalUrl: `${HUB}/auth/admin/approvals/${ID1}` }), NOW);
  ok(push && push.phase === 'warning' && push.call.command === 'docker restart web' && push.call.secondsLeft === 30, 'push: veto push read');
  eq(vt.vetoFromPush(HUB, { type: 'approval', id: ID1 }, NOW), null, 'push: other pushes ignored');
  eq(vt.vetoEvent({ event: 'countdown', data: '{"secondsLeft":12}' }), { type: 'countdown', secondsLeft: 12 }, 'stream: countdown');
  eq(vt.vetoEvent({ event: 'output', data: '{"stream":"stderr","text":"oops"}' }), { type: 'output', stream: 'stderr', text: 'oops' }, 'stream: output');
  eq(vt.vetoEvent({ event: 'done', data: '{"state":"ran","exitCode":0}' }), { type: 'done', state: 'ran', exitCode: 0 }, 'stream: done');
  eq(vt.vetoEvent({ event: 'done', data: '{"exitCode":2}' }).state, 'failed', 'stream: done without state, non-zero = failed');
  eq(vt.vetoEvent({ event: 'state', data: '{"state":"bogus"}' }), null, 'stream: unknown state dropped');
  {
    const frames = [];
    const sse = 'event: countdown\ndata: {"secondsLeft":1}\n\nevent: state\ndata: {"state":"running"}\n\nevent: output\ndata: {"stream":"stdout","text":"hi"}\n\nevent: done\ndata: {"state":"ran","exitCode":0}\n\n';
    const end = await vt.followVeto(c.streamUrl, HUB, (e) => frames.push(e.type), { fetch: async () => new Response(sse, { status: 200 }) });
    eq([end, frames], ['ran', ['countdown', 'state', 'output', 'done']], 'stream: followed to the end');
    let threw = false;
    try { await vt.followVeto('https://evil.example/s', HUB, () => undefined); } catch { threw = true; }
    ok(threw, 'stream: only the hub');
  }
  {
    const sent = [];
    const fake = async (u, i) => { sent.push([u, i?.method ?? 'GET', i?.headers?.['X-AxHub-CSRF']]); return u.endsWith('/session') ? new Response('{"signedIn":true,"csrf":"tok12345"}') : new Response('{"ok":true,"state":"denied"}', { status: 200 }); };
    const r = await vt.denyVeto(HUB, ID1, { fetch: fake });
    ok(r.ok && r.state === 'denied', 'deny: ok');
    eq(sent[1], [`${HUB}/auth/api/approvals/${ID1}/deny`, 'POST', 'tok12345'], 'deny: POST with the session CSRF');
    eq((await vt.denyVeto(HUB, 'nope', { fetch: fake })).ok, false, 'deny: only request ids');
  }
  // decision #104: Approve now + Shelve next to Deny; a hub before #104 = Deny only
  eq(c.actions, ['deny'], 'veto: no actions from the hub = Deny only');
  {
    const shelvedBody = JSON.stringify({ held: [held({ veto: { state: 'shelved', runsAt: '2026-10-29T02:03:00.000Z', secondsLeft: 80, countdownSeconds: 90, actions: ['approve-now', 'deny'] } })] });
    const sc = vt.interpretVeto(HUB, shelvedBody, NOW)[0];
    eq([sc.shelved, sc.actions], [true, ['deny', 'approve-now']], 'veto: shelved call with its actions');
    eq(vt.secondsLeftNow(sc, NOW + 600_000), 80, 'veto: a shelved countdown is frozen');
    eq(vt.notifyPlan([], [sc], NOW).send.length, 0, 'notify: a shelved call gets no notices');
    eq(vt.vetoActionUrl(HUB, ID1, 'approve-now'), `${HUB}/auth/api/approvals/${ID1}/approve-now`, 'veto: approve-now url rebuilt');
    eq(vt.vetoActionUrl(HUB, ID1, 'bogus'), null, 'veto: unknown action refused');
    eq(vt.vetoFromPush(HUB, { type: 'veto', phase: 'cleared', id: ID1, runsAt: '2026-10-29T02:03:00.000Z', secondsLeft: 0, actions: [] }, NOW)?.phase, 'cleared', 'push: cleared phase read');
    const sent = [];
    const fake = async (u, i) => { sent.push([u, i?.method ?? 'GET']); return u.endsWith('/session') ? new Response('{"csrf":"tok12345"}') : new Response('{"ok":true,"state":"approved-now"}', { status: 200 }); };
    const r = await vt.vetoAction(HUB, ID1, 'approve-now', { fetch: fake });
    ok(r.ok && r.state === 'approved-now' && sent[1][0].endsWith('/approve-now') && sent[1][1] === 'POST', 'veto: approve-now posts with the session CSRF');
    // the host seam: the phone's act first; nothing posted from a page off the hub
    let asked = null;
    vt.setVetoHost({ act: async (id, a) => { asked = [id, a]; return { ok: true, state: 'shelved' }; } });
    const hr = await vt.runVetoAction(HUB, { id: ID1, url: `${HUB}/auth/admin/approvals/${ID1}` }, 'shelve');
    eq([hr.ok, asked], [true, [ID1, 'shelve']], 'veto: actions go through the app host');
    vt.setVetoHost({});
  }
  {
    const store = await import('./src/plugins/approvals/web/store.ts');
    store.resetVeto();
    const started = [];
    store.setVetoHooks({ started: (t) => started.push(t.call.id) });
    const c0 = { ...calls[0], streamUrl: null };
    store.mergeHeld([c0], NOW);
    eq([store.vetoState().tracks.length, started], [1, [ID1]], 'store: a held call opens a track (terminal tab)');
    store.mergeHeld([c0], NOW + 1000);
    eq(started.length, 1, 'store: once');
    store.markDenied(ID1);
    eq(store.vetoState().tracks[0].state, 'denied', 'store: denied');
    store.closeTrack(ID1);
    eq(store.vetoState().tracks.length, 0, 'store: a finished tab closes');
    store.mergeHeld([c0], NOW);
    store.mergeHeld([], NOW + 5000);
    eq(store.vetoState().tracks[0].state, 'gone', 'store: no longer held = gone');
    store.resetVeto();
  }
}

// silent wake listener (Oct 29 2026, amberx-voice-wake s87–s89): Vosk idle, one Google utterance after a trigger
{
  const wk = await import('./src/plugins/voice/web/wake.ts');
  const cases = JSON.parse(readFileSync(new URL('./src/plugins/voice/web/wake-cases.json', import.meta.url), 'utf8'));
  eq(wk.grammar(cases.phrases), cases.grammar, 'wake: grammar = the phrases as a small model hears them, then [unk]');
  for (const [heard, partial, sens, peak, want] of cases.trigger) eq(wk.triggerHit(heard, partial, sens, peak, cases.phrases), want, `wake: trigger ${JSON.stringify([heard, partial, sens, peak])}`);
  for (const [a, b] of cases.clean) eq(wk.cleanHeard(a), b, `wake: clean ${JSON.stringify(a)}`);
  for (const [dbfs, level, db] of cases.level) {
    const l = wk.levelOfDbfs(dbfs);
    ok(Math.abs(l - level) < 1e-9 && Math.abs(wk.recognizerDb(l) - db) < 1e-9, `wake: level of ${dbfs} dBFS`);
  }
  for (const [a, b] of cases.sensitivity) eq(wk.sensitivity(a), b, `wake: sensitivity ${JSON.stringify(a)}`);
  eq(wk.levelOfDbfs(-Infinity), 0, 'wake: silence is level 0');
  ok(wk.grammar(Array.from({ length: 40 }, (_, i) => `hey amberx ${i}`)).length <= wk.MAX_GRAMMAR + 1, 'wake: grammar is capped');
  eq(wk.grammar([]), ['[unk]'], 'wake: no phrases = only [unk]');
  eq([wk.handsFreeMode(undefined), wk.handsFreeMode('classic'), wk.handsFreeMode('x')], ['wake', 'classic', 'wake'], 'wake: silent wake is the default mode');
  // the phrase list (settings)
  eq(wk.addPhrase(['hey amberx'], '  Hi, AmberX! ').list, ['hey amberx', 'hi amberx'], 'phrases: add tidies the phrase');
  ok(wk.addPhrase(['hey amberx'], 'Hey AmberX').error?.includes('already'), 'phrases: no duplicates');
  ok(wk.addPhrase([], 'yo').error?.includes('short'), 'phrases: too short refused');
  ok(wk.addPhrase([], '   ').error !== null, 'phrases: empty refused');
  ok(wk.addPhrase(Array.from({ length: wk.MAX_PHRASES }, (_, i) => `phrase ${i}`), 'one more please').error?.includes('most'), 'phrases: list is capped');
  eq(wk.removePhrase(['hey amberx', 'okay amberx'], 'hey amberx'), ['okay amberx'], 'phrases: remove');
  eq(voice.phraseList(wk.phrasesText(wk.FACTORY_PHRASES)), wk.FACTORY_PHRASES, 'phrases: the text round-trips through the wake setting');
  // the config the native side gets
  const c0 = hf.voiceConfig({ handsFree: undefined, alwaysArmed: undefined, overlay: undefined, wake: ['hey amberx'], lang: '' });
  eq([c0.mode, c0.sensitivity, c0.triggerTone], ['wake', 'normal', false], 'voice config: silent wake, normal sensitivity, no trigger tone by default');
  const c1 = hf.voiceConfig({ handsFree: true, alwaysArmed: false, overlay: true, wake: [], lang: 'en', mode: 'classic', sensitivity: 'high', triggerTone: true });
  eq([c1.mode, c1.sensitivity, c1.triggerTone], ['classic', 'high', true], 'voice config: mode, sensitivity, tone kept');
  // the Android side (compiled by CI)
  const dir = './android/app/src/main/java/ai/amberx/droid/';
  const src = (f) => readFileSync(new URL(dir + f, import.meta.url), 'utf8');
  const wl = src('WakeListener.java'), ws = src('WatchService.java'), wr = src('WakeRules.java');
  ok(/static final String MODEL_URL = /.test(wl) && (wl.match(/alphacephei\.com/g) ?? []).length === 1, 'android: the model address lives in one constant');
  ok(wl.includes('getCanonicalPath()') && wl.includes('MAX_DOWNLOAD'), 'android: the model unzip stays in its folder and the download is capped');
  ok(wl.includes('WakeRules.grammarJson(') && wl.includes('new Recognizer(m, RATE)'), 'android: grammar of the wake phrases, full vocabulary when armed');
  ok(!/SpeechRecognizer/.test(wl), 'android: no SpeechRecognizer while idle (no tone)');
  ok(ws.includes('SpeechTuning.quietTrigger(') && /if \(muted\) main\.postDelayed\(\(\) -> \{ if \(!oneShot\) SpeechTuning\.loud/.test(ws), 'android: tones muted only around the one utterance, then restored');
  ok(/oneShot\(String phrase\)[\s\S]{0,2000}SpeechTuning\.request\(lang\(\), v, false\)/.test(ws) && src('SpeechTuning.java').includes('EXTRA_PARTIAL_RESULTS'), 'android: the one utterance uses SpeechTuning (partial results on)');
  ok(wr.includes('SpeechTuning.wakeHit('), 'android: one wake matcher (SpeechTuning) behind both modes');
  const gradle = readFileSync(new URL('./android/app/build.gradle', import.meta.url), 'utf8');
  ok(gradle.includes("com.alphacephei:vosk-android:") && gradle.includes('net.java.dev.jna:jna:'), 'android: vosk + jna dependencies');
  const ui = readFileSync(new URL('./src/plugins/voice/web/index.tsx', import.meta.url), 'utf8');
  ok(/settingsPanels:[\s\S]{0,200}tab: 'voice'/.test(ui), 'voice: the trigger phrase list is a panel in the plugin\'s own settings tab');
  for (const k of ['K.mode', 'K.sensitivity', 'K.triggerTone']) ok(ui.includes(`key: ${k},`), `voice: ${k} is a setting`);
}

/* ---------------------------------------------------------------- console plugins' voice phrases (generic seam) */
{
  const voiceUi = readFileSync(new URL('./src/plugins/voice/web/index.tsx', import.meta.url), 'utf8');
  ok(/amberxVoice = \{ register: registerVoiceCommands \}/.test(voiceUi), 'voice: console plugins add phrases through globalThis.amberxVoice');
}

/* ---------------------------------------------------------------- speech gate (Oct 31 2026: the "nothing in Inbox" loop) */
{
  const sg = await import('./src/plugins/voice/web/speechgate.ts');
  const notes = await import('./src/plugins/notes/web/core.ts');
  // A repeated empty refresh speaks nothing: read the empty Inbox, Voice notes and a missing list, search and remove
  // in an empty store, ten times a minute apart (past the repeat window, so only the empty-state rule keeps it quiet).
  const g = sg.newGate();
  const store = notes.emptyStore();
  notes.ensureSystemLists(store);
  let spoken = 0;
  for (let i = 0; i < 10; i++) {
    for (const intent of [{ action: 'read', list: 'Inbox' }, { action: 'read', list: 'notes' }, { action: 'read', list: 'no such list' }, { action: 'search', text: 'milk' }, { action: 'remove', target: 'last' }]) {
      const r = notes.applyIntent(store, intent, { now: new Date(Date.UTC(2026, 9, 31, 12, i)).toISOString() });
      const now = i * 60_000;
      if (sg.shouldSpeak(g, r.say, now).speak) { spoken += 1; sg.markSpeaking(g, r.say, now); sg.markDone(g, now + 1000); }
    }
  }
  eq(spoken, 0, 'speech gate: a repeated empty refresh speaks nothing');
  for (const t of ['Nothing in Inbox.', "There's no list called notes.", 'No steps yet.', 'The inbox is empty.', 'Inbox: nothing in it.', 'No saved notes.', 'No tags yet.', 'Nothing found.', 'Heard nothing.'])
    ok(sg.isEmptyState(t), `speech gate: "${t}" is an empty state (never spoken)`);
  for (const t of ['Note saved to Inbox.', 'You have 2 waiting.', 'Yes?', 'Moved “milk” to Shopping.'])
    ok(!sg.isEmptyState(t), `speech gate: "${t}" is spoken`);
  // Said once per change: the same sentence again (poll, refresh, re-render, loop) stays quiet; a question may repeat.
  const h = sg.newGate();
  ok(sg.shouldSpeak(h, 'You have 2 waiting.', 0).speak, 'speech gate: first time is said');
  sg.markSpeaking(h, 'You have 2 waiting.', 0); sg.markDone(h, 1500);
  ok(!sg.shouldSpeak(h, 'You have 2 waiting.', 5000).speak, 'speech gate: the same sentence again is not');
  ok(sg.shouldSpeak(h, 'You have 3 waiting.', 6000).speak, 'speech gate: a real change is said');
  ok(sg.shouldSpeak(h, 'You have 2 waiting.', 5000, { asked: true }).speak && sg.shouldSpeak(h, 'You have 2 waiting.', 5000, { change: true }).speak, 'speech gate: questions and fresh saves may repeat');
  ok(!sg.shouldSpeak(h, 'Nothing in Inbox.', 9000, { asked: true }).speak, 'speech gate: an empty state is silent even as an answer');
  ok(sg.shouldSpeak(h, 'You have 2 waiting.', 1500 + sg.REPEAT_MS).speak, 'speech gate: after a while it can be said again');
  // No TTS ↔ mic loop: while talking, just after, and anything that sounds like what it said is AmberX's own voice.
  const e = sg.newGate();
  sg.markSpeaking(e, 'Moved milk to Shopping.', 10_000);
  ok(sg.isEcho(e, 'open approvals', 10_500), 'echo: anything heard while AmberX talks is ignored');
  sg.markDone(e, 12_000);
  ok(sg.isEcho(e, 'anything', 12_400), 'echo: and just after');
  ok(sg.isEcho(e, 'moved milk to shopping', 15_000), 'echo: its own sentence coming back is ignored');
  ok(!sg.isEcho(e, 'open approvals', 15_000), 'echo: a new command is heard');
  ok(!sg.isEcho(e, 'yes', 13_000), 'echo: a short answer is heard');
  // The wiring: every reply goes through the gate, holds the mic, and hands-free drops its own echo.
  const vui = readFileSync(new URL('./src/plugins/voice/web/index.tsx', import.meta.url), 'utf8');
  ok(/shouldSpeak\(gate, text/.test(vui) && /holdMic: true/.test(vui), 'voice: say() goes through the gate and holds the mic');
  ok((vui.match(/heardEcho\(/g) ?? []).length >= 2, 'voice: wake + heard events drop AmberX\'s own voice');
  ok((vui.match(/native\.speak\(/g) ?? []).length === 1, 'voice: say() is the only place that speaks');
  const dui = readFileSync(new URL('./src/plugins/dictation/web/index.tsx', import.meta.url), 'utf8');
  ok(!/native\.speak\(/.test(dui) && /heardEcho\(/.test(dui), 'dictation: speaks through the gate and never dictates its own reply');
  const ws = readFileSync(new URL('./android/app/src/main/java/ai/amberx/droid/WatchService.java', import.meta.url), 'utf8');
  ok(/else if \(on && w\.recognizer != null\) \{ w\.pauseListening\(\)/.test(ws), 'android: classic hands-free stops listening while AmberX talks');
}

/* ---------------------------------------------------------------- screen capture (Oct 31 2026: "can't record due to security policy") */
{
  const sc = await import('./src/securescreen.ts');
  const root = (has) => ({ querySelector: (s) => (has && s === sc.SENSITIVE_SELECTOR ? {} : null) });
  ok(!sc.secureWanted(undefined, true) && !sc.secureWanted(false, true), 'screen: setting off (default) = never hidden, even on a password screen');
  ok(!sc.secureWanted(true, false), 'screen: setting on, normal screen = recordable');
  ok(sc.secureWanted(true, true), 'screen: setting on + password / key / vault screen = hidden');
  ok(sc.isSensitive(root(true)) && !sc.isSensitive(root(false)) && !sc.isSensitive(null), 'screen: a password field makes the screen sensitive');
  ok(sc.SENSITIVE_SELECTOR.includes('input[type="password"]'), 'screen: password inputs count');
  eq(sc.secureScreenLibrary.settings[0].settings[0].default, false, 'screen: "Hide sensitive screens from recordings" is off by default');
  const java = (f) => readFileSync(new URL(`./android/app/src/main/java/ai/amberx/droid/${f}`, import.meta.url), 'utf8');
  for (const f of ['MainActivity.java', 'HubWebActivity.java']) ok(!/addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/.test(java(f)), `android: ${f} no longer sets FLAG_SECURE`);
  const ss = java('SecureScreen.java');
  ok(/sensitiveScreen && hideSensitive\(a\)/.test(ss) && /getBoolean\(HIDE, false\)/.test(ss), 'android: FLAG_SECURE only when opted in and sensitive (default off)');
  ok(/public void secureScreen\(PluginCall call\)/.test(java('AmberxNativePlugin.java')), 'android: the page reports sensitive screens');
  const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
  ok(app.includes('secureScreenLibrary'), 'App installs the screen capture setting');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
