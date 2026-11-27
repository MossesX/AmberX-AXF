/**
 * What the builds table says about a build right now (pipeline-status@1, as the screen reads it). No IO, no React.
 *
 * The builds store attaches a computed `pipelineView` to every build it reads (framework/core/pipeline-status.mjs):
 * { state, label, tone, icon, line, attempt, waitingOn, mergeLine }, next to the stored `number` (the short build
 * number), `split` ({ by, model, at, stepCount }) and, on each step, `uid`, `splitBy`, `model` and `modelBy`. This
 * module turns that into the fields the table draws. Whatever the read does not carry is worked out here from the
 * build's own status, so the screen keeps a badge and a plain line on a store that has not caught up yet. The store's
 * own words always win over the fallback.
 *
 * Used by web/status-table-core.mjs (buildRow), so the console table and the CLI behind GET /table agree.
 */

/** Every state a build shows a badge for, in pipeline order (the lander's four come after the build's own). */
export const PIPELINE_STATES = Object.freeze(['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'failed', 'waiting-to-merge', 'merging', 'running-ci', 'landed']);
/** The states the lander writes. */
export const LANDER_STATES = Object.freeze(['waiting-to-merge', 'merging', 'running-ci', 'landed']);
/** The tones a badge may carry (each one a theme colour in status-table.css). */
export const TONES = Object.freeze(['muted', 'info', 'accent', 'warning', 'success', 'danger']);

const META = Object.freeze({
  pending: { label: 'Pending', tone: 'muted', icon: 'clock', line: 'Waiting for the VPS to split it into steps.' },
  splitting: { label: 'Splitting', tone: 'accent', icon: 'layers', line: 'The VPS is splitting it into steps with Fable.' },
  split: { label: 'Split', tone: 'muted', icon: 'list', line: 'Split into steps. Waiting for the active place.' },
  'pulling-main': { label: 'Pulling main', tone: 'info', icon: 'download', line: 'The VPS is pulling main into the build.' },
  'assigning-models': { label: 'Assigning models', tone: 'info', icon: 'user', line: 'The triage gate is giving each step its model.' },
  ready: { label: 'Ready', tone: 'info', icon: 'check', line: 'Ready. Waiting for the VPS to send its steps.' },
  sending: { label: 'Sending', tone: 'accent', icon: 'play', line: 'The VPS is sending the steps to their sessions.' },
  building: { label: 'Building', tone: 'accent', icon: 'zap', line: 'The steps are building.' },
  'build-complete': { label: 'Build complete', tone: 'success', icon: 'check', line: 'Every step is built. Waiting for the lander.' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert', line: 'It failed. The VPS tries again by itself.' },
  'waiting-to-merge': { label: 'Waiting to merge', tone: 'warning', icon: 'clock', line: 'Built and waiting its turn to merge.' },
  merging: { label: 'Merging', tone: 'warning', icon: 'branch', line: 'The lander is merging it.' },
  'running-ci': { label: 'Running CI', tone: 'warning', icon: 'refresh', line: 'CI is running on its PR.' },
  landed: { label: 'Landed', tone: 'success', icon: 'check', line: 'Merged into main.' },
});

/** A stored status that is not a display state of its own → the state it shows as. */
const AS_STATE = Object.freeze({ 'merging-pr': 'merging', 'pr-pulling-main': 'merging', 'merging-main': 'merging' });
const LEGACY_LINE = Object.freeze({ 'merging-pr': 'The lander is putting its steps into one PR.', 'pr-pulling-main': 'The lander is pulling main into its PR.', 'merging-main': 'The lander is merging its PR into main.' });
/** Statuses that hold the one active place (pulling main through merging). */
const HOLDS = Object.freeze(['pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'waiting-to-merge', 'merging']);
/** States that wait for the active place. */
const WAITS = Object.freeze(['split']);

const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const beside = (b) => !!(obj(b?.emergency)?.at || obj(b?.hand)?.at);

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n) {
  const x = num(n); if (!x) return '';
  const t = x % 100; const u = x % 10;
  return `${x}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`;
}

/** The short build number as the screen shows it ('' when the store has not given one). */
export const buildNumber = (b) => str(b?.number).trim().slice(0, 24);

/** A state's label; failed carries its attempt: "Failed (attempt 2)". Unknown states read as themselves. */
export function stateLabel(state, attempt = 0) {
  if (state === 'failed') return num(attempt) ? `Failed (attempt ${num(attempt)})` : 'Failed';
  return META[state]?.label ?? (str(state) || 'Unknown');
}
export const stateTone = (state) => META[state]?.tone ?? 'muted';
export const stateIcon = (state) => META[state]?.icon ?? 'layers';

/** The build with this id or build number, among the builds read with it. */
function findBuild(all, key) {
  const k = str(key).trim(); if (!k) return null;
  return (Array.isArray(all) ? all : []).find((x) => x && (str(x.id) === k || (buildNumber(x) && buildNumber(x) === k))) ?? null;
}

/** The build that holds the one active place, other than `b` (builds that run beside the line never hold it). */
export function activeHolder(b, all) {
  return (Array.isArray(all) ? all : []).find((x) => x && x !== b && str(x.id) !== str(b?.id) && !x.deleted && x.flow === 'pipeline-2' && !beside(x)
    && (HOLDS.includes(str(x.status)) || (x.status === 'failed' && HOLDS.includes(str(x.failedFrom))))) ?? null;
}

function normWaiting(w, all) {
  const x = obj(w); if (!x) return null;
  const hit = findBuild(all, x.buildId ?? x.id ?? x.build);
  const buildId = str(hit?.id) || str(x.buildId ?? x.id ?? x.build);
  const title = str(x.title) || str(hit?.title) || buildId;
  if (!buildId && !str(x.reason)) return null;
  return { buildId, number: str(x.number) || (hit ? buildNumber(hit) : ''), title, reason: str(x.reason) || `Waiting: ${title} holds the active place` };
}

/**
 * The merge line: the build's place in the lander's line and the build it waits for. `waitingFor` in the store is a
 * build id or a build number (or { buildId, number, title }); the screen names the build by its number when it has one.
 */
export function normMergeLine(m, all) {
  const x = obj(m); if (!x) return null;
  const position = num(x.position);
  const w = obj(x.waitingFor);
  const key = w ? str(w.buildId ?? w.id ?? w.number) : str(x.waitingFor);
  const hit = findBuild(all, key);
  if (!position && !key) return null;
  const waitingFor = str(hit?.id) || key;
  const waitingForNumber = (hit ? buildNumber(hit) : '') || str(w?.number) || (hit ? '' : key);
  const name = waitingForNumber || waitingFor;
  const text = [position ? `${ordinal(position)} to merge` : '', name ? `waiting for ${name}` : ''].filter(Boolean).join(', ');
  return { position, waitingFor, waitingForNumber, waitingForTitle: str(w?.title) || str(hit?.title), text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** Split provenance: who split the build and with which model ({ by, model, at, stepCount }), or null. */
export function normSplit(s) {
  const x = obj(s); if (!x || !str(x.by)) return null;
  return { by: str(x.by), model: str(x.model), at: str(x.at), stepCount: num(x.stepCount) };
}
/** The words of the split badge: "Split by Fable on the VPS" ('' when the VPS did not split it). */
export function splitLabel(split) {
  if (!split || split.by !== 'vps') return '';
  const m = /fable/i.test(split.model) ? 'Fable' : /opus/i.test(split.model) ? 'Opus' : split.model || 'Fable';
  return `Split by ${m} on the VPS`;
}
/** The same words for one step, from its own `splitBy` ("vps-fable") or the build's split. */
export function stepSplitLabel(splitBy, split = null) {
  const m = /^vps(?:-(.+))?$/.exec(str(splitBy));
  if (m) return splitLabel({ by: 'vps', model: m[1] ?? '' });
  return str(splitBy) ? '' : splitLabel(split);
}

/** The state a build shows when the store read carries no view: the lander's own state, else its status. */
function fallbackState(b) {
  const land = obj(b?.landing);
  const lander = [str(b?.landingState), str(land?.state), str(land?.status)].find((s) => LANDER_STATES.includes(s));
  const status = str(b?.status);
  if (lander && status !== 'failed') return lander;
  return AS_STATE[status] ?? (status || 'pending');
}

function fallbackLine(b, state) {
  const status = str(b?.status);
  const steps = (Array.isArray(b?.steps) ? b.steps : []).filter((s) => s && !s.skip);
  const done = steps.filter((s) => s.done || ['completed', 'in-pr', 'done'].includes(str(s.status))).length;
  if (LEGACY_LINE[status]) return LEGACY_LINE[status];
  if (state === 'split' && steps.length) return `Split into ${steps.length} step${steps.length === 1 ? '' : 's'}. Waiting for the active place.`;
  if (state === 'building' && steps.length) return `Building: ${done} of ${steps.length} step${steps.length === 1 ? '' : 's'} done.`;
  if (state === 'failed') { const n = num(b?.attempt) || 1; const from = str(b?.failedFrom); return `Failed on attempt ${n}${from ? ` while ${stateLabel(AS_STATE[from] ?? from).toLowerCase()}` : ''}.`; }
  return META[state]?.line ?? '';
}

/**
 * What the screen shows for one build: { state, label, tone, icon, line, attempt, waitingOn, mergeLine, fromStore }.
 * `all` is every build read with it (to name the build that holds the active place and the one ahead in the merge
 * line). The store's `pipelineView` wins field by field; anything it leaves out comes from the build's status.
 */
export function viewOf(b, all = []) {
  const pv = obj(b?.pipelineView);
  const state = str(pv?.state) || fallbackState(b);
  const attempt = state === 'failed' ? num(pv?.attempt) || num(b?.attempt) || (Array.isArray(b?.attempts) ? b.attempts.length : 0) || 1 : 0;
  let waitingOn = normWaiting(pv?.waitingOn, all);
  if (!pv && !waitingOn && WAITS.includes(state) && b?.flow === 'pipeline-2' && !beside(b)) {
    const holder = activeHolder(b, all);
    if (holder) waitingOn = normWaiting({ buildId: str(holder.id), title: str(holder.title) }, all);
  }
  const tone = str(pv?.tone);
  return {
    state, attempt,
    label: str(pv?.label) || stateLabel(state, attempt),
    tone: TONES.includes(tone) ? tone : stateTone(state),
    icon: str(pv?.icon) || stateIcon(state),
    line: str(pv?.line) || fallbackLine(b, state),
    waitingOn,
    mergeLine: normMergeLine(pv?.mergeLine ?? b?.mergeLine ?? obj(b?.landing)?.mergeLine, all),
    fromStore: !!pv,
  };
}

/** How many of these rows wait in the merge line (they are what "Merge together" combines). */
export const waitingToMerge = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && (r.view?.state === 'waiting-to-merge' || (r.view?.mergeLine && r.view.state !== 'landed')));
