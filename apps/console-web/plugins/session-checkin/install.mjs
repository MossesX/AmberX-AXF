#!/usr/bin/env node
/**
 * Session check-in installer. Interactive in a terminal; the console's Settings → Plugins → Session check-in wizard drives
 * the same steps through --json.
 *
 *   node install.mjs                         interactive (asks where, which questions, behaviour, expected values)
 *   node install.mjs --json '<request>'      non-interactive; request = { action, target, dir?, config?, onDevice? }
 *                                            action: install | uninstall | preview | status   → prints one JSON result
 *   node install.mjs --uninstall [--target local|shared|user]
 *   node install.mjs --status
 *
 * Targets (see lib.mjs targetPaths):
 *   local   <repo>/.claude/settings.local.json  this clone only (not committed)
 *   shared  <repo>/.claude/settings.json        every clone after commit + push (phone / cloud sessions too)
 *   user    ~/.claude/settings.json             every folder on the device the installer runs on
 *
 * From the console (--json), the "shared" target is published: the change is committed in a temporary worktree of
 * origin's branch and pushed to GitHub with the console's GITHUB_TOKEN (needs Contents: write), so it survives the
 * VPS clone's 5-minute reset to origin and reaches every clone. The token is passed to git through GIT_ASKPASS,
 * never in a URL, an argument or the log.
 *
 * Only hook entries whose command contains "session-checkin/checkin.mjs" are ever added or removed; everything
 * else in the settings file is kept as it was. The old file is saved as <file>.bak before each change.
 */
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { relative, resolve } from 'node:path';
import * as L from './lib.mjs';
import { gitAuthEnv, scrub } from '../../../../framework/cli/github.mjs';

const TARGETS = {
  local: 'This clone only (.claude/settings.local.json, not committed)',
  shared: 'Every clone of the repo (.claude/settings.json; commit + push to apply on phone/cloud sessions)',
  user: 'Every folder on this device (~/.claude/settings.json)',
};
const show = (p) => (p.startsWith(L.REPO_ROOT) ? relative(L.REPO_ROOT, p) : p.replace(process.env.HOME ?? '~', '~'));

function plan(target, dir, config) {
  if (!TARGETS[target]) throw new Error(`target must be one of ${Object.keys(TARGETS).join(', ')}`);
  const root = resolve(dir ?? L.REPO_ROOT);
  if (target !== 'user' && !existsSync(resolve(root, L.REL_CHECKIN))) throw new Error(`${root} is not an AmberX-AXF clone (no ${L.REL_CHECKIN})`);
  const t = L.targetPaths(target, root);
  const cfg = L.normaliseConfig(config ?? {});
  const before = L.readJson(t.settings, {});
  if (existsSync(t.settings) && before === null) throw new Error(`${show(t.settings)} is not valid JSON; fix it first`);
  const after = L.withOurHooks(before ?? {}, L.hookEntries(target, cfg, root));
  return { target, root, paths: t, config: cfg, before: before ?? {}, after };
}

function apply(p, log) {
  if (existsSync(p.paths.settings)) { copyFileSync(p.paths.settings, `${p.paths.settings}.bak`); log(`backup: ${show(p.paths.settings)}.bak`); }
  L.writeJsonAtomic(p.paths.settings, p.after);
  log(`hooks written: ${show(p.paths.settings)} (SessionStart on ${p.config.sources.join('|')}, SessionEnd)`);
  L.writeJsonAtomic(p.paths.config, p.config);
  log(`config written: ${show(p.paths.config)}`);
  if (p.target === 'shared') log('next: commit .claude/settings.json and .claude/session-checkin.json, then push, so every clone (phone and cloud sessions too) gets it');
  if (p.target === 'local') log('applies to Claude Code sessions started in this clone; .claude/*.local.json is git-ignored');
  log('done — the check-in runs at the next new Claude Code session');
}

function uninstall(target, dir, log) {
  const t = L.targetPaths(target, resolve(dir ?? L.REPO_ROOT));
  const s = L.readJson(t.settings);
  if (!s || !L.installedIn(t.settings)) { log(`not installed in ${show(t.settings)}`); return false; }
  copyFileSync(t.settings, `${t.settings}.bak`);
  const rest = L.withoutOurHooks(s);
  if (Object.keys(rest).length) L.writeJsonAtomic(t.settings, rest); else unlinkSync(t.settings); // nothing else in it: remove the file
  log(`hooks removed from ${show(t.settings)} (backup ${show(t.settings)}.bak)`);
  if (existsSync(t.config)) { unlinkSync(t.config); log(`config removed: ${show(t.config)}`); }
  log('the session archive is kept');
  return true;
}

function status(dir) {
  const root = resolve(dir ?? L.REPO_ROOT);
  return Object.fromEntries(Object.keys(TARGETS).map((target) => {
    const t = L.targetPaths(target, root);
    const hooks = L.installedIn(t.settings);
    return [target, { label: TARGETS[target], settings: show(t.settings), installed: !!hooks, hooks, config: hooks ? L.readJson(t.config) : null }];
  }));
}

/* ------------------------------------------------------------------ publish "shared" to GitHub (console) */

function publishShared({ remove = false, config, log }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Publishing for every clone needs the console\'s GITHUB_TOKEN with Contents: write access. Re-run deploy/install-console.sh with GITHUB_TOKEN=… set, or use "This clone".');
  const git = (args, opts = {}) => {
    const r = spawnSync('git', ['-c', 'safe.directory=*', ...args], { encoding: 'utf8', timeout: 120000, cwd: opts.cwd, env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.status !== 0 && !opts.ok) throw new Error(scrub(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`, [token]));
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const root = L.REPO_ROOT;
  const slug = L.repoSlug(git(['-C', root, 'remote', 'get-url', 'origin']).out);
  if (!slug) throw new Error('could not read the repo\'s GitHub origin');
  const branch = git(['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';
  const url = process.env.AXF_CHECKIN_PUSH_URL || `https://github.com/${slug}.git`; // override for tests
  const tmp = mkdtempSync(join(tmpdir(), 'axf-checkin-'));
  // lib-github: the token reaches git only through GIT_CONFIG_* (header scoped to https://github.com/, no redirects)
  const auth = { env: gitAuthEnv(token) };
  const wt = join(tmp, 'wt');
  try {
    git(['-C', root, 'fetch', '-q', url, branch], auth);
    git(['-C', root, 'worktree', 'add', '-q', '--detach', wt, 'FETCH_HEAD']);
    const sub = [];
    if (remove) uninstall('shared', wt, (m) => sub.push(m)); else apply(plan('shared', wt, config), (m) => sub.push(m));
    git(['-C', wt, 'add', '-A', '--', '.claude/settings.json', '.claude/session-checkin.json'], { ok: true });
    if (git(['-C', wt, 'diff', '--cached', '--quiet'], { ok: true }).ok) { log(`GitHub already has this ${remove ? 'removal' : 'install'}; nothing to push`); }
    else {
      git(['-C', wt, '-c', 'user.name=AXF Dev Console', '-c', 'user.email=axf-console@users.noreply.github.com', 'commit', '-q', '-m', `Session check-in: ${remove ? 'remove from' : 'install for'} every clone (from the Dev Console)`]);
      let pushed = false;
      for (let i = 0; i < 3 && !pushed; i++) {
        const r = git(['-C', wt, 'push', '-q', url, `HEAD:refs/heads/${branch}`], { ...auth, ok: true });
        if (r.ok) { pushed = true; break; }
        if (/denied|403|401|not permitted|authentication/i.test(r.err)) throw new Error('GitHub refused the push: the console\'s GITHUB_TOKEN needs Contents: write on this repo');
        git(['-C', wt, 'fetch', '-q', url, branch], auth);
        git(['-C', wt, 'rebase', '-q', 'FETCH_HEAD']);
      }
      if (!pushed) throw new Error('could not push after 3 tries (main kept moving); try again');
      log(`pushed ${git(['-C', wt, 'rev-parse', '--short', 'HEAD']).out} to ${slug} ${branch}: every clone gets it on its next pull`);
    }
  } finally {
    git(['-C', root, 'worktree', 'remove', '--force', wt], { ok: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  // apply to this clone right away too (its 5-minute reset to origin then changes nothing)
  if (remove) uninstall('shared', root, () => {}); else apply(plan('shared', root, config), () => {});
  log(remove ? 'removed here and on GitHub' : 'installed here and on GitHub — new Claude Code sessions in any clone run the check-in');
}

/* ------------------------------------------------------------------ JSON mode (the console wizard) */

async function jsonMode(raw) {
  const lines = [];
  const log = (m) => lines.push(m);
  let req;
  try { req = JSON.parse(raw === '-' ? (await import('node:fs')).readFileSync(0, 'utf8') : raw); } catch { console.log(JSON.stringify({ ok: false, error: 'request is not JSON' })); return; }
  try {
    const action = req.action ?? 'preview';
    if (action === 'status') { console.log(JSON.stringify({ ok: true, version: L.VERSION, targets: status(req.dir), questions: L.QUESTIONS, defaults: L.defaultConfig() })); return; }
    const publish = req.target === 'shared' && req.publish === true;
    if (action === 'uninstall') {
      if (publish) { publishShared({ remove: true, log }); console.log(JSON.stringify({ ok: true, changed: true, log: lines })); return; }
      const changed = uninstall(req.target, req.dir, log); console.log(JSON.stringify({ ok: true, changed, log: lines })); return;
    }
    // the console runs --json in its own container (another machine), so "user" needs onDevice: true = this command runs
    // on the device itself (the systems check's VPS Auto fix sends it through vps.run on the host)
    if (req.target === 'user' && req.onDevice !== true) throw new Error('the "user" target is installed on the device itself: run the installer there in a terminal');
    const p = plan(req.target, req.dir, req.config);
    const result = { settings: show(p.paths.settings), config: show(p.paths.config), before: p.before, after: p.after, configJson: p.config };
    if (action === 'preview') { console.log(JSON.stringify({ ok: true, preview: result })); return; }
    if (action !== 'install') throw new Error(`unknown action "${action}"`);
    if (publish) publishShared({ config: req.config, log }); else apply(p, log);
    console.log(JSON.stringify({ ok: true, installed: result, log: lines }));
  } catch (e) { console.log(JSON.stringify({ ok: false, error: e.message, log: lines })); }
}

/* ------------------------------------------------------------------ interactive (terminal / mosh) */

async function interactive() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def = '') => { const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim(); return a || def; };
  const yesNo = async (q, def = true) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));
  const pick = async (q, options, def) => {
    console.log(`\n${q}`);
    options.forEach(([k, label], i) => console.log(`  ${i + 1}) ${label}${k === def ? '  (default)' : ''}`));
    const a = await ask('Choose', String(options.findIndex(([k]) => k === def) + 1));
    return options[Math.max(0, Math.min(options.length - 1, Number(a) - 1))]?.[0] ?? def;
  };
  console.log(`\nSession check-in installer ${L.VERSION} — AmberX AXF\nEvery new Claude Code session will open with a short group of questions, location first, and be logged to the session archive.\n`);
  const st = status();
  for (const [k, v] of Object.entries(st)) if (v.installed) console.log(`  already installed: ${k} (${v.settings})`);

  const target = await pick('1. Where should it run?', Object.entries(TARGETS), Object.values(st).some((v) => v.installed) ? Object.keys(st).find((k) => st[k].installed) : 'local');
  const cur = (st[target]?.config && L.normaliseConfig(st[target].config)) || L.defaultConfig();

  console.log('\n2. Which questions? (Location is always asked first.)');
  const questions = { location: true };
  for (const q of L.QUESTIONS.filter((x) => !x.required)) questions[q.id] = await yesNo(`   ${q.label} — ${q.help}`, cur.questions[q.id]);

  console.log('\n3. Behaviour');
  const resume = await yesNo('   Also run when a session is resumed (not only new sessions)?', cur.sources.includes('resume'));
  const allowSkip = await yesNo('   Allow "skip" to log without asking?', cur.allowSkip);
  const allowSameAsLast = await yesNo('   Allow "same as last" to reuse the previous answers?', cur.allowSameAsLast);
  const unattended = (await yesNo('   Log unattended runs (claude -p, scheduled) without asking?', cur.unattended === 'log')) ? 'log' : 'off';
  const defaultEffort = await pick('   Default effort level', L.EFFORTS.map((e) => [e, e]), cur.defaultEffort);

  console.log('\n4. Expected values (anything else is flagged as a mismatch)');
  const expected = { repo: await ask('   Repo', cur.expected.repo), project: await ask('   Project', cur.expected.project), vpsContainer: await ask('   On the VPS, run on (host / docker:<name>)', cur.expected.vpsContainer) };
  const archive = await ask('   Archive folder ("auto" = hub /projects/<name>/_data/sessions, else the repo\'s sessions/)', cur.archive);

  const config = { ...cur, questions, sources: resume ? ['startup', 'resume'] : ['startup'], allowSkip, allowSameAsLast, unattended, defaultEffort, expected, archive };
  const p = plan(target, undefined, config);
  console.log(`\n5. Review\n   ${show(p.paths.settings)} gets these hooks:\n${JSON.stringify(L.hookEntries(target, p.config, p.root), null, 2).replace(/^/gm, '     ')}\n   config → ${show(p.paths.config)}`);
  if (!(await yesNo('\nInstall?', true))) { console.log('Nothing changed.'); rl.close(); return; }
  apply(p, (m) => console.log(`  ${m}`));
  rl.close();
}

/* ------------------------------------------------------------------ main */
const argv = process.argv.slice(2);
const ji = argv.indexOf('--json');
if (ji >= 0) await jsonMode(argv[ji + 1] ?? '-');
else if (argv.includes('--status')) console.log(JSON.stringify(status(), null, 2));
else if (argv.includes('--uninstall')) { const ti = argv.indexOf('--target'); uninstall(ti >= 0 ? argv[ti + 1] : 'local', undefined, console.log); }
else if (!process.stdin.isTTY) { console.error('Run this in a terminal (it asks questions), or use --json / --status / --uninstall.'); process.exit(2); }
else await interactive();
