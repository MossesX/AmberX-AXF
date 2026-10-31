/**
 * Plan Studio plain-English AI (Brett, Oct 30 2026: "integrated AI where you can type plain English and have it add
 * to the plan"). Text → plan@1 edits ("ops"), shown as a diff to apply or undo.
 *
 * Two layers, one op vocabulary:
 *  1. rules(): common requests parsed right here, no model needed ("add a step for the installer, Opus, 20 minutes",
 *     "move this to Product > Installer and make it P1", "add a risk: …", "new plan: docs website, parked",
 *     "mark AmberX voice as planned for the Agent voice plan", "what's left on Docs Studio?").
 *  2. Anything else goes to the console's AI (axf.llm@1, whatever model is configured) with modelPrompt(); its reply
 *     is read back with parseModelReply(). Tests use fixed replies, never a live model.
 *
 * Ops:
 *   {op:'set', field, value}                      title|summary|goal|why|status|priority|targetDate|owner|project|profile|body
 *   {op:'category', value}                        "A > B" (created when missing)
 *   {op:'tag', add?:[], remove?:[]}
 *   {op:'add', list, item}                        steps|requirements|acceptance|decisions|questions|risks|outOfScope|links|comments
 *   {op:'remove', list, match}                    text (or step number) to match
 *   {op:'step', match, done?, model?, minutes?}   change one step
 *   {op:'feature', entry, feature?, title, state, plan?}   a catalog feature (planned/have/idea) on a plan
 *   {op:'new-plan', plan}                         a new plan (fields as plan@1)
 *   {op:'answer', text}                           a reply, no change
 *   {op:'ask', text}                              a short question back (the request was unclear)
 */
import * as pc from './plan-core.mjs';

const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
export const OP_KINDS = ['set', 'category', 'tag', 'add', 'remove', 'step', 'feature', 'new-plan', 'answer', 'ask'];
export const SET_FIELDS = ['title', 'summary', 'goal', 'why', 'status', 'priority', 'targetDate', 'owner', 'project', 'profile', 'body'];
export const ADD_LISTS = ['steps', ...pc.LIST_IDS, 'links', 'comments', 'tags'];
/** Edits that never ask first even when "apply small edits straight away" is off are none; these count as small. */
export const SMALL_OPS = new Set(['set', 'category', 'tag', 'add', 'step']);
/** Edits voice always confirms before applying. */
export const BIG_OPS = new Set(['new-plan', 'remove', 'build']);

const LIST_WORDS = {
  step: 'steps', task: 'steps', requirement: 'requirements', req: 'requirements', acceptance: 'acceptance', check: 'acceptance', criterion: 'acceptance', criteria: 'acceptance',
  decision: 'decisions', question: 'questions', 'open question': 'questions', risk: 'risks', 'out of scope': 'outOfScope', 'non-goal': 'outOfScope', comment: 'comments', note: 'comments', link: 'links',
};
const VERBS = '(?:add|put|move|make|mark|set|park|tag|untag|new|create|rename|remove|delete|drop|tick|untick|change|call|title|status|priority|target|owner|due|assign|link|answer|record|note|plan|turn|it\'s|its)';

/** Split "move this to X and make it P1, then add a risk: y" into clauses at verbs. */
export function clauses(text) {
  const t = str(text, 4000).trim().replace(/\s+/g, ' ');
  if (!t) return [];
  // the text after "add a risk:" is free prose: split it only where a plain command on "it/this" follows
  if (/^\s*(add|put)\s+(a|an|another)?\s*(risk|requirement|decision|question|note|comment)s?\s*:/i.test(t)) return t.split(/,?\s+(?:and|then)\s+(?=(?:make|move|park|tag|mark|set)\s+(?:it|this|the plan)\b)/i).map((x) => x.trim().replace(/[.!]+$/, '')).filter(Boolean);
  return t.split(new RegExp(`\\s*(?:[.;]\\s+|,?\\s+(?:and|then|also)\\s+|,\\s+)(?=${VERBS}\\b)`, 'i')).map((x) => x.trim().replace(/[.!]+$/, '')).filter(Boolean);
}

const model = (s) => pc.normModel(s);
const minutes = (s) => { const m = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i.exec(s); return m ? pc.minutesOf(`${m[1]} ${m[2]}`) : 0; };
const status = (s) => { const x = str(s).toLowerCase(); const ids = pc.STATUS_IDS.find((id) => new RegExp(`\\b${id}\\b`).test(x)); return ids ?? (/\bpark/.test(x) ? 'parked' : /\b(finished|complete)\b/.test(x) ? 'done' : /\bin progress\b/.test(x) ? 'building' : ''); };
const prio = (s) => { const m = /\bp\s?([0-3])\b/i.exec(s) ?? /\bpriority\s+([0-3])\b/i.exec(s); return m ? `P${m[1]}` : /\b(urgent|top priority|critical)\b/i.test(s) ? 'P0' : /\bhigh priority\b/i.test(s) ? 'P1' : /\blow priority\b/i.test(s) ? 'P3' : ''; };
const cleanItem = (s) => str(s).replace(/^\s*(?:a|an|the)\s+/i, '').replace(/^["“']|["”']$/g, '').trim();
const date = (s, now) => {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(s); if (iso) return iso[1];
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(s);
  if (m) { const y = m[3] ? Number(m[3]) : new Date(now).getUTCFullYear(); return `${y}-${String(months.indexOf(m[1].toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const rel = /\bin\s+(\d+)\s+(day|week)s?\b/i.exec(s); if (rel) return new Date(Date.parse(now) + Number(rel[1]) * (rel[2].toLowerCase() === 'week' ? 7 : 1) * 86400000).toISOString().slice(0, 10);
  if (/\btomorrow\b/i.test(s)) return new Date(Date.parse(now) + 86400000).toISOString().slice(0, 10);
  return '';
};

/** Best catalog entry for a name ("AmberX voice" → plugin/app entry). Returns {entry, feature?} or null. */
export function findCatalog(catalog, name) {
  const q = str(name).toLowerCase().trim();
  if (!q) return null;
  const toks = q.split(/\s+/).filter(Boolean);
  let best = null;
  for (const e of arr(catalog)) {
    const en = `${e.name} ${e.key}`.toLowerCase();
    for (const f of [null, ...arr(e.features)]) {
      const hay = f ? `${en} ${f.title}`.toLowerCase() : en;
      const hit = toks.filter((t) => hay.includes(t)).length / toks.length;
      const exact = (f ? f.title.toLowerCase() === q : e.name.toLowerCase() === q) ? 0.5 : 0;
      const score = hit + exact + (f ? 0.05 : 0);
      if (hit >= 0.99 && (!best || score > best.score)) best = { entry: e, feature: f, score };
    }
  }
  return best;
}
/** Best plan for a name. */
export function findPlan(plans, name) {
  const q = str(name).toLowerCase().replace(/\b(the|plan)\b/g, '').trim();
  if (!q) return null;
  const exact = arr(plans).find((p) => p.title.toLowerCase() === q || p.id === q);
  if (exact) return exact;
  const toks = q.split(/\s+/).filter(Boolean);
  const scored = arr(plans).map((p) => ({ p, s: toks.filter((t) => p.title.toLowerCase().includes(t)).length / toks.length })).filter((x) => x.s >= 0.99);
  return scored.sort((a, b) => a.p.title.length - b.p.title.length)[0]?.p ?? null;
}

/**
 * Rules: plain English → ops, or null when a clause isn't understood (then the model gets the whole request).
 * ctx: {plan (current, may be null), plans, catalog, categories, now}
 */
export function rules(text, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  const t = str(text).trim();
  if (!t) return { ops: [{ op: 'ask', text: 'What should I add or change?' }], understood: true };
  // questions about plans
  const q = /^(?:what(?:'s| is)\s+left\s+(?:on|in|for)|how\s+(?:far|much)\s+(?:along\s+)?is|status of|where\s+(?:are we|is)\s+(?:on|with))\s+(.+?)\??$/i.exec(t);
  if (q) {
    const p = /^(this|it|this plan)$/i.test(q[1].trim()) ? ctx.plan : findPlan(ctx.plans, q[1]);
    if (!p) return { ops: [{ op: 'ask', text: `Which plan do you mean by "${q[1]}"?` }], understood: true };
    return { ops: [{ op: 'answer', text: answerLeft(p) }], understood: true };
  }
  if (/^(?:what|which)\s+plans?\b|^list\s+(?:my\s+)?plans|^how many plans/i.test(t)) return { ops: [{ op: 'answer', text: answerList(t, ctx.plans ?? []) }], understood: true };
  const ops = [];
  for (const c of clauses(t)) {
    const got = clause(c, ctx, now);
    if (!got) return null;
    ops.push(...got);
  }
  return ops.length ? { ops, understood: true } : null;
}

function clause(c, ctx, now) {
  let m;
  // new plan: docs website, parked
  if ((m = /^(?:new|create|start)\s+(?:a\s+)?plan(?:\s+(?:called|named|for))?\s*[:\-–]?\s*(.+)$/i.exec(c))) {
    const parts = m[1].split(/\s*,\s*/);
    const title = parts.shift().trim();
    const rest = parts.join(', ');
    const plan = { title: title.charAt(0).toUpperCase() + title.slice(1), status: status(rest) || 'draft' };
    const p = prio(rest); if (p) plan.priority = p;
    const cat = /\b(?:in|under|category)\s+(.+?)(?:,|$)/i.exec(rest); if (cat) plan.category = pc.normPath(cat[1]);
    return [{ op: 'new-plan', plan }];
  }
  // mark AmberX voice as planned for the Agent voice plan
  if ((m = /^mark\s+(.+?)\s+as\s+(planned|have|had|built|done|an idea|idea|partial)(?:\s+(?:for|in|on)\s+(?:the\s+)?(.+?)(?:\s+plan)?)?$/i.exec(c)) && arr(ctx.catalog).length) {
    const hit = findCatalog(ctx.catalog, m[1]);
    if (!hit) return [{ op: 'ask', text: `I couldn't find "${m[1]}" in the Catalog. Which plugin, app or library is it?` }];
    const state = /have|had|built|done/i.test(m[2]) ? 'have' : /idea/i.test(m[2]) ? 'idea' : /partial/i.test(m[2]) ? 'partial' : 'planned';
    const target = m[3] ? findPlan(ctx.plans, m[3]) : ctx.plan;
    if (m[3] && !target) return [{ op: 'ask', text: `Which plan is "${m[3]}"?` }];
    if (!target) return [{ op: 'ask', text: 'Which plan should this feature belong to?' }];
    return [{ op: 'feature', entry: hit.entry.key, feature: hit.feature?.id ?? '', title: hit.feature?.title ?? m[1].trim(), state, plan: target.id }];
  }
  // add a step for the installer, Opus, 20 minutes  /  add a step: X (Fable, 1 h)
  if ((m = /^(?:add|put|new)\s+(?:a\s+|another\s+)?(?:build\s+)?(?:step|task)s?\s*(?:for|to|:|-|–|that|which|called)?\s*(.+)$/i.exec(c))) {
    let body = m[1].replace(/\s*\(([^)]*)\)\s*$/, ', $1');
    const parts = body.split(/\s*,\s*/);
    const meta = parts.slice(1).join(' ');
    const mdl = model(meta) || model(parts[0]);
    const mins = minutes(meta) || minutes(parts[0]);
    let text = parts.filter((p, i) => i === 0 || (!model(p) && !minutes(p) && !/^(after|depends)/i.test(p))).join(', ');
    text = text.replace(/\b(on|with|using)\s+(opus|fable|sonnet)\b/i, '').replace(/\b(?:taking|about|~)?\s*\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?)\b/i, '').trim();
    const dep = /\b(?:after|depends on)\s+(?:step\s+)?(\S+)/i.exec(meta);
    const item = { text: cleanItem(text).replace(/^(?:the\s+)?/, '').replace(/^./, (x) => x.toUpperCase()), model: mdl || 'Opus', minutes: mins || 20 };
    if (dep) item.dependsOn = [dep[1].replace(/^(\d+)$/, 's$1')];
    if (!item.text) return null;
    return [{ op: 'add', list: 'steps', item }];
  }
  // add a risk: card fees eat the dollar plan  /  add requirement X  /  out of scope: Y
  if ((m = /^(?:add|put|record|note)\s+(?:a\s+|an\s+|another\s+)?(risk|requirement|req|decision|question|open question|acceptance(?:\s+check)?|check|criterion|criteria|comment|note|non-goal)s?\s*(?:that|:|-|–)?\s*(.+)$/i.exec(c))) {
    const list = LIST_WORDS[m[1].toLowerCase().replace(/\s+check$/, '')] ?? 'requirements';
    const text = cleanItem(m[2]);
    if (!text) return null;
    return [{ op: 'add', list, item: list === 'comments' ? { text, by: 'AI' } : { text } }];
  }
  if ((m = /^(?:out of scope|not doing|won't do)\s*[:\-–]?\s*(.+)$/i.exec(c))) return [{ op: 'add', list: 'outOfScope', item: { text: cleanItem(m[1]) } }];
  if ((m = /^(?:done when|accept(?:ance)? when|acceptance)\s*[:\-–]?\s*(.+)$/i.exec(c))) return [{ op: 'add', list: 'acceptance', item: { text: cleanItem(m[1]) } }];
  // move this to Product > Installer  /  category X
  if ((m = /^(?:move|put|file)\s+(?:this|it|the plan)?\s*(?:in|into|to|under)\s+(.+)$/i.exec(c)) || (m = /^(?:set\s+)?(?:the\s+)?category\s+(?:to\s+)?(.+)$/i.exec(c))) {
    const v = pc.normPath(m[1].replace(/\b(category|folder)\b/gi, ''));
    if (!v) return null;
    if (prio(v) && pc.pathParts(v).length === 1) return [{ op: 'set', field: 'priority', value: prio(v) }];
    return [{ op: 'category', value: v }];
  }
  // make it P1 / priority 0 / urgent
  if (prio(c) && /^(?:make|set|mark|change|it'?s|bump|drop)?\s*(?:it|this|the plan|priority)?\s*(?:to|as)?\s*(?:a\s+)?(?:priority\s+)?(?:p\s?[0-3]|[0-3]|urgent|top priority|critical|high priority|low priority)\s*(?:priority)?$/i.test(c)) return [{ op: 'set', field: 'priority', value: prio(c) }];
  // park it / mark it ready / status done
  if ((m = /^(?:park|shelve)\s+(?:it|this)$/i.exec(c))) return [{ op: 'set', field: 'status', value: 'parked' }];
  if ((m = /^(?:drop|cancel|abandon)\s+(?:it|this|the plan)$/i.exec(c))) return [{ op: 'set', field: 'status', value: 'dropped' }];
  if ((m = /^(?:mark|set|make|change|move)?\s*(?:it|this|the plan|status)?\s*(?:to|as)?\s*(?:status\s+)?(idea|draft|parked|ready|building|done|dropped|finished|complete|in progress)$/i.exec(c))) return [{ op: 'set', field: 'status', value: status(m[1]) }];
  // step 2 done / tick step "contract"
  if ((m = /^(?:tick|check|mark|finish|complete)\s+(?:off\s+)?step\s+(.+?)(?:\s+(?:as\s+)?done)?$/i.exec(c)) || (m = /^step\s+(.+?)\s+(?:is\s+)?done$/i.exec(c))) return [{ op: 'step', match: m[1].replace(/^["']|["']$/g, ''), done: true }];
  if ((m = /^(?:untick|uncheck|reopen)\s+step\s+(.+)$/i.exec(c))) return [{ op: 'step', match: m[1], done: false }];
  if ((m = /^(?:make|set|change|move)\s+step\s+(\S+)\s+(?:to\s+|on\s+)?(.+)$/i.exec(c))) {
    const o = { op: 'step', match: m[1] }; const mdl = model(m[2]); const mins = minutes(m[2]);
    if (mdl) o.model = mdl; if (mins) o.minutes = mins;
    return mdl || mins ? [o] : null;
  }
  // remove the risk about X / remove step 3
  if ((m = /^(?:remove|delete|drop)\s+(?:the\s+)?(step|task|risk|requirement|decision|question|acceptance(?:\s+check)?|check|comment|link)s?\s+(?:about|on|called|saying|number|#)?\s*(.+)$/i.exec(c))) return [{ op: 'remove', list: LIST_WORDS[m[1].toLowerCase().replace(/\s+check$/, '')] ?? 'steps', match: m[2].replace(/^["']|["']$/g, '') }];
  // tag it installer, product / untag x
  if ((m = /^(?:tag|label)\s+(?:it|this)?\s*(?:with|as)?\s*(.+)$/i.exec(c)) || (m = /^add\s+(?:the\s+)?tags?\s+(.+)$/i.exec(c))) return [{ op: 'tag', add: m[1].split(/\s*(?:,|\band\b)\s*/).map((x) => x.replace(/^#/, '').trim().toLowerCase()).filter(Boolean) }];
  if ((m = /^(?:untag|remove\s+(?:the\s+)?tags?)\s+(.+)$/i.exec(c))) return [{ op: 'tag', remove: m[1].split(/\s*(?:,|\band\b)\s*/).map((x) => x.replace(/^#/, '').trim().toLowerCase()).filter(Boolean) }];
  // rename it / call it X / title X
  if ((m = /^(?:rename\s+(?:it|this|the plan)?\s*(?:to)?|call\s+(?:it|this)|title\s*[:\-]?)\s+(.+)$/i.exec(c))) return [{ op: 'set', field: 'title', value: cleanItem(m[1]) }];
  // target / due date
  if ((m = /^(?:target|due|deadline|finish by|set\s+(?:the\s+)?target(?:\s+date)?\s+(?:to)?)\s*(?:date)?\s*(?:is|by|on|for|:)?\s*(.+)$/i.exec(c))) { const d = date(m[1], now); return d ? [{ op: 'set', field: 'targetDate', value: d }] : null; }
  // owner / assign
  if ((m = /^(?:assign\s+(?:it|this)?\s*to|owner\s*(?:is|:)?|set\s+(?:the\s+)?owner\s+(?:to)?)\s+(.+)$/i.exec(c))) return [{ op: 'set', field: 'owner', value: cleanItem(m[1]) }];
  // goal / why / summary
  if ((m = /^(?:set\s+)?(?:the\s+)?(goal|why|summary|reason)\s*(?:is|to|:|-)?\s*(.+)$/i.exec(c))) return [{ op: 'set', field: m[1].toLowerCase() === 'reason' ? 'why' : m[1].toLowerCase(), value: m[2].trim() }];
  // link
  if ((m = /^link\s+(?:it|this)?\s*(?:to)?\s*(https?:\/\/\S+|pr\s*#?\d+|#\d+)(?:\s+as\s+(.+))?$/i.exec(c))) {
    const ref = m[1].replace(/^pr\s*#?|^#/i, (x) => (/^https?/i.test(m[1]) ? x : ''));
    return [{ op: 'add', list: 'links', item: /^https?:/i.test(m[1]) ? { kind: 'url', ref: m[1], label: m[2] ?? '' } : { kind: 'pr', ref, label: m[2] ?? '' } }];
  }
  if ((m = /^(?:this|it)\s+(depends on|blocks|is part of)\s+(?:the\s+)?(.+?)(?:\s+plan)?$/i.exec(c))) {
    const p = findPlan(ctx.plans, m[2]);
    if (!p) return [{ op: 'ask', text: `Which plan is "${m[2]}"?` }];
    return [{ op: 'add', list: 'links', item: { kind: m[1].startsWith('depends') ? 'depends' : m[1].startsWith('blocks') ? 'blocks' : 'part-of', ref: p.id, label: p.title } }];
  }
  return null;
}

export function answerLeft(p) {
  const left = p.steps.filter((s) => !s.done);
  const t = pc.totals(p);
  if (!p.steps.length) return `${p.title} has no steps yet. It's ${p.status}.`;
  if (!left.length) return `Nothing left on ${p.title}: all ${p.steps.length} steps are done.`;
  const list = left.slice(0, 5).map((s, i) => `${i + 1}. ${s.text} (${s.model}${s.minutes ? `, ${pc.fmtMinutes(s.minutes)}` : ''})`).join(' ');
  return `${p.title} is ${p.status}: ${left.length} of ${p.steps.length} steps left, about ${pc.fmtMinutes(t.left) || 'no estimate'}. ${list}${left.length > 5 ? ` …and ${left.length - 5} more.` : ''}`;
}
function answerList(t, plans) {
  const st = status(t);
  const ps = st ? plans.filter((p) => p.status === st) : plans.filter((p) => !['done', 'dropped'].includes(p.status));
  if (!ps.length) return st ? `No plans are ${st}.` : 'There are no open plans.';
  return `${ps.length} ${st || 'open'} plan${ps.length === 1 ? '' : 's'}: ${ps.slice(0, 8).map((p) => p.title).join('; ')}${ps.length > 8 ? '; …' : ''}.`;
}

/* ------------------------------------------------------------------ applying */

/**
 * Apply ops. ctx: {plan, plans, now}. Returns {plan (edited current or null), others: Map(id → edited plan),
 * created: [new plans], summary: [lines], answer, ask, changed}. Never mutates its inputs.
 */
export function applyOps(ops, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  let plan = ctx.plan ? JSON.parse(JSON.stringify(ctx.plan)) : null;
  const others = new Map();
  const created = [];
  const summary = [];
  let answer = '', ask = '';
  const need = () => { if (!plan) throw new Error('Open a plan first (or say "new plan: …").'); return plan; };
  const target = (id) => { if (!id || id === plan?.id) return need(); if (!others.has(id)) { const p = arr(ctx.plans).find((x) => x.id === id); if (!p) throw new Error(`no plan ${id}`); others.set(id, JSON.parse(JSON.stringify(p))); } return others.get(id); };
  const matchStep = (p, m) => {
    const s = str(m).trim().toLowerCase();
    const n = /^(?:s|#)?(\d+)$/.exec(s);
    return n ? p.steps.find((x) => x.id === `s${n[1]}`) ?? p.steps[Number(n[1]) - 1] : p.steps.find((x) => x.id === s) ?? p.steps.find((x) => x.text.toLowerCase().includes(s));
  };
  for (const o of arr(ops)) {
    switch (o?.op) {
      case 'answer': answer = [answer, str(o.text)].filter(Boolean).join(' '); break;
      case 'ask': ask = str(o.text, 300); break;
      case 'set': {
        const p = target(o.plan);
        if (!SET_FIELDS.includes(o.field)) throw new Error(`can't set ${o.field}`);
        let v = str(o.value, o.field === 'body' ? 200000 : 4000);
        if (o.field === 'status' && !pc.STATUS_IDS.includes(v)) throw new Error(`unknown status ${v}`);
        if (o.field === 'priority') { v = v.toUpperCase(); if (!pc.PRIORITIES.includes(v)) throw new Error(`unknown priority ${v}`); }
        p[o.field] = v; summary.push(`${o.field === 'targetDate' ? 'Target date' : o.field[0].toUpperCase() + o.field.slice(1)} → ${v}`); break;
      }
      case 'category': { const p = target(o.plan); p.category = pc.normPath(o.value); summary.push(`Category → ${p.category}`); break; }
      case 'tag': {
        const p = target(o.plan);
        const add = arr(o.add).map((x) => str(x, 40).toLowerCase()).filter(Boolean), rem = arr(o.remove).map((x) => str(x).toLowerCase());
        p.tags = [...new Set([...p.tags.filter((x) => !rem.includes(x)), ...add])];
        if (add.length) summary.push(`Tags + ${add.map((x) => `#${x}`).join(' ')}`); if (rem.length) summary.push(`Tags − ${rem.map((x) => `#${x}`).join(' ')}`); break;
      }
      case 'add': {
        const p = target(o.plan);
        const list = o.list;
        if (list === 'tags') { p.tags = [...new Set([...p.tags, str(o.item?.text ?? o.item).toLowerCase()])]; summary.push(`Tag + #${str(o.item?.text ?? o.item)}`); break; }
        if (!ADD_LISTS.includes(list)) throw new Error(`can't add to ${list}`);
        if (list === 'steps') {
          let n = p.steps.length + 1; while (p.steps.some((x) => x.id === `s${n}`)) n += 1;
          const it = { id: `s${n}`, text: str(o.item?.text, 2000), model: pc.normModel(o.item?.model) || 'Opus', minutes: pc.minutesOf(o.item?.minutes ?? o.item?.estimate) || 20, dependsOn: arr(o.item?.dependsOn), done: false, doneAt: '', phase: str(o.item?.phase) };
          p.steps.push(it); summary.push(`Step ${it.id} + ${it.text} (${it.model}, ${pc.fmtMinutes(it.minutes)})`); break;
        }
        const item = typeof o.item === 'string' ? { text: o.item } : { ...o.item };
        if (list === 'comments') { p.comments.push({ id: `c-${pc.rid()}`, by: str(item.by) || 'AI', at: now, text: str(item.text) }); summary.push(`Comment + ${item.text}`); break; }
        if (list === 'links') { p.links.push({ kind: pc.LINK_KINDS.includes(item.kind) ? item.kind : 'related', ref: str(item.ref), label: str(item.label) }); summary.push(`Link + ${item.kind}: ${item.label || item.ref}`); break; }
        p[list].push({ ...item, text: str(item.text) }); summary.push(`${pc.LISTS[list].label} + ${item.text}`); break;
      }
      case 'remove': {
        const p = target(o.plan);
        const m = str(o.match).toLowerCase();
        if (o.list === 'steps') { const s = matchStep(p, o.match); if (!s) throw new Error(`no step matching "${o.match}"`); p.steps = p.steps.filter((x) => x !== s); for (const x of p.steps) x.dependsOn = x.dependsOn.filter((d) => d !== s.id); summary.push(`Step − ${s.text}`); break; }
        const list = o.list === 'links' ? p.links : p[o.list];
        if (!Array.isArray(list)) throw new Error(`can't remove from ${o.list}`);
        const it = list.find((x) => `${x.text ?? ''} ${x.ref ?? ''} ${x.label ?? ''}`.toLowerCase().includes(m));
        if (!it) throw new Error(`nothing in ${o.list} matches "${o.match}"`);
        if (o.list === 'links') p.links = p.links.filter((x) => x !== it); else p[o.list] = list.filter((x) => x !== it);
        summary.push(`${pc.LISTS[o.list]?.label ?? o.list} − ${it.text ?? it.ref}`); break;
      }
      case 'step': {
        const p = target(o.plan);
        const s = matchStep(p, o.match);
        if (!s) throw new Error(`no step matching "${o.match}"`);
        if (typeof o.done === 'boolean') { s.done = o.done; s.doneAt = o.done ? now : ''; summary.push(`Step ${s.id} ${o.done ? 'done' : 'not done'}`); }
        if (o.model) { s.model = pc.normModel(o.model) || s.model; summary.push(`Step ${s.id} → ${s.model}`); }
        if (o.minutes) { s.minutes = pc.minutesOf(o.minutes); summary.push(`Step ${s.id} → ${pc.fmtMinutes(s.minutes)}`); }
        if (o.text) { s.text = str(o.text, 2000); summary.push(`Step ${s.id} text changed`); }
        break;
      }
      case 'feature': {
        const p = target(o.plan);
        const id = str(o.feature) || pc.slug(o.title, 80);
        const i = p.features.findIndex((f) => f.entry === o.entry && (f.feature || pc.slug(f.title, 80)) === id);
        const f = { entry: str(o.entry), feature: str(o.feature), title: str(o.title), state: pc.FEATURE_STATES.includes(o.state) ? o.state : 'planned' };
        if (i >= 0) p.features[i] = { ...p.features[i], ...f }; else p.features.push(f);
        if (!p.touches.some((x) => x.key === f.entry)) p.touches.push({ key: f.entry });
        summary.push(`${f.title} (${f.entry}) → ${f.state}${o.plan && o.plan !== plan?.id ? ` on ${p.title}` : ''}`); break;
      }
      case 'new-plan': {
        const np = pc.normalize({ ...o.plan, createdAt: now, updatedAt: now, createdBy: 'AI' }, { now });
        created.push(np); summary.push(`New plan: ${np.title} (${np.status})`); break;
      }
      default: throw new Error(`unknown edit ${JSON.stringify(o?.op)}`);
    }
  }
  const fix = (p) => (p ? pc.normalize(p, { now: p.updatedAt }) : p);
  plan = fix(plan);
  for (const [k, v] of others) others.set(k, fix(v));
  const changed = !!(created.length || others.size || (plan && ctx.plan && pc.diff(ctx.plan, plan).length));
  return { plan, others, created, summary, answer, ask, changed };
}

/** Is this edit small enough to apply straight away (setting on), and does voice need a yes first? */
export function isSmall(ops) { return arr(ops).every((o) => SMALL_OPS.has(o.op) || o.op === 'answer'); }
export function isBig(ops) { return arr(ops).some((o) => BIG_OPS.has(o.op)) || arr(ops).filter((o) => o.op !== 'answer').length > 4; }

/* ------------------------------------------------------------------ the model */

/** The system prompt + user message for the console's AI. Keeps the context small: the plan, category paths, plan titles, catalog names. */
export function modelPrompt(text, ctx = {}) {
  const p = ctx.plan;
  const brief = p ? { id: p.id, title: p.title, status: p.status, priority: p.priority, category: p.category, tags: p.tags, summary: p.summary, goal: p.goal, steps: p.steps.map((s) => ({ id: s.id, text: s.text, model: s.model, minutes: s.minutes, done: s.done })), ...Object.fromEntries(pc.LIST_IDS.map((k) => [k, p[k].map((x) => x.text)])), features: p.features } : null;
  const system = [
    'You edit plans in Plan Studio (plan@1). Turn the request into JSON edits. Reply with ONE JSON object only, no prose around it:',
    '{"ops":[…],"reply":"one short sentence for the person"}',
    'Ops: {"op":"set","field":"title|summary|goal|why|status|priority|targetDate|owner|project|profile|body","value":"…"}',
    ' {"op":"category","value":"A > B"} {"op":"tag","add":["x"],"remove":["y"]}',
    ' {"op":"add","list":"steps","item":{"text":"…","model":"Opus|Fable|Sonnet","minutes":20,"dependsOn":["s1"]}}',
    ' {"op":"add","list":"requirements|acceptance|decisions|questions|risks|outOfScope|comments","item":{"text":"…"}}',
    ' {"op":"add","list":"links","item":{"kind":"depends|blocks|part-of|related|pr|branch|build|doc|url","ref":"…","label":"…"}}',
    ' {"op":"remove","list":"steps|risks|…","match":"text or step number"} {"op":"step","match":"s2","done":true,"model":"Fable","minutes":30}',
    ' {"op":"feature","entry":"<catalog key>","feature":"<feature id or empty>","title":"…","state":"planned|have|partial|idea","plan":"<plan id>"}',
    ' {"op":"new-plan","plan":{"title":"…","status":"idea|draft|parked|ready","category":"…","summary":"…","steps":[…]}}',
    ' {"op":"answer","text":"…"} to answer a question about plans (no edit). {"op":"ask","text":"…"} when the request is unclear: one short question.',
    `Statuses: ${pc.STATUS_IDS.join(', ')}. Priorities P0 (most urgent)–P3. Models: Fable for contracts/engines/migrations, Opus for the rest, Sonnet only for trivial work. Steps are 30 minutes or less.`,
    'Edit the open plan unless the person names another plan (then set "plan" on the op to its id). Never invent catalog keys: use the list given.',
  ].join('\n');
  const context = {
    openPlan: brief,
    categories: arr(ctx.categories).slice(0, 200),
    plans: arr(ctx.plans).slice(0, 300).map((x) => ({ id: x.id, title: x.title, status: x.status, left: x.steps.filter((s) => !s.done).length })),
    catalog: arr(ctx.catalog).slice(0, 300).map((e) => ({ key: e.key, name: e.name, features: arr(e.features).slice(0, 40).map((f) => `${f.id}: ${f.title} [${f.state}]`) })),
    builds: arr(ctx.builds).slice(0, 60).map((b) => ({ id: b.id, title: b.title, status: b.status })),
  };
  return { system, messages: [{ role: 'user', content: `Context:\n${JSON.stringify(context)}\n\nRequest: ${str(text, 4000)}` }] };
}

/** The model's reply → {ops, reply}. Tolerates prose and code fences around the JSON; drops ops it doesn't know. */
export function parseModelReply(textReply) {
  const t = str(textReply, 200000);
  const start = t.indexOf('{');
  if (start < 0) return { ops: [{ op: 'answer', text: t.trim() || 'No reply.' }], reply: t.trim() };
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth += 1; else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  let j;
  try { j = JSON.parse(t.slice(start, end + 1)); } catch { return { ops: [{ op: 'answer', text: t.trim() }], reply: t.trim() }; }
  const ops = arr(j.ops).filter((o) => o && OP_KINDS.includes(o.op));
  const reply = str(j.reply, 600);
  if (!ops.length && reply) ops.push({ op: 'answer', text: reply });
  return { ops, reply };
}

/** One turn: rules first, else the model (`complete({system, messages}) → text`). Returns {ops, reply, via}. */
export async function interpret(text, ctx = {}, complete = null) {
  const r = rules(text, ctx);
  if (r) return { ops: r.ops, reply: '', via: 'rules' };
  if (!complete) return { ops: [{ op: 'ask', text: 'I can do that once an AI provider is set up (Settings → AI). Until then try: "add a step …", "add a risk: …", "move this to A > B", "make it P1", "new plan: …".' }], reply: '', via: 'none', needsAi: true };
  const { system, messages } = modelPrompt(text, ctx);
  const out = await complete({ system, messages });
  const parsed = parseModelReply(out);
  return { ...parsed, via: 'model' };
}

/** What to say back after an edit (one or two short sentences, for the screen and for speech). */
export function speakable(res) {
  if (res.ask) return res.ask;
  const bits = [];
  if (res.summary?.length) bits.push(res.summary.length <= 3 ? `${res.summary.join('. ')}.` : `${res.summary.length} changes: ${res.summary.slice(0, 2).join('. ')}, and more.`);
  if (res.answer) bits.push(res.answer);
  return bits.join(' ') || 'Done.';
}
