/**
 * Send UI Review work stuck in build worktrees to the console (what the `ui-review-stuck` health check reports).
 *
 *   node apps/console-web/plugins/ui-review/review.mjs resubmit [--roots /root/axf-builds,/root/axf-review-shots] [--dry-run] [--json]
 *
 * For every `<root>/<worktree>/.axf-console/plugins/ui-review/` it re-runs the normal CLIs against the console
 * (AXF_CONSOLE_URL + AXF_TOKEN): review items through `review.mjs submit --console` (same kind, name, app, screen, group,
 * build, branch, PR, single option, pictures), screenshots through `shots.mjs --console`. Each one sent is recorded in
 * that folder's sent.json, so a second run (and the health check) skips it, and a clean worktree clears the failure
 * marker. An item the console already has (same name and branch) is recorded as sent without a second copy; loose
 * pictures identical to a stuck item's are skipped. A root that holds loose pictures (no UI Review data folder, e.g. /root/axf-review-shots/<build>/*.png) is
 * sent as screenshots grouped by folder name. Nothing is deleted.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REL = join('.axf-console', 'plugins', 'ui-review');
export const DEFAULT_ROOTS = ['/root/axf-builds', '/root/axf-review-shots'];
const IMG = /\.(png|jpe?g|webp)$/i;

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const by = (s) => (s && typeof s === 'object' && s.type && s.id ? `${s.type}:${s.id}` : '');

/** Where a stored item's picture lives in its data folder ("items/<id>/f.png" → shots/<id>/f.png). */
export const itemFile = (dir, src) => join(dir, 'shots', String(src).replace(/^items\//, ''));

/** The CLI calls that would re-send one data folder's unsent items and screenshots: [{ id, label, argv, files }]. */
export function planDataDir(dir, { console: remote = true } = {}) {
  const sent = new Set((readJson(join(dir, 'sent.json'), {}).ids) || []);
  const out = [];
  for (const it of readJson(join(dir, 'items.json'), {}).items || []) {
    if (!it?.id || sent.has(it.id)) continue;
    const pics = [...(it.files?.before || []), ...(it.files?.after || [])].map((f) => itemFile(dir, f.src)).filter((f) => existsSync(f));
    if (!pics.length) { out.push({ id: it.id, label: it.name || it.id, skip: 'no pictures on disk' }); continue; }
    const argv = [join(HERE, 'review.mjs'), 'submit', '--kind', it.kind || 'screen', '--name', it.name || it.title || it.id, '--app', it.app || 'console-web',
      '--screen', it.screen || '-', '--shots', pics.join(',')];
    const opt = { group: it.group?.name, build: it.build, step: it.step, branch: it.branch, pr: it.pr != null ? String(it.pr) : '', notes: it.notes, source: it.source, by: by(it.submittedBy), 'single-option': it.singleOption };
    for (const [k, v] of Object.entries(opt)) if (v) argv.push(`--${k}`, String(v));
    if (remote) argv.push('--console');
    out.push({ id: it.id, label: it.name || it.id, argv, files: pics });
  }
  for (const s of readJson(join(dir, 'screenshots', 'index.json'), {}).shots || []) {
    if (!s?.id || sent.has(s.id)) continue;
    const pics = [...(s.files?.before || []), ...(s.files?.after || [])].map((f) => join(dir, 'screenshots', 'files', String(f.src))).filter((f) => existsSync(f));
    if (!pics.length) { out.push({ id: s.id, label: s.name || s.id, skip: 'no picture on disk' }); continue; }
    const argv = [join(HERE, 'shots.mjs'), ...pics, '--name', s.name || s.id, '--app', s.app || 'console-web', '--screen', s.screen || '-'];
    const opt = { group: s.group?.name, viewport: s.viewport, source: s.source, by: by(s.submittedBy), note: s.note, branch: s.branch, pr: s.pr != null ? String(s.pr) : '', build: s.build };
    for (const [k, v] of Object.entries(opt)) if (v) argv.push(`--${k}`, String(v));
    argv.push(remote ? '--console' : '--local');
    out.push({ id: s.id, label: s.name || s.id, argv, files: pics });
  }
  return out;
}

/** Loose pictures in a folder (no UI Review data): one screenshot call, grouped by the folder's name. */
export function planLoose(folder, { console: remote = true } = {}) {
  const sent = new Set((readJson(join(folder, '.axf-sent.json'), {}).ids) || []);
  const pics = readdirSync(folder).filter((n) => IMG.test(n) && !sent.has(n)).sort().map((n) => join(folder, n));
  if (!pics.length) return [];
  const name = folder.split('/').filter(Boolean).pop();
  return [{ id: `loose:${name}`, label: `${pics.length} picture(s) in ${folder}`, loose: true, files: pics,
    argv: [join(HERE, 'shots.mjs'), ...pics, '--name', name, '--app', 'console-web', '--screen', name, '--group', `${name} (re-sent)`, '--source', 'headless', remote ? '--console' : '--local'] }];
}

/** Every worktree / folder under the roots with something to send. */
export function plan(roots = DEFAULT_ROOTS, opts = {}) {
  const out = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const n of readdirSync(root).sort()) {
      const wt = join(root, n);
      if (!isDir(wt)) continue;
      const dir = join(wt, REL);
      if (isDir(dir)) { const calls = planDataDir(dir, opts); if (calls.length || existsSync(join(dir, 'submit-failed.json'))) out.push({ where: wt, dir, calls }); }
      else if (!existsSync(join(wt, '.git'))) { const calls = planLoose(wt, opts); if (calls.length) out.push({ where: wt, dir: wt, loose: true, calls }); }
    }
  }
  return out;
}

const argOf = (argv, k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
export { keyOf };

const markSent = (dir, ids, loose) => {
  const f = join(dir, loose ? '.axf-sent.json' : 'sent.json');
  const prev = readJson(f, {}).ids || [];
  writeFileSync(f, JSON.stringify({ ids: [...new Set([...prev, ...ids])], at: new Date().toISOString() }, null, 2) + '\n');
};

const sha = (f) => { try { return createHash('sha256').update(readFileSync(f)).digest('hex'); } catch { return ''; } };
const keyOf = (name, branch) => `${String(name || '').trim().toLowerCase()}|${String(branch || '').trim()}`;

/** Run the plan: each call through the normal CLI; sent ones recorded; returns a summary.
 *  `known`: name|branch keys of items the console already has (skipped, recorded as sent). */
export function run(roots = DEFAULT_ROOTS, { dryRun = false, log = console.log, spawn = spawnSync, known = new Set() } = {}) {
  const found = plan(roots);
  const itemPics = new Set(found.flatMap((w) => (w.loose ? [] : w.calls.flatMap((c) => (c.files || []).map(sha)))));
  for (const w of found) {
    if (w.loose) for (const c of w.calls) { const dup = c.files.filter((f) => itemPics.has(sha(f))); if (dup.length === c.files.length) c.skip = 'same pictures as a stuck review item'; }
    else for (const c of w.calls) { const it = c.argv && c.argv.includes('submit') ? c : null; if (it && known.has(keyOf(argOf(c.argv, '--name'), argOf(c.argv, '--branch')))) c.already = true; }
  }
  const res = { sent: [], failed: [], skipped: [], cleared: [] };
  for (const w of found) {
    const ok = [];
    for (const c of w.calls) {
      if (c.skip) { res.skipped.push({ where: w.where, id: c.id, why: c.skip }); continue; }
      if (c.already) { ok.push(c.id); res.skipped.push({ where: w.where, id: c.id, why: 'already in UI Review' }); log(`already in UI Review: ${c.label}`); continue; }
      if (dryRun) { log(`would send ${c.label} (${c.files.length} file(s)) from ${w.where}`); continue; }
      const r = spawn(process.execPath, c.argv, { encoding: 'utf8', env: { ...process.env, AXF_UI_REVIEW_DIR: '' } });
      if (r.status === 0) { ok.push(...(c.loose ? c.files.map((f) => f.split('/').pop()) : [c.id])); res.sent.push({ where: w.where, id: c.id, label: c.label }); log(`sent ${c.label} from ${w.where}`); }
      else { const why = (r.stderr || r.stdout || '').trim().split('\n').pop(); res.failed.push({ where: w.where, id: c.id, why }); log(`FAILED ${c.label} from ${w.where}: ${why}`); }
    }
    if (ok.length && !dryRun) markSent(w.dir, ok, w.loose);
    if (!dryRun && !w.loose && !res.failed.some((f) => f.where === w.where) && existsSync(join(w.dir, 'submit-failed.json'))) {
      rmSync(join(w.dir, 'submit-failed.json'), { force: true }); res.cleared.push(w.where);
    }
  }
  return res;
}
