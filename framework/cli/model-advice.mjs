#!/usr/bin/env node
/**
 * model-advice — the model & thinking audit (model-advice@1). Brett, Nov 4 2026: "Go through my list of things that can
 * be done and see what should be redone with Fable and put that next to it, and put the level of thinking that it should
 * be on." Runs the engine (framework/core/model-advice.mjs) over every build and step of every profile in the one builds
 * store, every Plan Studio plan and every queued / running headless build, writes the recommendation next to each item
 * (the store, the plan files) and the report. Recommendations only: nothing here changes a model; Apply and Dismiss go
 * through the orchestrator and need Brett.
 *
 *   node framework/cli/model-advice.mjs audit [--write] [--force] [--json]   every build + step, every profile (writes the store with --write)
 *   node framework/cli/model-advice.mjs plans [--write] [--json]             Plan Studio plans (plan@1 files)
 *   node framework/cli/model-advice.mjs queue [--json]                       queued + running headless builds, from their briefs
 *   node framework/cli/model-advice.mjs report [--out <file>]                the Markdown report (default _claude/builds/reports/model-thinking-audit.md)
 *   node framework/cli/model-advice.mjs show <build> [--json]                one build with its steps and why
 *   node framework/cli/model-advice.mjs set-thinking <build> [<step>] <level>
 *   node framework/cli/model-advice.mjs apply <build> [<step>] | dismiss <build> [<step>]    (Brett only: a session is refused)
 *
 * Curated overrides (pinned, never overwritten by a plain audit): _claude/builds/model-advice.json
 *   { $axf: 'model-advice-overrides@1', builds: { <id>: { recommendedModel, recommendedThinking, verdict, modelWhy, adviceCost?, steps?: { <stepId>: {…} } } },
 *     picks: [{ id, why }] }   picks = the top "redo on Fable" list in the report
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../core/model-advice.mjs';
import * as core from '../plan/builds-store-core.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { REPO_ROOT } from './persist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERRIDES = join(REPO_ROOT, '_claude/builds/model-advice.json');
const REPORT = join(REPO_ROOT, '_claude/builds/reports/model-thinking-audit.md');
const ORCH = join(REPO_ROOT, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs'); // axf-plugin:build-orchestrator
const PLANS = join(REPO_ROOT, 'apps/console-web/plugins/plan-studio/plans.mjs'); // axf-plugin:plan-studio
const SLOTS = join(HERE, 'agent-slots.mjs');
const nowIso = () => new Date().toISOString();
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

export function readOverrides(file = OVERRIDES) {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return { builds: j?.builds && typeof j.builds === 'object' ? j.builds : {}, picks: Array.isArray(j?.picks) ? j.picks : [] }; } catch { return { builds: {}, picks: [] }; }
}

/** The engine's advice for one build, with the curated override (pinned) on top. */
export function adviceFor(b, overrides = readOverrides().builds) {
  const a = A.adviseBuild(b);
  const o = overrides[b.id];
  if (!o) return { ...a, pinned: false };
  const { steps: os, ...ob } = o;
  const out = { ...a, ...A.adviceRecord({ ...a, ...ob }, { build: true }), pinned: true };
  if (os && typeof os === 'object') out.steps = a.steps.map((s) => (os[s.id] ? { ...s, ...A.adviceRecord({ ...s, ...os[s.id] }), pinned: true } : s));
  return out;
}

/** Put the advice on a record (in place). Pinned records are left alone unless `force`. */
export function putAdvice(b, a, { now = nowIso(), force = false } = {}) {
  let n = 0;
  const put = (target, src, build) => {
    if (target.advicePinned && !force && !src.pinned) return false;
    const rec = A.adviceRecord({ ...src, adviceAt: now, advicePinned: src.pinned ? true : undefined }, { build });
    if (!src.pinned) delete rec.advicePinned;
    const before = JSON.stringify(A.adviceRecord(target, { build }));
    for (const k of (build ? A.BUILD_RECORD_FIELDS : A.STEP_RECORD_FIELDS)) if (k !== 'thinking' && k !== 'reviewOk') delete target[k];
    Object.assign(target, rec);
    if (!src.pinned) delete target.advicePinned;
    return JSON.stringify(A.adviceRecord(target, { build })) !== before;
  };
  if (put(b, a, true)) n += 1;
  for (const sa of a.steps ?? []) { const st = b.steps.find((x) => (sa.uid && x.uid === sa.uid) || x.id === sa.id); if (st && put(st, sa, false)) n += 1; }
  return n;
}

// ------------------------------------------------------------------ builds (every profile)

export function auditBuilds(store, { overrides = readOverrides().builds } = {}) {
  const rows = [];
  for (const b of store.builds.filter((x) => !x.deleted)) {
    const a = adviceFor(b, overrides);
    const view = A.buildView({ ...b, ...A.adviceRecord(a, { build: true }), steps: b.steps.map((s) => ({ ...s, ...A.adviceRecord(a.steps.find((x) => x.uid === s.uid || x.id === s.id) ?? {}) })) });
    rows.push({ id: b.id, title: b.title, status: b.status, profiles: b.profiles, category: b.category, createdAt: b.createdAt, mergedAt: b.mergedAt ?? '', pr: b.pr, steps: b.steps.length, pinned: a.pinned, ...view, stepRows: b.steps.map((s) => { const sa = a.steps.find((x) => x.uid === s.uid || x.id === s.id) ?? {}; return { id: s.id, text: s.title || s.text, done: s.done, ...A.stepView({ ...s, ...A.adviceRecord(sa) }) }; }) });
  }
  return rows;
}

export function writeBuilds({ force = false, overrides = readOverrides().builds } = {}) {
  let n = 0; let builds = 0;
  const r = withStore((s) => { for (const b of s.builds.filter((x) => !x.deleted)) { const k = putAdvice(b, adviceFor(b, overrides), { force }); if (k) { n += k; builds += 1; } } return s; }, { by: process.env.AXF_SESSION || 'model-advice', action: 'advise', note: `model & thinking audit: ${builds} build(s), ${n} record(s)` });
  return { builds, records: n, rev: r.rev };
}

// ------------------------------------------------------------------ Plan Studio plans

async function plansModule() { return import(PLANS); }
const PLAN_DONE = { done: 'complete', dropped: 'archived', building: 'running' };
export function planAsBuild(p) {
  return { id: p.id, title: p.title, category: p.category, detail: [p.summary, p.body].filter(Boolean).join('\n').slice(0, 6000), status: PLAN_DONE[p.status] ?? 'pending', thinking: p.thinking,
    recommendedModel: p.recommendedModel, recommendedThinking: p.recommendedThinking, modelWhy: p.modelWhy, verdict: p.verdict, adviceCost: p.adviceCost, reviewOk: p.reviewOk,
    steps: (p.steps ?? []).map((s, i) => ({ id: s.id || `s${i + 1}`, uid: s.id || `s${i + 1}`, text: s.text, model: s.model === 'Fable' ? 'Fable' : 'Opus', estimate: s.minutes ? `${s.minutes} min` : '', done: !!s.done, thinking: s.thinking, recommendedModel: s.recommendedModel, recommendedThinking: s.recommendedThinking, modelWhy: s.modelWhy, reviewOk: s.reviewOk })) };
}
export async function auditPlans({ write = false, overrides = readOverrides().builds } = {}) {
  const m = await plansModule();
  const rows = [];
  for (const p of m.loadPlans()) {
    const b = planAsBuild(p);
    const a = adviceFor(b, overrides);
    const rec = A.adviceRecord({ ...a, adviceAt: nowIso(), advicePinned: a.pinned ? true : undefined }, { build: true });
    const next = { ...p, ...rec, steps: (p.steps ?? []).map((s, i) => ({ ...s, ...A.adviceRecord({ ...(a.steps.find((x) => x.id === (s.id || `s${i + 1}`)) ?? {}), adviceAt: rec.adviceAt }) })) };
    const view = A.buildView(planAsBuild(next));
    rows.push({ id: p.id, title: p.title, status: p.status, priority: p.priority, category: p.category, steps: (p.steps ?? []).length, pinned: a.pinned, ...view });
    if (write && JSON.stringify(A.adviceRecord(p, { build: true })) !== JSON.stringify(A.adviceRecord(next, { build: true }))) m.savePlan(next, { by: 'model-advice', kind: 'save', note: `Model & thinking recommendation: ${view.recommendedModel} · ${view.recommendedThinking}`, force: true });
  }
  return rows;
}

// ------------------------------------------------------------------ the headless queue (agent-slots) from the briefs

const TITLE_RE = /^#\s*(?:Build|RESUME):\s*([^\s(]+)\s*(?:\(([^)]*)\))?/im;
export function parseBriefHead(text) {
  const m = TITLE_RE.exec(str(text, 2000)) ?? [];
  const head = str(m[2], 200);
  const model = /fable/i.test(head) ? 'Fable' : /opus/i.test(head) ? 'Opus' : '';
  const thinking = A.normThinking((/(low|medium|high|max)(?:-high)?\s*thinking/i.exec(head) ?? [])[1] ?? '');
  return { name: str(m[1], 80), stated: head, model, thinking };
}
export function auditQueue({ store = null } = {}) {
  let st; try { st = JSON.parse(execFileSync('node', [SLOTS, 'status', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return []; }
  const rows = [];
  for (const r of [...(st.running ?? []), ...(st.queue ?? st.waiting ?? [])]) {
    let brief = ''; try { brief = readFileSync(join(r.cwd ?? '', '.brief.md'), 'utf8'); } catch { /* no brief */ }
    const head = parseBriefHead(brief);
    const spec = /RESUME:\s*\S+[\s\S]*?brief[^\n]*?`([^`]+\.brief\.md)`/i.exec(brief)?.[1] ?? '';
    let specText = ''; if (spec) { try { specText = readFileSync(spec, 'utf8'); } catch { /* gone */ } }
    const c = A.classify(str(specText || brief, 6000).replace(/^#.*$/m, ''), { title: head.name });
    const b = store?.builds.find((x) => !x.deleted && (x.id === head.name || x.id === r.name || x.id === head.name.replace(/-r\d+$/, '')));
    const model = head.model || (b ? A.currentModel(b) : 'Opus'); const thinking = head.thinking || (b ? A.currentThinking(b) : A.defaultThinking(model));
    const view = { model, thinking, recommendedModel: c.model, recommendedThinking: c.thinking, modelWhy: c.why, reviewStatus: '' };
    view.reviewStatus = A.reviewStatus({ recommendedModel: c.model, recommendedThinking: c.thinking }, view);
    rows.push({ name: r.name, state: r.state, position: r.position, agent: r.session?.split('--').pop() ?? '', build: b?.id ?? '', stated: head.stated, ...view, kind: c.kind });
  }
  return rows;
}

// ------------------------------------------------------------------ the report

const esc = (s) => str(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (s, n = 90) => { const x = esc(s); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const icon = (r) => (r.reviewStatus === 'look' ? '⚠️' : '✅');
const cost = (c) => (c && (c.usd || c.minutes) ? `~$${c.usd} / ${c.minutes} min` : '');
const cur = (r) => `${r.model} · ${r.thinking}`;
const rec = (r) => `${r.recommendedModel} · ${r.recommendedThinking}`;
const STATUS_ORDER = ['running', 'waiting', 'blocked', 'failed', 'pending', 'built', 'complete', 'archived'];

export function reportMarkdown({ builds, plans, queue, picks, at = nowIso() }) {
  const live = builds.filter((b) => b.status !== 'archived');
  const built = live.filter((b) => A.FINISHED.includes(b.status) && b.verdict);
  const open = live.filter((b) => !A.FINISHED.includes(b.status) || !b.verdict);
  const archived = builds.filter((b) => b.status === 'archived');
  const count = (list, f) => list.filter(f).length;
  const byVerdict = (v) => count(built, (b) => b.verdict === v);
  const lines = [];
  lines.push('# Model & thinking audit (model-thinking-audit)', '', `Generated ${at} by \`node framework/cli/model-advice.mjs report\` (engine: \`framework/core/model-advice.mjs\`, model-advice@1). Brett, Nov 4 2026: "Go through my list of things that can be done and see what should be redone with Fable and put that next to it, and put the level of thinking that it should be on."`, '',
    'Rule of thumb: foundation or contract work = **Fable, high or max**. Plugins and screens = **Opus, medium**. Wording, small fixes and landing PRs = **Opus, low**. Gnarly debugging or architecture inside a plugin = **Opus, high**. ✅ = all set (on its recommendation, or Brett OK\'d it as is) · ⚠️ = needs a look (the recommendation differs, or built work to review / redo). Recommendations only: nothing changed model; Apply and Dismiss are Brett\'s (console: the icon\'s why-panel; CLI: `model-advice.mjs apply|dismiss`).', '');
  lines.push('## Summary', '', '| | Count |', '|---|---|', `| Builds in the store (all profiles, not archived) | ${live.length} |`, `| … built work: keep | ${byVerdict('keep')} |`, `| … built work: Fable review | ${byVerdict('fable-review')} |`, `| … built work: redo on Fable | ${byVerdict('redo-on-fable')} |`, `| … open work that should move to Fable | ${count(open, (b) => b.recommendedModel === 'Fable' && b.model !== 'Fable')} |`, `| … open work on Fable that is Opus work | ${count(open, (b) => b.recommendedModel === 'Opus' && b.model === 'Fable')} |`, `| … needs a look (⚠️) | ${count(live, (b) => b.reviewStatus === 'look')} |`, `| Steps needing a look | ${live.reduce((t, b) => t + b.stepsToLook, 0)} |`, `| Plan Studio plans | ${plans.length} (⚠️ ${count(plans, (p) => p.reviewStatus === 'look')}) |`, `| Queued / running headless builds | ${queue.length} (⚠️ ${count(queue, (q) => q.reviewStatus === 'look')}) |`, `| Archived builds (listed at the end) | ${archived.length} |`, '');
  lines.push('## Top 5: redo on Fable', '', 'Curated picks (`_claude/builds/model-advice.json` → `picks`), with the engine\'s cost. The `fable-review-nov3` build consumes this list; nothing is redone from here.', '', '| # | Build | PR | Why | Cost |', '|---|---|---|---|---|');
  const pickRows = picks.length ? picks : built.filter((b) => b.verdict === 'redo-on-fable').sort((a, b) => (b.adviceCost?.usd ?? 0) - (a.adviceCost?.usd ?? 0)).slice(0, 5).map((b) => ({ id: b.id, why: b.modelWhy }));
  pickRows.forEach((p, i) => { const b = builds.find((x) => x.id === p.id); lines.push(`| ${i + 1} | \`${p.id}\`${b ? ` ${short(b.title, 60)}` : ''} | ${b?.pr ?? ''} | ${esc(p.why)} | ${b ? cost(b.adviceCost) : ''} |`); });
  lines.push('', '## What this audit built, and what is left', '',
    '- **Engine** `framework/core/model-advice.mjs` (model-advice@1): classifier, build verdicts with cost, review status (the check / the triangle), filters, why-panel lines; fixture `framework/spec/fixtures/model-advice.json`, check `framework/spec/check-model-advice.mjs` (CI). Kotlin twin: deferred (Android on hold, `framework/spec/PORTING.md`).',
    '- **Store** (builds@1): `thinking`, `recommendedModel`, `recommendedThinking`, `modelWhy`, `verdict`, `adviceCost`, `reviewOk` on every build and step; every projection and read (orchestrator, Pending, queue, Builds page, control@1 `planner.builds`, `pending_list`, `build_queue`, crew) carries `model`, `thinking`, `recommendedModel`, `recommendedThinking`, `reviewStatus`. Sidecar `_claude/builds/advice.json` (healed on read, folded on write, merged by the live publish) so older code can\'t drop it.',
    '- **Orchestrator actions:** `advise`, `set-thinking`; `apply-advice`, `dismiss-advice`, `apply-advice-all` are Brett\'s only (same approver gate as a model upgrade). Plan Studio plans carry the same fields (`model-advice.mjs plans --write`).',
    '- **Launcher:** a step\'s thinking level becomes `claude --effort` (`AXF_THINKING`; `deploy/claude-headless.sh`, build_start / `launchCommand`). Briefs already name the level in their title line; the launcher now honours it.',
    '- **Console:** one component (`framework/react/components/ModelAdvice.tsx`): model + thinking chips, green check / yellow triangle, right-click or long-press → the row expands with why + Apply / Dismiss; shown on Build manager, Builds (Builds + Steps views), Pending builds, Build queue, Build orchestrator (grid, list, step grid), Plan Studio, Crew (rows + steps), Home (build summary card), Codebase changes. Settings → Builds → Show model & thinking (global; mirrored to the Claude setting `builds.showModelThinking`) + a per-screen override; filters (model, thinking, check / triangle, Needs a look, Fable candidates) shared by every list; voice: `model-advice.show`, `model-advice.filter`, `model-advice.screen`.',
    '- **Follow-ups:** Requests ledger (#310) and Git board (#291) are not on main yet: when they land, give their rows `<ModelChips screen="requests" | "git">` (the settings overrides already exist). Molly and axHub web show no build lists of their own (Molly embeds the console). The `fable-review-nov3` build consumes this list: `plugin-settings-placement` (its s2) is already covered by `settings-placement-everywhere` s2 on Fable. `apps/walkthrough-studio/_claude/shared/rules/RULES.md` is a synced rules copy that the plugin-lifecycle check flags as stale references (pre-existing, not from this build). `npx -y tsx framework/spec/gen-fixtures.mts` on main also rewrites `agent-card.json` / `widgets.json` (pre-existing drift, left alone).',
    '');
  const table = (title, list, { verdict = false, note = '' } = {}) => {
    lines.push(`## ${title} (${list.length})`, '');
    if (note) lines.push(note, '');
    lines.push(`| | Build | Status | Now | Recommended | ${verdict ? 'Verdict | ' : ''}Why | Cost |`, `|---|---|---|---|---|${verdict ? '---|' : ''}---|---|`);
    for (const b of list) lines.push(`| ${icon(b)} | \`${b.id}\` ${short(b.title, 70)}${b.pinned ? ' 📌' : ''} | ${b.status}${b.pr ? ` ${esc(b.pr)}` : ''} | ${cur(b)} | ${rec(b)} | ${verdict ? `${A.VERDICT_LABEL[b.verdict] ?? b.verdict ?? ''} | ` : ''}${short(b.modelWhy, 160)} | ${cost(b.adviceCost)} |`);
    lines.push('');
  };
  const sorted = (list) => [...list].sort((a, b) => (a.reviewStatus === 'look' ? 0 : 1) - (b.reviewStatus === 'look' ? 0 : 1) || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.createdAt > a.createdAt ? 1 : -1));
  table('Built work: keep, Fable review or redo on Fable', sorted(built), { verdict: true, note: 'Every finished build in the store (every profile), newest first within ⚠️ / ✅. Verdict = keep (nothing foundation ran on Opus), Fable review (some did: read on Fable, fix only what is wrong), redo on Fable (a kernel / migration step ran on Opus, or most of the build is foundation work).' });
  table('Open work: queued, pending, running, built-awaiting-merge', sorted(open), { note: 'Now = the model and thinking its next step runs on. Recommended = what the audit says. Cost = the Fable extra over Opus for the open steps that should move.' });
  lines.push('## Steps that need a look', '', 'Every step whose model or thinking differs from its recommendation (the same ⚠️ shows on the step row in every list).', '', '| Build | Step | Done | Now | Recommended | Why |', '|---|---|---|---|---|---|');
  for (const b of sorted(live)) for (const s of b.stepRows.filter((x) => x.reviewStatus === 'look')) lines.push(`| \`${b.id}\` | ${s.id} ${short(s.text, 70)} | ${s.done ? '✓' : ''} | ${cur(s)} | ${rec(s)} | ${short(s.modelWhy, 120)} |`);
  lines.push('');
  lines.push(`## Plan Studio plans (${plans.length})`, '', 'plan@1 files carry the same fields (`recommendedModel`, `recommendedThinking`, `modelWhy`); Plan Studio shows the chips.', '', '| | Plan | Status | Now | Recommended | Why |', '|---|---|---|---|---|---|');
  for (const p of plans) lines.push(`| ${icon(p)} | \`${p.id}\` ${short(p.title, 70)} | ${p.status} | ${cur(p)} | ${rec(p)} | ${short(p.modelWhy, 140)} |`);
  lines.push('');
  lines.push(`## Queued and running headless builds (${queue.length})`, '', 'From the agent-slots queue and each run\'s brief (its title line states the model and thinking it was launched with). Now = what the brief says (else the store build); Recommended = the engine on the brief.', '', '| | Run | State | Agent | Brief says | Now | Recommended | Why |', '|---|---|---|---|---|---|---|---|');
  for (const q of queue) lines.push(`| ${icon(q)} | \`${q.name}\`${q.build && q.build !== q.name ? ` (${q.build})` : ''} | ${q.state}${q.position ? ` #${q.position}` : ''} | ${esc(q.agent)} | ${short(q.stated, 60)} | ${cur(q)} | ${rec(q)} | ${short(q.modelWhy, 120)} |`);
  lines.push('');
  lines.push('<details><summary>Archived builds (' + archived.length + ')</summary>', '', '| | Build | Now | Recommended | Verdict | Why |', '|---|---|---|---|---|---|');
  for (const b of archived) lines.push(`| ${icon(b)} | \`${b.id}\` ${short(b.title, 60)} | ${cur(b)} | ${rec(b)} | ${A.VERDICT_LABEL[b.verdict] ?? ''} | ${short(b.modelWhy, 120)} |`);
  lines.push('', '</details>', '');
  return lines.join('\n');
}

// ------------------------------------------------------------------ CLI

const line = (r) => `${r.reviewStatus === 'look' ? '!' : ' '} ${String(r.id ?? r.name).padEnd(36)} ${String(r.status ?? r.state ?? '').padEnd(9)} ${cur(r).padEnd(15)} → ${rec(r).padEnd(15)} ${(r.verdict ? A.VERDICT_LABEL[r.verdict] : '').padEnd(13)} ${short(r.modelWhy, 90)}`;

async function main(argv) {
  const json = argv.includes('--json'); const write = argv.includes('--write'); const force = argv.includes('--force');
  const args = argv.filter((a) => !a.startsWith('--'));
  const outArg = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : '';
  const [cmd = 'audit', ...rest] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o, null, 1) : text);
  if (cmd === 'audit') {
    const w = write ? writeBuilds({ force }) : null;
    const rows = auditBuilds(loadStore());
    const live = rows.filter((r) => r.status !== 'archived');
    return out({ ok: true, written: w, builds: rows }, [...live.map(line), '', `${live.length} builds (${rows.length} with archived) · ⚠️ ${live.filter((r) => r.reviewStatus === 'look').length} need a look · ${live.filter((r) => r.verdict === 'redo-on-fable').length} redo on Fable · ${live.filter((r) => r.verdict === 'fable-review').length} Fable review${w ? ` · written: ${w.builds} build(s), ${w.records} record(s), store rev ${w.rev}` : ' · dry run (add --write to put it on the builds)'}`].join('\n'));
  }
  if (cmd === 'plans') { const rows = await auditPlans({ write }); return out({ ok: true, written: write, plans: rows }, [...rows.map(line), '', `${rows.length} plan(s)${write ? ' written' : ' · dry run (add --write)'}`].join('\n')); }
  if (cmd === 'queue') { const rows = auditQueue({ store: loadStore() }); return out({ ok: true, queue: rows }, rows.map((r) => `${r.reviewStatus === 'look' ? '!' : ' '} ${r.name.padEnd(30)} ${String(r.state).padEnd(8)} says: ${short(r.stated, 40).padEnd(42)} now ${cur(r).padEnd(14)} → ${rec(r)}`).join('\n') || 'Nothing queued or running.'); }
  if (cmd === 'report') {
    const store = loadStore(); const ov = readOverrides();
    const md = reportMarkdown({ builds: auditBuilds(store, { overrides: ov.builds }), plans: await auditPlans({ overrides: ov.builds }), queue: auditQueue({ store }), picks: ov.picks });
    const file = outArg ? resolve(outArg) : REPORT; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, md);
    return out({ ok: true, file }, `wrote ${file} (${md.split('\n').length} lines)`);
  }
  if (cmd === 'show') {
    const b = core.findBuild(loadStore(), rest[0]); if (!b) throw new Error(`no build "${rest[0]}"`);
    const v = A.buildView(b);
    return out({ ok: true, build: { id: b.id, ...v }, steps: b.steps.map((s) => ({ id: s.id, text: s.title || s.text, done: s.done, ...A.stepView(s) })), why: A.whyLines(v) }, [`${b.id}: ${b.title}`, ...A.whyLines(v).map((l) => `  ${l.label}: ${l.text}`), '  steps:', ...b.steps.map((s) => { const sv = A.stepView(s); return `   ${sv.reviewStatus === 'look' ? '!' : ' '} ${s.id.padEnd(6)} ${s.done ? '✓' : ' '} ${cur(sv).padEnd(15)} → ${rec(sv).padEnd(15)} ${short(s.title || s.text, 70)}${sv.modelWhy ? ` — ${short(sv.modelWhy, 80)}` : ''}`; })].join('\n'));
  }
  if (cmd === 'set-thinking' || cmd === 'apply' || cmd === 'dismiss') {
    const [id, a, b] = rest; const level = cmd === 'set-thinking' ? (b ?? a) : ''; const step = cmd === 'set-thinking' ? (b ? a : '') : a;
    const change = cmd === 'set-thinking' ? { action: 'set-thinking', id, step, thinking: level } : { action: cmd === 'apply' ? 'apply-advice' : 'dismiss-advice', id, ...(step ? { step } : {}) };
    const r = JSON.parse(execFileSync('node', [ORCH, 'act', JSON.stringify(change), '--json'], { encoding: 'utf8', cwd: REPO_ROOT }).trim().split('\n').pop());
    if (!r.ok) throw new Error(r.error);
    return out(r, r.log.join('\n'));
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message); process.exitCode = 1; });
}
