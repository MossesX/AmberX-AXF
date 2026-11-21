#!/usr/bin/env node
/**
 * Branch protection for main (audit finding L2-09: CI gating lived only in the lander, GitHub let anything into main).
 * Nothing here runs on its own: Brett runs it once the settings are approved. `show` changes nothing.
 *
 *   node deploy/branch-protection.mjs show [--json]        the exact ruleset, and what GitHub has now (read-only)
 *   … status-key --yes                                     make the builds-live deploy key (the ruleset's only bypass)
 *   … apply --yes [--lander-app <app id>]                  create or update the ruleset on GitHub
 *   … off --yes --why "<reason>"                           the emergency path: disable the ruleset (apply turns it on again)
 *
 * The ruleset ("main: green PRs only"), on the default branch:
 *   - changes reach main through a pull request only (no direct pushes, no approvals needed: the lander has no reviewer);
 *   - required status checks, branch up to date before the merge: the five jobs of .github/workflows/android.yml that
 *     report on every pull request (a job the CI scope skips reports "skipped", which GitHub counts as passed);
 *   - no force pushes, no deleting main;
 *   - bypass: deploy keys only. The one deploy key is the builds-live status snapshot's (framework/cli/builds-live.mjs
 *     pushTarget): a status-only commit has no PR and no CI run, so without it the store's projection on main stops.
 *     Admins, the personal access token the lander and the sessions use, and Brett do NOT bypass: a hand merge is still
 *     possible, but only of a green, up-to-date PR.
 *
 * "Merges only by the lander" cannot be enforced while the lander and Brett share one GitHub identity (the personal
 * access token): GitHub sees the same actor. Once the lander runs as a GitHub App (github-app@1), `--lander-app <id>`
 * adds a restrict-updates rule with that app as the second bypass, so only the lander can move main.
 *
 * Token: AXF_GITHUB_ADMIN_TOKEN (needs Administration: read and write on the repository), else the token broker's.
 * Repository: AXF_GITHUB_REPO (owner/name), else origin's.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const RULESET_NAME = 'main: green PRs only';
/** GitHub Actions' app id: a required check only counts when Actions reported it (a status of the same name from a token does not). */
export const ACTIONS_APP_ID = 15368;
/** The jobs of .github/workflows/android.yml (their `name:`), each reported on every pull request. */
export const REQUIRED_CHECKS = Object.freeze([
  'CI scope (what changed)',
  'Light PR checks (full run happens once, in the merge queue)',
  'Build engine sweep (Node)',
  'Web Dev Console (React/TS) + Python API',
  'Gradle — framework modules, kernel tests, console APK',
]);
export const KEY_TITLE = 'axf builds-live status snapshot';

/** The ruleset as the REST API takes it (POST /repos/{owner}/{repo}/rulesets). Pure. */
export function ruleset({ landerApp = 0, enforcement = 'active', checks = REQUIRED_CHECKS } = {}) {
  const app = Number(landerApp) || 0;
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement,
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [
      { actor_id: null, actor_type: 'DeployKey', bypass_mode: 'always' },
      ...(app ? [{ actor_id: app, actor_type: 'Integration', bypass_mode: 'always' }] : []),
    ],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: checks.map((context) => ({ context, integration_id: ACTIONS_APP_ID })) } },
      // only a bypass actor may move main at all: the lander's app merges, the deploy key snapshots, nobody else
      ...(app ? [{ type: 'update' }] : []),
    ],
  };
}

/** The `name:` of every job in a workflow file (to catch a renamed job before it blocks every merge). Pure. */
export function jobNames(yaml) {
  const out = []; let inJobs = false; let job = false;
  for (const line of String(yaml).split('\n')) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line)) break;
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) { job = true; continue; }
    const m = job && /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (m) { out.push(m[1].replace(/^(['"])(.*)\1$/, '$2')); job = false; }
  }
  return out;
}
/** Required checks that no job of the workflow reports any more. Pure. */
export const missingChecks = (yaml, checks = REQUIRED_CHECKS) => { const names = jobNames(yaml); return checks.filter((c) => !names.includes(c)); };

// ------------------------------------------------------------------ GitHub

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : ''; };
const root = () => resolve(HERE, '..');
const consoleDir = () => join(process.env.AXF_CONSOLE_ROOT && process.env.AXF_CONSOLE_ROOT !== 'off' ? process.env.AXF_CONSOLE_ROOT : (existsSync('/opt/axf/.axf-console') ? '/opt/axf' : root()), '.axf-console');

function token() {
  if (process.env.AXF_GITHUB_ADMIN_TOKEN) return process.env.AXF_GITHUB_ADMIN_TOKEN;
  try { return execFileSync(process.execPath, [join(root(), 'framework/cli/github-token.mjs'), 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch { return ''; }
}
function repo() {
  if (process.env.AXF_GITHUB_REPO) return process.env.AXF_GITHUB_REPO;
  const url = spawnSync('git', ['-C', root(), 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error('no GitHub repository: set AXF_GITHUB_REPO=owner/name');
  return m[1];
}
async function gh(method, path, body) {
  const t = token(); if (!t) throw new Error('no GitHub token: set AXF_GITHUB_ADMIN_TOKEN');
  const r = await fetch(`https://api.github.com${path}`, { method, headers: { authorization: `Bearer ${t}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'axf-branch-protection', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const why = r.status === 403 || r.status === 404 ? ' (this token cannot manage repository settings: give AXF_GITHUB_ADMIN_TOKEN a token with Administration: read and write on the repository)' : '';
    throw Object.assign(new Error(`GitHub ${method} ${path}: ${r.status} ${data?.message ?? text.slice(0, 200)}${why}`), { status: r.status });
  }
  return data;
}
async function current(slug) {
  const list = await gh('GET', `/repos/${slug}/rulesets?includes_parents=false`);
  const hit = (list ?? []).find((x) => x.name === RULESET_NAME);
  return hit ? gh('GET', `/repos/${slug}/rulesets/${hit.id}`) : null;
}
const keyFiles = () => ({ dir: consoleDir(), key: join(consoleDir(), 'builds-live-push.key'), config: join(consoleDir(), 'builds-live-push.json') });

async function main() {
  const cmd = argv.find((a) => !a.startsWith('--') && a !== opt('lander-app') && a !== opt('why')) ?? 'show';
  const want = ruleset({ landerApp: opt('lander-app') });
  const lost = missingChecks(readFileSync(join(root(), '.github/workflows/android.yml'), 'utf8'));
  if (lost.length) throw new Error(`required checks that .github/workflows/android.yml no longer reports (fix REQUIRED_CHECKS first, or every merge blocks): ${lost.join('; ')}`);
  const say = (o, text) => console.log(flag('json') ? JSON.stringify(o, null, 1) : text);

  if (cmd === 'show') {
    let now = null; let err = '';
    try { now = await current(repo()); } catch (e) { err = e.message; }
    return say({ ok: true, ruleset: want, statusKey: existsSync(keyFiles().config), current: now, error: err },
      `${JSON.stringify(want, null, 1)}\n\nbuilds-live deploy key here: ${existsSync(keyFiles().config) ? 'yes' : 'no (run status-key before apply)'}\non GitHub now: ${err || (now ? `"${now.name}" ${now.enforcement}, ${now.rules?.length ?? 0} rule(s)` : 'no such ruleset')}`);
  }
  if (!flag('yes')) throw new Error(`${cmd} changes repository settings: add --yes (Brett only)`);
  const slug = repo();

  if (cmd === 'status-key') {
    const f = keyFiles();
    if (!existsSync(f.key)) {
      mkdirSync(f.dir, { recursive: true });
      const k = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', KEY_TITLE, '-f', f.key], { encoding: 'utf8' });
      if (k.status !== 0) throw new Error(`ssh-keygen: ${k.stderr || k.error?.message}`);
      chmodSync(f.key, 0o600);
    }
    const pub = readFileSync(`${f.key}.pub`, 'utf8').trim();
    const keys = await gh('GET', `/repos/${slug}/keys?per_page=100`);
    const have = (keys ?? []).find((x) => x.key.split(' ').slice(0, 2).join(' ') === pub.split(' ').slice(0, 2).join(' '));
    const made = have ?? await gh('POST', `/repos/${slug}/keys`, { title: KEY_TITLE, key: pub, read_only: false });
    writeFileSync(f.config, `${JSON.stringify({ $axf: 'builds-live-push@1', url: `git@github.com:${slug}.git`, key: 'builds-live-push.key', deployKey: made.id }, null, 1)}\n`);
    const others = (keys ?? []).filter((x) => x.id !== made.id && !x.read_only).map((x) => x.title);
    return say({ ok: true, deployKey: made.id, config: f.config, otherWriteKeys: others },
      `deploy key ${made.id} (${KEY_TITLE}) ${have ? 'was already on GitHub' : 'added'}; builds-live pushes its snapshot with it (${f.config})${others.length ? `\nother write deploy keys also bypass the ruleset, remove the ones not needed: ${others.join(', ')}` : ''}`);
  }
  if (cmd === 'apply') {
    if (!existsSync(keyFiles().config) && !flag('no-status-key')) throw new Error('the builds-live deploy key is not set up: run `status-key --yes` first, or the status snapshot is refused by the ruleset (--no-status-key to apply anyway)');
    const now = await current(slug);
    const r = now ? await gh('PUT', `/repos/${slug}/rulesets/${now.id}`, want) : await gh('POST', `/repos/${slug}/rulesets`, want);
    return say({ ok: true, id: r.id, enforcement: r.enforcement, updated: !!now }, `ruleset "${r.name}" ${now ? 'updated' : 'created'} (${r.enforcement}) on ${slug}: ${REQUIRED_CHECKS.length} required checks, up to date before merge, PRs only, bypass: deploy keys${opt('lander-app') ? ` + app ${opt('lander-app')}` : ''}`);
  }
  if (cmd === 'off') {
    if (!opt('why')) throw new Error('off needs --why "<reason>"');
    const now = await current(slug); if (!now) throw new Error(`no ruleset "${RULESET_NAME}" on ${slug}`);
    const r = await gh('PUT', `/repos/${slug}/rulesets/${now.id}`, { ...want, enforcement: 'disabled' });
    console.error(`${new Date().toISOString()} branch protection OFF on ${slug}: ${opt('why')}`);
    return say({ ok: true, id: r.id, enforcement: r.enforcement, why: opt('why') }, `ruleset "${r.name}" is ${r.enforcement}. Turn it back on: node deploy/branch-protection.mjs apply --yes`);
  }
  throw new Error(`unknown command ${cmd}: show | status-key | apply | off`);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
