#!/usr/bin/env node
/**
 * shipped — the orchestrator's shipped-manifest@1 sender (IO side of framework/core/shipped-manifest.mjs).
 *
 * When a build lands, the orchestrator gathers everything about it (the builds@1 record and Brett's words, the brief
 * the session ran on, git: landed commit, the branch's own commits and files; headless session events and meters:
 * accounts, models, times, cost and tokens; UI Review items; the build report: tests and what is still open), writes
 * the manifest as a sidecar (_claude/builds/shipped/<build>.json) and puts its ref on the build record through the
 * builds store, so build-hook@1 fires a `shipped` event and the Shipped features ledger takes it. A build that never
 * reached the store (an older direct launch) is created in it first, from the manifest.
 *
 *   node framework/cli/shipped.mjs gather <build> [--json]                 the manifest it would send (nothing written)
 *   node framework/cli/shipped.mjs ship <build> [--manifest-file f|-] [--source orchestrator|backfill|api|manual] [--by who] [--json]
 *                                  gather + write (fields given in the manifest file win over gathered ones)
 *   node framework/cli/shipped.mjs backfill --since <YYYY-MM-DD> [--dry] [--json]
 *                                  landed builds since the date with no manifest (store builds, and build_land merges
 *                                  on main whose branch has no store build) → ship each one
 *   node framework/cli/shipped.mjs landed [--since d] [--max n] [--json]   what the orchestrator's tick runs: ship newly landed builds
 *   node framework/cli/shipped.mjs show <build> [--json]                   the stored manifest
 *   node framework/cli/shipped.mjs list [--since d] [--q text] [--json]    stored manifests (one line each)
 *   node framework/cli/shipped.mjs validate <file|->                       check a manifest (exit 1 with the field errors)
 *
 * Env: AXF_HEADLESS_DIR (session events + meters, default /var/tmp/axf-headless), AXF_PIPELINE_WORKTREES (build
 * worktrees, for .axf-brief.md; default /root/axf-builds), AXF_CONSOLE_ROOT (the console checkout whose UI Review data
 * is read; default /opt/axf), AXF_SHIPPED=off (the tick ships nothing), AXF_SHIPPED_GIT=off (no git) or
 * AXF_SHIPPED_GIT_DIR=<repo> (another repo: tests), AXF_SHIPPED_UI_REVIEW=off.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as SM from '../core/shipped-manifest.mjs';
import * as core from '../plan/builds-store-core.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { listManifests, readManifest, writeManifest, REPO_ROOT, SHIPPED_REL } from './shipped-files.mjs';

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const branchShort = (b) => str(b, 200).replace(/^claude\//, '').replace(/^refs\/heads\//, '');

// ------------------------------------------------------------------ git

const gitOff = (env = process.env) => env.AXF_SHIPPED_GIT === 'off';
const gitDir = (env = process.env) => env.AXF_SHIPPED_GIT_DIR || REPO_ROOT;
function git(args, { env = process.env, cwd = gitDir(env) } = {}) {
  if (gitOff(env)) return '';
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60e3 });
  return r.status === 0 ? r.stdout.trim() : '';
}
const isAncestor = (a, b, env) => !gitOff(env) && spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: gitDir(env), timeout: 30e3 }).status === 0;
export const mainRef = (env = process.env) => (git(['rev-parse', '--verify', '-q', 'origin/main'], { env }) ? 'origin/main' : 'main');
/** The tip of a build branch (remote first), or ''. */
export function branchHead(branch, env = process.env) {
  const b = str(branch, 200).trim(); if (!b) return '';
  return git(['rev-parse', '--verify', '-q', `origin/${b}^{commit}`], { env }) || git(['rev-parse', '--verify', '-q', `${b}^{commit}`], { env });
}
/**
 * The commit that brought `head` onto main, or '': `head` itself when main's first-parent line runs through it (a
 * fast-forward land), else the first merge on the way to main that has `head` as a parent (the PR merge), else the
 * oldest first-parent commit of main that contains it.
 */
export function landedCommitOf(head, env = process.env, depth = 1500) {
  if (!head) return '';
  const main = mainRef(env); if (!isAncestor(head, main, env)) return '';
  const line = git(['rev-list', '--first-parent', `-n${depth}`, main], { env }).split('\n').filter(Boolean); // newest first
  if (line.includes(head)) return head;
  const merge = git(['rev-list', '--reverse', '--ancestry-path', '--merges', '--parents', `${head}..${main}`], { env }).split('\n').find((l) => l.split(' ').slice(1).includes(head));
  if (merge) return merge.split(' ')[0];
  let lo = 0; let hi = line.length - 1; let found = '';
  // containment is monotonic along the first-parent line: find the oldest commit that still contains head
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (isAncestor(head, line[mid], env)) { found = line[mid]; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
/**
 * The branch's own commits (no merges) and the files they touched: walk the branch's first-parent line from `head`,
 * leaving out everything main had (every main snapshot merged into the branch, and main before the landing).
 */
export function branchWork(head, landed = '', env = process.env) {
  if (!head) return { commits: [], files: [] };
  const exclude = new Set();
  for (const line of git(['rev-list', '--first-parent', '--merges', '--parents', '-n200', head], { env }).split('\n').filter(Boolean)) for (const p of line.split(' ').slice(2)) exclude.add(p);
  // main as it was when the build landed: every parent of the landing commit except the branch head itself
  if (landed && landed !== head) for (const p of git(['rev-list', '--parents', '-n1', landed], { env }).split(' ').slice(1)) if (p && p !== head) exclude.add(p);
  if (!exclude.size) { const base = git(['merge-base', head, mainRef(env)], { env }); if (base && base !== head) exclude.add(base); }
  const not = [...exclude].map((x) => `^${x}`);
  const commits = git(['rev-list', '--no-merges', '--first-parent', '-n300', head, ...not], { env }).split('\n').filter(Boolean);
  const files = git(['log', '--no-merges', '--first-parent', '-n300', '--name-only', '--format=', head, ...not], { env }).split('\n').map((s) => s.trim()).filter(Boolean);
  return { commits, files: [...new Set(files)].sort() };
}
const filesOf = (commits, env) => [...new Set(commits.flatMap((c) => git(['show', '--name-only', '--format=', c], { env }).split('\n').map((s) => s.trim()).filter(Boolean)))].sort();
const commitTime = (c, env) => (c ? git(['show', '-s', '--format=%cI', c], { env }) : '');

// ------------------------------------------------------------------ sessions, report, UI Review

const headlessDir = (env = process.env) => env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';
function sessionEvents(env) { let t = ''; try { t = readFileSync(join(headlessDir(env), 'events.jsonl'), 'utf8'); } catch { return []; } return t.split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } }); }
/** Every headless run of a build (matched on the build id or its branch's short name): accounts, models, times, cost, tokens. */
export function runsOf(names, env = process.env) {
  const want = new Set(names.filter(Boolean));
  const by = new Map();
  for (const e of sessionEvents(env)) {
    if (!want.has(e?.name) && !want.has(basename(str(e?.cwd, 300)))) continue;
    const r = by.get(e.session) ?? { session: e.session, account: '', model: '', startedAt: '', endedAt: '', exit: null, costUsd: 0 };
    if (e.event === 'session-start') { r.startedAt = r.startedAt || e.at; r.model = r.model || e.model; }
    if (e.event === 'session-login' && e.account) r.account = e.account;
    if (e.event === 'session-end') { r.endedAt = e.at; r.exit = Number.isInteger(e.exit) ? e.exit : null; r.costUsd = Number(e.costUsd) || r.costUsd; if (e.account) r.account = e.account; }
    by.set(e.session, r);
  }
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; let usd = 0; let estimated = false;
  for (const r of by.values()) {
    const m = readJson(join(headlessDir(env), `${r.session}.meter.json`));
    if (m) { for (const k of Object.keys(tokens)) tokens[k] += Number(m.tokens?.[k]) || 0; if (!r.costUsd) { r.costUsd = Number(m.costUsd) || Number(m.estimatedUsd) || 0; estimated = estimated || !!m.costEstimated || (!m.costUsd && !!m.estimatedUsd); } r.model = r.model || m.modelKey || m.model; }
    usd += r.costUsd;
  }
  const runs = [...by.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { runs, cost: { usd, estimated, tokens } };
}
/** The build report (repo-relative), first that exists. */
export function reportOf(b, root = REPO_ROOT) {
  const names = [b.id, branchShort(b.branch), ...list(b.steps).flatMap((s) => list(s.files)).filter((f) => /_claude\/builds\/reports\/[^/]+\.md$/.test(f)).map((f) => basename(f, '.md'))];
  for (const n of [...new Set(names.filter(Boolean))]) { const rel = `_claude/builds/reports/${n}.md`; if (existsSync(join(root, rel))) return rel; }
  return '';
}
const OPEN_HEAD = /^(#+)\s*(still open|open|open items|left|left for|not done|follow[- ]ups?|deferred|known gaps|gaps|todo|next|what'?s left|remaining)\b/i;
const TEST_HEAD = /^(#+)\s*(tests?|checks|verification|verified)\b/i;
/** Tests (bullets under a Tests heading, or lines naming a test command) and open items from a report's markdown. */
export function parseReport(md) {
  const items = []; let mode = ''; let level = 0; let cur = null;
  for (const raw of str(md, 200000).split('\n')) {
    const line = raw.trimEnd(); const h = /^(#+)\s/.exec(line);
    if (h) { cur = null; if (TEST_HEAD.test(line)) { mode = 'tests'; level = h[1].length; } else if (OPEN_HEAD.test(line)) { mode = 'open'; level = h[1].length; } else if (h[1].length <= level) { mode = ''; level = 0; } continue; }
    if (!line.trim()) { cur = null; continue; }
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    // a wrapped bullet: the next lines belong to it until a blank line, a heading or the next bullet
    if (!bullet) { if (cur) cur.text += ` ${line.trim()}`; continue; }
    const cmd = /`((?:node|npx|pnpm|npm|python3?|pytest|docker)\s[^`]*?(?:test|check|spec|typecheck)[^`]*)`/i.exec(line)?.[1] || '';
    cur = mode === 'open' ? { kind: 'open', text: bullet[1].trim() } : (mode === 'tests' || (!mode && cmd)) ? { kind: 'test', text: bullet[1].trim(), cmd } : null;
    if (cur) items.push(cur);
  }
  const testResult = (text) => {
    const l = text.toLowerCase();
    if (/\b(fail(s|ed|ing)?|red|broken|✗)\b/.test(l) && !/\b0 fail/.test(l)) return 'fail';
    if (/\b(pass(es|ed)?|green|ok|✓|clean|all \d+)\b/.test(l) || /\b\d+\s*(checks?|tests?|passed)\b|\d+\s*→\s*\d+/.test(l)) return 'pass';
    return /\bskip(ped)?\b|not run|deferred/.test(l) ? 'skip' : 'unknown';
  };
  const tests = items.filter((x) => x.kind === 'test').map((x) => ({ name: x.text.replace(/`/g, '').slice(0, 300), command: x.cmd || /`((?:node|npx|pnpm|npm|python3?|pytest|docker)\s[^`]*)`/i.exec(x.text)?.[1] || '', result: testResult(x.text), detail: '' }));
  const open = items.filter((x) => x.kind === 'open').map((x) => x.text.replace(/\*\*/g, '').slice(0, 500));
  return { tests: tests.slice(0, 60), open: open.slice(0, 40) };
}
/** UI Review items of the build (by branch or build id), read from the console checkout's UI Review data. */
export function uiReviewOf(b, env = process.env) {
  if (env.AXF_SHIPPED_UI_REVIEW === 'off') return [];
  const root = env.AXF_CONSOLE_ROOT && env.AXF_CONSOLE_ROOT !== 'off' ? env.AXF_CONSOLE_ROOT : existsSync('/opt/axf/.axf-console') ? '/opt/axf' : REPO_ROOT;
  const cli = join(REPO_ROOT, 'apps/console-web/plugins/ui-review/review.mjs'); if (!existsSync(cli)) return [];
  const r = spawnSync(process.execPath, [cli, 'list', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30e3, env: { ...env, AXF_UI_REVIEW_DIR: env.AXF_UI_REVIEW_DIR || join(root, '.axf-console/plugins/ui-review') } });
  let items = []; try { items = JSON.parse(r.stdout).items ?? []; } catch { return []; }
  return items.filter((x) => (b.branch && x.branch === b.branch) || x.build === b.id || x.submittedBy?.id === b.branch).map((x) => ({ id: x.id, name: x.title || x.name || '', status: x.status || '', group: x.group || '', url: `/review/${x.id}` }));
}
function briefOf(b, env = process.env) {
  const root = env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';
  // .axf-brief.md: the orchestrator's dispatcher; .brief.md: a direct launch (vps.build_start)
  for (const n of [b.id, branchShort(b.branch)].filter(Boolean)) for (const f of ['.axf-brief.md', '.brief.md']) { try { const t = readFileSync(join(root, n, f), 'utf8'); if (t.trim()) return str(t, SM.MAX_BRIEF); } catch { /* no worktree any more */ } }
  return str(b.origin?.brief, SM.MAX_BRIEF);
}

// ------------------------------------------------------------------ gather + ship

/** Everything the host knows about a build, for manifestFromBuild. `hint` = { landedCommit, commits, branch } overrides. */
export function gather(b, { env = process.env, hint = {} } = {}) {
  const branch = hint.branch || b.branch || '';
  const head = branchHead(branch, env);
  const landedCommit = hint.landedCommit || landedCommitOf(head, env);
  let { commits, files } = branchWork(head, landedCommit, env);
  if (list(hint.commits).length) { commits = [...new Set([...list(hint.commits).map((c) => git(['rev-parse', '-q', '--verify', `${c}^{commit}`], { env }) || c), ...commits])]; files = [...new Set([...files, ...filesOf(commits, env)])].sort(); }
  if (!commits.length && landedCommit && !head) { commits = [landedCommit]; files = filesOf(commits, env); }
  const { runs, cost } = runsOf([b.id, branchShort(branch)], env);
  const report = reportOf({ ...b, branch });
  const parsed = report ? parseReport(readFileSync(join(REPO_ROOT, report), 'utf8')) : { tests: [], open: [] };
  const landedAt = commitTime(landedCommit, env);
  return { branch, landedCommit, landedAt, commits, files, runs, cost, report, tests: parsed.tests, open: parsed.open, uiReview: uiReviewOf({ ...b, branch }, env), brief: briefOf({ ...b, branch }, env), accounts: [b.pipeline?.account, b.pipeline?.lastRun?.account].filter(Boolean) };
}

/** Fields given in `over` (a partial manifest) win over the gathered ones; lists given replace, empty ones don't. */
export function overlay(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? { ...base[k], ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== '')) } : v;
  }
  return out;
}
/** A builds@1 record for a build the store never had, from its manifest (status follows the landing). */
export function recordFromManifest(m, now = nowIso()) {
  return core.normBuild({
    id: m.build.id, title: m.build.title || m.build.id, category: m.build.category, status: m.mergedAt || m.landedCommit ? 'complete' : 'built', source: 'shipped', branch: m.branch, pr: m.pr.number ? `#${m.pr.number}` : '',
    ...(m.mergedAt || m.landedAt ? { mergedAt: m.mergedAt || m.landedAt } : {}), builtAt: m.landedAt || now, createdAt: m.runs[0]?.startedAt || m.landedAt || now,
    origin: m.said.text ? { said: m.said.text, verbatim: m.said.verbatim, at: m.said.at, source: m.said.source, by: m.said.by, brief: m.brief.slice(0, 30000), from: m.said.verbatim ? '' : 'report' } : undefined,
    steps: m.steps.map((s) => ({ id: s.id, text: s.text, model: s.model, estimate: s.estimate, done: s.done, doneAt: s.doneAt })),
    notes: [{ text: `Recorded from its shipped manifest (${m.source}): it was started outside the builds store and landed as ${m.landedCommit ? m.landedCommit.slice(0, 9) : `PR #${m.pr.number}`}.`, at: now }],
    profiles: [core.MERGED_PROFILE || 'all'],
  }, { now });
}

/**
 * Gather, build and write one manifest; put its ref on the build record (created from the manifest when the store has
 * none). `manifest` = a partial manifest that wins over what is gathered (API / backfill). Returns { manifest, file, created }.
 */
export function ship(id, { manifest: over = null, source = 'orchestrator', by = process.env.AXF_ACTOR || 'orchestrator', env = process.env, dry = false, now = nowIso() } = {}) {
  const store = loadStore();
  const rec = core.findBuild(store, id) ?? null;
  const prev = readManifest(rec?.id || id, env);
  const base = rec ? rec : { id, title: over?.build?.title || id, branch: over?.branch || '', steps: [], origin: null };
  const found = gather(base, { env, hint: { landedCommit: over?.landedCommit, commits: over?.commits, branch: over?.branch } });
  let m = SM.manifestFromBuild(base, found, { now, source, by, prev });
  if (over) {
    // the fields as given are checked raw (normalising would quietly coerce a bad one), on top of what was gathered
    const given = SM.validateManifest({ ...m, ...Object.fromEntries(Object.entries(over).filter(([k, v]) => k !== 'build' && k !== '$axf' && v !== undefined && v !== null && v !== '')) });
    if (!given.ok) throw Object.assign(new Error(`shipped-manifest@1 rejected: ${SM.rejection(given.errors)}`), { code: 2, errors: given.errors });
    m = SM.normManifest({ ...overlay(m, { ...over, build: { ...(over.build || {}), id: m.build.id } }), id: m.id, rev: m.rev, source, shippedAt: now }, { now });
  }
  const v = SM.validateManifest(m);
  if (!v.ok) throw Object.assign(new Error(`shipped-manifest@1 rejected: ${SM.rejection(v.errors)}`), { code: 2, errors: v.errors });
  if (dry) return { manifest: m, file: '', created: !rec, dry: true };
  const file = writeManifest(m, env);
  let created = false;
  withStore((s) => {
    let b = core.findBuild(s, m.build.id);
    if (!b) { b = recordFromManifest(m, now); s.builds.push(b); created = true; }
    b.shipped = SM.refOf(m);
    if (!b.branch && m.branch) b.branch = m.branch;
    if (!str(b.pr) && m.pr.number) b.pr = `#${m.pr.number}`;
    // the build is on main: record when it landed (the reconciler does this for PR merges; build_land fast-forwards don't have one)
    // only when nothing is left: a build with open steps keeps its status (Brett decides), its manifest lists them
    const left = (b.steps ?? []).some((x) => !x.done && !x.skip);
    if (!b.mergedAt && (m.mergedAt || m.landedAt) && !left) { b.mergedAt = m.mergedAt || m.landedAt; if (!['complete', 'archived'].includes(b.status)) b.status = 'complete'; b.builtAt = b.builtAt || b.mergedAt; }
    b.notes = [...(b.notes ?? []), { text: `Shipped manifest ${m.id} rev ${m.rev} sent to Shipped features (${m.source}): ${m.landedCommit ? `landed ${m.landedCommit.slice(0, 9)}` : `PR #${m.pr.number}`}, ${m.files.length} file(s), ${m.tests.length} test line(s), ${m.open.length} open.`, at: now }];
    b.updatedAt = now;
    return s;
  }, { by, action: 'shipped', note: `${m.build.id}: ${m.id} rev ${m.rev}` });
  return { manifest: m, file: file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file, created };
}

// ------------------------------------------------------------------ what landed without a manifest

const since = (d) => SM.iso(d) || '';
/**
 * Landed builds since `from` with no manifest yet:
 *   store:   builds merged / complete since then, or whose branch is on main (build_land fast-forwards set no mergedAt)
 *   git:     build_land merges on main since then whose branch has no store build (direct launches before the
 *            orchestrator was the only launcher); id = the branch name, title and words from its report
 */
export function findUnshipped({ from, env = process.env } = {}) {
  const at = since(from); if (!at) throw Object.assign(new Error('--since needs a date (YYYY-MM-DD)'), { code: 2 });
  const store = loadStore(); const out = []; const branches = new Set();
  for (const b of store.builds) {
    if (b.deleted || b.kind === 'epic') continue;
    if (b.branch) branches.add(b.branch);
    const when = b.mergedAt || b.updatedAt || '';
    if (when < at || readManifest(b.id, env)) continue;
    if (SM.isLanded(b)) { out.push({ id: b.id, why: b.mergedAt ? `merged ${b.mergedAt}` : 'complete', branch: b.branch }); continue; }
    if (b.branch && b.status !== 'archived') { const lc = landedCommitOf(branchHead(b.branch, env), env); if (lc) out.push({ id: b.id, why: `branch ${b.branch} is on main (${lc.slice(0, 9)})`, branch: b.branch, landedCommit: lc }); }
  }
  for (const line of git(['log', '--first-parent', mainRef(env), `--since=${at}`, '--format=%H%x09%cI%x09%s'], { env }).split('\n').filter(Boolean)) {
    const [sha, when, subject] = line.split('\t');
    const br = /\b(claude\/[A-Za-z0-9._/-]+)/.exec(subject)?.[1]?.replace(/[.,;)]+$/, '');
    if (!br || branches.has(br) || out.some((x) => x.branch === br)) continue;
    const id = core.slug(branchShort(br));
    if (readManifest(id, env) || core.findBuild(store, id)) continue;
    out.push({ id, why: `landed on main ${when.slice(0, 16)} (${sha.slice(0, 9)}) with no store build`, branch: br, landedCommit: sha, fromGit: true });
  }
  return out;
}
/** A partial manifest for a build the store never had, from its report (title, Brett's quoted words). */
export function fromReport(c) {
  const rel = `_claude/builds/reports/${branchShort(c.branch) || c.id}.md`; let md = ''; try { md = readFileSync(join(REPO_ROOT, rel), 'utf8'); } catch { /* none */ }
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() || c.id;
  const quote = /(?:Brett(?: said)?[^\n]*\n+)?^>\s?(.+(?:\n>\s?.*)*)/m.exec(md)?.[1]?.replace(/\n>\s?/g, '\n').trim() || '';
  return { build: { id: c.id, title }, branch: c.branch, landedCommit: c.landedCommit, said: quote ? { text: quote, verbatim: true, source: 'report' } : { text: title, verbatim: false }, report: md ? rel : '' };
}
export function backfill({ from, dry = false, by = 'backfill', env = process.env } = {}) {
  const found = findUnshipped({ from, env }); const done = [];
  for (const c of found) {
    try {
      const over = c.fromGit ? fromReport(c) : c.landedCommit ? { landedCommit: c.landedCommit } : null;
      const r = ship(c.id, { manifest: over, source: 'backfill', by, env, dry });
      done.push({ id: c.id, why: c.why, ok: true, created: r.created, manifest: SM.summaryOf(r.manifest), file: r.file });
    } catch (e) { done.push({ id: c.id, why: c.why, ok: false, error: e.message }); }
  }
  return { since: since(from), dry, found: found.length, shipped: done };
}
/** The orchestrator tick's step: ship builds that landed in the last `days` days and have no manifest (a few per tick). */
export function shipLanded({ days = 3, max = 3, env = process.env } = {}) {
  if (env.AXF_SHIPPED === 'off') return { off: true, shipped: [] };
  const from = new Date(Date.now() - days * 86400e3).toISOString();
  const store = loadStore();
  const due = store.builds.filter((b) => !b.deleted && SM.isLanded(b) && (b.mergedAt || b.updatedAt) >= from && !b.shipped && !readManifest(b.id, env)).slice(0, max);
  const shipped = [];
  for (const b of due) { try { const r = ship(b.id, { source: 'orchestrator', by: 'orchestrator', env }); shipped.push({ id: b.id, manifest: r.manifest.id, rev: r.manifest.rev }); } catch (e) { shipped.push({ id: b.id, error: e.message }); } }
  return { shipped };
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? true : null; };
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const readInput = (f) => JSON.parse(f === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(f), 'utf8'));
  const [cmd = 'list', id] = args;
  if (cmd === 'gather') {
    const b = core.findBuild(loadStore(), id); if (!b) throw Object.assign(new Error(`no build "${id}"`), { code: 2 });
    const m = SM.manifestFromBuild(b, gather(b), { now: nowIso(), source: 'orchestrator' }); return out(m, JSON.stringify(m, null, 1));
  }
  if (cmd === 'ship') {
    const over = typeof flag('manifest-file') === 'string' ? readInput(flag('manifest-file')) : null;
    const src = typeof flag('source') === 'string' ? flag('source') : over ? 'api' : 'manual';
    const r = ship(id || over?.build?.id, { manifest: over, source: src, by: typeof flag('by') === 'string' ? flag('by') : process.env.AXF_ACTOR || 'cli', dry: args.includes('--dry') });
    return out({ ok: true, ...r, summary: SM.summaryOf(r.manifest) }, `${r.dry ? 'would ship' : 'shipped'} ${r.manifest.id} rev ${r.manifest.rev}${r.created ? ' (build created in the store)' : ''}${r.file ? ` → ${r.file}` : ''}`);
  }
  if (cmd === 'backfill' || cmd === 'landed') {
    const r = cmd === 'backfill' ? backfill({ from: flag('since'), dry: args.includes('--dry') }) : shipLanded({ days: Number(flag('days')) || 3, max: Number(flag('max')) || 3 });
    return out({ ok: true, ...r }, r.shipped.length ? r.shipped.map((x) => `${x.ok === false || x.error ? '✗' : r.dry ? '·' : '✓'} ${x.id}${x.why ? ` (${x.why})` : ''}${x.error ? `: ${x.error}` : x.created ? ' [created]' : ''}`).join('\n') : 'nothing to ship');
  }
  if (cmd === 'show') { const m = readManifest(id); if (!m) throw Object.assign(new Error(`no manifest for "${id}" (${SHIPPED_REL})`), { code: 2 }); return out(m, JSON.stringify(m, null, 1)); }
  if (cmd === 'list') {
    const from = typeof flag('since') === 'string' ? since(flag('since')) : ''; const q = typeof flag('q') === 'string' ? flag('q').toLowerCase() : '';
    const ms = listManifests().filter((m) => (!from || (m.landedAt || m.shippedAt) >= from) && (!q || SM.searchText(m).includes(q))).map(SM.summaryOf);
    return out({ ok: true, manifests: ms }, ms.map((m) => `${(m.landedAt || m.shippedAt).slice(0, 16)}  ${m.build.padEnd(50)} ${m.pr ? `#${m.pr}` : ''} ${m.landedCommit.slice(0, 9)}`).join('\n') || 'no manifests');
  }
  if (cmd === 'validate') { const v = SM.validateManifest(readInput(id || '-')); if (!v.ok) process.exitCode = 1; return out(v, v.ok ? 'ok: a valid shipped-manifest@1' : v.errors.map((e) => `✗ ${e.field}: ${e.message}`).join('\n')); }
  throw Object.assign(new Error('usage: shipped.mjs gather|ship|backfill|landed|show|list|validate (see the header)'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message, errors: e.errors })); else console.error(e.message);
    process.exitCode = e.code === 2 ? 2 : 1;
  });
}
