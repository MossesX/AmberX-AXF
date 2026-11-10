/**
 * main-check-core.mjs — the orchestrator's one-build check against main (pure; IO side: main-check.mjs).
 *
 * Brett, Nov 10 2026: "Instead of checking all the pending against main, just have the orchestrator check each one at a
 * time before it puts it in the queue." Right before a build moves into the Queue (and again at dispatch) the orchestrator
 * looks at that one build against main and decides:
 *   done        every open step has evidence on main (or it landed with nothing open): every step is ticked, the build
 *               is closed and archived with the PR / commit. A merged PR or a landed branch alone never closes a build
 *               with open steps (a multi-phase build lands phase 1 first): it only lends its files as evidence
 *   partial     some open steps already have evidence on main: those are ticked, only what is left is queued
 *   superseded  another landed build (Shipped features ledger or the store) is the same work: archived with the reason
 *   open        nothing found: queue as is
 *   unknown     main could not be read (no git): queue as is, never block on the check
 * Plain code decides; the AI pass (settings.mainCheck = 'ai') is asked only when code finds nothing, and its answer can
 * only tick steps or close the build when it cites a commit that is on main.
 *
 * Evidence (gathered by main-check.mjs):
 *   { main: sha, manifest: {id, pr, landedCommit, doneSteps[]} | null, mergedPr: {number, commit} | null,
 *     landed: {commit, files[]} | null,        the build's branch head is on main (and the files its own commits touched)
 *     paths: { [path]: { onMain, addedAt } },  every repo path an open step names
 *     ledger: [{ build, title, landedAt, landedCommit, pr, source: 'shipped'|'store' }] }
 */

export const VERDICTS = ['done', 'partial', 'superseded', 'open', 'unknown'];
export const MODES = ['code', 'ai', 'off'];
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const ms = (v) => { const t = Date.parse(str(v, 40)); return Number.isFinite(t) ? t : NaN; };
/** a happened at or after b (both ISO-ish dates; false when either is missing) */
const notBefore = (a, b) => ms(a) >= ms(b);

const PATH_RE = /(?:^|[\s`'"(\[])((?:apps|framework|deploy|_claude|docs|axhub|tools|scripts|packages)\/[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)/g;
/** Repo paths a step's text names (the files it would touch), deduplicated, in order. */
export function pathsOf(text) {
  const out = []; let m; PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(str(text, 4000)))) { const p = m[1].replace(/[.,;:)\]]+$/, ''); if (!p.includes('<') && !out.includes(p)) out.push(p); }
  return out;
}

const CREATE = /\b(add|adds|adding|create|creates|creating|write|writes|writing|new|scaffold|ship|ships)\b[^.;:]{0,50}$/i;
const REFER = /\b(reuse|reuses|read|reads|existing|extend|extends|like|see|from|in|into|per|via|change|changes|update|updates|edit|fix)\b[^.;:]{0,12}$/i;
/** The paths a step says it creates ("add `x`", "write x", "new x"): only these count as done when they appear on main. */
export function createdPathsOf(text) {
  const t = str(text, 4000); const out = []; let m; PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(t))) {
    const p = m[1].replace(/[.,;:)\]]+$/, ''); if (p.includes('<') || out.includes(p)) continue;
    const before = t.slice(Math.max(0, m.index - 60), m.index + m[0].indexOf(m[1])).replace(/[`'"(\[]/g, ' ');
    if (CREATE.test(before) && !REFER.test(before)) out.push(p);
  }
  return out;
}
/** A step only Brett can do (a decision, a review): never ticked from evidence. */
export const isBrettStep = (s) => /^\s*BRETT\b/.test(s?.text ?? '');

/** The closing step every build ends with ("Tests green, report _claude/builds/reports/<id>.md, THREADS row, commit, push, PR"). */
export const isWrapUpStep = (s) => /\bPR\b|pull request|merge queue/i.test(s?.text ?? '') && /\b(tests?|report|gates?|push|deploy|screenshots|shots)\b/i.test(s?.text ?? '');
export const reportPathOf = (b) => `_claude/builds/reports/${str(b?.id, 80)}.md`;

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'when', 'what', 'each', 'every', 'only', 'its', 'are', 'not', 'one', 'all', 'build', 'builds', 'make', 'add', 'fix', 'new', 'use', 'via', 'out', 'any', 'has', 'have', 'should', 'must', 'can', 'will', 'just']);
/** Meaningful words of a title (lower case, 3+ letters, stop words out). */
export function words(title) { return [...new Set(str(title, 400).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))]; }
/** Jaccard similarity of two titles' words (0..1). */
export function similarity(a, b) {
  const x = new Set(words(a)); const y = new Set(words(b)); if (!x.size || !y.size) return 0;
  let both = 0; for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}
export const SUPERSEDE_AT = 0.8;
const MIN_WORDS = 4;

/**
 * Which open steps have evidence on main: [{ id, why }].
 *   a step that names repo paths: every path was changed by the landed branch, or every path it says it creates
 *   ("add / create / write / new x") was added on main after the build was filed; a step for Brett (BRETT …) never
 *   a step the build's shipped manifest lists as done (same text)
 *   the wrap-up step (tests / report / gates + PR / merge queue): the build landed and every other open step has evidence
 */
export function stepEvidence(b, ev) {
  const created = str(b?.createdAt, 40);
  const landedFiles = new Set(list(ev?.landed?.files));
  const shippedDone = new Set(list(ev?.manifest?.doneSteps).map((t) => str(t, 2000).trim().toLowerCase()));
  const open = list(b?.steps).filter((s) => !s.done && !s.skip);
  const out = [];
  for (const s of open) {
    if (shippedDone.has(str(s.text, 2000).trim().toLowerCase())) { out.push({ id: s.id, why: `done in the shipped manifest ${ev.manifest.id}` }); continue; }
    if (isWrapUpStep(s) || isBrettStep(s)) continue;
    // the landed branch: every path the step names was changed by it; else main: every path the step creates was added
    // after the build was filed (a path it only reads or reuses is no evidence)
    const named = pathsOf(s.text); const made = createdPathsOf(s.text);
    const why = [];
    if (named.length && landedFiles.size && named.every((p) => landedFiles.has(p))) why.push(...named.map((p) => `${p} changed by the landed branch`));
    else if (made.length && made.every((p) => ev?.paths?.[p]?.onMain && notBefore(ev.paths[p].addedAt, created))) why.push(...made.map((p) => `${p} added on main ${ev.paths[p].addedAt.slice(0, 10)}`));
    if (why.length) out.push({ id: s.id, why: why.join('; ') });
  }
  const wrap = open.filter((s) => isWrapUpStep(s) && !out.some((t) => t.id === s.id));
  const landedAt = landingOf(ev);
  // the wrap-up (tests, report, PR) is what a landing proves: ticked once the build landed and nothing else is left
  if (wrap.length && landedAt && out.length + wrap.length === open.length) for (const s of wrap) out.push({ id: s.id, why: `landed (${landedAt.label})${ev?.paths?.[reportPathOf(b)]?.onMain ? `, ${reportPathOf(b)} on main` : ''}` });
  return out;
}

/** How the build reached main, or null: its shipped manifest, a merged PR, or its branch head on main. */
export function landingOf(ev) {
  if (ev?.manifest) return { label: `Shipped features ${ev.manifest.id}`, pr: ev.manifest.pr || 0, commit: ev.manifest.landedCommit || '' };
  if (ev?.mergedPr) return { label: `PR #${ev.mergedPr.number} merged`, pr: ev.mergedPr.number, commit: ev.mergedPr.commit || '' };
  if (ev?.landed?.commit) return { label: `branch landed ${ev.landed.commit.slice(0, 9)}`, pr: 0, commit: ev.landed.commit };
  return null;
}

/** The landed build in the ledger this one duplicates, or null. Same build id never counts. */
export function supersededBy(b, ledger) {
  if (words(b?.title).length < MIN_WORDS) return null;
  const created = str(b?.createdAt, 40);
  let best = null;
  for (const e of list(ledger)) {
    if (!e || e.build === b.id) continue;
    // no landing time, or landed before this build was filed (Brett asked again on purpose): not a duplicate
    if (!e.landedAt || (created && ms(e.landedAt) < ms(created))) continue;
    const sim = similarity(b.title, e.title);
    if (sim >= SUPERSEDE_AT && (!best || sim > best.sim)) best = { ...e, sim: Math.round(sim * 100) / 100 };
  }
  return best;
}

/**
 * The verdict for one build: { verdict, why, ticks: [{id, why}], pr, commit, by }.
 * `ai` (optional) = the AI pass's parsed answer { verdict, steps[], commit, why } — used only when code found nothing and
 * only when its commit is on main (ev.aiCommitOnMain).
 */
export function decide(b, ev, { ai = null } = {}) {
  const open = list(b?.steps).filter((s) => !s.done && !s.skip);
  if (!ev || ev.unavailable) return { verdict: 'unknown', why: str(ev?.error || 'main could not be read', 300), ticks: [], pr: 0, commit: '' };
  const landing = landingOf(ev);
  const pr = landing?.pr || 0; const commit = landing?.commit || '';
  // landed with nothing open (every step ticked, but the record never closed)
  if (landing && !open.length) return { verdict: 'done', why: `${landing.label}, every step ticked`, ticks: [], pr, commit };
  const ticks = stepEvidence(b, ev);
  if (open.length && ticks.length === open.length) return { verdict: 'done', why: `every open step is on main${landing ? ` (${landing.label})` : ''}`, ticks, pr, commit };
  const sup = landing ? null : supersededBy(b, ev.ledger);
  if (sup && !ticks.length) return { verdict: 'superseded', why: `same work as ${sup.build} ("${str(sup.title, 120)}"), landed${sup.landedCommit ? ` ${sup.landedCommit.slice(0, 9)}` : ''}${sup.pr ? ` in PR #${sup.pr}` : ''}`, ticks: [], pr: sup.pr || 0, commit: sup.landedCommit || '', by: sup.build };
  if (ticks.length) return { verdict: 'partial', why: `${ticks.length} of ${open.length} open steps already on main${landing ? ` (${landing.label})` : ''}`, ticks, pr, commit };
  if (ai && ev.aiCommitOnMain && VERDICTS.includes(ai.verdict)) {
    const known = new Set(open.map((s) => s.id));
    const aiTicks = [...new Set(list(ai.steps))].filter((id) => known.has(id)).map((id) => ({ id, why: `AI check: ${str(ai.why, 200)}` }));
    if (ai.verdict === 'done') return { verdict: 'done', why: `AI check: ${str(ai.why, 300)} (${str(ai.commit, 12)})`, ticks: open.map((s) => ({ id: s.id, why: 'AI check' })), pr, commit: str(ai.commit, 40), ai: true };
    if (ai.verdict === 'partial' && aiTicks.length && aiTicks.length < open.length) return { verdict: 'partial', why: `AI check: ${str(ai.why, 300)} (${str(ai.commit, 12)})`, ticks: aiTicks, pr, commit: str(ai.commit, 40), ai: true };
  }
  return { verdict: 'open', why: landing ? `${landing.label}, but ${open.length === 1 ? 'its open step has' : `its ${open.length} open steps have`} no evidence on main` : 'nothing on main yet', ticks: [], pr: 0, commit: '' };
}

/** The AI pass's prompt (one build, the evidence code found) and its answer's parser. */
export function aiPrompt(b, ev) {
  const steps = list(b?.steps).filter((s) => !s.done && !s.skip).map((s) => `${s.id}: ${str(s.text, 600)}`).join('\n');
  const near = list(ev?.ledger).map((e) => ({ e, sim: similarity(b.title, e.title) })).filter((x) => x.sim >= 0.4).sort((x, y) => y.sim - x.sim).slice(0, 5).map((x) => `- ${x.e.build}: ${str(x.e.title, 160)} (${x.e.landedCommit?.slice(0, 9) || 'no commit'})`).join('\n');
  return [`You check whether one build is already done on main. Answer with JSON only: {"verdict":"done|partial|open","steps":["s1"],"commit":"<sha on main>","why":"<one line>"}.`,
    'Say done or partial only when you can cite a commit on main that does the work; otherwise "open".',
    `Build ${b.id}: ${str(b.title, 200)}\n${str(b.detail, 1500)}`, `Open steps:\n${steps || '(none)'}`,
    `Recent main commits that mention its words:\n${list(ev?.commits).slice(0, 15).map((c) => `- ${c}`).join('\n') || '(none)'}`, `Landed builds with similar titles:\n${near || '(none)'}`].join('\n\n');
}
export function parseAi(text) {
  const m = /\{[\s\S]*\}/.exec(str(text, 20000)); if (!m) return null;
  try { const j = JSON.parse(m[0]); return VERDICTS.includes(j.verdict) ? { verdict: j.verdict, steps: list(j.steps).map((x) => str(x, 40)), commit: str(j.commit, 40).trim(), why: str(j.why, 300) } : null; } catch { return null; }
}

/** The AmberX notification for a build the check closed (pipeline-core alertFor shape). */
export function closedAlert(b, r) {
  const title = `${r.verdict === 'superseded' ? 'Superseded' : 'Already on main'}: ${str(b.title, 120)}`;
  const link = [r.pr ? `PR #${r.pr}` : '', r.commit ? r.commit.slice(0, 9) : ''].filter(Boolean).join(' · ');
  return { kind: 'main-check', id: b.id, title, body: `${r.why}${link ? `\n${link}` : ''}\nClosed and archived; not queued.` };
}

/** One line for the CLI / logs. */
export const lineOf = (id, r) => `${id}: ${r.verdict}${r.ticks?.length && r.verdict === 'partial' ? ` (ticked ${r.ticks.map((t) => t.id).join(', ')})` : ''} · ${r.why}`;
