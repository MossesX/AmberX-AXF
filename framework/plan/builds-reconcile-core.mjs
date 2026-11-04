/**
 * builds-reconcile-core — match GitHub work (open and merged PRs, claude/* branches) to builds in the store, pure and
 * IO-free (framework/cli/builds-reconcile.mjs does the GitHub and git reads and the store write).
 *
 * Brett, Nov 3 2026 (orch-live-sync): builds finished on a branch showed "pending, 0 steps" because nobody linked the
 * branch or PR to the build. The reconciler runs at every session start and on a timer, and:
 *   - links a build to its branch and PR when they are blank (one clear match only);
 *   - ticks the steps a PR names for that build (title, body lines, commit subjects: "token-control s4-s14");
 *   - marks a build's PR merged (mergedAt), so `built` turns `complete`;
 *   - lists what it can't place: open PRs and recent claude/* branches that match no build (orphans), and matches it
 *     wasn't sure of (suggestions), for the report and the systems check banner item.
 *
 * Match strength (highest wins; a tie between builds is ambiguous and only suggested):
 *   100  the build's branch or PR field names it
 *    90  branch name (after its prefix) is the build id                     claude/theme-editor ↔ theme-editor
 *    70  branch name starts with the build id + "-"                         claude/token-control-opus ↔ token-control
 *    60  PR title/body names the build id as a word (ids of 6+ characters with a hyphen only, so common words never match)
 */

const str = (v) => (typeof v === 'string' ? v : '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lines that talk about steps still to do: their step ids are never ticked. */
const NOT_DONE = /\b(left|todo|to do|remaining|next|pending|not done|later|queued|waits?|waiting|parked|open steps?|still to|planned|plan)\b/i;
/** A PR body line only counts when it says the work is done (a plan PR lists every step without saying so). */
const DONE = /\b(done|built|complete|completed|finished|landed|shipped|ticked)\b|✓|✅|\[x\]/i;

export const prRef = (n) => `#${n}`;
/** A PR field ("#245", "245", a URL) → its number, else 0. */
export function prNumber(v) { const m = /^#?(\d+)$/.exec(str(v).trim()) || /\/pull\/(\d+)/.exec(str(v)); return m ? Number(m[1]) : 0; }
const tail = (branch) => str(branch).replace(/^.*\//, '');
const idWord = (id) => id.length >= 6 && id.includes('-');
const mentions = (text, id) => new RegExp(`(^|[^A-Za-z0-9-])${esc(id)}([^A-Za-z0-9-]|$)`).test(str(text));

/** How strongly a PR or branch belongs to a build (0 = not at all). */
export function score(b, { branch = '', number = 0, title = '', body = '' } = {}) {
  if ((b.branch && b.branch === branch) || (number && prNumber(b.pr) === number)) return 100;
  const t = tail(branch);
  if (t && t === b.id) return 90;
  if (t && t.startsWith(`${b.id}-`)) return 70;
  if (idWord(b.id) && (mentions(title, b.id) || mentions(body, b.id))) return 60;
  return 0;
}

/** Best builds for one PR/branch: [{ build, score }] (all at the top score), [] when none. */
export function matchesFor(builds, ref) {
  let best = 0; let out = [];
  for (const b of builds) {
    const s = score(b, ref);
    if (!s) continue;
    if (s > best) { best = s; out = [{ build: b, score: s }]; } else if (s === best) out.push({ build: b, score: s });
  }
  return out;
}

/**
 * Step ids a text says are done for build `b`: "s4-s14", "s1–s3", "s2, s5", "s7". Only lines that name the build (or
 * every line when `anyLine`, i.e. the PR's branch is the build's own) and don't talk about work still to do.
 */
export function stepRefs(b, lines, { anyLine = false, needDone = false } = {}) {
  const ids = new Set(b.steps.map((s) => s.id));
  const order = b.steps.map((s) => s.id);
  const out = new Set();
  for (const raw of lines) {
    const line = str(raw);
    if (!line.trim() || NOT_DONE.test(line) || (needDone && !DONE.test(line))) continue;
    if (!anyLine && !mentions(line, b.id)) continue;
    const re = /\bs(\d{1,3})(?:\s*(?:-|–|—|to|\.\.)\s*s?(\d{1,3}))?\b/g;
    let m;
    while ((m = re.exec(line))) {
      const a = Number(m[1]); const z = m[2] ? Number(m[2]) : a;
      if (z < a || z - a > 60) continue;
      for (let n = a; n <= z; n += 1) if (ids.has(`s${n}`)) out.add(`s${n}`);
    }
  }
  return order.filter((id) => out.has(id));
}

/**
 * Plan the changes. builds: store records (live ones); prs: [{ number, branch, title, body, state: 'open'|'merged'|
 * 'closed', mergedAt, updatedAt, commits: [subject] }]; branches: [{ name, ahead, updatedAt, pr }] (claude/* with
 * commits ahead of main). Returns { changes: [{ id, set: {branch?, pr?, mergedAt?}, steps: [ids], stepNotes: {id: note},
 * why: [..] }], suggestions: [...], orphans: { prs: [...], branches: [...] } }.
 */
export function plan(builds, prs, branches = [], { now = new Date().toISOString(), orphanDays = 30 } = {}) {
  const live = builds.filter((b) => !b.deleted && b.status !== 'archived');
  const changes = new Map();
  const change = (b) => { if (!changes.has(b.id)) changes.set(b.id, { id: b.id, set: {}, steps: [], stepNotes: {}, why: [] }); return changes.get(b.id); };
  const suggestions = [];
  const orphanPrs = [];
  const linked = new Set();
  // newest first, so the latest PR of a build is the one its fields point at
  const sorted = [...prs].sort((x, y) => (str(y.updatedAt) > str(x.updatedAt) ? 1 : -1));
  for (const pr of sorted) {
    if (pr.state === 'closed') continue; // closed without merging: not work that landed or is landing
    const ms = matchesFor(live, pr);
    if (!ms.length) { if (pr.state === 'open') orphanPrs.push({ number: pr.number, branch: pr.branch, title: pr.title }); continue; }
    const strong = ms.filter((m) => m.score >= 90);
    const take = strong.length ? strong : ms.length === 1 ? ms : [];
    if (!take.length) { if (pr.state === 'open') suggestions.push({ pr: pr.number, branch: pr.branch, builds: ms.map((m) => m.build.id), why: `PR #${pr.number} names several builds; not linked` }); continue; }
    for (const { build: b, score: s } of take) {
      linked.add(pr.branch);
      const c = change(b);
      // title and commit subjects name finished work; body lines only when they say so
      const refs = [...new Set([...stepRefs(b, [pr.title, ...(pr.commits ?? [])], { anyLine: s >= 90 }), ...stepRefs(b, str(pr.body).split('\n'), { anyLine: s >= 90, needDone: true })])];
      // blank fields are filled from the branch name or the build's own field, or a PR that names this build's steps;
      // a PR that only mentions the id is a suggestion
      const sure = s >= 70 || refs.length > 0;
      if (!sure) { if (pr.state === 'open') suggestions.push({ build: b.id, pr: pr.number, why: `PR #${pr.number} mentions ${b.id}; not linked (check it)` }); continue; }
      if (!b.branch && !c.set.branch) { c.set.branch = pr.branch; c.why.push(`branch ${pr.branch} (PR #${pr.number})`); }
      if (!b.pr && !c.set.pr) { c.set.pr = prRef(pr.number); c.why.push(`PR #${pr.number}`); }
      const own = prNumber(c.set.pr || b.pr) === pr.number;
      if (own && pr.state === 'merged' && !b.mergedAt) { c.set.mergedAt = pr.mergedAt || now; c.why.push(`PR #${pr.number} merged`); }
      for (const id of refs) {
        const st = b.steps.find((x) => x.id === id);
        if (st && !st.done && !c.steps.includes(id)) { c.steps.push(id); c.stepNotes[id] = `PR #${pr.number} (${pr.branch})`; }
      }
      if (refs.length) c.why.push(`PR #${pr.number} names ${refs.join(', ')} done`);
      if (pr.state === 'merged' && own) {
        const open = b.steps.filter((x) => !x.done && !x.skip && !c.steps.includes(x.id));
        if (open.length) suggestions.push({ build: b.id, pr: pr.number, why: `PR #${pr.number} merged but ${open.length} step(s) are open (${open.map((x) => x.id).join(', ')}): tick what it built` });
      }
    }
  }
  const cutoff = new Date(Date.parse(now) - orphanDays * 86400000).toISOString();
  const orphanBranches = [];
  for (const br of branches) {
    if (linked.has(br.name) || !(br.ahead > 0) || str(br.updatedAt) < cutoff) continue;
    const ms = matchesFor(live, { branch: br.name });
    if (ms.length === 1 && ms[0].score >= 70) {
      const b = ms[0].build; const c = change(b);
      if (!b.branch && !c.set.branch) { c.set.branch = br.name; c.why.push(`branch ${br.name} (no PR yet)`); }
      if (!b.pr && !br.pr) suggestions.push({ build: b.id, branch: br.name, why: `branch ${br.name} has ${br.ahead} commit(s) and no PR` });
      continue;
    }
    if (!br.pr) orphanBranches.push({ branch: br.name, ahead: br.ahead, updatedAt: br.updatedAt });
  }
  const list = [...changes.values()].filter((c) => Object.keys(c.set).length || c.steps.length);
  return { changes: list, suggestions, orphans: { prs: orphanPrs, branches: orphanBranches } };
}

/**
 * Running means something is running it (Brett, Nov 4 2026: the banner said 21 going while one build ran). A `running`
 * build whose id no live process names (`alive`: agent-slots holders, axf-<id> tmux sessions, build-log entries with a
 * fresh heartbeat) and that nobody touched in `graceMin` minutes is settled: PR merged -> complete; every step done ->
 * built (PR open) or complete; else -> pending, i.e. paused with its worktree kept (a tick or a relaunch makes it
 * running again). `alive` null = processes can't be seen from here, so nothing is touched. Zero tokens.
 */
export function idlePlan(builds, alive, { now = new Date().toISOString(), graceMin = 20, skip = [] } = {}) {
  if (!alive) return [];
  const t = Date.parse(now);
  const out = [];
  for (const b of builds) {
    // plan epics take their status from the plan (builds-store-core syncs it), so they are left to it
    if (b.deleted || b.status !== 'running' || skip.includes(b.id) || b.kind === 'epic' || str(b.planRef)) continue;
    const change = (status, why) => out.push({ id: b.id, set: { status }, steps: [], stepNotes: {}, why: [why] });
    if (str(b.mergedAt)) { change('complete', `PR ${prNumber(b.pr) ? prRef(prNumber(b.pr)) : b.pr} merged: complete`); continue; }
    if (alive.has(b.id)) continue;
    const touched = Date.parse(str(b.updatedAt));
    if (Number.isFinite(touched) && t - touched < graceMin * 60000) continue;
    const steps = (b.steps ?? []).filter((x) => !x.skip);
    if (steps.length && steps.every((x) => x.done)) change(str(b.pr) ? 'built' : 'complete', 'no live process and every step done');
    else change('pending', 'paused: no live session or process runs it (worktree kept); was running');
  }
  return out;
}

/**
 * Build ids a live process works on. `sessions` = tmux session names (`axf-<id>--<agent>`, `axf-<id>`), `slots` =
 * agent-slots running entries ({ name }), `changes` = build-log entries ({ state, lastSeenAt, buildRef, branch }).
 */
export function aliveIds({ sessions = [], slots = [], changes = [], now = new Date().toISOString(), heartbeatMin = 15 } = {}) {
  const ids = new Set();
  for (const n of sessions) { const id = str(n).replace(/^axf-/, '').split('--')[0]; if (id) ids.add(id); }
  for (const r of slots) if (str(r?.name)) ids.add(r.name);
  const t = Date.parse(now);
  for (const e of changes) {
    if (!e || (e.status ?? e.state) !== 'running' || e.result) continue;
    const seen = Date.parse(str(e.lastSeenAt) || str(e.updatedAt));
    if (!Number.isFinite(seen) || t - seen > heartbeatMin * 60000) continue;
    if (str(e.buildRef?.id)) ids.add(e.buildRef.id);
    if (str(e.branch)) ids.add(tail(e.branch));
  }
  return ids;
}
