/**
 * Approvals & veto, pure part (policy-table@1; web, CLI and tests share it). The table is axHub's: this code reads it
 * and works out changes, it decides nothing. A change reaches the hub only from Brett's own hub session (PUT
 * /auth/api/policy, framework/spec/AXHUB-POLICY-API.md); the rules the hub keeps (destructive never allow, explicit
 * approval, owner grants) stay the hub's.
 */
export const TABLE_FRAME = 'policy-table@1';
export const DECISIONS = ['allow', 'veto', 'confirm', 'deny'];
export const VETO_MIN = 10;
export const VETO_MAX = 1800;

export const secondsOk = (n) => Number.isInteger(n) && n >= VETO_MIN && n <= VETO_MAX;

/** Is this tool on the hold list? rules = registry `policyDefaults`: { hold: [{ service, tools }], holdMatch: [regex] }. */
export function onHoldList(service, tool, rules) {
  for (const h of rules?.hold ?? []) if (h.service === service && (h.tools === '*' || (h.tools ?? []).includes(tool))) return h.why || 'on the hold list';
  for (const m of rules?.holdMatch ?? []) { try { if (new RegExp(m, 'i').test(`${service}.${tool}`)) return 'switches accounts'; } catch { /* a bad pattern holds nothing */ } }
  return '';
}

/**
 * What Brett's rule gives a tool (Nov 6 2026: hold only what writes to the VPS or switches accounts):
 * → { decision, why }. Decision null = leave it alone: the hub decides these, or they are stricter on purpose.
 */
export function defaultFor(service, tool, rules) {
  const a = tool.annotations ?? {};
  if (!service.enabled) return { decision: null, why: 'service is off' };
  if (tool.policy === 'deny') return { decision: null, why: 'denied stays denied' }; // the plan never opens anything up
  if (a.explicitApproval || a.ownerGrant) return { decision: null, why: 'always needs Brett' };
  if (a.destructive) return { decision: null, why: 'destructive: the hub keeps its confirm' };
  const held = onHoldList(service.namespace, tool.name, rules);
  if (held) return { decision: 'veto', why: held };
  if (a.readOnly) return { decision: 'allow', why: 'a read' };
  if (service.type === 'ssh') {
    // tools Brett already let through stay through (axHub decision 110, the vps build tools); any other shell tool may write to the VPS
    return tool.policy === 'allow' ? { decision: null, why: 'a fixed tool already let through' } : { decision: 'veto', why: 'shell tool: may write to the VPS' };
  }
  return { decision: 'allow', why: 'not a VPS write or an account switch' };
}

/** The changes that bring the table to the default. → [{ service, tool, from, to, why }] */
export function planDefaults(table, rules) {
  const out = [];
  for (const s of table?.services ?? []) for (const t of s.tools ?? []) {
    const d = defaultFor(s, t, rules);
    if (d.decision && d.decision !== t.policy) out.push({ service: s.namespace, tool: t.name, from: t.policy, to: d.decision, why: d.why });
  }
  return out;
}

/** One decision for every tool of a service. The hub's own rules still apply to each. */
export const groupChanges = (service, policy, vetoSeconds) => (service.tools ?? []).map((t) => ({ service: service.namespace, tool: t.name, policy, ...(vetoSeconds !== undefined ? { vetoSeconds } : {}) }));

/** The one decision all a service's tools share, or 'mixed'. */
export function groupDecision(service) {
  const set = new Set((service.tools ?? []).map((t) => t.policy));
  return set.size === 1 ? [...set][0] : 'mixed';
}

/** How many tools sit on each decision: { allow, veto, confirm, deny }. */
export function counts(table) {
  const n = { allow: 0, veto: 0, confirm: 0, deny: 0 };
  for (const s of table?.services ?? []) for (const t of s.tools ?? []) if (n[t.policy] !== undefined) n[t.policy]++;
  return n;
}

/** A change list's problem in plain words, or ''. */
export function changesProblem(changes) {
  if (!Array.isArray(changes) || !changes.length) return 'nothing to change';
  for (const c of changes) {
    if (typeof c?.service !== 'string' || typeof c?.tool !== 'string') return 'each change names a service and a tool';
    if (c.policy !== null && c.policy !== undefined && !DECISIONS.includes(c.policy)) return `${c.service}.${c.tool}: ${c.policy} is not one of ${DECISIONS.join(', ')}`;
    if (c.vetoSeconds !== undefined && !secondsOk(c.vetoSeconds)) return `${c.service}.${c.tool}: hold is ${VETO_MIN}-${VETO_MAX} seconds`;
  }
  return '';
}

/** Send changes from this browser, on Brett's own hub session. The console server never holds this power. */
export async function putPolicy(hub, changes, reason, { fetch: f = globalThis.fetch } = {}) {
  const bad = changesProblem(changes);
  if (bad) return { ok: false, message: bad };
  let r;
  try { r = await f(`${hub}/auth/api/policy`, { method: 'PUT', credentials: 'include', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes, reason }) }); }
  catch { return { ok: false, message: "Can't reach axHub from this browser." }; }
  if (r.status === 404) return { ok: false, code: 'not_available', message: "axHub doesn't have the policy API yet." };
  if (r.status === 401) return { ok: false, code: 'unauthenticated', message: 'Sign in to axHub in this browser first.' };
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, ...j } : { ok: false, code: j?.error?.code, message: j?.error?.message || `axHub said ${r.status}` };
}
