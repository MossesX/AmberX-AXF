/**
 * Fixer `tracker-threads` (build rules `threads-log`, tracker): after a build, tracker.json is regenerated from
 * framework/catalog/status.json (`framework/cli/tracker.mjs`) and _claude/THREADS.md has the build's row in Active.
 * The row is added only when no line names the build id in backticks; the tracker is written only when it changes.
 *
 * CLI: node apps/console-web/plugins/gate/fixers/tracker-threads.mjs [check|fix] --build <id> [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, readText, result, rootOf, writeIfChanged } from './lib.mjs';

export const id = 'tracker-threads';
export const THREADS_REL = '_claude/THREADS.md';
const ACTIVE_HEAD = '| Thread | State | Branch | PR | Queued / next | Updated |';
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** The Active row for a build. */
export const threadsRow = (b, day = new Date().toISOString().slice(0, 10)) =>
  `| ${cell(b.title || b.id)} (\`${b.id}\`) | ${cell(b.state || 'in-pr')} | ${b.branch ? `\`${cell(b.branch)}\`` : ''} | ${b.pr ? `#${cell(b.pr)}` : ''} | ${cell(b.next || '')} | ${day} |`;

/** Is there a table row (a line starting with `|`) naming the build in backticks? The Live build log lines don't count. */
export const hasRow = (text, id) => text.split('\n').some((l) => l.startsWith('|') && l.includes(`\`${id}\``));

/** THREADS.md with the build's row added under the Active header (first row), or the same text when it is there. */
export function withRow(text, b, day) {
  if (!b?.id || hasRow(text, b.id)) return text;
  const i = text.indexOf(ACTIVE_HEAD);
  if (i < 0) return text;
  const end = text.indexOf('\n', i);
  return `${text.slice(0, end + 1)}${threadsRow(b, day)}\n${text.slice(end + 1)}`;
}

const tracker = (ctx, args) => spawnSync(process.execPath, [join(rootOf(ctx), 'framework/cli/tracker.mjs'), ...args], { cwd: rootOf(ctx), encoding: 'utf8', timeout: 60000 });

export function check(ctx = {}) {
  const missing = [];
  const t = tracker(ctx, ['--check']);
  if (t.status !== 0) missing.push(`tracker: ${(t.stdout || t.stderr || '').trim().split('\n').pop()}`);
  const b = ctx.build;
  if (b?.id && !hasRow(readText(join(rootOf(ctx), THREADS_REL)), b.id)) missing.push(`THREADS: no row for ${b.id}`);
  return result(id, { ok: !missing.length, missing, detail: missing.length ? missing.join('; ') : 'tracker and THREADS are current' });
}

export function fix(ctx = {}, { dryRun = false } = {}) {
  const planned = []; const changed = [];
  const root = rootOf(ctx);
  const before = readText(join(root, 'tracker.json'));
  if (dryRun) planned.push('tracker.json (regenerate)');
  else { const t = tracker(ctx, []); if (t.status !== 0) return result(id, { ok: false, unfixable: `tracker.mjs failed: ${(t.stderr || t.stdout).trim().slice(-300)}` }); if (readText(join(root, 'tracker.json')) !== before) changed.push('tracker.json'); }
  const b = ctx.build;
  if (b?.id) {
    const f = join(root, THREADS_REL);
    const cur = readText(f); const next = withRow(cur, b);
    if (next !== cur) { if (dryRun) planned.push(`${THREADS_REL} (row ${b.id})`); else if (writeIfChanged(f, next)) changed.push(THREADS_REL); }
  }
  return result(id, { ok: true, dryRun, planned, changed, detail: dryRun ? `would update ${planned.length} file(s)` : `updated ${changed.length} file(s)` });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check, fix });
