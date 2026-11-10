/**
 * build-pipeline@1 — the pipeline record on a builds@1 build and the three table states (pure, IO-free).
 *
 * Brett, Nov 8 2026 ("You need to start the pipeline over from scratch"): everything he asks for becomes a build in the
 * orchestrator, which assigns the id, splits it into steps (≤ 30 min, Fable only where needed) and puts it in
 * **Pending**. He moves builds from Pending to the **Queue**. A dispatcher on the VPS watches the connected Claude
 * accounts (which have Fable, how many may run in parallel) and the agent slots; when a slot is free it takes the next
 * Queue build and starts a headless session on an account that can run the next phase's model (**Building**).
 *
 *   status flow:  pending → queued → running (Building) → built → complete
 *                 a session that ends with steps left goes back to queued (crash / limit, up to maxRuns) or to pending
 *                 (stopped on purpose: UI Review wait, a question); failed after maxRuns.
 *
 * `pipeline` on a build (kept across orchestrator, Pending and queue writes; only the dispatcher and the queue
 * actions change it):
 *   queuedAt   ISO: when it entered the Queue ('' in Pending)        queuedBy  who queued it (brett | auto | console | …)
 *   account    the Claude account the current / last run is on       session   its tmux session (axf-<id>--<agent>)
 *   slot       the agent-slots entry id of the current run           model     the model that run started on
 *   launchedAt ISO of the current / last launch                      runs      how many sessions have run it
 *   lastRun    { at, exit, outcome, stepsLeft, account, session }    outcome = finished | requeued | returned | failed
 *   split      { at, by, provider, steps, note }                     how its steps were made (claude | rules | hand)
 *   splitRequested  ISO: the console asked for a (re)split; the next tick does it
 *   note       one plain line the Pipeline view shows (why it waits, what happened last)
 *   route      '' (auto: subscriptions, then API only when the overflow rule is on) | 'api' (run on an API-key account,
 *              billed per token, under its caps) | 'subscription' (never an API account). Brett's per-build override.
 *   dispatchedAt  ISO of the orchestrator dispatch that started the current run (its token is in the dispatcher's files)
 *   need       { kind, text, at, by } what the build needs before it can go on (Needs something), or null. Read from the
 *              session report and the build notes when a run stops with work left (needFrom()), set by the dispatcher
 *              when a Running build has no live session; cleared when the build is queued, runs or lands.
 *
 * Statuses tell the truth (Brett, Nov 10 2026: "They can't say running, and you gotta show if they need something.
 * Show what they need."): buildTruth() is the one state every surface shows (orchestrator, Build Manager, Home card,
 * AmberX, API). Running only while a live tmux / claude session exists for the build; a session that stops with work
 * left goes to Needs something (stored as `blocked` with a `need`), never back to Pending; finished work is Ready to
 * land (PR open) and then Landed.
 */

export const SCHEMA = 'build-pipeline@1';
/** The pipeline table: what each builds@1 status shows as. */
export const TABLE = Object.freeze({ pending: 'pending', queued: 'queued', running: 'building', waiting: 'building' });
export const TABLE_STATES = ['pending', 'queued', 'building'];
export const TABLE_LABEL = Object.freeze({ pending: 'Pending', queued: 'Queue', building: 'Building' });
export const OUTCOMES = ['finished', 'requeued', 'returned', 'failed'];
/** Where a build may run: auto, only API-key accounts, only subscriptions. */
export const ROUTES = ['', 'api', 'subscription'];
export const SPLIT_PROVIDERS = ['claude', 'rules', 'hand'];
export const DEFAULT_MAX_RUNS = 3;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const iso = (v) => { const s = str(v, 40).trim(); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** A saved Claude account name (deploy/claude-login.mjs), or ''. */
export const accountName = (v) => (NAME_RE.test(str(v, 40)) ? str(v, 40) : '');

export function emptyPipeline() {
  return { queuedAt: '', queuedBy: '', account: '', session: '', slot: '', model: '', launchedAt: '', runs: 0, lastRun: null, split: null, splitRequested: '', note: '', route: '', dispatchedAt: '', need: null };
}

/** The record, every field in shape; null for nothing (a build the pipeline never touched carries none). */
export function normPipeline(p) {
  if (!p || typeof p !== 'object') return null;
  const lr = p.lastRun && typeof p.lastRun === 'object' ? p.lastRun : null;
  const sp = p.split && typeof p.split === 'object' ? p.split : null;
  const out = {
    queuedAt: iso(p.queuedAt), queuedBy: str(p.queuedBy, 80),
    account: accountName(p.account), session: str(p.session, 120), slot: str(p.slot, 60), model: str(p.model, 20),
    launchedAt: iso(p.launchedAt), runs: Number.isInteger(p.runs) && p.runs > 0 ? p.runs : 0,
    lastRun: lr ? { at: iso(lr.at), exit: Number.isInteger(lr.exit) ? lr.exit : null, outcome: OUTCOMES.includes(lr.outcome) ? lr.outcome : 'finished', stepsLeft: Number.isInteger(lr.stepsLeft) ? lr.stepsLeft : 0, account: accountName(lr.account), session: str(lr.session, 120) } : null,
    split: sp ? { at: iso(sp.at), by: str(sp.by, 80), provider: SPLIT_PROVIDERS.includes(sp.provider) ? sp.provider : 'hand', steps: Number.isInteger(sp.steps) ? sp.steps : 0, note: str(sp.note, 400) } : null,
    splitRequested: iso(p.splitRequested), note: str(p.note, 400),
    route: ROUTES.includes(p.route) ? p.route : '', dispatchedAt: iso(p.dispatchedAt),
    need: normNeed(p.need),
  };
  const empty = emptyPipeline();
  return JSON.stringify(out) === JSON.stringify(empty) ? null : out;
}

/** Which table a build sits in ('' for builds the table does not show: built, complete, failed, blocked, archived). */
export const tableOf = (b) => TABLE[b?.status] ?? '';

/** A build may be queued: it is in Pending, or it needs something (queueing it is the answer: resume, Fable). */
export const canQueue = (b) => !!b && (b.status === 'pending' || b.status === 'blocked') && !b.deleted && !b.hidden;
/** A build may leave the Queue for Pending: queued and not launched yet. */
export const canUnqueue = (b) => !!b && b.status === 'queued';

/** Builds of the Queue in start order: priority first (P0 before P3), then the moment they were queued. */
export function queueOrder(builds, priorityOf = () => 'P2') {
  const rank = (p) => { const n = parseInt(String(p).replace(/^P/, ''), 10); return Number.isInteger(n) ? n : 2; };
  return [...builds].filter((b) => b.status === 'queued').sort((a, b) => rank(priorityOf(a)) - rank(priorityOf(b)) || str(a.pipeline?.queuedAt).localeCompare(str(b.pipeline?.queuedAt)) || str(a.createdAt).localeCompare(str(b.createdAt)));
}

/** The steps still to do (not done, not skipped). */
export const openSteps = (b) => (b?.steps ?? []).filter((s) => !s.done && !s.skip);
/** The model the next open step runs on ('' when nothing is left). */
export const nextModel = (b) => openSteps(b)[0]?.model ?? '';

/**
 * What a run's end means for the build. A clean exit with nothing left = finished. A failed exit (crash, usage limit,
 * killed) = requeued, until `runs` reaches maxRuns, then failed. A clean exit with steps left = the session stopped on
 * purpose (a question, UI Review, a step marked for a new session): back to Pending for Brett, with the reason.
 */
export function outcomeOf({ exit, stepsLeft, runs, phaseSwitch = false }, maxRuns = DEFAULT_MAX_RUNS) {
  if (!stepsLeft) return 'finished';
  if (exit === 0) return phaseSwitch ? 'requeued' : 'returned'; // a phase ended on purpose: the next phase runs on its own model's account
  return runs >= maxRuns ? 'failed' : 'requeued';
}
/** A session that stops on purpose with work left is not Pending again: it needs something (a `need` says what). */
export const STATUS_AFTER = Object.freeze({ finished: 'built', requeued: 'queued', returned: 'blocked', failed: 'failed' });

// ------------------------------------------------------------------ needs (what a build waits on)

/** What a build can need, in the order needFrom() checks them. `brett` = only Brett can do it; the rest the system fixes itself. */
export const NEED_KINDS = ['review', 'land', 'signin', 'credits', 'key', 'decision', 'fable', 'env', 'resume'];
export const NEED_LABEL = Object.freeze({ review: 'UI Review', land: 'Merge / land', signin: 'Sign-in', credits: 'Account credits', key: 'Key / token', decision: 'Your decision', fable: 'Fable review', env: 'Disk / env fix', resume: 'Restart' });
/** The button on the row: what it does (`action`, an orchestrator / pipeline action) or where it jumps (`href`). */
export const NEED_ACTION = Object.freeze({
  review: { label: 'Open UI Review', href: '#/ui-review' },
  land: { label: 'Open the PR', href: '' },
  signin: { label: 'Claude accounts', href: '#/claude-accounts' },
  credits: { label: 'Claude accounts', href: '#/claude-accounts' },
  key: { label: 'Open Keys', href: '#/keys' },
  decision: { label: 'Answer', href: '' },
  fable: { label: 'Queue for Fable', action: 'queue' },
  env: { label: 'Systems check', href: '#/systems-check' },
  resume: { label: 'Queue it again', action: 'queue' },
});
/** Needs the system handles without Brett (fix-it-yourself rule): the dispatcher acts on these by itself. */
export const NEED_SELF = Object.freeze(['resume']);
const NEED_RULES = [
  ['review', /\bUI Review\b|screenshots? (?:for|waiting|in) (?:the )?review|waiting (?:there|in UI Review)|look approval/i, 'Screenshots wait in UI Review for your approval.'],
  ['land', /merge conflict|needs? (?:a )?(?:merge|landing|land)\b|PR .{0,40}(?:conflict|can't merge|cannot merge|not mergeable)|rebase/i, 'The PR needs a merge or land.'],
  ['signin', /sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in (?:expired|again)|login expired|re-?auth|OAuth/i, 'An account needs signing in again.'],
  ['credits', /credit|usage limit|out of (?:tokens|quota)|billing|quota/i, 'It needs an account with credits left.'],
  ['key', /(?:api key|token|secret|credential)s?\b.{0,40}(?:missing|needed|expired|invalid|rejected|not set)|(?:missing|needs?|no) (?:an? )?(?:api key|token|secret|credential)/i, 'A key or token is missing.'],
  ['fable', /\bFable\b.{0,40}(?:review|needed|upgrade|approval)|needs? Fable/i, 'A Fable step or review is next.'],
  ['env', /disk (?:full|space)|no space left|ENOSPC|env(?:ironment)? (?:fix|broken|missing)|docker .{0,30}(?:down|failed)|npm .{0,20}(?:broken|failed to install)/i, 'The VPS needs a disk or environment fix.'],
  ['decision', /\?\s*$|decision|question for Brett|ask(?:ing)? Brett|needs? Brett|waiting (?:on|for) Brett|which (?:one|option)/im, 'It has a question for you.'],
];

/**
 * The need a session left behind, from its report and the build's notes (latest text first): { kind, text } or null.
 * `text` is one plain sentence: the matching line itself when it is short, else the kind's stock sentence.
 */
export function needFrom(...texts) {
  const lines = texts.flatMap((t) => str(t, 20000).split(/\n+/)).map((l) => l.replace(/^\s*(?:[-*#>]+|\d+[.)])\s*/, '').trim()).filter(Boolean);
  for (const [kind, re, stock] of NEED_RULES) {
    const hit = lines.find((l) => re.test(l));
    if (hit) return { kind, text: hit.length <= 160 ? hit.replace(/\s+/g, ' ') : stock };
  }
  return null;
}
/** A need record in shape, or null. */
export function normNeed(n) {
  if (!n || typeof n !== 'object' || !NEED_KINDS.includes(n.kind)) return null;
  return { kind: n.kind, text: str(n.text, 300) || NEED_RULES.find((r) => r[0] === n.kind)?.[2] || NEED_LABEL[n.kind], at: iso(n.at), by: str(n.by, 80) };
}

// ------------------------------------------------------------------ the truth (one state on every surface)

export const TRUTH = ['running', 'needs', 'queued', 'pending', 'ready', 'landed', 'failed', 'archived'];
export const TRUTH_LABEL = Object.freeze({ running: 'Running', needs: 'Needs something', queued: 'Queued', pending: 'Pending', ready: 'Ready to land', landed: 'Landed', failed: 'Failed', archived: 'Archived' });
export const TRUTH_TONE = Object.freeze({ running: 'accent', needs: 'warning', queued: 'muted', pending: 'muted', ready: 'accent', landed: 'success', failed: 'danger', archived: 'muted' });

/**
 * What a build is, honestly: { state, label, tone, need } where need = { kind, label, text, action } or null.
 * `live` = a session for it exists right now (tmux / claude); null = unknown (the console can't see the host), then a
 * stored `running` counts as running only with a pipeline session on record.
 */
export function buildTruth(b, { live = null } = {}) {
  const st = str(b?.status, 20);
  const p = b?.pipeline ?? null;
  const withNeed = (n) => { const x = normNeed(n); return x ? { kind: x.kind, label: NEED_LABEL[x.kind], text: x.text, action: { ...NEED_ACTION[x.kind], ...(x.kind === 'land' && b?.pr ? { href: str(b.pr, 300) } : {}) } } : null; };
  const out = (state, need = null) => ({ state, label: TRUTH_LABEL[state], tone: TRUTH_TONE[state], need });
  if (st === 'archived') return out('archived');
  if (st === 'complete') return out('landed');
  if (st === 'built') return out('ready');
  if (st === 'failed') return out('failed');
  if (st === 'queued') return out('queued');
  if (st === 'waiting') return out('needs', withNeed({ kind: 'decision', text: 'A model upgrade waits for your approval.' }));
  if (st === 'running') {
    const alive = live ?? !!p?.session;
    if (alive) return out('running');
    return out('needs', withNeed(p?.need) ?? withNeed({ kind: 'resume', text: `Its session is gone with ${openSteps(b).length} step${openSteps(b).length === 1 ? '' : 's'} left.` }));
  }
  if (st === 'blocked') return out('needs', withNeed(p?.need) ?? withNeed(needFrom(...[...(b?.notes ?? [])].reverse().slice(0, 3).map((n) => n.text))) ?? withNeed({ kind: 'decision', text: 'It is blocked: say what to do next.' }));
  return out('pending');
}

/** One plain line about a run's end, for the build's notes and the phone. */
export function outcomeLine(b, run) {
  const left = run.stepsLeft ? `${run.stepsLeft} step${run.stepsLeft === 1 ? '' : 's'} left` : 'every step done';
  const where = run.account ? ` on ${run.account}` : '';
  switch (run.outcome) {
    case 'finished': return `Session ${run.session || ''}${where} finished: ${left}.`.replace('  ', ' ');
    case 'requeued': return `Session${where} ended (exit ${run.exit}) with ${left}: back in the Queue (run ${b.pipeline?.runs ?? 1}).`;
    case 'returned': return `Session${where} stopped on its own with ${left}: needs something${run.need ? ` (${NEED_LABEL[run.need.kind] ?? run.need.kind}: ${run.need.text})` : ''}.`;
    default: return `Session${where} ended (exit ${run.exit}) with ${left} after ${b.pipeline?.runs ?? 0} runs: failed.`;
  }
}
