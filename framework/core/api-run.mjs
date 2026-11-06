/**
 * API runs (api-run@1; build token-optimize, Brett, Nov 6 2026): a run billed to an API key is real money, so it always
 * waits for Brett's confirm approval, with its estimated cost before and its final cost after. Never a veto: no timer ever
 * lets one through. Pure. Store and CLI: framework/cli/api-run.mjs.
 */
export const FRAME = 'api-run@1';
export const STATES = ['waiting', 'approved', 'running', 'done', 'denied', 'expired'];
export const EXPIRE_MS = 24 * 3600 * 1000;
export const DEFAULT_MINUTES = 30;
/** Ways Brett's approval may arrive: set by the console server from his request, never by a caller. */
export const OWNER_VIA = ['console', 'local'];

/** Is this launch billed to an API key? A key in the environment beats a subscription login, so any key counts. */
export const isApiRun = (env = {}) => env.AXF_CLAUDE_AUTH === 'api' || Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);

const num = (s) => { const m = /([\d.]+)\s*(h|m)?/i.exec(String(s ?? '')); return m ? Number(m[1]) * (m[2]?.toLowerCase() === 'h' ? 60 : 1) : 0; };
/** Minutes left on a build: its open steps' estimates, or the default when it has none. */
export function minutesLeft(build) {
  const left = (build?.steps ?? []).filter((s) => !s.done && !s.skip).reduce((t, s) => t + num(s.estimate), 0);
  return left > 0 ? Math.round(left) : DEFAULT_MINUTES;
}

export function newRun({ id, name, build = '', model = '', minutes = DEFAULT_MINUTES, estimateUsd = null, briefHash = '', title = '', at }) {
  return { $axf: FRAME, id, name, build, model, title: String(title).slice(0, 160), briefHash, status: 'waiting', minutes, estimateUsd, finalUsd: null, requestedAt: at, decidedAt: '', decidedBy: '', via: '', startedAt: '', finishedAt: '', session: '', acknowledgedAt: '' };
}

/** Waiting too long means nobody said yes: it expires, it never runs. */
export const expired = (r, now) => r.status === 'waiting' && now - Date.parse(r.requestedAt) > EXPIRE_MS;

/** The approval check. Throws on anything but Brett's own decision of a waiting run. */
export function decide(r, decision, { owner, source = '', at }) {
  if (source) throw new Error(`refused: ${source} can't decide an API run; only Brett can`);
  if (!OWNER_VIA.includes(owner?.via) || !owner?.name) throw new Error('refused: this needs Brett\'s own signed-in console session');
  if (r.status !== 'waiting') throw new Error(`this run is ${r.status}, not waiting`);
  if (!['approve', 'deny'].includes(decision)) throw new Error('approve or deny');
  return { ...r, status: decision === 'approve' ? 'approved' : 'denied', decidedAt: at, decidedBy: String(owner.name).slice(0, 80), via: owner.via };
}

/** Dialogs the console owes Brett: runs waiting for a yes, and finished runs he hasn't seen the bill for. */
export const owed = (runs) => runs.filter((r) => r.status === 'waiting' || (r.status === 'done' && !r.acknowledgedAt));
