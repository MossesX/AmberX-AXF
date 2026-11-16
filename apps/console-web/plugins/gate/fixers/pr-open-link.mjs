/**
 * Fixer `pr-open-link` (build rules `builds-live`, `pr-only`): a finished build has a PR on its branch and the PR is
 * linked on the build (builds-live@1). The fixer finds the open PR for ctx.build.branch, opens one when there is none
 * (title and body from ctx.build), then runs `framework/cli/builds-live.mjs link <build> --branch <b> --pr <n>`.
 * The token is the GitHub App's, from `framework/cli/github-token.mjs token` (never logged). It never merges and
 * never pushes. A second run finds the same PR and the same link: nothing changes.
 *
 * ctx.build = { id, branch, title?, body?, pr? }; ctx.repo = "owner/name" (default: the origin remote).
 * CLI: node apps/console-web/plugins/gate/fixers/pr-open-link.mjs [check|fix] --build <id> [--branch b] [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { result, rootOf } from './lib.mjs';

export const id = 'pr-open-link';
const API = 'https://api.github.com';

const sh = (ctx, cmd, args, input) => spawnSync(cmd, args, { cwd: rootOf(ctx), encoding: 'utf8', timeout: 60000, input });

/** owner/name of the origin remote. */
export function repoOf(ctx = {}) {
  if (ctx.repo) return ctx.repo;
  const u = (sh(ctx, 'git', ['remote', 'get-url', 'origin']).stdout || '').trim();
  const m = u.match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/);
  return m ? m[1] : '';
}

function token(ctx) {
  if (ctx.token) return ctx.token;
  const r = sh(ctx, process.execPath, [join(rootOf(ctx), 'framework/cli/github-token.mjs'), 'token']);
  return r.status === 0 ? r.stdout.trim().split('\n').pop() : '';
}

async function gh(ctx, tok, method, path, body) {
  const f = ctx.fetch || fetch;
  const r = await f(`${API}${path}`, { method, headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'user-agent': 'axf-gate-fixer', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${r.status} ${j.message || ''}`.trim());
  return j;
}

/** The open PR on the branch, or null. */
export async function findPr(ctx, tok, repo, branch) {
  const owner = repo.split('/')[0];
  const list = await gh(ctx, tok, 'GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  return Array.isArray(list) && list.length ? list[0] : null;
}

const link = (ctx, build, branch, pr) => sh(ctx, process.execPath, [join(rootOf(ctx), 'framework/cli/builds-live.mjs'), 'link', build, '--branch', branch, '--pr', String(pr)]);

export async function check(ctx = {}) {
  const b = ctx.build || {};
  if (!b.id || !b.branch) return result(id, { ok: true, detail: 'no build branch named: nothing to check' });
  if (b.pr) return result(id, { ok: true, detail: `${b.id} is linked to PR #${b.pr}` });
  return result(id, { ok: false, missing: [`${b.id}: no PR linked for ${b.branch}`], detail: `${b.id} has no PR linked` });
}

export async function fix(ctx = {}, { dryRun = false } = {}) {
  const b = ctx.build || {};
  if (!b.id || !b.branch) return result(id, { ok: true, detail: 'no build branch named: nothing to fix' });
  const repo = repoOf(ctx);
  const tok = token(ctx);
  if (!repo || !tok) return result(id, { ok: false, unfixable: !repo ? 'no GitHub origin remote' : 'no GitHub token (framework/cli/github-token.mjs status)' });
  try {
    let pr = await findPr(ctx, tok, repo, b.branch);
    const planned = []; const changed = [];
    if (!pr) {
      if (dryRun) planned.push(`open a PR for ${b.branch} on ${repo}`);
      else { pr = await gh(ctx, tok, 'POST', `/repos/${repo}/pulls`, { title: String(b.title || b.id).slice(0, 200), head: b.branch, base: b.base || 'main', body: String(b.body || `Build \`${b.id}\`.`) }); changed.push(`PR #${pr.number} opened`); }
    }
    if (dryRun) { planned.push(`builds-live link ${b.id} --branch ${b.branch} --pr ${pr ? pr.number : '<new>'}`); return result(id, { ok: true, dryRun, planned, detail: `would open/link ${planned.length} thing(s)` }); }
    if (Number(b.pr) !== pr.number) {
      const l = link(ctx, b.id, b.branch, pr.number);
      if (l.status !== 0) return result(id, { ok: false, changed, unfixable: `builds-live link failed: ${(l.stderr || l.stdout).trim().slice(-300)}` });
      changed.push(`linked ${b.id} → #${pr.number}`);
    }
    return result(id, { ok: true, changed, pr: pr.number, url: pr.html_url, detail: changed.length ? changed.join('; ') : `already linked to #${pr.number}` });
  } catch (e) {
    return result(id, { ok: false, unfixable: String(e.message || e).slice(0, 400) });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const a = process.argv.slice(2); const flag = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : ''; };
  const ctx = { build: { id: flag('--build'), branch: flag('--branch'), pr: flag('--pr') } };
  const r = a[0] === 'fix' ? await fix(ctx, { dryRun: a.includes('--dry-run') }) : await check(ctx);
  console.log(a.includes('--json') ? JSON.stringify(r, null, 2) : `${r.ok ? 'ok' : 'FAIL'} ${r.fixer}: ${r.detail}`);
  process.exitCode = r.ok ? 0 : 1;
}
