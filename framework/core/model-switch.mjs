/**
 * model-switch — upgrades need Brett, downgrades don't (Brett, Nov 3 2026: "It cannot be switching the model without my
 * approval. That's not even a veto. That's an approval." … "You can downgrade, but you can't upgrade.").
 *
 * Set after a headless build (agent-swarm-fable-rebuild, PR #247) approved its own Opus → Fable phase switch because
 * its brief said "do every step". The ranking is model-policy's one ordered list (MODEL_TIERS, lowest first), so a new
 * model slots in there and nowhere else.
 *
 *   - A switch to a LOWER model (downgrade) passes by itself; it is recorded (kind 'downgrade', by 'auto').
 *   - A switch to a HIGHER model (upgrade) needs Brett's approval: his own signed-in console click (via 'console') or
 *     an axHub approval he approves (confirm policy, never a veto countdown; via 'axhub'). A session, agent, headless
 *     build or the orchestrator never approves one; a session that reaches an upgrade stops and asks.
 *
 * Pure, no I/O: shared by the orchestrator core (console page, CLI, server), the builds store, the agent swarm planner
 * and the launch gate (framework/cli/model-gate.mjs). The callers pass the environment and headers in.
 */
import { MODEL_LABELS, modelKey, switchKind } from './model-policy.mjs';

export { switchKind, isUpgrade, modelRank } from './model-policy.mjs';

const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');

/** One approval record on a build (orchestrator@1 / builds@1 `approvals[]`). Old records keep their four fields. */
export function normApproval(a) {
  const o = a && typeof a === 'object' ? a : {};
  const out = { phase: Number(o.phase) || 0, from: str(o.from, 10), to: str(o.to, 10), at: str(o.at, 40) };
  for (const k of ['by', 'via', 'kind', 'note', 'request']) if (str(o[k])) out[k] = str(o[k], k === 'note' ? 500 : 120);
  if (o.selfApproved === true) out.selfApproved = true;
  return out;
}

/** One open upgrade request (a session reached an upgrade and asked; Brett answers on axHub or in the console). */
export function normRequest(r) {
  const o = r && typeof r === 'object' ? r : {};
  return { id: str(o.id, 80), phase: Number(o.phase) || 0, from: str(o.from, 10), to: str(o.to, 10), at: str(o.at, 40), by: str(o.by, 120),
    state: ['open', 'approved', 'denied'].includes(o.state) ? o.state : 'open', ...(str(o.job) ? { job: str(o.job, 120) } : {}) };
}

/**
 * Whether an approval record lets an upgrade through: Brett's (console / axHub), or an old record from before the rule
 * (no `by`; those phases are history). A record marked self-approved (the audit) or a downgrade record never does.
 */
export const approvalCounts = (a) => !!a && a.kind !== 'downgrade' && a.selfApproved !== true;

/**
 * Phases of a step list, the orchestrator's rule: a run of consecutive steps with the same model and phase label (a
 * step with no label joins the run before it while the model stays the same). `gate` = it starts with a model switch;
 * `kind` = 'upgrade' | 'downgrade' | 'same' for that switch.
 */
export function stepPhases(steps) {
  const out = [];
  (Array.isArray(steps) ? steps : []).forEach((s, i) => {
    const last = out[out.length - 1];
    if (last && last.model === s.model && (!s.phase || s.phase === last.label)) { last.stepIds.push(s.id ?? `s${i + 1}`); return; }
    const gate = !!last && last.model !== s.model;
    out.push({ index: out.length, model: s.model, label: s.phase || '', from: last?.model ?? '', gate, kind: gate ? switchKind(last.model, s.model) : '', stepIds: [s.id ?? `s${i + 1}`] });
  });
  return out;
}

/** Is this phase clear to run? No gate, a downgrade, or an upgrade Brett approved. */
export function phaseApproved(approvals, p) {
  if (!p?.gate || p.kind !== 'upgrade') return true;
  return (Array.isArray(approvals) ? approvals : []).some((a) => a.phase === p.index && modelKey(a.to) === modelKey(p.model) && approvalCounts(a));
}

/** Step ids of a build that sit in an upgrade phase Brett hasn't approved (nobody may run them yet). */
export function heldSteps(build) {
  const held = new Set();
  for (const p of stepPhases(build?.steps)) if (!phaseApproved(build?.approvals, p)) p.stepIds.forEach((id) => held.add(id));
  return held;
}

/**
 * Why this caller is not Brett, or '' when nothing says it is an agent. Signals (the same ones "who asked" uses on
 * approvals, axHub decision 109): a Claude Code session (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, AI_AGENT), a headless or
 * agent run (AXF_SURFACE headless/agent-job/swarm, AXF_SESSION build:/agent:), and on HTTP an X-Axhub-Session or
 * X-Axhub-Source header naming a session, build or agent.
 */
export function nonHumanSource(env = {}, headers = {}) {
  const e = env ?? {}; const h = {};
  for (const [k, v] of Object.entries(headers ?? {})) h[String(k).toLowerCase()] = String(v ?? '');
  if (e.CLAUDECODE) return 'a Claude Code session (CLAUDECODE)';
  if (e.CLAUDE_CODE_ENTRYPOINT) return `a Claude Code run (${str(e.CLAUDE_CODE_ENTRYPOINT, 40)})`;
  if (e.AI_AGENT) return `an AI agent (${str(e.AI_AGENT, 60)})`;
  if (['headless', 'agent-job', 'swarm', 'agent'].includes(e.AXF_SURFACE)) return `a ${e.AXF_SURFACE} run (AXF_SURFACE)`;
  if (e.AXF_SESSION) return `session ${str(e.AXF_SESSION, 60)} (AXF_SESSION)`;
  for (const k of ['x-axhub-session', 'x-axhub-source']) if (h[k] && h[k] !== 'console') return `${str(h[k], 60)} (${k})`;
  return '';
}

/**
 * The approver an upgrade approval carries, from the caller's environment: the console server sets AXF_APPROVER (the
 * signed-in hub admin) + AXF_APPROVER_VIA=console for Brett's own click, the console's axHub-approved MCP tool sets
 * AXF_APPROVER_VIA=axhub. Returns { ok, by, via } or { ok: false, why }.
 */
export function approverFrom(env = {}, headers = {}) {
  const not = nonHumanSource(env, headers);
  if (not) return { ok: false, why: `${not} can't approve a model upgrade: only Brett can (console click or axHub approval)` };
  const by = str(env.AXF_APPROVER, 120).trim(); const via = str(env.AXF_APPROVER_VIA, 20).trim();
  if (!by || !['console', 'axhub'].includes(via)) return { ok: false, why: 'a model upgrade needs Brett\'s approval: his signed-in console click or an axHub approval he approves' };
  return { ok: true, by, via };
}

const label = (m) => MODEL_LABELS[modelKey(m)] ?? m;
/** The plain line a session, a brief or an approval card uses. */
export const upgradeLine = (buildId, p) => `${buildId}: phase ${p.index + 1}${p.label ? ` (${p.label})` : ''} upgrades ${label(p.from)} → ${label(p.model)}`;

/** What every brief says (no wording may let a session approve an upgrade). */
export const SWITCH_RULE = 'Model switches: a downgrade (e.g. Fable → Opus) is fine and passes by itself. An upgrade (e.g. Opus → Fable) needs Brett\'s approval: stop at it and ask (orchestrator.mjs request-upgrade <id> <phase> files the axHub approval); never approve it yourself, never relaunch on a higher model.';
