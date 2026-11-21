/**
 * Approval rules, pure part (approval-rules@1; the tab, the CLI, the server routes and the tests share it).
 *
 * axHub decides every call from its policy table (policy-table@1, framework/spec/AXHUB-POLICY-API.md). Since axHub
 * decision 121 a service carries an ordered list of match-pattern rules: `{ match, policy?, vetoSeconds? }`, where
 * `match` is a tool-name pattern (`*` = any run of characters), the first match wins and a tool's own entry beats
 * every rule. This file reads that table, keeps a draft of rule edits and works out the one request that saves it.
 * It decides nothing: the hub does, and only Brett's own hub session writes (the browser sends the request).
 */
export const FRAME = 'approval-rules@1';
export const DRAFT_FRAME = 'approval-rules-draft@1';
export const DECISIONS = Object.freeze(['allow', 'veto', 'confirm', 'deny']);
export const HOLD_MIN = 10;
export const HOLD_MAX = 1800;
export const HOLD_DEFAULT = 90;
export const MAX_RULES = 200;
export const OPS = Object.freeze(['add', 'edit', 'remove', 'move', 'set', 'clear-own', 'default', 'discard']);

const fail = (message, code = 'invalid') => Object.assign(new Error(message), { code });
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The hub's own pattern test (axHub packages/core/src/policy.ts → matchesToolPattern): `*` only, whole name. */
export function matches(pattern, name) {
  if (typeof pattern !== 'string' || typeof name !== 'string' || !pattern) return false;
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === name;
  const first = parts[0]; const last = parts[parts.length - 1];
  if (name.length < first.length + last.length || !name.startsWith(first) || !name.endsWith(last)) return false;
  let at = first.length; const end = name.length - last.length;
  for (const mid of parts.slice(1, -1)) {
    if (!mid) continue;
    const i = name.indexOf(mid, at);
    if (i < 0 || i + mid.length > end) return false;
    at = i + mid.length;
  }
  return true;
}

/** What is wrong with a rule, in plain words, or ''. The hub checks the same things again. */
export function ruleProblem(rule) {
  if (!isObj(rule)) return 'a rule is { match, policy, vetoSeconds }';
  const m = rule.match;
  if (typeof m !== 'string' || !m) return 'say which tools: a name or a pattern like build_* or *';
  if (m.length > 128) return 'the pattern is at most 128 characters';
  if (/[\s\x00-\x1f\x7f-\x9f]/.test(m)) return 'the pattern has no spaces';
  if (m === '__proto__') return 'that pattern is not allowed';
  if (rule.policy !== undefined && !DECISIONS.includes(rule.policy)) return `the decision is one of ${DECISIONS.join(', ')}`;
  if (rule.vetoSeconds !== undefined && !(Number.isInteger(rule.vetoSeconds) && rule.vetoSeconds >= HOLD_MIN && rule.vetoSeconds <= HOLD_MAX)) return `the hold is a whole number of seconds from ${HOLD_MIN} to ${HOLD_MAX}`;
  if (rule.policy === undefined && rule.vetoSeconds === undefined) return 'a rule sets a decision, a hold, or both';
  return '';
}

/** A rule with only the fields the hub takes; text numbers become numbers, empty fields drop out. Throws on a bad rule. */
export function cleanRule(rule) {
  const r = isObj(rule) ? rule : {};
  const out = { match: typeof r.match === 'string' ? r.match.trim() : r.match };
  if (r.policy !== undefined && r.policy !== null && r.policy !== '') out.policy = r.policy;
  if (r.vetoSeconds !== undefined && r.vetoSeconds !== null && r.vetoSeconds !== '') out.vetoSeconds = typeof r.vetoSeconds === 'string' && /^\d+$/.test(r.vetoSeconds.trim()) ? Number(r.vetoSeconds.trim()) : r.vetoSeconds;
  const bad = ruleProblem(out);
  if (bad) throw fail(bad);
  return out;
}

export function cleanRules(rules) {
  if (!Array.isArray(rules)) throw fail('rules is a list');
  if (rules.length > MAX_RULES) throw fail(`at most ${MAX_RULES} rules a service`);
  return rules.map((r, i) => { try { return cleanRule(r); } catch (e) { throw fail(`rule ${i + 1}: ${e.message}`); } });
}

const guarded = (tool) => { const a = tool?.annotations ?? {}; return a.destructive === true || a.ownerGrant === true || a.explicitApproval === true; };
const sameRules = (a, b) => JSON.stringify((a ?? []).map(normal)) === JSON.stringify((b ?? []).map(normal));
const normal = (r) => ({ match: r.match, ...(r.policy !== undefined ? { policy: r.policy } : {}), ...(r.vetoSeconds !== undefined ? { vetoSeconds: r.vetoSeconds } : {}) });

/** The rule that would decide a tool (index into `rules`), as the hub picks it: -1 = none. */
export function decidingIndex(rules, tool) {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.policy === undefined || !matches(r.match, tool.name)) continue;
    return r.policy === 'allow' && guarded(tool) ? -1 : i;
  }
  return -1;
}

/** A tool's own entry that 'let the rules decide' would clear: never a deny, never a guarded tool. */
const clearable = (tool) => !!tool.explicit && tool.explicit !== 'deny' && !guarded(tool);

const liveRules = (service) => (Array.isArray(service?.rules) ? service.rules.filter((r) => !ruleProblem(r)).map(normal) : []);
const draftOf = (draft, ns) => (isObj(draft?.services) && isObj(draft.services[ns]) ? draft.services[ns] : null);

/** One service as the editor shows it: live rules, the rules in the draft, and what each rule decides right now. */
export function serviceView(service, entry) {
  const live = liveRules(service);
  const rules = entry && Array.isArray(entry.rules) ? entry.rules.map(normal) : live;
  const clearOwn = !!entry?.clearOwn;
  const tools = Array.isArray(service.tools) ? service.tools : [];
  const own = tools.filter(clearable);
  const decides = rules.map(() => []);
  for (const t of tools) {
    if (t.explicit && !(clearOwn && clearable(t))) continue; // its own entry wins
    const i = decidingIndex(rules, t);
    if (i >= 0) decides[i].push(t.name);
  }
  const counts = { allow: 0, veto: 0, confirm: 0, deny: 0 };
  for (const t of tools) if (counts[t.policy] !== undefined) counts[t.policy]++;
  return {
    service: service.namespace, displayName: service.displayName || service.namespace, type: service.type || '', enabled: service.enabled !== false,
    tools: tools.length, own: own.length, counts, live,
    rules: rules.map((r, i) => ({ ...r, decides: decides[i].length, sample: decides[i].slice(0, 4) })),
    clearOwn, changed: !sameRules(rules, live) || (clearOwn && own.length > 0),
  };
}

/** The request that saves the draft on the hub: every changed rule list, and own entries to clear. null = nothing to save. */
export function saveBody(table, draft, reason = 'Approval rules') {
  const rules = []; const changes = [];
  for (const s of table?.services ?? []) {
    const entry = draftOf(draft, s.namespace);
    if (!entry) continue;
    if (Array.isArray(entry.rules) && !sameRules(entry.rules, liveRules(s))) rules.push({ service: s.namespace, rules: entry.rules.map(normal) });
    if (entry.clearOwn) for (const t of s.tools ?? []) if (clearable(t)) changes.push({ service: s.namespace, tool: t.name, policy: null });
  }
  if (!rules.length && !changes.length) return null;
  return { ...(changes.length ? { changes } : {}), ...(rules.length ? { rules } : {}), reason: String(reason).slice(0, 300) };
}

/**
 * Brett's default (Nov 12 2026, again Nov 21 2026: "It's only supposed to be for writes on the VPS."): a veto countdown
 * only on shell commands that run on the VPS; everything else in the console and the orchestrator runs at once; model
 * upgrades keep their confirm. As rules, so a console tool added later runs at once too. Destructive tools are not
 * opened by `*`: the hub keeps them on their approval.
 */
export const DEFAULT = Object.freeze({
  reason: 'Default: veto countdown only on VPS shell commands',
  summary: 'Holds only shell commands on the VPS (vps run and launch, the console terminal run, Vinny command run). Everything else in the console and the orchestrator runs at once. Model upgrades keep their confirm. Deletes keep their approval.',
  services: Object.freeze({
    vps: { rules: [{ match: 'run', policy: 'veto' }, { match: 'launch', policy: 'veto' }], clearOwn: false },
    'axf-console': {
      rules: [
        { match: 'console_terminal_sessions_run', policy: 'veto' },
        { match: 'agent_manager_vinny_commands_by_cid_run', policy: 'veto' },
        { match: 'orchestrator_upgrade_approve', policy: 'confirm' },
        { match: '*', policy: 'allow' },
      ],
      clearOwn: true,
    },
  }),
});

/** The default as a draft for the services the hub really has. Rules a service already holds beyond the default stay, after the default's. */
export function defaultDraft(table) {
  const services = {};
  for (const s of table?.services ?? []) {
    const d = DEFAULT.services[s.namespace];
    if (!d) continue;
    const mine = d.rules.map(normal);
    const names = new Set(mine.map((r) => r.match));
    const extra = liveRules(s).filter((r) => !names.has(r.match));
    const all = mine.at(-1)?.match === '*' ? [...mine.slice(0, -1), ...extra, mine.at(-1)] : [...mine, ...extra];
    services[s.namespace] = { rules: all, clearOwn: d.clearOwn };
  }
  return services;
}

/** Is the live table already on the default? (every default service holds the default's rules in order, nothing left to clear) */
export function onDefault(table) {
  const want = defaultDraft(table);
  if (!Object.keys(want).length) return false;
  return saveBody(table, { services: want }) === null;
}

/**
 * One edit to the draft → the new draft's `services`. `table` is the live table (the base for a service not yet in
 * the draft). Throws { code: 'invalid' | 'not_found' } with the plain reason.
 *   add { service, rule, index? } · edit { service, index, rule } · remove { service, index } · move { service, index, to }
 *   set { service, rules?, clearOwn? } · clear-own { service, on? } · default {} · discard { service? }
 */
export function stage(draftServices, table, op) {
  const o = isObj(op) ? op : {};
  if (!OPS.includes(o.op)) throw fail(`say what to do: ${OPS.join(', ')}`);
  const out = { ...(isObj(draftServices) ? draftServices : {}) };
  if (o.op === 'default') return defaultDraft(table);
  if (o.op === 'discard') { if (!o.service) return {}; delete out[o.service]; return out; }
  const svc = (table?.services ?? []).find((s) => s.namespace === o.service);
  if (!svc) throw fail(`no service "${o.service ?? ''}" on axHub (${(table?.services ?? []).map((s) => s.namespace).join(', ')})`, 'not_found');
  const cur = isObj(out[svc.namespace]) ? out[svc.namespace] : null;
  const rules = (cur && Array.isArray(cur.rules) ? cur.rules : liveRules(svc)).map(normal);
  let clearOwn = !!cur?.clearOwn;
  const at = (v, max, what = 'index') => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > max) throw fail(`${what} is a rule number from 1 to ${max + 1}`); return n; };
  if (o.op === 'add') {
    if (rules.length >= MAX_RULES) throw fail(`at most ${MAX_RULES} rules a service`);
    const rule = cleanRule(o.rule);
    // a new rule goes above a closing catch-all, where it can still decide something
    const end = rules.length && rules.at(-1).match === '*' ? rules.length - 1 : rules.length;
    rules.splice(o.index === undefined || o.index === null ? end : at(o.index, rules.length), 0, rule);
  } else if (o.op === 'edit') {
    const i = at(o.index, rules.length - 1);
    const patch = isObj(o.rule) ? o.rule : {};
    const merged = { ...rules[i] };
    for (const k of ['match', 'policy', 'vetoSeconds']) if (k in patch) { if (patch[k] === null || patch[k] === '') delete merged[k]; else merged[k] = patch[k]; }
    rules[i] = cleanRule(merged);
  } else if (o.op === 'remove') {
    rules.splice(at(o.index, rules.length - 1), 1);
  } else if (o.op === 'move') {
    const [r] = rules.splice(at(o.index, rules.length - 1), 1);
    rules.splice(at(o.to, rules.length, 'to'), 0, r);
  } else if (o.op === 'set') {
    if (o.rules !== undefined) rules.splice(0, rules.length, ...cleanRules(o.rules));
    if (o.clearOwn !== undefined) clearOwn = !!o.clearOwn;
  } else if (o.op === 'clear-own') {
    clearOwn = o.on === undefined ? true : !!o.on;
  }
  out[svc.namespace] = { rules, clearOwn };
  return out;
}

/** approval-rules@1: what every surface reads. `live` = { hub, available, table?, message? } (claude-settings core readPolicy). */
export function view(live, draft) {
  const base = { $axf: FRAME, ok: true, at: new Date().toISOString(), hub: live?.hub ?? '', decisions: DECISIONS, ops: OPS, default: { summary: DEFAULT.summary, reason: DEFAULT.reason } };
  if (!live?.available || !live.table) return { ...base, available: false, message: live?.message || 'axHub did not answer.', services: [], pending: 0, draft: null, save: null, hold: { default: HOLD_DEFAULT, min: HOLD_MIN, max: HOLD_MAX } };
  const table = live.table;
  if (!(table.services ?? []).every((s) => Array.isArray(s.rules))) {
    return { ...base, available: false, message: 'This axHub has the policy API but not match-pattern rules yet (axHub decision 121).', services: [], pending: 0, draft: null, save: null, hold: { default: HOLD_DEFAULT, min: HOLD_MIN, max: HOLD_MAX } };
  }
  const services = (table.services ?? []).map((s) => serviceView(s, draftOf(draft, s.namespace)));
  const save = saveBody(table, draft, draft?.reason || 'Approval rules');
  return {
    ...base, available: true, services,
    hold: { default: table.veto?.defaultSeconds ?? HOLD_DEFAULT, min: table.veto?.min ?? HOLD_MIN, max: table.veto?.max ?? HOLD_MAX },
    pending: services.filter((s) => s.changed).length,
    draft: save && draft ? { by: draft.by || '', at: draft.at || '', reason: draft.reason || '' } : null,
    save,
    default: { ...base.default, applied: onDefault(table) },
  };
}

/** One plain line a service: for the CLI, voice and toasts. */
export function lines(v) {
  if (!v.available) return [`Approval rules can't be shown: ${v.message}`];
  const out = [];
  for (const s of v.services) {
    if (!s.rules.length && !s.changed) continue;
    out.push(`${s.service}${s.changed ? ' (unsaved)' : ''}: ${s.rules.map((r, i) => `${i + 1}. ${r.match} → ${r.policy ?? 'hold only'}${r.vetoSeconds ? ` ${r.vetoSeconds} s` : ''}`).join(' · ') || 'no rules'}${s.clearOwn ? ` · clears ${s.own} own entries` : ''}`);
  }
  if (!out.length) out.push('No approval rules yet: every tool follows its own entry or its service.');
  out.push(v.default.applied ? 'The default is applied: only VPS shell commands hold.' : 'The default is not applied.');
  if (v.pending) out.push(`${v.pending} service${v.pending === 1 ? '' : 's'} with unsaved rules: Brett saves them from his console (Builds → VPS Configuration → Approval rules).`);
  return out;
}

/** Send the save from this browser, on Brett's own hub session. The console server never holds this power. */
export async function putRules(hub, body, { fetch: f = globalThis.fetch } = {}) {
  if (!body) return { ok: false, message: 'Nothing to save.' };
  let r;
  try { r = await f(`${hub}/auth/api/policy`, { method: 'PUT', credentials: 'include', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { return { ok: false, message: "Can't reach axHub from this browser." }; }
  if (r.status === 404) return { ok: false, code: 'not_available', message: "axHub doesn't have the policy API yet." };
  if (r.status === 401) return { ok: false, code: 'unauthenticated', message: 'Sign in to axHub in this browser first.' };
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, ...j } : { ok: false, code: j?.error?.code, message: j?.error?.message || `axHub said ${r.status}` };
}
