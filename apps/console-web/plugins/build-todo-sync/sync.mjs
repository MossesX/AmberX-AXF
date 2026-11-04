#!/usr/bin/env node
/**
 * Build to-do sync — the plugin's engine (node). The rules are the framework's (build-todo-sync@1,
 * framework/core/build-todo-sync.mjs); this file reads the builds store and turns a snapshot of the to-do manager into
 * the control@1 commands that make it match. It never writes the to-do manager itself: the server part runs the
 * commands through the control@1 capability (so the plugin depends on no other plugin's folder), and the CLI form
 * below prints them.
 *
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs plan      < {lists, items, links, asks, opts, now}   → {ops, links, drift, asks, summary, builds}
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs names     [--all]                                   builds whose name / category await Brett (open first)
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs suggest   "<title>" [--detail "…"]                  a short name + category
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs builds                                              every mirrored build with its place, name and steps
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs step      <build> <step uid>                        one step's record (for an ask)
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs plans     < {plans, now, opts}                      the Plan Studio plan every mirrored build should have (new / changed)
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs docs      <build> [--no-git]                        the build's documentation and its status (none / draft / in development / merged)
 *   node apps/console-web/plugins/build-todo-sync/sync.mjs build     <build> [--no-git]                        one build as the API shows it (names, steps, fixes, docs)
 *
 * --json on every command answers one JSON line. The store is the active checkout's (AXF_BUILDS_STORE for tests).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as t from '../../../../framework/core/build-todo-sync.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';

export const FOLDER = 'build-todo-sync';
const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

function readStdin() {
  return new Promise((ok) => { let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { d += c; }); process.stdin.on('end', () => ok(d)); if (process.stdin.isTTY) ok(''); });
}

/** Builds the mirror covers, with their place and names (what the page lists). */
export function mirroredBuilds(store, { now = new Date().toISOString(), completedDays = t.DEFAULT_COMPLETED_DAYS, profiles } = {}) {
  const only = Array.isArray(profiles) && profiles.length ? new Set(profiles) : null;
  return store.builds.filter((b) => b.kind !== 'epic' && (!only || b.profiles.some((p) => only.has(p)))).map((b) => ({ b, place: t.placeOf(b, { now, completedDays }) })).filter((x) => x.place)
    .map(({ b, place }) => ({ id: b.id, displayName: t.listNameOf(b), title: b.title, category: b.category, area: b.area, nameReview: b.nameReview, status: b.status, place, profiles: b.profiles,
      steps: b.steps.length, done: b.steps.filter((s) => s.done).length, next: t.nextOpenUid(b), updatedAt: b.updatedAt }));
}

/** Builds whose name or category is still a suggestion: open ones first, newest first. */
export function needingNames(store, { all = false } = {}) {
  const open = (b) => !['built', 'complete', 'archived'].includes(b.status) && !b.deleted;
  return store.builds.filter((b) => b.kind !== 'epic' && b.nameReview && !b.deleted && (all || open(b)))
    .sort((a, b) => Number(open(b)) - Number(open(a)) || (b.createdAt > a.createdAt ? 1 : -1))
    .map((b) => ({ id: b.id, title: b.title, displayName: b.displayName, category: b.category, area: b.area, status: b.status, source: b.source, createdAt: b.createdAt, profiles: b.profiles,
      suggested: { displayName: t.suggestDisplayName(b.title, { id: b.id }), ...t.suggestCategory(b) } }));
}

export function suggest(title, detail = '') {
  const s = t.suggestCategory({ title, detail });
  return { displayName: t.suggestDisplayName(title), category: s.category, why: s.why, confidence: s.confidence, categories: t.CATEGORIES, maxName: t.MAX_NAME };
}

/** The plan for a snapshot (stdin JSON) against the store now. */
export function planFor(input, store = loadStore()) {
  const now = typeof input.now === 'string' && input.now ? input.now : new Date().toISOString();
  const opts = input.opts && typeof input.opts === 'object' ? input.opts : {};
  const r = t.plan({ store, lists: input.lists ?? [], items: input.items ?? [], links: input.links ?? null, asks: (input.asks ?? []).filter((a) => a.state === 'open' || !a.state), now, opts });
  const fresh = t.asksFrom(r.drift, now);
  const asks = t.mergeAsks(input.asks ?? [], fresh, now);
  return { ...r, asks, builds: mirroredBuilds(store, { now, completedDays: opts.completedDays, profiles: opts.profiles }) };
}

/* ------------------------------------------------------------------ Plan Studio: a plan per build (addendum 2) + its docs (addendum 4) */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const MARK_START = '<!-- build-todo-sync:start -->';
export const MARK_END = '<!-- build-todo-sync:end -->';
/** Build status → plan@1 status. */
export const PLAN_STATUS = { pending: 'ready', running: 'building', waiting: 'building', blocked: 'building', failed: 'building', built: 'building', complete: 'done', archived: 'dropped' };
export const DOC_STATUSES = ['none', 'draft', 'in development', 'merged'];
export const planIdFor = (b) => `build-${String(b.id).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 80);

const MD_RE = /(?:apps|framework|_claude|docs|deploy)\/[\w./-]+?\.md\b/g;
const PLUGIN_RE = /apps\/console-web\/plugins\/([\w-]+)\//g;

function gitHas(ref, path) {
  try { execFileSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}
function docStatusOnDisk(path) {
  const f = join(ROOT, path);
  if (!existsSync(f)) return '';
  try { const text = readFileSync(f, 'utf8'); return text.trim().length < 300 || /\bdraft\b/i.test(text.split('\n').slice(0, 6).join('\n')) ? 'draft' : 'merged'; } catch { return 'merged'; }
}

/**
 * The documentation a build has or should have: the plugin / app readme (standing readme rule), its build report, every
 * other .md its steps or fixes name. Status: merged (on main), in development (only on the build's branch), draft (on main
 * but thin or marked draft), none (expected, nowhere yet). `git: false` skips the branch lookups (tests).
 */
export function docsFor(b, { git = true } = {}) {
  const text = [b.detail, ...(b.steps ?? []).flatMap((s) => [s.text, ...(s.files ?? [])]), ...(b.fixes ?? []).map((f) => f.link)].filter(Boolean).join('\n');
  const paths = new Map(); // path → label
  for (const m of text.matchAll(PLUGIN_RE)) paths.set(`apps/console-web/plugins/${m[1]}/README.md`, `${m[1]} readme`);
  for (const m of text.matchAll(MD_RE)) if (!/^_claude\/builds\/(journal|store)/.test(m[0])) paths.set(m[0], m[0].split('/').pop());
  if (b.category === 'Plugin' && ![...paths.keys()].some((p) => /plugins\/[\w-]+\/README\.md$/.test(p))) {
    // the plugin folder: the build id, the id without -plugin, or the short name as a slug; the first that exists wins, else the id
    const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const guesses = [...new Set([b.id, b.id.replace(/-plugin$/, ''), slugOf(b.displayName), slugOf(b.displayName).replace(/-plugin$/, '')].filter(Boolean))];
    const folder = guesses.find((g) => existsSync(join(ROOT, 'apps', 'console-web', 'plugins', g))) ?? b.id;
    paths.set(`apps/console-web/plugins/${folder}/README.md`, `${folder} readme`);
  }
  paths.set(`_claude/builds/reports/${b.id}.md`, 'build report');
  const branch = str(b.branch).trim(); const pr = str(b.pr).trim();
  const out = [];
  for (const [path, label] of paths) {
    let status = docStatusOnDisk(path); let where = status ? 'main' : '';
    if (!status && git && branch && (gitHas(`origin/${branch}`, path) || gitHas(branch, path))) { status = 'in development'; where = 'branch'; }
    if (!status) { if (!/README\.md$|reports\//.test(path)) continue; status = 'none'; }
    out.push({ label, path, status, where, ...(status === 'in development' ? { branch, pr } : {}), open: `md-studio.open:${path}` });
  }
  const rank = { 'in development': 0, merged: 1, draft: 2, none: 3 };
  return out.sort((x, y) => rank[x.status] - rank[y.status] || x.path.localeCompare(y.path));
}
/** One word for a build's docs as a whole: the best status any of its docs has, 'none' without any. */
export const docsStatus = (docs) => ['in development', 'merged', 'draft'].find((s) => docs.some((d) => d.status === s)) ?? 'none';

const check = (done) => (done ? '[x]' : '[ ]');
/** The part of a plan's body this plugin owns: what Brett said, the steps, Planned & fixes, docs. */
export function managedBlock(b, docs, { linkBase = '' } = {}) {
  const p = { done: (b.steps ?? []).filter((s) => s.done).length, total: (b.steps ?? []).length };
  const lines = [MARK_START, `## Build`, `\`${b.id}\` · ${b.status} · ${p.done}/${p.total} steps${b.branch ? ` · branch \`${b.branch}\`` : ''}${b.pr ? ` · PR ${b.pr}` : ''} · [open in the orchestrator](${t.linkTo(linkBase, b.id)})`];
  if (b.origin?.said) { lines.push('', '## Brett said (verbatim)', ...String(b.origin.said).split('\n').map((l) => `> ${l}`)); for (const [i, a] of (b.origin.addenda ?? []).entries()) if (a.said) lines.push('', `### Addendum ${i + 1}${a.at ? ` (${a.at.slice(0, 10)}${a.source ? `, ${a.source}` : ''})` : ''}`, ...String(a.said).split('\n').map((l) => `> ${l}`)); }
  lines.push('', '## Steps', ...(b.steps ?? []).map((s, i) => `- ${check(s.done)} ${i + 1}. ${t.stepTitle(s)} _(${s.model}${s.estimate ? `, ${s.estimate}` : ''}${s.skip ? ', skipped' : ''})_`));
  lines.push('', '## Planned & fixes', ...((b.fixes ?? []).length ? b.fixes.map((f) => `- ${check(f.done)} **${f.kind}:** ${f.text}${f.note ? ` — ${f.note}` : ''}${f.link ? ` ([link](${f.link}))` : ''} _(${f.at.slice(0, 10)}${f.by ? `, ${f.by}` : ''})_`) : ['_Nothing yet. Add one: `axf build-todo-sync fix-add --id ' + b.id + ' --text "…"`_']));
  lines.push('', '## Docs', ...(docs.length ? docs.map((d) => `- **${d.status}** [${d.label}](${d.path})${d.where === 'branch' ? ` _(on ${d.branch}${d.pr ? `, PR ${d.pr}` : ''})_` : ''}`) : ['_None expected._']), MARK_END);
  return lines.join('\n');
}
/** A body with the managed block replaced (or appended after the user's own text). */
export function withBlock(body, block) {
  const s = str(body, 200000); const a = s.indexOf(MARK_START); const e = s.indexOf(MARK_END);
  if (a >= 0 && e > a) return `${s.slice(0, a)}${block}${s.slice(e + MARK_END.length)}`;
  return `${s.trimEnd()}${s.trim() ? '\n\n' : ''}${block}\n`;
}

/** The plan a build should have, from the existing one (kept: Brett's own text, lists, links) or new. */
export function planForBuild(b, existing, { now = new Date().toISOString(), docs = [], linkBase = '' } = {}) {
  const profile = b.profiles?.[0] ?? 'main-framework';
  const p = existing && typeof existing === 'object' ? { ...existing } : { id: planIdFor(b), createdAt: now, createdBy: 'build-todo-sync', priority: 'P2', tags: [] };
  const ref = `${profile}:${b.id}`;
  const links = (p.links ?? []).filter((l) => !(l.kind === 'build' && l.ref === ref) && !(l.kind === 'doc' && l.by === 'build-todo-sync'));
  links.push({ kind: 'build', ref, label: 'Orchestrator build' });
  for (const d of docs) links.push({ kind: 'doc', ref: d.path, label: `${d.label} (${d.status})`, by: 'build-todo-sync', status: d.status });
  const comments = [...(p.comments ?? [])];
  for (const a of b.origin?.addenda ?? []) if (a.said && !comments.some((c) => c.text === a.said)) comments.push({ by: 'Brett', at: a.at || now, text: a.said, verbatim: true, source: a.source || '' });
  const total = (b.steps ?? []).length; const done = (b.steps ?? []).filter((s) => s.done).length;
  return {
    ...p,
    $axf: 'plan@1',
    title: t.listNameOf(b),
    summary: str(b.title, 2000),
    category: `Builds > ${b.category}`,
    status: p.status === 'dropped' && b.status !== 'archived' ? p.status : (PLAN_STATUS[b.status] ?? 'ready'),
    profile,
    steps: (b.steps ?? []).map((s) => ({ id: s.id, text: s.title || s.text, model: s.model, minutes: s.estimate, done: s.done, doneAt: s.doneAt, phase: s.phase })),
    links, comments,
    tags: [...new Set([...(p.tags ?? []), 'build', b.category.toLowerCase().replace(/\s+/g, '-')])],
    build: { ...(p.build ?? {}), profile, id: b.id, linkedAt: p.build?.linkedAt || now, status: b.status, progress: total ? Math.round((done / total) * 100) : 0 },
    body: withBlock(p.body, managedBlock(b, docs, { linkBase })),
    fixes: (b.fixes ?? []).map((f) => ({ id: f.id, text: f.text, kind: f.kind, done: f.done, doneAt: f.doneAt, by: f.by, at: f.at, note: f.note, link: f.link })),
    docs,
    docsStatus: docsStatus(docs),
  };
}
const planFingerprint = (p) => JSON.stringify({ title: p.title, summary: p.summary, category: p.category, status: p.status, steps: p.steps, links: p.links, comments: p.comments, build: { ...p.build, linkedAt: '' }, body: p.body, fixes: p.fixes, docs: p.docs, tags: p.tags });

/** Every mirrored build's plan: created when missing, refreshed when its managed parts changed. */
export function plansFor(input, store = loadStore()) {
  const now = typeof input.now === 'string' && input.now ? input.now : new Date().toISOString();
  const opts = input.opts && typeof input.opts === 'object' ? input.opts : {};
  const plans = Array.isArray(input.plans) ? input.plans : [];
  const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
  const out = [];
  for (const b of store.builds) {
    if (b.kind === 'epic' || b.deleted || (only && !only.has(b.id))) continue;
    if (!only && !t.placeOf(b, { now, completedDays: opts.completedDays }) && b.status !== 'built') continue;
    const existing = plans.find((p) => p?.build?.id === b.id) ?? plans.find((p) => p?.id === b.planRef) ?? plans.find((p) => (p?.links ?? []).some((l) => l.kind === 'build' && String(l.ref).endsWith(`:${b.id}`))) ?? null;
    const docs = docsFor(b, { git: opts.git !== false });
    const plan = planForBuild(b, existing, { now, docs, linkBase: opts.linkBase });
    const changed = !existing || planFingerprint(plan) !== planFingerprint({ ...existing, build: existing.build ?? {} });
    out.push({ buildId: b.id, planId: plan.id, created: !existing, changed, docsStatus: plan.docsStatus, plan: changed ? plan : null });
  }
  return { plans: out, summary: { builds: out.length, created: out.filter((x) => x.created).length, changed: out.filter((x) => x.changed).length } };
}

/** One build as the API shows it: names, place, steps, fixes, docs. */
export function buildView(store, id, { now = new Date().toISOString(), git = true, linkBase = '' } = {}) {
  const b = store.builds.find((x) => x.id === id || x.pendingId === id);
  if (!b) return null;
  const docs = docsFor(b, { git });
  return { id: b.id, displayName: t.listNameOf(b), title: b.title, category: b.category, area: b.area, nameReview: b.nameReview, status: b.status, place: t.placeOf(b, { now }), profiles: b.profiles, branch: b.branch, pr: b.pr, planId: planIdFor(b), planRef: b.planRef,
    said: b.origin?.said ?? '', addenda: b.origin?.addenda ?? [], link: t.linkTo(linkBase, b.id),
    steps: (b.steps ?? []).map((s, i) => ({ id: s.id, uid: s.uid, title: t.stepTitle(s), model: s.model, estimate: s.estimate, done: s.done, doneAt: s.doneAt, skip: s.skip, next: s.uid === t.nextOpenUid(b), item: t.itemFor(b, s, i, { linkBase, nextStepUid: t.nextOpenUid(b) }) })),
    fixes: b.fixes ?? [], docs, docsStatus: docsStatus(docs) };
}

export function stepOf(store, buildId, uid) {
  const b = store.builds.find((x) => x.id === buildId);
  const s = b?.steps.find((x) => x.uid === uid || x.id === uid);
  return b && s ? { build: { id: b.id, displayName: t.listNameOf(b), status: b.status, profiles: b.profiles }, step: s } : null;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const [cmd = 'builds', ...rest] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'plan') {
    const input = JSON.parse((await readStdin()) || '{}');
    const r = planFor(input);
    return out({ ok: true, ...r }, [`${r.summary.builds} build(s) in ${r.summary.groups} group(s): ${r.summary.ops} change(s) (${r.summary.adds} add, ${r.summary.sets} set, ${r.summary.removes} remove), ${r.drift.length} drift`, ...r.ops.map((o) => `  ${o.op.padEnd(6)} ${o.target.padEnd(13)} ${o.path ?? o.ref ?? ''}  ${o.why ?? ''}`), ...r.drift.map((d) => `  drift ${d.kind} ${d.build}${d.stepId ? ` ${d.stepId}` : ''}`)].join('\n'));
  }
  if (cmd === 'names') { const l = needingNames(loadStore(), { all: rest.includes('--all') }); return out({ ok: true, builds: l }, l.length ? l.map((b) => `${b.id.padEnd(34)} "${b.displayName}" (${b.category})  ← ${b.title.slice(0, 60)}`).join('\n') : 'Every build has a confirmed name.'); }
  if (cmd === 'suggest') { const d = rest.indexOf('--detail'); const title = (d >= 0 ? rest.filter((_, i) => i !== d && i !== d + 1) : rest).join(' '); const s = suggest(title, d >= 0 ? rest[d + 1] : ''); return out({ ok: true, ...s }, `"${s.displayName}" · ${s.category} (${s.confidence}: ${s.why})`); }
  if (cmd === 'builds') { const l = mirroredBuilds(loadStore()); return out({ ok: true, builds: l }, l.map((b) => `${b.place.padEnd(17)} ${b.displayName.padEnd(40)} ${b.done}/${b.steps}  ${b.id}`).join('\n') || 'Nothing to mirror.'); }
  if (cmd === 'step') { const r = stepOf(loadStore(), rest[0], rest[1]); if (!r) throw new Error(`no step ${rest[1]} in ${rest[0]}`); return out({ ok: true, ...r }, `${r.build.id} ${r.step.id}: ${r.step.text} (${r.step.done ? 'done' : 'open'})`); }
  if (cmd === 'plans') {
    const input = JSON.parse((await readStdin()) || '{}');
    const r = plansFor(input);
    return out({ ok: true, ...r }, [`${r.summary.builds} plan(s): ${r.summary.created} new, ${r.summary.changed} changed`, ...r.plans.map((p) => `  ${p.changed ? (p.created ? 'new    ' : 'changed') : 'same   '} ${p.planId.padEnd(40)} ${p.buildId}  docs: ${p.docsStatus}`)].join('\n'));
  }
  if (cmd === 'docs') { const s = loadStore(); const b = s.builds.find((x) => x.id === rest[0]); if (!b) throw new Error(`no build ${rest[0]}`); const docs = docsFor(b, { git: !rest.includes('--no-git') }); return out({ ok: true, build: b.id, docs, status: docsStatus(docs) }, docs.map((d) => `${d.status.padEnd(15)} ${d.path}${d.branch ? ` (${d.branch})` : ''}`).join('\n') || 'no docs expected'); }
  if (cmd === 'build') { const v = buildView(loadStore(), rest[0], { git: !rest.includes('--no-git') }); if (!v) throw new Error(`no build ${rest[0]}`); return out({ ok: true, build: v }, `${v.displayName} (${v.id}) · ${v.category} · ${v.status} · ${v.steps.filter((s) => s.done).length}/${v.steps.length} steps · ${v.fixes.filter((f) => f.done).length}/${v.fixes.length} fixes · docs ${v.docsStatus}`); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message); process.exitCode = 1; });
}
