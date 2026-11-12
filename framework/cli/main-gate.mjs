#!/usr/bin/env node
/**
 * Main gate (build main-gate-nothing-reaches-main-without-passing, Brett Nov 12 2026: "NOTHING gets pushed or merged to
 * main unless it passes"). Plain Node, built-ins only (the pre-push hook runs an installed copy of this file), no model
 * calls. One decision for every way a commit reaches main from this VPS:
 *
 *   - the land / merge scripts (merge queue batch landing, stack merges) ask `check` before they push or merge;
 *   - the git pre-push hook (installed into the repo's shared hooks folder, so every worktree and every session has it)
 *     asks the same question for any push to refs/heads/main, whoever runs it;
 *   - GitHub's own rules (`protect`) hold for everything that doesn't come through this VPS, where the token may set them.
 *
 * A commit may become main only when:
 *   1. it is a fast-forward of main (the merged result is exactly the commit that was tested; no force-push, no delete);
 *   2. its change against main is status only (every file under _claude/, the builds-live ticks), or
 *   3. GitHub CI on that exact commit (or on a commit whose code is identical, differing only under _claude/) ran the
 *      full set and every check passed (a light PR-only run is not enough), and the asset checks (check-theme,
 *      check-controls) pass on the commit's own tree;
 *   4. or the owner's override is on (off by default, expires by itself, every use logged and sent to AmberX).
 * Every refusal is logged (decisions.jsonl in the gate folder) and sent to AmberX as an FYI.
 *
 *   node framework/cli/main-gate.mjs check <sha> [--merge] [--repo <dir>] [--slug <owner/repo>] [--json]   may <sha> become main?
 *                                                     (--merge: GitHub merges it, so main may be ahead in status only;
 *                                                      --github: a commit with no clone here is judged from GitHub alone)
 *   node framework/cli/main-gate.mjs push <sha> [--repo <dir>] [--remote origin]                   check, then push it to main
 *   node framework/cli/main-gate.mjs hook <remote> <url>                                           git pre-push hook (stdin)
 *   node framework/cli/main-gate.mjs state | log [--refusals] [--limit n]                         what the gate did
 *   node framework/cli/main-gate.mjs override status | on --minutes <n> --reason "…" | off         the owner's override
 *   node framework/cli/main-gate.mjs install [--repo <dir>] | uninstall                            the pre-push hook
 *   node framework/cli/main-gate.mjs protect [--slug <owner/repo>] [--dry-run]                     GitHub ruleset on main
 *
 * Common flags: --dir <gate folder> (default <console root>/.axf-console/main-gate), --api <GitHub API base>,
 * --console <container|off> (where AmberX FYIs go), --json.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE_FRAME = 'main-gate@1';
export const BASE = 'main';
/** Paths a status-only change may touch (builds-live ticks, the builds store; = the merge queue's sameCodeFiles). */
export const STATUS_PREFIXES = Object.freeze(['_claude/']);
/** Check conclusions that count as passed. */
const PASSED = new Set(['success', 'skipped', 'neutral']);
/** A run of only these means CI ran the light PR checks, not the full set. */
const LIGHT_RE = /^Light PR checks/;
/** The asset checks run on the commit's own tree. */
export const LOCAL_CHECKS = Object.freeze([
  { id: 'theme', file: 'framework/cli/check-theme.mjs' },
  { id: 'controls', file: 'framework/cli/check-controls.mjs' },
]);
export const OVERRIDE_MAX_MIN = 120;
/** AmberX-AXF's CI jobs GitHub requires on a PR into main (.github/workflows/android.yml job names). */
export const REQUIRED_CHECKS = Object.freeze(['CI scope (what changed)', 'Build engine sweep (Node)', 'Web Dev Console (React/TS) + Python API']);
const APPROVAL_TTL_MS = 15 * 60000;
const ZERO = /^0{40}$/;
const HOOK_MARK = '# axf main gate';

// ------------------------------------------------------------------ pure rules (tested in framework/spec/check-main-gate.mjs)

/** Every file under a status prefix (an empty change counts as status only). */
export const statusOnly = (files) => (files || []).map((f) => String(f || '').trim()).filter(Boolean)
  .every((f) => STATUS_PREFIXES.some((p) => f.startsWith(p)));

/** GitHub check runs on one commit → { ok, why, state: 'passed'|'running'|'failed'|'light'|'none' }. */
export function ciVerdict(runs) {
  const rs = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === 'object');
  if (!rs.length) return { ok: false, state: 'none', why: 'no CI ran on this commit' };
  const open = rs.filter((r) => r.status !== 'completed');
  if (open.length) return { ok: false, state: 'running', why: `CI is still running (${open.map((r) => r.name).slice(0, 3).join(', ')})` };
  const bad = rs.filter((r) => !PASSED.has(String(r.conclusion || '')));
  if (bad.length) return { ok: false, state: 'failed', why: `CI failed: ${bad.map((r) => `${r.name} (${r.conclusion || 'no result'})`).slice(0, 4).join(', ')}` };
  const ran = rs.filter((r) => r.conclusion === 'success');
  if (!ran.length) return { ok: false, state: 'none', why: 'every CI job was skipped on this commit' };
  if (ran.some((r) => LIGHT_RE.test(String(r.name || '')))) return { ok: false, state: 'light', why: 'only the light PR checks ran on this commit; the full set runs in the merge queue' };
  return { ok: true, state: 'passed', why: `CI passed (${ran.length} job${ran.length === 1 ? '' : 's'})` };
}

/** The override as stored → active now? */
export function overrideActive(o, now = Date.now()) {
  return !!(o && o.on === true && Date.parse(o.until || '') > now);
}

/**
 * The decision. facts: { deleting, fastForward, statusOnly, ci: ciVerdict|null, local: [{id, ok, why}]|null,
 * override: stored override }. Returns { allow, via, why }.
 */
export function decide(f, now = Date.now()) {
  const ov = overrideActive(f.override, now);
  const viaOverride = (why) => ({ allow: true, via: 'override', why: `owner override (${f.override.by || 'owner'}, until ${f.override.until}): ${why}` });
  if (f.deleting) return { allow: false, via: 'refused', why: 'main is never deleted' };
  if (!f.fastForward) return { allow: false, via: 'refused', why: 'not a fast-forward of main (a force-push or a commit built on an old main); merge main in first' };
  if (f.statusOnly) return { allow: true, via: 'status', why: 'status only (every file under _claude/)' };
  const fails = [];
  if (!f.ci || !f.ci.ok) fails.push(f.ci ? f.ci.why : 'CI not checked');
  for (const l of f.local || []) if (!l.ok) fails.push(`${l.id} check failed: ${l.why}`);
  if (!fails.length) return { allow: true, via: 'passed', why: [f.ci.why, ...(f.local || []).map((l) => `${l.id} ${l.why}`)].join('; ') };
  if (ov) return viaOverride(fails.join('; '));
  return { allow: false, via: 'refused', why: fails.join('; ') };
}

// ------------------------------------------------------------------ settings and small IO

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (argv, n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

export function consoleRoot() {
  if (process.env.AXF_CONSOLE_ROOT) return process.env.AXF_CONSOLE_ROOT;
  for (const r of ['/opt/axf', '/axf']) if (existsSync(join(r, '.axf-console'))) return r;
  return resolve(HERE, '../..');
}
export const gateDir = (argv = []) => argOf(argv, 'dir') || process.env.AXF_MAIN_GATE_DIR || join(consoleRoot(), '.axf-console', 'main-gate');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

/** git without the hook's GIT_* environment (a hook runs with GIT_DIR set, which would point every call at one repo). */
function makeGit(cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|INDEX_FILE|WORK_TREE|PREFIX|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|QUARANTINE_PATH)$/.test(k)));
  env.GIT_TERMINAL_PROMPT = '0';
  return (args, o = {}) => {
    const r = spawnSync('git', args, { cwd: o.cwd || cwd, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 64 << 20, env });
    return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
}
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

function slugOf(git) {
  const url = git(['remote', 'get-url', 'origin']).out;
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(\.git)?$/);
  return m ? m[1] : '';
}

function token(repo) {
  if (process.env.AXF_MAIN_GATE_TOKEN) return process.env.AXF_MAIN_GATE_TOKEN;
  for (const f of [join(repo, 'framework/cli/github-token.mjs'), join(HERE, 'github-token.mjs')]) {
    if (!existsSync(f)) continue;
    const r = spawnSync('node', [f, 'token'], { encoding: 'utf8', timeout: 30000 });
    const t = (r.stdout || '').trim().split('\n').pop();
    if (r.status === 0 && t) return t;
  }
  return '';
}

async function gh(o, method, path, body) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'axf-main-gate', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = o.token ?? (o.token = token(o.repo));
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${o.api}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { message: text.slice(0, 200) }; }
  if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${(j && j.message) || r.statusText}`); e.status = r.status; throw e; }
  return j;
}

/** An FYI to AmberX (the console's alerts, which reach the phone). Never throws; quiet when the console is off. */
export function fyi(o, alert) {
  const where = o.console ?? process.env.AXF_MAIN_GATE_CONSOLE ?? 'axf-console';
  if (where === 'off') return false;
  const body = JSON.stringify({ source: 'main-gate', severity: 'info', ...alert, title: String(alert.title || '').slice(0, 200), body: String(alert.body || '').slice(0, 1500) });
  if (process.env.AXF_TOKEN) { // inside the console container
    const r = spawnSync('curl', ['-s', '-m', '15', '-X', 'POST', '-H', `Authorization: Bearer ${process.env.AXF_TOKEN}`, '-H', 'Content-Type: application/json', '--data-binary', '@-', `http://127.0.0.1:${process.env.PORT || 7090}/api/alerts`], { input: body, encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
  }
  const cmd = 'curl -s -m 15 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:7090/api/alerts"';
  const r = spawnSync('docker', ['exec', '-i', where, 'sh', '-c', cmd], { input: body, encoding: 'utf8', timeout: 30000 });
  return r.status === 0;
}

// ------------------------------------------------------------------ the facts about one commit

/** CI on <sha>, or on the nearest ancestor (3 levels) whose code is the same (differs only under _claude/). */
async function ciFor(o, git, sha) {
  const seen = new Set(); let level = [sha]; let first = null;
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next = [];
    for (const c of level) {
      if (seen.has(c)) continue; seen.add(c);
      if (c !== sha && !statusOnly(lines(git(['diff', '--name-only', c, sha]).out))) continue;
      let runs;
      try { runs = (await gh(o, 'GET', `/repos/${o.slug}/commits/${c}/check-runs?per_page=100`))?.check_runs || []; }
      catch (e) {
        if (e.status === 422 && c !== sha) continue; // an ancestor GitHub never saw
        return e.status === 422 ? { ok: false, state: 'none', why: 'this commit was never on GitHub, so no CI ran on it: push the branch and land it through its PR' }
          : { ok: false, state: 'error', why: `couldn't read CI (${e.message.slice(0, 160)})` };
      }
      const v = ciVerdict(runs);
      if (v.ok) return c === sha ? v : { ...v, why: `${v.why} on ${c.slice(0, 8)} (same code)`, tested: c };
      if (!first || (first.state === 'none' && v.state !== 'none')) first = v;
      next.push(...lines(git(['rev-list', '--parents', '-n', '1', c]).out.split(' ').slice(1).join('\n')));
    }
    level = next;
  }
  return first || { ok: false, state: 'none', why: 'no CI ran on this commit' };
}

/** check-theme / check-controls from the commit's own tree, in a throwaway worktree. */
function localChecks(git, sha) {
  if (LOCAL_CHECKS.every((c) => git(['cat-file', '-e', `${sha}:${c.file}`]).code !== 0)) return [];
  const tmp = mkdtempSync(join(tmpdir(), 'axf-main-gate-'));
  const wt = join(tmp, 'wt');
  try {
    const a = git(['worktree', 'add', '-q', '--detach', wt, sha], { timeout: 300000 });
    if (a.code) return [{ id: 'checkout', ok: false, why: a.err.slice(-200) || 'worktree add failed' }];
    return LOCAL_CHECKS.map((c) => {
      if (!existsSync(join(wt, c.file))) return { id: c.id, ok: false, why: `${c.file} is missing from this commit` };
      const r = spawnSync('node', [join(wt, c.file)], { cwd: wt, encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 });
      const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-3).join(' ').slice(-300);
      return { id: c.id, ok: r.status === 0, why: r.status === 0 ? 'passed' : tail || `exit ${r.status}` };
    });
  } finally {
    git(['worktree', 'remove', '--force', wt]);
    rmSync(tmp, { recursive: true, force: true });
  }
}

const approvalFile = (dir, sha) => join(dir, 'approved', sha);

/**
 * May <sha> become main? Gathers the facts, decides, logs, and on a refusal sends AmberX an FYI.
 * o: { repo, slug, api, dir, console, remote, source, from (the main it replaces; default the remote main) }.
 */
/**
 * The facts from GitHub alone, for a repo with no clone here (the console's PR merge of axHub): the compare API gives
 * fast-forward and the changed files, check runs give CI. The asset checks need the tree: a repo that carries them is
 * refused here (it lands through the merge queue on its clone); one without them has none to run.
 */
async function remoteFacts(o, sha, facts) {
  const files = (c) => (c?.files || []).map((f) => f.filename);
  const full = String((await gh(o, 'GET', `/repos/${o.slug}/commits/${sha}`))?.sha || '');
  if (!full) return { full: '', from: '' };
  const cmp = await gh(o, 'GET', `/repos/${o.slug}/compare/${BASE}...${full}`);
  let from = String(cmp?.base_commit?.sha || '');
  facts.fastForward = cmp.status === 'ahead' || cmp.status === 'identical';
  if (!facts.fastForward && o.merge && cmp.status === 'diverged') {
    const back = await gh(o, 'GET', `/repos/${o.slug}/compare/${sha}...${BASE}`); // what main has that <sha> lacks
    if (statusOnly(files(back)) && (back?.files || []).length < 300) { facts.fastForward = true; from = String(cmp?.merge_base_commit?.sha || from); }
  }
  // the compare API lists at most 300 files: more than that is never called status only
  facts.statusOnly = (cmp?.files || []).length < 300 && statusOnly(files(cmp));
  facts.files = (cmp?.files || []).length;
  if (facts.fastForward && !facts.statusOnly) {
    let runs; try { runs = (await gh(o, 'GET', `/repos/${o.slug}/commits/${full}/check-runs?per_page=100`))?.check_runs || []; } catch (e) { runs = null; facts.ci = { ok: false, state: 'error', why: `couldn't read CI (${e.message.slice(0, 160)})` }; }
    if (runs) facts.ci = ciVerdict(runs);
    facts.local = [];
    for (const c of LOCAL_CHECKS) {
      try { await gh(o, 'GET', `/repos/${o.slug}/contents/${c.file}?ref=${full}`); facts.local.push({ id: c.id, ok: false, why: 'this repo carries the asset checks and has no clone here: it lands through the merge queue' }); }
      catch (e) { if (e.status !== 404) facts.local.push({ id: c.id, ok: false, why: `couldn't look for ${c.file} (${e.message.slice(0, 120)})` }); }
    }
  }
  return { full, from };
}

export async function check(o, sha) {
  const git = makeGit(o.repo);
  const remote = o.remote || 'origin';
  let full = git(['rev-parse', '--verify', '-q', `${sha}^{commit}`]).out;
  const at = new Date().toISOString();
  const dir = o.dir;
  const override = readJson(join(dir, 'override.json'), null);
  const facts = { deleting: ZERO.test(sha || ''), fastForward: false, statusOnly: false, ci: null, local: null, override };
  let from = o.from;
  if (!facts.deleting && !full && o.github) {
    try { ({ full, from } = await remoteFacts(o, sha, facts)); } catch (e) { full = ''; facts.githubError = e.message.slice(0, 200); }
    if (!full) facts.missing = true;
  } else if (!facts.deleting) {
    if (!full) facts.missing = true;
    if (!from || ZERO.test(from)) { git(['fetch', '-q', remote, BASE], { timeout: 120000 }); from = git(['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${BASE}`]).out; }
    facts.fastForward = !!full && (!from || git(['merge-base', '--is-ancestor', from, full]).code === 0);
    // a GitHub merge (o.merge) makes a merge commit: fine when all main has that <sha> lacks is status (_claude/)
    if (!facts.fastForward && o.merge && full && from) {
      const mb = git(['merge-base', from, full]).out;
      if (mb && statusOnly(lines(git(['diff', '--name-only', mb, from]).out))) { facts.fastForward = true; from = mb; }
    }
    const files = from && full ? lines(git(['diff', '--name-only', from, full]).out) : null;
    facts.statusOnly = !!files && statusOnly(files);
    facts.files = files ? files.length : null;
    const approved = full ? readJson(approvalFile(dir, full), null) : null;
    if (facts.fastForward && !facts.statusOnly && approved && Date.now() - Date.parse(approved.at || 0) < APPROVAL_TTL_MS && approved.allow) {
      facts.ci = approved.ci; facts.local = approved.local; facts.cached = true;
    } else if (facts.fastForward && !facts.statusOnly && full) {
      facts.ci = await ciFor(o, git, full);
      facts.local = localChecks(git, full);
    }
  }
  const d = facts.missing ? { allow: false, via: 'refused', why: facts.githubError ? `GitHub couldn't compare ${sha} with main (${facts.githubError})` : `${sha} is not a commit here` } : decide(facts);
  const rec = { $axf: GATE_FRAME, at, sha: full || sha, from: from || '', slug: o.slug, source: o.source || 'check', ...d, ci: facts.ci, local: facts.local, statusOnly: facts.statusOnly, cached: !!facts.cached };
  if (!(d.via === 'status' && facts.statusOnly)) { // status pushes are many a minute: only code decisions are logged
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'decisions.jsonl'), `${JSON.stringify(rec)}\n`);
  }
  if (d.allow && d.via !== 'status' && full) writeJson(approvalFile(dir, full), { at, allow: true, via: d.via, ci: facts.ci, local: facts.local });
  if (!d.allow) fyi(o, { key: `main-gate:${(full || sha || '').slice(0, 12)}`, title: `Main gate refused ${String(full || sha).slice(0, 8)} (${o.source || 'push'})`, body: `Nothing reached main. ${d.why}` });
  else if (d.via === 'override') fyi(o, { key: `main-gate:override:${(full || '').slice(0, 12)}`, severity: 'warning', title: `Main gate: override used for ${String(full).slice(0, 8)}`, body: d.why });
  return rec;
}

/** Check, then push <sha> to main (one push, never forced). Returns the decision plus { pushed, pushError }. */
export async function push(o, sha) {
  const rec = await check(o, sha);
  if (!rec.allow) return { ...rec, pushed: false };
  const git = makeGit(o.repo);
  const p = git(['push', '-q', o.remote || 'origin', `${rec.sha}:refs/heads/${BASE}`], { timeout: 120000 });
  return { ...rec, pushed: p.code === 0, pushError: p.code ? p.err.slice(-300) : '' };
}

/** The pre-push hook: every update of refs/heads/main on stdin goes through check(); any refusal stops the push. */
export async function hook(o, stdin) {
  const out = [];
  for (const l of lines(stdin)) {
    const [, localSha, remoteRef, remoteSha] = l.split(/\s+/);
    if (remoteRef !== `refs/heads/${BASE}`) continue;
    out.push(await check({ ...o, source: 'git push', from: remoteSha }, localSha));
  }
  return out;
}

// ------------------------------------------------------------------ the owner's override

/**
 * Turn the override on (owner only) or off (anyone: off only tightens). The owner proof is the console's owner check
 * (control@1 owner(request): Brett's signed-in session) passed in by the REST route; the CLI has none, so `on` from a
 * shell is refused with where to turn it on.
 */
export function setOverride(dir, { on, minutes, reason, owner, by }, now = Date.now()) {
  const f = join(dir, 'override.json');
  const prev = readJson(f, null);
  if (!on) {
    const next = { $axf: GATE_FRAME, on: false, until: '', by: by || 'console', reason: reason || '', at: new Date(now).toISOString() };
    writeJson(f, next);
    if (overrideActive(prev, now)) appendFileSync(join(dir, 'decisions.jsonl'), `${JSON.stringify({ $axf: GATE_FRAME, at: next.at, source: 'override', via: 'override-off', allow: false, why: `override turned off by ${next.by}` })}\n`);
    return { ok: true, override: next };
  }
  if (!owner) return { ok: false, code: 'owner-only', message: 'the main gate override is owner only: Brett turns it on from his signed-in console (the main gate override route); from a shell, a token, MCP or voice it stays off' };
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1 || m > OVERRIDE_MAX_MIN) return { ok: false, code: 'invalid', message: `minutes is 1 to ${OVERRIDE_MAX_MIN}` };
  if (!String(reason || '').trim()) return { ok: false, code: 'invalid', message: 'a reason is required' };
  const next = { $axf: GATE_FRAME, on: true, until: new Date(now + m * 60000).toISOString(), by: String(owner.name || owner.by || by || 'owner').slice(0, 80), reason: String(reason).slice(0, 300), at: new Date(now).toISOString() };
  writeJson(f, next);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'decisions.jsonl'), `${JSON.stringify({ $axf: GATE_FRAME, at: next.at, source: 'override', via: 'override-on', allow: true, why: `override on for ${m} min by ${next.by}: ${next.reason}` })}\n`);
  return { ok: true, override: next };
}

export function readLog(dir, { refusals = false, limit = 50 } = {}) {
  let rows = [];
  try { rows = lines(readFileSync(join(dir, 'decisions.jsonl'), 'utf8')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ }
  if (refusals) rows = rows.filter((r) => r.via === 'refused');
  return rows.slice(-Math.max(1, limit));
}

export function state(dir, now = Date.now()) {
  const o = readJson(join(dir, 'override.json'), null);
  const log = readLog(dir, { limit: 500 });
  const refusals = log.filter((r) => r.via === 'refused');
  const hooks = readJson(join(dir, 'hooks.json'), { repos: [] });
  return {
    $axf: GATE_FRAME, on: true,
    override: { on: overrideActive(o, now), until: overrideActive(o, now) ? o.until : '', by: o?.by || '', reason: o?.reason || '', maxMinutes: OVERRIDE_MAX_MIN },
    hooks: hooks.repos || [],
    lastRefusal: refusals[refusals.length - 1] || null,
    refusals24h: refusals.filter((r) => now - Date.parse(r.at) < 86400000).length,
    passed24h: log.filter((r) => r.via === 'passed' && now - Date.parse(r.at) < 86400000).length,
    protection: readJson(join(dir, 'protection.json'), {}),
    rules: ['fast-forward of main only (no force-push, no delete)', 'status-only changes (_claude/) pass', 'full CI green on the exact code', 'check-theme + check-controls pass on the commit', 'owner override: off by default, expires, logged'],
  };
}

// ------------------------------------------------------------------ install: the pre-push hook in the shared hooks folder

export function install(dir, repo) {
  const git = makeGit(repo);
  const common = resolve(repo, git(['rev-parse', '--git-common-dir']).out || '.git');
  const hooksPath = git(['config', '--get', 'core.hooksPath']).out;
  const hooks = hooksPath ? resolve(repo, hooksPath) : join(common, 'hooks');
  const f = join(hooks, 'pre-push');
  if (existsSync(f) && !readFileSync(f, 'utf8').includes(HOOK_MARK)) return { ok: false, message: `${f} is someone else's hook; not replaced` };
  mkdirSync(dir, { recursive: true }); mkdirSync(hooks, { recursive: true });
  const copy = join(dir, 'main-gate.mjs');
  copyFileSync(fileURLToPath(import.meta.url), copy);
  // fail closed: no gate, no push to main (other branches are never held). The gate is looked up next to the repo's
  // own .git first, so the console container (which mounts the same repo elsewhere) finds its copy too.
  const rel = dir.startsWith(`${resolve(common, '..')}/`) ? dir.slice(resolve(common, '..').length + 1) : '';
  writeFileSync(f, `#!/bin/sh
${HOOK_MARK}: every push to main goes through main-gate.mjs (framework/cli/main-gate.mjs install)
input=$(cat)
case "$input" in *" refs/heads/${BASE} "*) ;; *) exit 0 ;; esac
dir="${dir}"
${rel ? `top=$(cd "$(git rev-parse --git-common-dir)/.." 2>/dev/null && pwd)
[ -n "$top" ] && [ -f "$top/${rel}/main-gate.mjs" ] && dir="$top/${rel}"
` : ''}command -v node >/dev/null 2>&1 || { echo "main gate: node is missing, so nothing is pushed to main" >&2; exit 1; }
[ -f "$dir/main-gate.mjs" ] || { echo "main gate: $dir/main-gate.mjs is missing, so nothing is pushed to main" >&2; exit 1; }
printf '%s\\n' "$input" | AXF_MAIN_GATE_DIR="$dir" node "$dir/main-gate.mjs" hook "$@"
`);
  chmodSync(f, 0o755);
  const st = readJson(join(dir, 'hooks.json'), { repos: [] });
  const repos = [...new Set([...(st.repos || []).filter((r) => r !== common), common])];
  writeJson(join(dir, 'hooks.json'), { $axf: GATE_FRAME, repos, at: new Date().toISOString() });
  return { ok: true, hook: f, gate: copy };
}

export function uninstall(dir, repo) {
  const git = makeGit(repo);
  const common = resolve(repo, git(['rev-parse', '--git-common-dir']).out || '.git');
  const f = join(common, 'hooks', 'pre-push');
  if (existsSync(f) && readFileSync(f, 'utf8').includes(HOOK_MARK)) unlinkSync(f);
  const st = readJson(join(dir, 'hooks.json'), { repos: [] });
  writeJson(join(dir, 'hooks.json'), { $axf: GATE_FRAME, repos: (st.repos || []).filter((r) => r !== common), at: new Date().toISOString() });
  return { ok: true, removed: f };
}

// ------------------------------------------------------------------ GitHub: a ruleset on main

/** The ruleset main gets: no delete, no force-push, a PR, the CI checks, up to date. */
export function rulesetBody(checks) {
  return {
    name: 'AXF main gate', target: 'branch', enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    // the VPS gate lands through the repo admin (this file decides first); everyone else needs a PR with green CI
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
      ...(checks.length ? [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: checks.map((context) => ({ context })) } }] : []),
    ],
  };
}

export async function protect(o, { dry = false } = {}) {
  const out = { slug: o.slug, at: new Date().toISOString(), state: 'unknown', error: '', checks: [] };
  try {
    const repo = await gh(o, 'GET', `/repos/${o.slug}`);
    out.private = !!repo?.private; out.ownerType = repo?.owner?.type || '';
    const list = await gh(o, 'GET', `/repos/${o.slug}/rulesets`);
    const have = (Array.isArray(list) ? list : []).find((r) => r.name === 'AXF main gate');
    const runs = o.slug.endsWith('/AmberX-AXF') ? [] : (await gh(o, 'GET', `/repos/${o.slug}/commits/${BASE}/check-runs?per_page=100`))?.check_runs || [];
    // the jobs android.yml always reports on a PR (a job its scope skips counts as passed on GitHub)
    out.checks = o.slug.endsWith('/AmberX-AXF') ? [...REQUIRED_CHECKS] : [...new Set(runs.filter((r) => r.conclusion === 'success' && r.app?.slug === 'github-actions').map((r) => r.name))];
    out.mergeQueue = out.ownerType === 'Organization' ? 'available' : "GitHub's merge queue needs an organisation-owned repo: the console's own merge queue lands main";
    if (dry) return { ...out, state: have ? 'set' : 'would set', body: rulesetBody(out.checks) };
    await gh(o, have ? 'PUT' : 'POST', have ? `/repos/${o.slug}/rulesets/${have.id}` : `/repos/${o.slug}/rulesets`, rulesetBody(out.checks));
    out.state = 'protected';
  } catch (e) {
    out.state = 'cannot';
    out.error = e.status === 403 && /Upgrade to GitHub Pro/i.test(e.message) ? 'private repo on a free plan: rulesets need GitHub Pro (or make it public)'
      : e.status === 403 || e.status === 404 ? `the GitHub token may not change ${o.slug}'s rules (it needs Administration: Read and write)` : e.message.slice(0, 200);
  }
  if (o.dir) { const f = join(o.dir, 'protection.json'); const cur = readJson(f, {}); writeJson(f, { ...cur, [o.slug]: out }); }
  return out;
}

// ------------------------------------------------------------------ CLI

function opts(argv) {
  const repo = resolve(argOf(argv, 'repo') || process.env.AXF_MAIN_GATE_REPO || process.cwd());
  const git = makeGit(repo);
  const top = git(['rev-parse', '--show-toplevel']).out || repo;
  return {
    repo: top, slug: argOf(argv, 'slug') || process.env.AXF_MAIN_GATE_SLUG || slugOf(git), remote: argOf(argv, 'remote', 'origin'),
    api: argOf(argv, 'api') || process.env.AXF_MAIN_GATE_API || 'https://api.github.com', dir: gateDir(argv),
    console: argOf(argv, 'console') || undefined, source: argOf(argv, 'source') || undefined, merge: argv.includes('--merge'),
    github: argv.includes('--github'),
  };
}

const BARE_FLAGS = ['--json', '--dry-run', '--refusals', '--stdin', '--merge', '--github'];
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

export async function main(argv) {
  const json = argv.includes('--json');
  const pos = []; // positionals: every word that isn't a flag or a flag's value
  for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) pos.push(argv[i]); else if (!BARE_FLAGS.includes(argv[i])) i++; }
  const [cmd = 'state', ...rest] = pos;
  const o = opts(argv);
  const print = (v, text) => console.log(json ? JSON.stringify(v) : text);
  if (cmd === 'check' || cmd === 'push') {
    const sha = rest[0]; if (!sha) throw new Error(`usage: main-gate.mjs ${cmd} <sha>`);
    const r = cmd === 'push' ? await push(o, sha) : await check(o, sha);
    print(r, `${r.allow ? (cmd === 'push' ? (r.pushed ? 'pushed to main' : `allowed, but the push failed: ${r.pushError}`) : 'allowed') : 'refused'}: ${r.why}`);
    if (!r.allow || (cmd === 'push' && !r.pushed)) process.exitCode = 1;
    return;
  }
  if (cmd === 'hook') {
    const rs = await hook(o, readStdin());
    for (const r of rs) if (!r.allow) console.error(`main gate: refused ${String(r.sha).slice(0, 8)} → main: ${r.why}\n  Nothing reached main. Land it through its PR and the merge queue (see main-gate.mjs state).`);
    if (rs.some((r) => !r.allow)) process.exitCode = 1;
    return;
  }
  if (cmd === 'state') { const s = state(o.dir); return print(s, `main gate on · override ${s.override.on ? `ON until ${s.override.until} (${s.override.by})` : 'off'} · hook in ${s.hooks.length} repo(s) · ${s.refusals24h} refused / ${s.passed24h} passed in 24 h${s.lastRefusal ? `\nlast refusal ${s.lastRefusal.at}: ${s.lastRefusal.why}` : ''}`); }
  if (cmd === 'log') { const rows = readLog(o.dir, { refusals: argv.includes('--refusals'), limit: Number(argOf(argv, 'limit', '20')) || 20 }); return print({ rows }, rows.map((r) => `${r.at} ${String(r.via).padEnd(9)} ${String(r.sha || '').slice(0, 8)} ${r.source || ''}: ${r.why}`).join('\n') || 'nothing logged yet'); }
  if (cmd === 'override') {
    const sub = rest[0] || 'status';
    if (sub === 'status') { const s = state(o.dir).override; return print(s, s.on ? `override ON until ${s.until} (${s.by}: ${s.reason})` : 'override off'); }
    // the console's REST route passes its owner proof on stdin ({ owner }); a shell has none
    const input = sub === 'on' && argv.includes('--stdin') ? JSON.parse(readStdin() || '{}') : {};
    const r = setOverride(o.dir, { on: sub === 'on', minutes: argOf(argv, 'minutes', input.minutes), reason: argOf(argv, 'reason', input.reason), owner: input.owner || null, by: argOf(argv, 'by', input.by || 'cli') });
    if (!r.ok && r.code === 'owner-only') fyi(o, { key: 'main-gate:override-request', title: 'Main gate: someone asked for the override', body: `${argOf(argv, 'reason') || 'no reason given'}. It stays off unless you turn it on from your console.` });
    print(r, r.ok ? (r.override.on ? `override ON until ${r.override.until}` : 'override off') : r.message);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === 'install') { const r = install(o.dir, o.repo); print(r, r.ok ? `pre-push hook: ${r.hook} → ${r.gate}` : r.message); if (!r.ok) process.exitCode = 1; return; }
  if (cmd === 'uninstall') return print(uninstall(o.dir, o.repo), 'pre-push hook removed');
  if (cmd === 'protect') {
    const slugs = argOf(argv, 'slug') ? [o.slug] : ['MossesX/AmberX-AXF', 'MossesX/axHub'];
    const rs = []; for (const slug of slugs) rs.push(await protect({ ...o, slug }, { dry: argv.includes('--dry-run') }));
    print({ repos: rs }, rs.map((r) => `${r.slug}: ${r.state}${r.error ? ` (${r.error})` : ''}${r.checks.length ? ` · checks ${r.checks.join(', ')}` : ''}`).join('\n'));
    return;
  }
  throw new Error('usage: main-gate.mjs check|push <sha> | hook | state | log [--refusals] | override status|on|off | install | uninstall | protect [--dry-run]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
