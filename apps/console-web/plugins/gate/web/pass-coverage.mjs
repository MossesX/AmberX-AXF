/**
 * What an axHub pass covers, for the pass page (VPS Configuration → Passes → axHub passes): the rules behind the
 * "All tools" / "Pick services and tools" picker, the coverage chips on a pass card and the runs listed under it.
 * Contract: framework/spec/AXHUB-PASS.md (pass@2 `covers`). No DOM, no network: `../test.mjs` checks every rule here.
 *
 * The picker's state (`Pick`):
 *   services  { <namespace>: true | [tool, …] }   true = every tool of the service, a list = exactly those tools
 *   more      typed entries, comma or space separated: `<service>`, `<service>.<tool>` (`*` = any run of characters),
 *             `scope:<target>` (any service), `<service>[.<tool>]@<target>` (a scoped entry of one service)
 */

/** A pass holds at most this many entries (the schema's limit). */
export const COVER_MAX = 50;
/** Tools drawn per service before the picker asks for a narrower search. */
export const TOOLS_SHOWN = 40;
const PATTERN_RE = /^[A-Za-z0-9._/*-]{1,128}$/;
const ok = (v) => typeof v === 'string' && PATTERN_RE.test(v);

export const emptyPick = () => ({ services: {}, more: '' });

/** One entry as typed text: the inverse of `parseEntry`. */
export function entryText(e) {
  if (e.service === '*') return `scope:${e.scope}`;
  return `${e.service}${e.tool ? `.${e.tool}` : ''}${e.scope ? `@${e.scope}` : ''}`;
}

/** One entry in the owner's words: `vps.run`, `axf-console (every tool)`, `scope tokens.theme`. */
export function entryLabel(e) {
  const what = e.service === '*' ? '' : e.tool ? `${e.service}.${e.tool}` : `${e.service} (every tool)`;
  return [what, e.scope ? `scope ${e.scope}` : ''].filter(Boolean).join(' · ');
}

/** One typed item → an entry, or null when it isn't one. */
export function parseEntry(item) {
  const text = String(item ?? '').trim();
  if (!text) return null;
  if (text.startsWith('scope:')) { const scope = text.slice(6); return ok(scope) ? { service: '*', scope } : null; }
  const at = text.indexOf('@');
  const head = at >= 0 ? text.slice(0, at) : text;
  const scope = at >= 0 ? text.slice(at + 1) : undefined;
  if (scope !== undefined && !ok(scope)) return null;
  const dot = head.indexOf('.');
  const service = dot >= 0 ? head.slice(0, dot) : head;
  const tool = dot >= 0 ? head.slice(dot + 1) : undefined;
  if (!ok(service) || (tool !== undefined && !ok(tool))) return null;
  if (service === '*' && scope === undefined) return null; // anything, anywhere is "All tools"
  if (service.includes('*') && service !== '*') return null; // a service is a namespace, never a pattern
  return { service, ...(tool !== undefined && tool !== '*' ? { tool } : {}), ...(scope !== undefined ? { scope } : {}) };
}

/** The typed field → its entries and the items that are not entries. */
export function parseEntries(text) {
  const entries = []; const bad = [];
  for (const item of String(text ?? '').split(/[\s,]+/).filter(Boolean)) { const e = parseEntry(item); if (e) entries.push(e); else bad.push(item); }
  return { entries, bad };
}

/** A service's tool names (the hub sends names or `{ name }` rows; none on a hub that doesn't list them). */
export const toolNames = (service) => (Array.isArray(service?.tools) ? service.tools.map((t) => (typeof t === 'string' ? t : t?.name)).filter((n) => typeof n === 'string' && n) : []);

/** The services the picker offers: the hub's own list first, else the names another reader knows; one row a namespace. */
export function pickerServices(...lists) {
  const out = new Map();
  for (const list of lists) for (const s of Array.isArray(list) ? list : []) {
    const namespace = s?.namespace ?? s?.service;
    if (!ok(namespace) || namespace.includes('*') || out.has(namespace)) continue;
    out.set(namespace, { namespace, displayName: typeof s.displayName === 'string' && s.displayName ? s.displayName : namespace, tools: toolNames(s) });
  }
  return [...out.values()];
}

/** The tools of a service that match a search, held to `limit`; `more` = how many matched beyond it. */
export function filterTools(tools, q = '', limit = TOOLS_SHOWN) {
  const s = String(q).trim().toLowerCase();
  const hit = s ? tools.filter((t) => t.toLowerCase().includes(s)) : tools;
  return { shown: hit.slice(0, limit), more: Math.max(0, hit.length - limit) };
}

/** A pass's coverage (`all`, `none` or its entries, as `readPassCovers` answers) → what the picker opens with. */
export function pickFromCovers(coverage, services = []) {
  if (coverage === 'all' || coverage === undefined || coverage === null) return { mode: 'all', pick: emptyPick() };
  const pick = emptyPick();
  if (!Array.isArray(coverage)) return { mode: 'pick', pick };
  const known = new Map(services.map((s) => [s.namespace, new Set(s.tools ?? [])]));
  const more = [];
  for (const e of coverage) {
    const tools = e.scope === undefined ? known.get(e.service) : undefined;
    if (tools && !e.tool) pick.services[e.service] = true;
    else if (tools && tools.has(e.tool)) { if (pick.services[e.service] !== true) pick.services[e.service] = [...(pick.services[e.service] ?? []), e.tool]; }
    else more.push(entryText(e));
  }
  pick.more = more.join(', ');
  return { mode: 'pick', pick };
}

/** Tick or untick a whole service. */
export function toggleService(pick, namespace, on) {
  const services = { ...pick.services };
  if (on) services[namespace] = true; else delete services[namespace];
  return { ...pick, services };
}

/** Tick or untick one tool; unticking one under a whole service leaves every other tool of it ticked. */
export function toggleTool(pick, namespace, tool, on, allTools = []) {
  const cur = pick.services[namespace];
  const list = new Set(cur === true ? allTools : cur ?? []);
  if (on) list.add(tool); else list.delete(tool);
  const services = { ...pick.services };
  if (!list.size) delete services[namespace];
  else services[namespace] = allTools.length > 0 && allTools.every((t) => list.has(t)) ? true : [...list];
  return { ...pick, services };
}

/** How a service's own tick box reads: every tool, some, or none. */
export const serviceState = (pick, namespace) => (pick.services[namespace] === true ? 'all' : pick.services[namespace]?.length ? 'some' : 'none');
export const toolPicked = (pick, namespace, tool) => pick.services[namespace] === true || (Array.isArray(pick.services[namespace]) && pick.services[namespace].includes(tool));

/**
 * The picker → the `covers` a grant or an edit sends: `all`, or the picked entries (a tool of a service that is
 * covered whole is dropped, repeats are dropped). `covers` is null with the reason in `error` when nothing valid is picked.
 */
export function coversFromPick(mode, pick) {
  if (mode === 'all') return { covers: 'all', error: '' };
  const { entries: typed, bad } = parseEntries(pick.more);
  if (bad.length) return { covers: null, error: `Not a service, tool or scope: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}` };
  const picked = [];
  for (const [service, v] of Object.entries(pick.services)) {
    if (v === true) picked.push({ service }); else for (const tool of v) picked.push({ service, tool });
  }
  const whole = new Set([...picked, ...typed].filter((e) => !e.tool && !e.scope && e.service !== '*').map((e) => e.service));
  const seen = new Set(); const covers = [];
  for (const e of [...picked, ...typed]) {
    if (e.tool && !e.scope && whole.has(e.service)) continue;
    const key = entryText(e);
    if (!seen.has(key)) { seen.add(key); covers.push(e); }
  }
  if (!covers.length) return { covers: null, error: 'Pick at least one service, tool or scope, or choose All tools.' };
  if (covers.length > COVER_MAX) return { covers: null, error: `A pass holds at most ${COVER_MAX} entries (${covers.length} picked). Tick the whole service or use a pattern.` };
  return { covers, error: '' };
}

/** The chips on a pass card: one "All tools" chip, or one per entry (the first `limit`, then "+N more"). */
export function coverageChips(coverage, includeIrreversible = false, limit = 12) {
  if (coverage === 'all') return [{ label: 'All tools', tone: 'success' }, ...(includeIrreversible ? [{ label: 'irreversible calls too', tone: 'warning' }] : [])];
  if (!Array.isArray(coverage)) return [{ label: 'Nothing: its coverage could not be read', tone: 'danger' }];
  const chips = coverage.slice(0, limit).map((e) => ({ label: entryLabel(e) }));
  return coverage.length > limit ? [...chips, { label: `+${coverage.length - limit} more` }] : chips;
}

/** The line under the picker: what the pass would cover, in the owner's words. */
export function coverageSummary(covers, includeIrreversible = false) {
  if (covers === 'all') return includeIrreversible
    ? 'Covers every tool on every service, irreversible calls included: nothing counts down and nothing asks.'
    : 'Covers every tool on every service, vps.run and the stop tools included: nothing counts down and nothing asks. Irreversible calls still ask.';
  if (!Array.isArray(covers)) return '';
  return `Covers only: ${covers.map(entryLabel).join(', ')}. Every other call keeps its countdown or approval.`;
}

/** Minutes as a length: `45 min`, `2 h`, `24 h`, `1 h 30 min`. */
export function lengthLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/** The minutes field: a whole number inside the hub's limits, or the reason it isn't. */
export function minutesError(text, limits) {
  const n = Number(text);
  return String(text).trim() !== '' && Number.isInteger(n) && n >= limits.min && n <= limits.max ? '' : `A whole number from ${limits.min} to ${limits.max}.`;
}

/** The body of `POST /auth/api/passes`: the coverage, the length, the reason and the two switches. */
export function grantBody({ covers, minutes, reason, includeIrreversible = false, quietNotice = false }) {
  return { covers, minutes: Math.round(Number(minutes)), reason: String(reason).trim(), quietNotice: !!quietNotice, ...(covers === 'all' && includeIrreversible ? { include_irreversible: true } : {}) };
}

/** The body of `POST /auth/api/passes/<id>/update`: the coverage and the two switches (the length is Extend's). */
export function updateBody({ covers, includeIrreversible = false, quietNotice = false }) {
  return { covers, quietNotice: !!quietNotice, include_irreversible: covers === 'all' && !!includeIrreversible };
}

const SKIPPED = { veto: 'no countdown', confirm: 'no approval prompt', 'always-approve': 'no approval prompt (always-approve tool)' };
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** One log entry that ran under a pass → the line on the pass card: the tool, what the pass skipped, when, and a failure. */
export function runLine(e) {
  const tool = text(e?.qualifiedTool) || [text(e?.service), text(e?.tool)].filter(Boolean).join('.') || '(unknown tool)';
  return { id: text(e?.id) || `${tool}@${text(e?.ranAt) || text(e?.createdAt)}`, tool, skipped: SKIPPED[e?.policySkipped] ?? '', at: text(e?.ranAt) || text(e?.createdAt), failed: text(e?.status).startsWith('failed') };
}

/** The runs a pass card lists: the newest `limit` entries of the log read for that pass. */
export const runLines = (entries, limit = 5) => (Array.isArray(entries) ? entries.slice(0, limit).map(runLine) : []);

/** The heading over them: `No call has run under it yet.`, `1 call ran under it`, `12 calls ran under it, last 3 min ago`. */
export function runsHeading(uses, lastAgo = '') {
  const n = Math.max(0, Math.round(Number(uses) || 0));
  if (!n) return 'No call has run under it yet.';
  return `${n} call${n === 1 ? '' : 's'} ran under it${lastAgo ? `, last ${lastAgo}` : ''}`;
}
