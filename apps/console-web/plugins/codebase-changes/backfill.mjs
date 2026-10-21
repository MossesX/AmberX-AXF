#!/usr/bin/env node
/**
 * backfill.mjs — one change-log@1 entry (surface "backfill") for everything built before builds reported themselves
 * (Oct 21 2026), so the Build manager's Built view shows the cost and time of all of it. Idempotent: every entry's id
 * is derived from its source key (`chg-<YYYYMMDD>-<sha256(key)[:10]>`), an id that already exists is left alone (or
 * merged with --update, keeping anything a session recorded), and a source already covered by a real entry (same
 * buildRef) is skipped.
 *
 *   node backfill.mjs                     dry run: what would be written (default)
 *   node backfill.mjs --json              the entries as JSON (dry run)
 *   node backfill.mjs --write [--update]  write them (same places as changes.mjs: AXF_CHANGES_DIR → /projects → axHub with
 *                                         the hub token → console API → --to-repo → queue); --out <dir> writes there
 *
 * Sources (one entry per build, first source wins on duplicates):
 *   1. pending items marked complete (builtAt) — model, estimate (item or steps), planId
 *   2. rebuilds in _claude/memory/docs/rebuilds/LOG.md — date, item, model, branch, report link
 *   3. harvest reports in _claude/memory/docs/harvest/*.md — title, model, date, branch
 *   4. CLAUDE.md Status entries "**Name (Oct 18 2026, built on Opus …)**" — date + model + summary
 *   5. build-queue steps done (completedAt; the "baseline" ones date from the first commits) — model, effort
 * Dates and commits come from git (the commits that first touched the item's folder / report, or the day's commits
 * mentioning it). Time: the item's own estimate, else its effort size (S 45 min, M 2 h, L 4 h, XL 8 h), else 2 h; cost
 * = minutes × the model's per-minute heuristic in framework/schemas/model-pricing.json. Every backfilled entry has
 * costEstimated: true and actual.source "backfill" only when git gives a real start→end span (minutes of work time are
 * never inferred from git).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DirStore, normalize } from './changes-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const REPO_NAME = 'MossesX/AmberX-AXF';
export const EFFORT_MIN = { S: 45, M: 120, L: 240, XL: 480 };
export const DEFAULT_MIN = 120;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
export const idFor = (key, iso) => `chg-${iso.slice(0, 10).replace(/-/g, '')}-${createHash('sha256').update(`backfill:${key}`).digest('hex').slice(0, 10)}`;
export const modelOf = (s) => { const m = String(s ?? '').toLowerCase(); return m.includes('fable') ? 'fable' : m.includes('sonnet') ? 'sonnet' : m.includes('opus') ? 'opus' : ''; };

function git(args) {
  const r = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}
/** Commits touching `paths` (oldest first): [{sha, at, subject}]. */
export function commitsFor(paths, { first = false } = {}) {
  const ps = paths.filter((p) => existsSync(join(REPO, p)));
  if (!ps.length) return [];
  const out = git(['log', '--reverse', '--format=%h%x09%aI%x09%s', ...(first ? ['--diff-filter=A'] : []), '--', ...ps]);
  return out.split('\n').filter(Boolean).map((l) => { const [sha, at, ...s] = l.split('\t'); return { sha, at, subject: s.join('\t') }; });
}
/** Commits whose subject mentions a word (case-insensitive), oldest first. */
function commitsMentioning(word) {
  if (!word || word.length < 4) return [];
  const out = git(['log', '--reverse', '-i', '--fixed-strings', `--grep=${word}`, '--format=%h%x09%aI%x09%s']);
  return out.split('\n').filter(Boolean).map((l) => { const [sha, at, ...s] = l.split('\t'); return { sha, at, subject: s.join('\t') }; });
}
const firstCommit = () => commitsFor(['.'])[0];

/** "Oct 18 2026" / "2026-10-18" → ISO noon UTC that day (Eastern daytime), or ''. */
export function dayIso(text) {
  const s = String(text ?? '');
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T16:00:00.000Z`;
  m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:[–-]\d{1,2})?,?\s+(\d{4})/i.exec(s);
  if (m) return `${m[3]}-${String(MONTHS[m[1].toLowerCase().slice(0, 3)]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}T16:00:00.000Z`;
  return '';
}
const toIso = (at) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/** The repo folders an item lives in (for git dates and the overlap areas). */
function foldersFor(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/`((?:apps|framework|deploy)\/[A-Za-z0-9_./-]+?)\/?`/g)) {
    const p = m[1].replace(/\/$/, '');
    if (existsSync(join(REPO, p)) && !p.includes('..')) out.add(p);
  }
  return [...out].slice(0, 12);
}

function money(model, minutes, pricing) { const c = pricing.estimateCost(model || 'opus', minutes); return c == null ? undefined : c; }

function entry({ key, title, model, at, finishedAt, minutes, ref, branch, commits = [], areas = [], links = {}, summary = '', source, steps = [] }, pricing) {
  const fin = finishedAt || at;
  const start = new Date(Date.parse(fin) - minutes * 60000).toISOString();
  const cost = money(model, minutes, pricing);
  return {
    $axf: 'change-log@1', id: idFor(key, fin), createdAt: start, updatedAt: fin, kind: 'build', title: title.slice(0, 160),
    asked: `Backfilled from ${source} (built before builds reported themselves).`, repos: [REPO_NAME], model,
    who: { where: 'backfill', host: 'backfill' }, steps: steps.slice(0, 30).map((s) => ({ text: String(s.text ?? s).slice(0, 300), state: 'done' })),
    result: { state: 'done', summary: summary.slice(0, 4000) || title, ...(branch ? { branch } : {}), commits: commits.slice(-20).map((c) => ({ sha: c.sha, message: c.subject.slice(0, 200) })), links },
    closed: { at: fin, by: 'backfill' },
    status: 'done', surface: 'backfill', startedAt: start, finishedAt: fin, buildRef: ref,
    estimate: { minutes, ...(cost != null ? { costUsd: cost } : {}) }, costEstimated: true,
    ...(branch ? { branch } : {}), ...(areas.length ? { areas } : {}),
  };
}

export async function collect({ pricing } = {}) {
  pricing ??= await import(pathToFileURL(join(REPO, 'framework/cli/model-pricing.mjs')).href);
  const pc = await import(pathToFileURL(join(REPO, 'framework/plan/pending-core.mjs')).href);
  const plan = readJson(join(REPO, 'framework/plan/plan.json'), { features: [] });
  const features = new Map((plan.features ?? []).map((f) => [f.id, f]));
  const out = [];
  const seen = new Set(); // normalised keys: pending id, plan id, report name, title words
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const claim = (...keys) => { const ks = keys.filter(Boolean).map(norm); if (ks.some((k) => seen.has(k))) return false; ks.forEach((k) => seen.add(k)); return true; };
  const effortMin = (f) => EFFORT_MIN[f?.effort] ?? null;

  // 1. pending items marked complete
  for (const it of readJson(join(REPO, 'framework/plan/pending.json'), { items: [] }).items ?? []) {
    if (it.status !== 'complete' || !it.builtAt) continue;
    if (!claim(it.id, it.planId, `${it.id}-fable`)) continue;
    const mins = pc.itemEstimate ? pc.estimateMinutes(pc.itemEstimate(it)) : null;
    const minutes = mins ?? effortMin(features.get(it.planId)) ?? DEFAULT_MIN;
    const report = existsSync(join(REPO, `_claude/memory/docs/rebuilds/${it.id}.md`)) ? `_claude/memory/docs/rebuilds/${it.id}.md` : '';
    const commits = report ? commitsFor([report]) : [];
    out.push(entry({ key: `pending:${it.id}`, title: it.title, model: modelOf(it.model), at: toIso(it.builtAt), finishedAt: toIso(it.builtAt), minutes, ref: { kind: 'pending', id: it.id },
      commits, links: report ? { report } : {}, summary: String(it.detail ?? '').slice(0, 600), source: 'the pending list (complete)', steps: it.subPrompts ?? [] }, pricing));
  }

  // 2. rebuild log
  for (const line of read(join(REPO, '_claude/memory/docs/rebuilds/LOG.md')).split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    if (c.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(c[1])) continue;
    const item = c[2].replace(/\s*\(.*$/, '').trim();
    if (!claim(item, item.replace(/-plugin$/, ''))) continue;
    const branch = (/`((?:fable|rebuild|harvest)\/[A-Za-z0-9._/-]+)`/.exec(c[4]) ?? [])[1] ?? '';
    const rep = (/\]\(([^)]+)\)/.exec(c[5]) ?? [])[1] ?? '';
    const reportPath = rep && !rep.startsWith('http') ? join('_claude/memory/docs/rebuilds', rep).replace(/\/[^/]+\/\.\.\//g, '/') : '';
    const commits = reportPath ? commitsFor([reportPath, `_claude/memory/docs/rebuilds/${item}`]) : [];
    const f = features.get([...features.values()].find((x) => norm(x.id).endsWith(norm(item)))?.id);
    const minutes = effortMin(f) ?? 240; // a rebuild is a big job: 4 h when nothing says otherwise
    const finished = commits.length ? toIso(commits[commits.length - 1].at) : dayIso(c[1]);
    out.push(entry({ key: `rebuild:${item}`, title: `${item} (rebuild)`, model: modelOf(c[3]), at: finished, finishedAt: finished, minutes, ref: { kind: 'pending', id: item },
      branch, commits, links: rep ? { report: rep.startsWith('http') ? rep : reportPath } : {}, summary: c[7], source: 'the rebuild log' }, pricing));
  }

  // 3. harvest reports
  const hdir = join(REPO, '_claude/memory/docs/harvest');
  for (const f of existsSync(hdir) ? readdirSync(hdir).filter((x) => x.endsWith('.md')).sort() : []) {
    const name = f.slice(0, -3);
    const text = read(join(hdir, f));
    const head = text.split('\n')[0].replace(/^#\s*/, '');
    if (!claim(`harvest-${name}`, name)) continue;
    const branch = (/Branch `([^`]+)`/.exec(text) ?? [])[1] ?? '';
    const commits = commitsFor([`_claude/memory/docs/harvest/${f}`, `_claude/memory/docs/harvest/${name}`]);
    const finished = commits.length ? toIso(commits[commits.length - 1].at) : dayIso(head);
    if (!finished) continue;
    out.push(entry({ key: `harvest:${name}`, title: `Harvest: ${name}`, model: modelOf(head) || 'opus', at: finished, finishedAt: finished, minutes: 240,
      ref: { kind: 'other', id: `harvest-${name}` }, branch, commits, areas: foldersFor(text), links: { report: `_claude/memory/docs/harvest/${f}` },
      summary: head, source: 'a harvest report' }, pricing));
  }

  // 4. CLAUDE.md Status entries with a date
  for (const line of read(join(REPO, 'CLAUDE.md')).split('\n')) {
    const m = /^- \*\*(.+?)\*\*:?\s*(.*)$/.exec(line);
    if (!m) continue;
    const head = m[1];
    const date = dayIso(head);
    if (!date || /^(Built|Just merged|Next|Feature tracker|Hosting|Pending build list)/.test(head)) continue;
    if (/^Harvest\b/i.test(head)) continue; // the harvest reports (source 3) cover these
    const name = head.replace(/\s*\(.*$/, '').replace(/[:—–-]+\s*$/, '').trim();
    const paren = (/\(([^)]*)\)/.exec(head) ?? [])[1] ?? head;
    const model = modelOf((/\b(fable|opus|sonnet)\b/i.exec(paren) ?? [])[1]) || 'opus'; // the first model named = who built it first
    const original = model === 'opus' && /fable rebuild/i.test(head); // "on Opus; Fable rebuild …": this is the Opus build
    const rebuildRep = (/rebuilds\/([a-z0-9-]+)\.md/.exec(`${head} ${m[2]}`) ?? [])[1];
    if (!original && rebuildRep && seen.has(norm(rebuildRep))) continue; // the rebuild log already has it
    const plugin = (/apps\/console-web\/plugins\/([a-z0-9-]+)/.exec(m[2]) ?? [])[1] ?? '';
    const pendingId = (/pending `([a-z0-9-]+)`/.exec(head) ?? [])[1] ?? '';
    if (original ? !claim(`${name}-opus`) : !claim(name, plugin && `${plugin}-plugin`, plugin, pendingId)) continue;
    const areas = foldersFor(m[2]);
    const commits = plugin ? commitsFor([`apps/console-web/plugins/${plugin}`]) : areas.length ? commitsFor(areas.slice(0, 3)) : [];
    // the build day (date in the header, US Eastern): commits from 14 h before to 14 h after its noon
    const sameDay = commits.filter((c) => Math.abs(Date.parse(c.at) - Date.parse(date)) < 14 * 3600000);
    const use = sameDay.length ? sameDay : [];
    const finished = use.length ? toIso(use[use.length - 1].at) : date;
    const f = [...features.values()].find((x) => plugin && (norm(x.id).includes(norm(plugin))));
    const minutes = effortMin(f) ?? (plugin ? 180 : DEFAULT_MIN);
    out.push(entry({ key: `status:${norm(name)}${original ? ':opus' : ''}`, title: original ? `${name} (Opus build)` : name, model, at: finished, finishedAt: finished, minutes, ref: plugin ? { kind: 'plugin', id: plugin } : { kind: 'other', id: norm(name).slice(0, 120) },
      commits: use, areas: plugin ? [`apps/console-web/plugins/${plugin}`] : areas, summary: m[2].replace(/<!--.*?-->/g, '').slice(0, 800), source: 'CLAUDE.md Status' }, pricing));
  }

  // 5. build-queue steps done
  const q = readJson(join(REPO, 'framework/plan/build-queue.json'), { steps: {} });
  const fc = firstCommit();
  for (const [id, rec] of Object.entries(q.steps ?? {})) {
    if (!rec?.completedAt) continue;
    const f = features.get(id);
    if (!f || !claim(id)) continue;
    const baseline = rec.completedBy === 'baseline' || rec.completedAt.startsWith('1970');
    const finished = baseline ? (fc ? toIso(fc.at) : '2026-10-15T16:47:47.000Z') : toIso(rec.completedAt);
    const minutes = effortMin(f) ?? DEFAULT_MIN;
    out.push(entry({ key: `queue:${id}`, title: f.title || id, model: modelOf(f.model) || 'opus', at: finished, finishedAt: finished, minutes, ref: { kind: 'queue', id },
      summary: `${String(f.summary ?? '').slice(0, 500)}${baseline ? ' (built before the build queue existed; date = the first commits)' : ''}`, source: 'the build queue (done step)' }, pricing));
  }
  return out.map((e) => { const r = normalize(e); if (!r.entry) throw new Error(`${e.title}: ${r.errors.join('; ')}`); return r.entry; });
}

export function totals(entries) {
  const t = { count: entries.length, minutes: 0, costUsd: 0, byModel: {} };
  for (const e of entries) {
    const m = e.estimate?.minutes ?? 0, c = e.estimate?.costUsd ?? 0;
    t.minutes += m; t.costUsd += c;
    const b = (t.byModel[e.model || '?'] ??= { count: 0, minutes: 0, costUsd: 0 });
    b.count++; b.minutes += m; b.costUsd += c;
  }
  t.costUsd = Math.round(t.costUsd * 100) / 100;
  for (const b of Object.values(t.byModel)) b.costUsd = Math.round(b.costUsd * 100) / 100;
  return t;
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const entries = await collect();
  const t = totals(entries);
  if (!has('--write')) {
    if (has('--json')) return console.log(JSON.stringify({ totals: t, entries }, null, 2));
    for (const e of entries) console.log(`${e.finishedAt.slice(0, 10)}  ${(e.model || '?').padEnd(6)} ${String(e.estimate.minutes).padStart(4)} min  $${String(e.estimate.costUsd ?? '?').padEnd(7)} ${e.buildRef.kind}:${e.buildRef.id}  ${e.title}`);
    console.log(`\n${t.count} entries · ${(t.minutes / 60).toFixed(1)} h · $${t.costUsd} (estimated)  ${Object.entries(t.byModel).map(([m, b]) => `${m} ${b.count} / ${(b.minutes / 60).toFixed(1)} h / $${b.costUsd}`).join(' · ')}`);
    return console.log('Dry run. Add --write to save them (idempotent).');
  }
  const { pickBackend } = await import('./changes.mjs');
  const b = val('--out') ? { put: async (e) => new DirStore(resolve(val('--out'))).put(e), get: async (id) => new DirStore(resolve(val('--out'))).get(id), list: async () => new DirStore(resolve(val('--out'))).all(), label: val('--out') } : await pickBackend(Object.fromEntries(args.filter((a) => a === '--to-repo').map(() => ['to-repo', true])));
  let written = 0, kept = 0, covered = 0, enriched = 0;
  const existing = b.list ? await b.list().catch(() => []) : [];
  const real = existing.filter((x) => x.surface !== 'backfill' && x.who?.where !== 'backfill');
  const refs = new Set(real.filter((x) => x.buildRef).map((x) => `${x.buildRef.kind}:${x.buildRef.id}`));
  for (const e of entries) {
    if (refs.has(`${e.buildRef.kind}:${e.buildRef.id}`)) { covered++; continue; }
    // A real entry recorded before build stats existed (same title start): give it the stats, keep what it recorded.
    const twin = real.find((x) => !x.estimate && sameBuild(x.title, e.title));
    if (twin) {
      if (has('--write')) await b.put({ ...twin, buildRef: twin.buildRef ?? e.buildRef, estimate: e.estimate, costEstimated: twin.actual?.costUsd == null, startedAt: twin.startedAt ?? twin.createdAt, finishedAt: twin.finishedAt ?? (twin.result ? twin.updatedAt : undefined), ...(twin.areas ? {} : e.areas ? { areas: e.areas } : {}) });
      enriched++; refs.add(`${e.buildRef.kind}:${e.buildRef.id}`); continue;
    }
    const cur = await b.get(e.id).catch(() => null);
    if (cur && !has('--update')) { kept++; continue; }
    await b.put(cur ? { ...e, ...Object.fromEntries(Object.entries(cur).filter(([k]) => ['actual', 'closed', 'verify'].includes(k))) } : e);
    written++;
  }
  console.log(`${written} written, ${kept} already there, ${covered} covered by a real entry, ${enriched} real entries given estimates (${b.label}). ${t.count} entries · ${(t.minutes / 60).toFixed(1)} h · $${t.costUsd} estimated.`);
}

/** "Codebase changes plugin" ≈ "Codebase changes plugin: log, banner and browser" (one title starts with the other's words). */
export function sameBuild(a, b) {
  const w = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const x = w(a), y = w(b);
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 3 && s.every((t, i) => l[i] === t);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`backfill: ${e.message}`); process.exit(1); });
export { basename };
