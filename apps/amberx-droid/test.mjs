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
  const own = { banner: 'amberx-thin', toolbar: 'amberx-droid', 'context-menu': 'amberx-droid', 'nav-menu': 'amberx-droid', 'app-menu': 'amberx-droid' };
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

console.log(`\n${failed === 0 ? '✓' : '✗'} ${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
