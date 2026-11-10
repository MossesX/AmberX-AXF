/**
 * Build orchestrator core (orchestrator@1). Pure: no fs, no DOM. Shared by the console page, the CLI
 * (../orchestrator.mjs), the server part and the tests.
 *
 * A build is a list of small steps (≤ 30 min), each pinned to Fable or Opus. Consecutive steps on the same model
 * form a phase. A phase whose model differs from the phase before it is a model switch (framework/core/model-switch.mjs,
 * Brett, Nov 3 2026): a downgrade (Fable → Opus) passes by itself and is recorded; an UPGRADE (Opus → Fable) opens
 * behind Brett's approval (his signed-in console click or an axHub approval), which no session, agent, headless build
 * or the orchestrator itself can give. Token rules travel with every build: stay in the same
 * session, no sub-agents, and only the current phase goes into a brief.
 */

import { normOrigin, originText } from '../../../../../framework/core/build-origin.mjs';
import { buildTruth, NEED_ACTION, NEED_KINDS, NEED_LABEL, TRUTH, TRUTH_LABEL, TRUTH_TONE } from '../../../../../framework/core/build-pipeline.mjs';
import { AUTO_UPGRADE_NOTE, normApproval, normRequest, phaseApproved, setUpgradePolicy, switchKind, switchRule, upgradeLine, upgradeNeedsApproval, upgradePolicy, modelRank } from '../../../../../framework/core/model-switch.mjs';

export const SCHEMA = 'orchestrator@1';
export const MODELS = ['Fable', 'Opus'];
/**
 * `built` = every step done but the build's PR is not merged yet; `complete` once it merged (or it has no PR).
 * `queued` (Nov 8 2026) = in the Queue: Brett moved it from Pending, the dispatcher starts it when a slot is free.
 */
export const STATUSES = ['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete', 'archived'];
/** Stored status → its label. `blocked` = Needs something (its need is on pipeline.need), built = Ready to land, complete = Landed (Nov 10 2026). */
export const STATUS_LABEL = { pending: 'Pending', queued: 'Queued', running: 'Running', waiting: 'Needs approval', blocked: 'Needs something', failed: 'Failed', built: 'Ready to land', complete: 'Landed', archived: 'Archived' };
/** The one honest state every surface shows (framework/core/build-pipeline.mjs buildTruth): Running only with a live session. */
export { buildTruth, NEED_ACTION, NEED_KINDS, NEED_LABEL, TRUTH, TRUTH_LABEL, TRUTH_TONE };
/** Finished work: no steps left (built waits only on its PR). */
export const isFinished = (status) => status === 'built' || status === 'complete';
export const SORTS = ['added', 'updated', 'queued', 'built', 'status', 'left', 'next', 'category', 'title'];
export const SORT_LABEL = { status: 'Status', added: 'Date added', updated: 'Last updated', queued: 'Date queued', built: 'Date built', left: 'Time left', next: 'Next model', category: 'Category', title: 'Title' };
/** The date sorts (Brett, Nov 10 2026: "I can't sort by day either"): both directions, inside groups too. */
export const DATE_SORTS = ['added', 'updated', 'queued', 'built'];
/**
 * How the Builds list groups (Nov 10 2026: "I don't want to be forced to view everything by category. I don't want a flat
 * list by default, it's got to at least have an expanding row, depending on the root."). `root` (the default) = one row
 * per root build that expands to its child builds and steps; the others group those root rows under a heading.
 */
export const GROUP_BY = ['root', 'category', 'status', 'priority', 'account'];
export const GROUP_LABEL = { root: 'Root builds', category: 'Category', status: 'Status', priority: 'Priority', account: 'Account' };
export const UNCATEGORISED = 'Uncategorised';
export const DEFAULT_RULES = { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 30 };
/** When Fable is worth its price (shown on the page; the session picks a step's model from it). */
export const MODEL_GUIDE = {
  Fable: 'Cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that changes how GUIs work across apps.',
  Opus: 'Everything else: plugin UI on the framework, servers, routes, tests, docs, wiring, security work.',
};

/**
 * Every brief carries the asset-conformance rule (Brett, Oct 31 2026; shared rule "Handwritten code conforms to the
 * asset system"): code a build writes, by hand or generated, takes every look value from hot-swappable assets.
 */
export const ASSET_RULE = 'UI code (handwritten or generated) conforms to the hot-swappable asset system: every colour, size, spacing, font, radius and border comes from asset tokens (--fx-* colour/style, --fx-type-* / --fx-dens-* / --fx-size-* scale, --fx-radius-*, --fx-border-w; Kotlin: Axf.colors / Axf.type / Axf.space / Axf.shapes), framework controls instead of raw ones, no var() fallbacks. `node framework/cli/check-theme.mjs` and `check-controls.mjs` must pass (CI fails otherwise); `node framework/cli/scale-adopt.mjs <path>` moves most literals onto the tokens.';

/**
 * Every brief carries the API rule (Brett, Nov 8 2026: "the orchestrator is going to include in the briefs, everything
 * comes with an API"; build orchestrator-api-rule-in-every-brief-plan-studio).
 */
export const API_RULE = 'Everything comes with an API (Brett, Nov 8 2026): anything this build adds or changes that has a UI gets full API control: a deep link that opens it (console_show / console_open target), its state readable, and every action and setting it offers callable without the UI, through the console API (REST), MCP tools (console actions, plugin commands, control@1 for tokens and planner items), the CLI and voice (AmberX), all four the same. A UI-only feature is not done; say in the PR how each one is reached.';

const now = () => new Date().toISOString();
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
/** A step still to do: not done and not skipped by the build's feature matrix. */
const open = (s) => !s.done && !s.skip;
const slug = (t) => str(t, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';

/** "45 min", "2 h", "1.5 d", "90" → minutes (a day = 8 working hours), null when unreadable. */
export function estimateMinutes(e) {
  if (typeof e === 'number' && e > 0) return e;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(str(e, 30));
  if (!m) return null;
  const n = Number(m[1]); const u = (m[2] || 'min').toLowerCase();
  return Math.round(u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 480 : n);
}
export function formatMinutes(min) {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = min / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

function normStep(s, i) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    id: str(o.id, 40) || `s${i + 1}`,
    ...(str(o.uid, 60) ? { uid: str(o.uid, 60) } : {}), // builds@1 step record id: never changes (store, Steps view)
    ...(str(o.title, 200) ? { title: str(o.title, 200) } : {}), // a renamed step shows its title instead of its text
    text: str(o.text, 2000),
    model: MODELS.includes(o.model) ? o.model : 'Opus',
    why: str(o.why, 300),
    phase: str(o.phase, 80),
    group: str(o.group, 80),
    estimate: str(o.estimate, 20),
    files: Array.isArray(o.files) ? o.files.map((f) => str(f, 300)).filter(Boolean).slice(0, 30) : [],
    checks: Array.isArray(o.checks) ? o.checks.map((f) => str(f, 300)).filter(Boolean).slice(0, 20) : [],
    session: o.session === 'new' ? 'new' : 'same',
    agent: o.agent === true,
    skip: o.skip === true, // set by the feature matrix (feature-matrix@1): skipped when the build runs, never removed
    done: o.done === true,
    doneAt: o.done === true ? str(o.doneAt, 40) : '',
    note: str(o.note, 1000),
  };
}

function normBuild(b) {
  const o = b && typeof b === 'object' ? b : {};
  const steps = (Array.isArray(o.steps) ? o.steps : []).map(normStep);
  const seen = new Set();
  steps.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}-${i}`; seen.add(s.id); });
  return {
    id: str(o.id, 80) || slug(o.title),
    title: str(o.title, 300) || 'Untitled build',
    category: str(o.category, 60),
    detail: str(o.detail, 8000),
    status: STATUSES.includes(o.status) ? o.status : 'pending',
    hidden: o.hidden === true,
    source: str(o.source, 40) || 'console',
    pendingId: str(o.pendingId, 80),
    branch: str(o.branch, 200),
    pr: str(o.pr, 200),
    ...(str(o.mergedAt) ? { mergedAt: str(o.mergedAt, 40) } : {}),
    ...(/^P[0-3]$/.test(str(o.priority)) ? { priority: o.priority } : {}),
    createdAt: str(o.createdAt, 40) || now(),
    updatedAt: str(o.updatedAt, 40) || now(),
    builtAt: isFinished(o.status) ? str(o.builtAt, 40) : '',
    notes: (Array.isArray(o.notes) ? o.notes : []).map((n) => ({ text: str(n?.text, 2000), at: str(n?.at, 40) })).filter((n) => n.text),
    approvals: (Array.isArray(o.approvals) ? o.approvals : []).map(normApproval),
    upgradeRequests: (Array.isArray(o.upgradeRequests) ? o.upgradeRequests : []).map(normRequest).filter((r) => r.id),
    ...(normOrigin(o.origin) ? { origin: normOrigin(o.origin) } : {}), // build-origin@1: what Brett said
    steps,
  };
}

export function emptyState() { return { $axf: SCHEMA, updatedAt: now(), rules: { ...DEFAULT_RULES }, builds: [] }; }
export function normalizeState(s) {
  const o = s && typeof s === 'object' ? s : {};
  return { $axf: SCHEMA, updatedAt: str(o.updatedAt, 40) || now(), rules: { ...DEFAULT_RULES, ...(o.rules && typeof o.rules === 'object' ? o.rules : {}) }, builds: (Array.isArray(o.builds) ? o.builds : []).map(normBuild) };
}

/**
 * Steps → phases → groups. A phase is a run of consecutive steps with the same phase label and model (a step with
 * no label joins the run before it while the model stays the same). `gate` = this phase starts with a model switch.
 * Inside a phase, consecutive steps with the same group label form a group.
 */
export function phases(build) {
  const out = [];
  build.steps.forEach((s, i) => {
    const last = out[out.length - 1];
    const sameRun = last && last.model === s.model && (!s.phase || s.phase === last.label);
    if (sameRun) last.steps.push({ ...s, index: i });
    else { const gate = !!last && last.model !== s.model; out.push({ index: out.length, model: s.model, label: s.phase || '', steps: [{ ...s, index: i }], gate, from: last?.model ?? '', kind: gate ? switchKind(last.model, s.model) : '' }); }
  });
  for (const p of out) {
    p.name = p.label || `Phase ${p.index + 1}`;
    p.done = p.steps.every((s) => !open(s));
    p.upgrade = p.gate && p.kind === 'upgrade';
    p.approved = phaseApproved(build.approvals, p); // downgrades pass; upgrades with Brett's approval, or by themselves while that setting is off
    p.minutesLeft = p.steps.filter(open).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0);
    p.groups = [];
    for (const s of p.steps) {
      const g = p.groups[p.groups.length - 1];
      if (g && g.label === s.group) g.steps.push(s);
      else p.groups.push({ label: s.group, steps: [s] });
    }
    for (const g of p.groups) { g.done = g.steps.filter((s) => s.done).length; g.skipped = g.steps.filter((s) => s.skip).length; g.minutesLeft = g.steps.filter(open).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0); }
  }
  return out;
}

/** Every category in use, sorted, with counts (builds without one count as UNCATEGORISED). */
export function categories(builds) {
  const c = new Map();
  for (const b of builds) { const k = b.category || UNCATEGORISED; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/** What happens next: the first phase with work left, its next step, and whether a switch approval is needed. */
export function nextUp(build, rules = DEFAULT_RULES) {
  const ps = phases(build);
  const phase = ps.find((p) => !p.done) ?? null;
  if (!phase) return { phase: null, step: null, needsApproval: false, done: build.steps.length > 0 };
  const step = phase.steps.find(open) ?? null;
  // An upgrade always waits for Brett (the approveModelSwitch rule can't turn that off); a downgrade never waits.
  const needsApproval = phase.upgrade && !phase.approved;
  return { phase, step, needsApproval, done: false };
}

export function progress(build) {
  const total = build.steps.length; const done = build.steps.filter((s) => s.done).length; const skipped = build.steps.filter((s) => s.skip && !s.done).length;
  const left = build.steps.filter(open);
  const minutesLeft = left.reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0);
  const byModel = Object.fromEntries(MODELS.map((m) => [m, left.filter((s) => s.model === m).reduce((t, s) => t + (estimateMinutes(s.estimate) ?? 0), 0)]));
  const switches = phases(build).filter((p) => p.gate).length;
  return { total, done, skipped, minutesLeft, byModel, switches };
}

/** Steps over the size limit or without an estimate (the small-steps rule). */
export function splitCheck(build, rules = DEFAULT_RULES) {
  const reasons = [];
  build.steps.forEach((s, i) => {
    const m = estimateMinutes(s.estimate);
    if (m == null) reasons.push(`step ${i + 1} has no estimate`);
    else if (m > (rules.maxStepMinutes || 30)) reasons.push(`step ${i + 1} is ${formatMinutes(m)}`);
  });
  if (!build.steps.length) reasons.push('no steps yet');
  // skipped steps (feature matrix) still have to be small: they may come back
  return { needsSplit: reasons.length > 0, reasons };
}

/**
 * Status the build should show, from its steps (explicit failed / archived stay). Statuses tell the truth (Nov 10 2026):
 * only a step being ticked (`ticked`: a session is working on it now) makes a build Running; a note, a rename or an edit
 * never does. The dispatcher takes Running away again when no live session is left (pipeline.mjs reconcileRunning).
 */
export function derivedStatus(build, rules, { ticked = false } = {}) {
  if (['failed', 'archived'].includes(build.status)) return build.status;
  if (!build.steps.length) return build.status; // nothing to derive from (e.g. a Pending item built before it had steps)
  if (isFinished(build.status) && !build.steps.some((s) => s.done)) return build.pr && !build.mergedAt ? 'built' : 'complete'; // built without ticking its steps
  const n = nextUp(build, rules);
  if (n.done) return build.pr && !build.mergedAt ? 'built' : 'complete';
  if (n.needsApproval) return 'waiting';
  if (ticked) return 'running';
  if (build.status === 'waiting') return 'queued'; // the upgrade was approved: back in the Queue for the dispatcher
  if (isFinished(build.status)) return 'blocked'; // finished work reopened: it needs something, it is not Pending again
  return build.status;
}

export function counts(builds) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const b of builds) c[b.status] += 1;
  return c;
}

const ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
const TRUTH_ORDER = Object.fromEntries(TRUTH.map((s, i) => [s, i]));

/**
 * Root of every build: { [id]: rootId }. Builds carry no parent link, so the root is read from what they do carry:
 * `parent` when set, a plan epic whose id / planRef is a dotted prefix of the build's planRef or id (x.assets →
 * x.assets.designer), and a follow-up's base build (foo-2 → foo). Chains resolve to the top; a build with none is its own root.
 */
export function rootsOf(builds) {
  const ids = new Set(builds.map((b) => b.id));
  const byRef = new Map(); for (const b of builds) if (b.planRef && !byRef.has(b.planRef)) byRef.set(b.planRef, b.id);
  const parent = new Map();
  for (const b of builds) {
    let p = b.parent && ids.has(b.parent) && b.parent !== b.id ? b.parent : '';
    if (!p) { // the longest dotted prefix that is another build (id or planRef)
      const key = b.planRef || b.id; const parts = key.split('.');
      for (let i = parts.length - 1; i > 0 && !p; i -= 1) { const pre = parts.slice(0, i).join('.'); const hit = ids.has(pre) ? pre : byRef.get(pre); if (hit && hit !== b.id) p = hit; }
    }
    if (!p) { const m = /^(.+)-(\d{1,2})$/.exec(b.id); if (m && ids.has(m[1])) p = m[1]; }
    if (p) parent.set(b.id, p);
  }
  const out = {};
  for (const b of builds) { let r = b.id; const seen = new Set([r]); while (parent.has(r) && !seen.has(parent.get(r))) { r = parent.get(r); seen.add(r); } out[b.id] = r; }
  return out;
}
/** Root rows with their children (sorted the same way), for the default list: [{ build, children }]. A child whose root is filtered out shows as its own row. */
export function rootTree(builds, sort = 'added', dir = 'desc', rules) {
  const roots = rootsOf(builds); const shown = new Set(builds.map((b) => b.id));
  const kids = new Map();
  for (const b of builds) { const r = roots[b.id]; if (r !== b.id && shown.has(r)) kids.set(r, [...(kids.get(r) ?? []), b]); }
  const top = builds.filter((b) => roots[b.id] === b.id || !shown.has(roots[b.id]));
  return sortBuilds(top, sort, dir, rules).map((b) => ({ build: b, children: sortBuilds(kids.get(b.id) ?? [], sort, dir, rules) }));
}
/** The heading a build sits under for a Group by choice ('' for root = no heading). */
export function groupKey(b, by) {
  if (by === 'category') return b.category || UNCATEGORISED;
  if (by === 'status') return buildTruth(b).label;
  if (by === 'priority') return /^P[0-3]$/.test(b.priority || '') ? b.priority : 'P2';
  if (by === 'account') return b.pipeline?.account || b.pipeline?.lastRun?.account || 'No account';
  return '';
}
/** Group headings in their natural order (status by the truth order, priority P0 first, the rest by name). */
export function groupOrder(by, a, b) {
  if (by === 'status') { const i = (l) => TRUTH_ORDER[Object.keys(TRUTH_LABEL).find((k) => TRUTH_LABEL[k] === l)] ?? 99; return i(a) - i(b); }
  return a.localeCompare(b);
}
export function sortBuilds(list, sort = 'status', dir = 'asc', rules) {
  const k = (b) => sort === 'category' ? (b.category || '~').toLowerCase() : sort === 'title' ? b.title.toLowerCase() : sort === 'added' ? b.createdAt : sort === 'updated' ? (b.updatedAt || b.createdAt) : sort === 'queued' ? (b.pipeline?.queuedAt || '') : sort === 'built' ? (b.builtAt || '') : sort === 'left' ? progress(b).minutesLeft
    : sort === 'next' ? (nextUp(b, rules).step?.model ?? 'z') : ORDER[b.status];
  const out = [...list].sort((a, b) => { const x = k(a); const y = k(b); return x < y ? -1 : x > y ? 1 : a.createdAt < b.createdAt ? -1 : 1; });
  return dir === 'desc' ? out.reverse() : out;
}

/**
 * Brief for the next session: only the current phase (fewest tokens), the token rules, what to read first and how
 * to report. Paste it as the first message, or `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>`.
 */
export function brief(build, rules = DEFAULT_RULES) {
  const n = nextUp(build, rules);
  if (n.done) return `Build "${build.title}" (${build.id}) is complete.`;
  const p = n.phase;
  const files = [...new Set(p.steps.filter(open).flatMap((s) => s.files))];
  const checks = [...new Set(p.steps.filter(open).flatMap((s) => s.checks))];
  const lines = [
    `Continue build "${build.title}" (${build.id})${build.category ? ` [${build.category}]` : ''} — ${p.name}, model ${p.model}.`,
    build.origin?.said || build.origin?.addenda?.length ? `What Brett asked for (build-origin@1, his words come first; a paraphrase never replaces them):\n${originText(build.origin)}` : '',
    n.needsApproval ? `STOP: ${upgradeLine(build.id, p)}. That is a model UPGRADE: only Brett can approve it. Do no work on this phase: run \`orchestrator.mjs request-upgrade ${build.id} ${p.index}\` (files the axHub approval), tell Brett, and end the session. Never approve it yourself.` : '',
    p.gate && p.kind === 'downgrade' ? `This phase downgrades ${p.from} → ${p.model}: fine, no approval needed (it is recorded when you tick its first step).` : '',
    p.upgrade && !n.needsApproval && !build.approvals.some((a) => a.phase === p.index && a.to === p.model) ? `This phase upgrades ${p.from} → ${p.model}: no approval needed (Fable upgrades need my approval is off); it is recorded when you tick its first step.` : '',
    switchRule(),
    `Rules: ${rules.sameSession ? 'stay in this one session' : 'new session allowed'}; ${rules.subAgents ? 'sub-agents allowed' : 'no sub-agents'}; steps ≤ ${rules.maxStepMinutes} min; read only the files listed; stop at the end of this phase.`,
    `Look: ${ASSET_RULE}`,
    `API: ${API_RULE}`,
    build.branch ? `Branch: ${build.branch}${build.pr ? ` · PR ${build.pr}` : ''}` : '',
    `Steps in this phase (${p.steps.filter(open).length} left, ~${formatMinutes(p.minutesLeft) || '?'}):`,
    ...p.steps.map((s, i) => `${s.group && s.group !== p.steps[i - 1]?.group ? `— ${s.group} —\n` : ''}${s.done ? '[x]' : s.skip ? '[skip]' : '[ ]'} ${s.id} ${s.estimate ? `(~${s.estimate}) ` : ''}${s.text}${s.session === 'new' ? ' [needs a new session]' : ''}${s.agent ? ' [sub-agent allowed]' : ''}`),
    files.length ? `Read first: ${files.join(', ')}` : '',
    checks.length ? `Checks: ${checks.join(' · ')}` : '',
    `Tick each step: node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step ${build.id} <stepId> done — it reaches main at once (builds-live). Link your branch / PR: node framework/cli/builds-live.mjs link ${build.id} --branch <b> --pr <n>.`,
    'Watch live: when you start on a screen, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "…"` so the live preview follows you.',
    'Screenshots that are not for approval (checking a screen, live captures, before/after): axf shot <file> --name "…" --app … --screen … --group "<build name>" (UI Review → Screenshots; ui-review-item@1), never the review queue.',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Who approves an upgrade. The core can't tell people from agents: the caller (CLI from its environment, the console
 * server from the signed-in hub admin, the console's axHub-approved MCP tool) puts { by, via } on the change as
 * `approver` only after its own check (framework/core/model-switch.mjs approverFrom). Without it an upgrade is refused.
 */
function needApprover(c, what, allowAuto = true) {
  const a = c.approver && typeof c.approver === 'object' ? c.approver : null;
  const by = str(a?.by, 120).trim(); const via = str(a?.via, 20);
  if (by && ['console', 'axhub'].includes(via)) return { by, via };
  if (allowAuto && !upgradeNeedsApproval()) return { by: 'auto', via: 'policy' }; // Fable upgrades need my approval: off
  throw new Error(`${what}: a model upgrade needs Brett's approval (his console click or an axHub approval); a session, agent or the orchestrator can't give it. Ask: orchestrator.mjs request-upgrade <id> <phase>`);
}
/** An upgrade while approvals are off: record it (approvals[], a build note), close open requests, say so. */
function autoUpgrade(b, p, log) {
  b.approvals.push(normApproval({ phase: p.index, from: p.from, to: p.model, at: now(), by: 'auto', via: 'policy', kind: 'upgrade', note: AUTO_UPGRADE_NOTE }));
  for (const r of b.upgradeRequests) if (r.phase === p.index && r.state === 'open') r.state = 'approved';
  b.notes.push({ text: `Model switch: phase ${p.index + 1}${p.label ? ` (${p.label})` : ''} ${p.from} → ${p.model}. ${AUTO_UPGRADE_NOTE}.`, at: now() });
  log.push(`${upgradeLine(b.id, p)}: upgraded by itself (Fable upgrades need my approval is off), recorded on the build`);
}
export { setUpgradePolicy, upgradePolicy };

/** Apply one change. Returns { state, build?, log: string[] } or throws Error with a plain message. */
export function apply(state, change) {
  const s = normalizeState(state);
  const c = change && typeof change === 'object' ? change : {};
  const log = [];
  const find = () => { const b = s.builds.find((x) => x.id === c.id); if (!b) throw new Error(`no build "${c.id}"`); return b; };
  const stepOf = (b) => { const st = b.steps.find((x) => x.id === c.step) ?? b.steps[Number(c.index)]; if (!st) throw new Error(`no step "${c.step ?? c.index}" in ${b.id}`); return st; };
  let b = null;
  switch (c.action) {
    case 'add': {
      const id = slug(c.id || c.title); if (!str(c.title).trim()) throw new Error('a title is needed');
      if (s.builds.some((x) => x.id === id)) throw new Error(`"${id}" is already on the list`);
      // origin = what Brett said that started it (build-origin@1); `said` is the shortcut for his verbatim words
      const origin = c.said !== undefined ? { ...(c.origin ?? {}), said: c.said, at: c.origin?.at || now() } : c.origin;
      b = normBuild({ ...c, id, origin, status: 'pending', createdAt: now() }); s.builds.push(b); log.push(`added ${id} (${b.steps.length} steps)${b.origin?.said ? ', with what Brett said' : ''}`); break;
    }
    case 'import': { // from a pending@1 item: its sub prompts become steps on the item's model
      const it = c.item ?? {}; const id = slug(c.id || it.id || it.title);
      if (s.builds.some((x) => x.id === id)) throw new Error(`"${id}" is already on the list`);
      const model = MODELS.includes(it.model) ? it.model : 'Opus';
      b = normBuild({ id, title: it.title, detail: it.detail, source: 'pending', pendingId: it.id, steps: (it.subPrompts ?? []).map((p) => ({ text: p.text, estimate: p.estimate, model, done: p.done, doneAt: p.doneAt })) });
      s.builds.push(b); log.push(`imported pending ${it.id} as ${id}`); break;
    }
    case 'update': { b = find(); if (Array.isArray(c.steps)) for (const ns of c.steps) { const old = b.steps.find((x) => x.id === ns?.id); if (old && !old.done && ns?.model && modelRank(ns.model) > modelRank(old.model)) needApprover(c, `raising ${b.id} ${old.id} from ${old.model} to ${ns.model}`); } for (const k of ['title', 'detail', 'branch', 'pr', 'mergedAt', 'category']) if (typeof c[k] === 'string') b[k] = str(c[k], k === 'detail' ? 8000 : k === 'category' ? 60 : 300); if (Array.isArray(c.steps)) b.steps = c.steps.map(normStep); log.push(`updated ${b.id}`); break; }
    case 'rename': { b = find(); const t = str(c.title, 300).trim(); if (!t) throw new Error('a build needs a name'); b.title = t; log.push(`${b.id} renamed "${t}"`); break; } // the id never changes
    case 'rename-step': { b = find(); const st = stepOf(b); const t = str(c.title, 200).trim(); if (!t) throw new Error('a step needs a name'); st.title = t; log.push(`${b.id} ${st.id} renamed "${t}"`); break; }
    case 'remove': { b = find(); s.builds = s.builds.filter((x) => x !== b); log.push(`removed ${b.id}`); break; }
    case 'status': { b = find(); if (!STATUSES.includes(c.status)) throw new Error(`unknown status ${c.status}`); b.status = c.status; b.builtAt = isFinished(c.status) ? (b.builtAt || now()) : ''; log.push(`${b.id} → ${c.status}`); break; }
    case 'archive': { b = find(); b.status = 'archived'; log.push(`archived ${b.id}`); break; }
    case 'hide': case 'unhide': { b = find(); b.hidden = c.action === 'hide'; log.push(`${c.action} ${b.id}`); break; }
    case 'note': { b = find(); if (!str(c.text).trim()) throw new Error('empty note'); b.notes.push({ text: str(c.text, 2000), at: now() }); log.push(`note on ${b.id}`); break; }
    case 'step': { b = find(); const st = stepOf(b); const ps = phases(b); const ph = ps.find((p) => p.steps.some((x) => x.id === st.id));
      if (c.done !== false && ph && !ph.approved) throw new Error(`${upgradeLine(b.id, ph)}: a model upgrade needs Brett's approval first (orchestrator.mjs request-upgrade ${b.id} ${ph.index})`);
      if (c.done !== false && ph && ph.gate && ph.kind === 'downgrade' && !b.approvals.some((a) => a.phase === ph.index && a.to === ph.model)) { b.approvals.push(normApproval({ phase: ph.index, from: ph.from, to: ph.model, at: now(), by: 'auto', kind: 'downgrade' })); log.push(`${b.id}: downgrade ${ph.from} → ${ph.model} recorded (phase ${ph.index + 1})`); }
      if (c.done !== false && ph && ph.upgrade && !upgradeNeedsApproval() && !b.approvals.some((a) => a.phase === ph.index && a.to === ph.model)) autoUpgrade(b, ph, log);
      st.done = c.done !== false; st.doneAt = st.done ? now() : ''; if (typeof c.note === 'string') st.note = str(c.note, 1000); log.push(`${b.id} ${st.id} ${st.done ? 'done' : 'not done'}`); break; }
    case 'add-step': { b = find(); const st = normStep({ ...c.stepData, id: `s${b.steps.length + 1}` }, b.steps.length); if (!st.text) throw new Error('step text needed'); const at = Number.isInteger(c.at) ? c.at : b.steps.length; b.steps.splice(at, 0, st); log.push(`${b.id} + ${st.id}`); break; }
    case 'edit-step': { b = find(); const st = stepOf(b); if (!st.done && c.stepData?.model && modelRank(c.stepData.model) > modelRank(st.model)) needApprover(c, `raising ${b.id} ${st.id} from ${st.model} to ${c.stepData.model}`); Object.assign(st, normStep({ ...st, ...c.stepData, id: st.id, done: st.done, doneAt: st.doneAt }, 0)); log.push(`${b.id} ${st.id} edited`); break; }
    case 'skip-step': { b = find(); const st = stepOf(b); st.skip = c.skip !== false; log.push(`${b.id} ${st.id} ${st.skip ? 'skipped' : 'back in'}`); break; } // the feature matrix's view of a step; the step stays
    case 'remove-step': { b = find(); const st = stepOf(b); b.steps = b.steps.filter((x) => x !== st); log.push(`${b.id} − ${st.id}`); break; }
    case 'move-step': { b = find(); const st = stepOf(b); const i = b.steps.indexOf(st); const j = i + (c.dir === 'up' ? -1 : 1); if (j >= 0 && j < b.steps.length) { b.steps.splice(i, 1); b.steps.splice(j, 0, st); } log.push(`${b.id} ${st.id} moved ${c.dir}`); break; }
    case 'approve': { b = find(); const p = phases(b)[Number(c.phase)]; if (!p || !p.gate) throw new Error('that phase has no model switch to approve');
      if (p.kind !== 'upgrade') { // a downgrade needs nobody: record it and go
        if (!b.approvals.some((a) => a.phase === p.index && a.to === p.model)) b.approvals.push(normApproval({ phase: p.index, from: p.from, to: p.model, at: now(), by: 'auto', kind: 'downgrade' }));
        log.push(`${b.id}: downgrade ${p.from} → ${p.model} needs no approval; recorded (phase ${p.index + 1})`); break; }
      const who = needApprover(c, upgradeLine(b.id, p));
      const req = b.upgradeRequests.find((r) => r.phase === p.index && r.to === p.model && r.state === 'open');
      if (!b.approvals.some((a) => a.phase === p.index && a.to === p.model)) b.approvals.push(normApproval({ phase: p.index, from: p.from, to: p.model, at: now(), by: who.by, via: who.via, kind: 'upgrade', request: req?.id ?? '', ...(who.via === 'policy' ? { note: AUTO_UPGRADE_NOTE } : {}) }));
      if (req) req.state = 'approved';
      log.push(`${upgradeLine(b.id, p)}: approved by ${who.by} (${who.via})`); break; }
    case 'request-upgrade': { b = find(); const p = phases(b)[Number(c.phase)]; if (!p || !p.upgrade) throw new Error('that phase is not a model upgrade (a downgrade needs no approval)');
      if (!upgradeNeedsApproval()) { if (!b.approvals.some((a) => a.phase === p.index && a.to === p.model)) autoUpgrade(b, p, log); else log.push(`${upgradeLine(b.id, p)}: no approval needed (Fable upgrades need my approval is off)`); break; }
      if (p.approved) { log.push(`${upgradeLine(b.id, p)}: already approved`); break; }
      let req = b.upgradeRequests.find((r) => r.phase === p.index && r.to === p.model && r.state === 'open');
      if (!req) { req = normRequest({ id: `${b.id}.p${p.index + 1}.${Date.now().toString(36)}`, phase: p.index, from: p.from, to: p.model, at: now(), by: str(c.by, 120) || 'session' }); b.upgradeRequests.push(req); }
      if (str(c.job)) req.job = str(c.job, 120);
      log.push(`${upgradeLine(b.id, p)}: asked Brett (request ${req.id})`); break; }
    case 'deny-upgrade': { b = find(); const who = needApprover(c, 'answering an upgrade request', false);
      const req = b.upgradeRequests.find((r) => r.phase === Number(c.phase) && r.state === 'open'); if (!req) throw new Error('no open upgrade request on that phase');
      req.state = 'denied'; log.push(`${b.id}: upgrade request ${req.id} denied by ${who.by}`); break; }
    case 'rules': { for (const k of Object.keys(DEFAULT_RULES)) if (k in (c.rules ?? {})) s.rules[k] = typeof DEFAULT_RULES[k] === 'number' ? Math.max(5, Math.min(240, Number(c.rules[k]) || 30)) : c.rules[k] === true; log.push('rules saved'); break; }
    default: throw new Error(`unknown action ${c.action}`);
  }
  if (b && s.builds.includes(b)) { b.updatedAt = now(); const st = derivedStatus(b, s.rules, { ticked: c.action === 'step' && c.done !== false }); if (st !== b.status && !(c.action === 'status')) { if (isFinished(st) && !b.builtAt) b.builtAt = now(); b.status = st; } }
  s.updatedAt = now();
  return { state: s, build: b && s.builds.includes(b) ? b : undefined, log };
}
