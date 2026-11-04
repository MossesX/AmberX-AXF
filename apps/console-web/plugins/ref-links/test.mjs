#!/usr/bin/env node
// Reference links runner + CLI: targets from the builds store and plugins, find (names, explicit touches, PRs, files,
// ambiguous names, missing targets), resolve, the console catalog as extra targets, CLI exit codes.
//   node apps/console-web/plugins/ref-links/test.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'ref-links-'));
mkdirSync(join(root, '_claude', 'builds'), { recursive: true });
writeFileSync(join(root, '_claude', 'builds', 'store.json'), JSON.stringify({ builds: [
  { id: 'terminal-sessions-nav', title: 'Terminal sessions nav', status: 'running', branch: 'claude/terminal-sessions-nav', pr: 'https://github.com/MossesX/AmberX-AXF/pull/290', detail: 'touches: screen.terminal, toolbar.terminal', steps: [{ text: 's1 list' }], notes: [] },
  { id: 'settings-wizard', title: 'Settings wizard', status: 'pending', detail: 'touches: dialog.settings-wizard', steps: [], notes: [] },
  { id: 'gone-build', title: 'Gone build', status: 'archived', steps: [], notes: [] },
] }));
process.env.AXF_REPO_ROOT = root;
const R = await import('./refs.mjs');

let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };

const catalog = [
  { kind: 'screen', id: 'terminal', label: 'Terminal' }, { kind: 'screen', id: 'plan-studio', label: 'Plan Studio' },
  { kind: 'settings', id: 'terminal', label: 'Terminal' }, { kind: 'dialog', id: 'about', label: 'About this console' },
];
const t = R.run({ op: 'targets', extra: catalog }).targets;
const ids = t.map((x) => x.id);
check('builds from the store (archived left out)', ids.includes('build:terminal-sessions-nav') && ids.includes('build:settings-wizard') && !ids.includes('build:gone-build'));
check('a build carries its declared touches', t.find((x) => x.id === 'build:terminal-sessions-nav')?.touches?.join() === 'screen:terminal,toolbar:terminal');
check('a build with a PR adds the PR', t.find((x) => x.id === 'pr:290')?.url?.endsWith('/pull/290'));
check('every plugin is a target', ids.includes('plugin:push-banner') && ids.includes('plugin:ref-links'));
check('console catalog items are targets', ids.includes('screen:plan-studio') && ids.includes('settings:terminal') && ids.includes('dialog:about'));

const f = R.run({ op: 'find', text: 'Terminal settings and the Plan Studio screen for terminal-sessions-nav (PR 290); see apps/console-web/plugins/ref-links/refs.mjs', extra: catalog });
const refs = f.spans.map((s) => s.ref);
check('find: settings, screen, build, PR, file', ['settings:terminal', 'screen:plan-studio', 'build:terminal-sessions-nav', 'pr:290', 'file:apps/console-web/plugins/ref-links/refs.mjs'].every((r) => refs.includes(r)), JSON.stringify(refs));
check('find: targets of every ref', f.targets.some((x) => x.id === 'pr:290'));
const amb = R.run({ op: 'find', text: 'Terminal is slow', extra: catalog }).spans[0];
check('find: an ambiguous name says so and lists the others', amb?.ref === 'screen:terminal' && amb.ambiguous && amb.candidates.includes('settings:terminal'), JSON.stringify(amb));
const ex = R.run({ op: 'find', text: 'Terminal is slow', touches: ['settings.terminal'], extra: catalog }).spans[0];
check('find: explicit touches win', ex?.ref === 'settings:terminal' && !ex.ambiguous, JSON.stringify(ex));
const miss = R.run({ op: 'find', text: 'touches: dialog.settings-wizard', extra: catalog }).spans[0];
check('find: a declared ref with no live target is missing (new, not live yet)', miss?.missing === true && miss.ref === 'dialog:settings-wizard');
check('find: empty text is a validation error', R.run({ op: 'find', text: ' ' }).code === 'validation');

check('resolve: by words', R.run({ op: 'resolve', query: 'plan studio', extra: catalog }).target?.id === 'screen:plan-studio');
check('resolve: by dotted id', R.run({ op: 'resolve', query: 'settings.terminal', extra: catalog }).target?.id === 'settings:terminal');
check('resolve: a build by id', R.run({ op: 'resolve', query: 'terminal-sessions-nav' }).target?.id === 'build:terminal-sessions-nav');
check('resolve: nothing is not_found', R.run({ op: 'resolve', query: 'zzz nothing here' }).code === 'not_found');
check('unknown op', R.run({ op: 'nope' }).code === 'invalid');

const cli = (...a) => spawnSync(process.execPath, [fileURLToPath(new URL('./refs.mjs', import.meta.url)), ...a], { env: { ...process.env, AXF_REPO_ROOT: root }, encoding: 'utf8' });
const c1 = cli('find', 'Settings wizard and PR 290', '--json');
check('CLI find --json', c1.status === 0 && JSON.parse(c1.stdout).spans.length === 2, c1.stderr || c1.stdout);
check('CLI resolve: not found exits 4', cli('resolve', 'zzz nothing').status === 4);
check('CLI usage exits 2', cli().status === 2 && cli('open').status === 2);

console.log(`${fails ? '✗' : '✓'} ref-links: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
