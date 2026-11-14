/**
 * HR rules for the build crew (Brett, Nov 10 2026: "It has to be assigned to an employee. If we don't have any builder
 * employees, you have to hire one. Notify me if I want to hire somebody; if I approve it, you hire somebody new. Give
 * them a persona, give them the tools and all that. You need to be able to train the employees with website data.").
 *
 * - Builder job category: the employees who can take the feature-build job type (job-type@1). Builds are booked on
 *   builders only; the router never falls back to someone outside the category for a build.
 * - Hire request (hire-request@1): filed when no builder can take a build (none on the roster, or every one busy). One
 *   open request per job type. Only Brett approves it (his signed-in console click or an axHub approval); on approve
 *   HR hires a builder: name, avatar, persona, voice, job category, tools and limits from the job type.
 * - Knowledge (employee-knowledge@1): website pages fetched for one employee, stored as plain text, listed, removable,
 *   and a capped digest goes into that employee's job briefs.
 *
 * Pure: no IO. hr.mjs does the files, the fetches and the console calls.
 */
import { canTake } from './jobs-core.mjs';
import { normAgent } from './web/swarm-core.mjs';

export const BUILDER_JOB = 'feature-build';
export const HIRE_SCHEMA = 'hire-request@1';
export const KNOWLEDGE_SCHEMA = 'employee-knowledge@1';
export const HIRE_STATES = ['open', 'approved', 'denied'];
/** Knowledge limits: per page, per employee, and the digest that goes into a brief. */
export const PAGE_MAX = 40000;
export const PAGES_MAX = 50;
export const DIGEST_MAX = 2500;
export const CRAWL_MAX = 20;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const slug = (s, max = 24) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);

/** Employees in the builder job category (can take the feature-build job type, not let go). */
export const buildersOf = (jt, roster, state) => roster.agents.filter((a) => canTake(jt, a) && state?.agents?.[a.id]?.status !== 'fired');

/** Builder names, personas and voices a new hire is drawn from (first one not on the roster). */
export const BUILDER_PERSONAS = [
  { first: 'Bea', last: 'Builder', voice: 'warm, quick, plain', catchphrase: 'Steps in, commits out.', bio: 'Ships small, ticks every step, never leaves a branch dirty.', avatar: { face: 'round', hair: 1, gear: 'cap', hue: 24 } },
  { first: 'Remy', last: 'Rivet', voice: 'calm, low, dry', catchphrase: 'Measure twice, push once.', bio: 'Reads the brief twice and the diff three times.', avatar: { face: 'square', hair: 3, gear: 'headphones', hue: 200 } },
  { first: 'Wren', last: 'Wrench', voice: 'bright, fast, upbeat', catchphrase: 'Green CI or it did not happen.', bio: 'Won\'t call a step done until the checks are green.', avatar: { face: 'tall', hair: 5, gear: 'shades', hue: 140 } },
  { first: 'Hal', last: 'Hammer', voice: 'steady, deep, blunt', catchphrase: 'Tokens, not literals.', bio: 'Every colour from the asset tokens, every control from the framework.', avatar: { face: 'round', hair: 4, gear: 'none', hue: 300 } },
  { first: 'Tess', last: 'Tinker', voice: 'clear, friendly, brisk', catchphrase: 'API first, UI second.', bio: 'Wires REST, MCP, CLI and voice before the button.', avatar: { face: 'square', hair: 2, gear: 'cap', hue: 50 } },
];

/**
 * A new builder for the job type: name, avatar and persona from BUILDER_PERSONAS, job category builder (the job type's
 * skills, home = the job type), tools, models and limits from the job type. Returns { agent, skill, profile }:
 * agent@1 for the roster, the skill page, and the profile extras (persona text, voice) the plugin keeps beside it.
 */
export function hireBuilder(jt, roster, at) {
  const taken = new Set(roster.agents.map((a) => a.id));
  let p = BUILDER_PERSONAS.find((x) => !taken.has(slug(x.first)));
  let id = p ? slug(p.first) : '';
  if (!p) { p = BUILDER_PERSONAS[roster.agents.length % BUILDER_PERSONAS.length]; let i = 2; while (taken.has(`${slug(p.first)}${i}`)) i += 1; id = `${slug(p.first)}${i}`; }
  const agent = normAgent({
    id, name: `${p.first} ${p.last}`, role: 'Builder', skill: jt.data.specialty, skills: jt.data.skills, home: jt.id, jobsOnly: true,
    specialty: `Builds features and fixes end to end (${jt.name})`, keywords: ['build', 'feature', 'fix'],
    models: ['opus', 'fable'], tools: jt.data.tools.length ? jt.data.tools : ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
    maxTurns: jt.data.budget.maxTurns, tokenBudget: jt.data.budget.tokens, salary: 25, hiredAt: at.slice(0, 10),
    avatar: p.avatar, catchphrase: p.catchphrase, bio: `${p.bio} Hired ${at.slice(0, 10)} as a builder.`,
  });
  const persona = `${agent.name} is a builder on the AXF crew. Voice: ${p.voice}. ${p.bio} Says: "${p.catchphrase}"`;
  const skill = { id: jt.data.specialty, title: jt.name, schema: 'agent-skill@1', body: `You are a builder: you build features and fixes from a build brief.\n\n- Work the steps in order, commit, push and tick each one.\n- Every UI value comes from asset tokens; framework controls only.\n- Everything you add gets REST, MCP, CLI and voice control.\n- Report what you did and what you could not.`, lines: 4, chars: 0 };
  skill.chars = skill.body.length;
  return { agent, skill, profile: { agent: id, category: 'builder', voice: p.voice, persona, hiredAt: at } };
}

/** One hire request, normalized. */
export function normHireRequest(o = {}) {
  return {
    $axf: HIRE_SCHEMA, id: str(o.id, 120), job: str(o.job, 60) || BUILDER_JOB, category: str(o.category, 40) || 'builder',
    build: str(o.build, 120), why: str(o.why, 600), at: str(o.at, 40), state: HIRE_STATES.includes(o.state) ? o.state : 'open',
    decidedAt: str(o.decidedAt, 40), decidedBy: str(o.decidedBy, 120), via: str(o.via, 20), hired: str(o.hired, 40),
  };
}

/** File a hire request, or return the open one for the job type (never two at once). Returns { list, request, created }. */
export function fileHireRequest(list, { job = BUILDER_JOB, build = '', why = '', at }) {
  const reqs = (list ?? []).map(normHireRequest);
  const open = reqs.find((r) => r.job === job && r.state === 'open');
  if (open) return { list: reqs, request: open, created: false };
  const request = normHireRequest({ id: `hire-${slug(job, 30)}-${at.replace(/[^0-9]/g, '').slice(0, 14)}`, job, build, why, at, state: 'open' });
  return { list: [...reqs, request].slice(-200), request, created: true };
}

/** Close a request (approved / denied). Throws when it is unknown or already decided. */
export function decideHireRequest(list, id, decision, { by, via, at, hired = '' }) {
  if (!['approved', 'denied'].includes(decision)) throw new Error(`decision is approved or denied (got "${decision}")`);
  const reqs = (list ?? []).map(normHireRequest);
  const r = reqs.find((x) => x.id === id);
  if (!r) throw new Error(`no hire request "${id}"`);
  if (r.state !== 'open') throw new Error(`hire request ${id} is already ${r.state}`);
  Object.assign(r, { state: decision, decidedAt: at, decidedBy: str(by, 120), via: str(via, 20), hired: str(hired, 40) });
  return { list: reqs, request: r };
}

/** The AmberX / console notification for an open request (alerts have a deep link, not buttons: it opens the request). */
export function hireAlert(r) {
  return {
    key: `hr:hire:${r.id}`, source: 'agent-swarm', severity: 'warning', title: 'Hire a new builder?',
    body: `${r.why || 'No builder is free to take builds.'}${r.build ? `\nWaiting: ${r.build}` : ''}\nApprove or deny in the Breakroom → Crew, or: agent-job.mjs hire-approve ${r.id} / hire-deny ${r.id}.`,
    link: `agent-swarm.hire-request:${r.id}`, meta: { kind: 'hire-request', request: r.id, job: r.job, build: r.build },
  };
}

/* ------------------------------------------------------------------ knowledge (website training) */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** A web page as plain text: title and readable text (scripts, styles, nav chrome and tags dropped). */
export function pageText(html) {
  const s = String(html ?? '');
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const text = s.replace(/<(head|script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCharCode(Number(e.slice(1)) || 32) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { title: str(title, 200), text: text.slice(0, PAGE_MAX) };
}

/** Same-site links on a page (absolute, no fragments, http(s) only), for a crawl. */
export function sameSiteLinks(html, base) {
  let root; try { root = new URL(base); } catch { return []; }
  const out = new Set();
  for (const m of String(html ?? '').matchAll(/href\s*=\s*["']([^"'#]+)/gi)) {
    try { const u = new URL(m[1], root); if (/^https?:$/.test(u.protocol) && u.host === root.host) { u.hash = ''; out.add(u.href); } } catch { /* not a URL */ }
  }
  return [...out];
}

export const pageId = (url) => { let h = 0; for (const c of String(url)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `p${h.toString(36)}`; };

/** One stored page's index entry. */
export const normPage = (o = {}) => ({ id: str(o.id, 40), url: str(o.url, 1000), title: str(o.title, 200), chars: Number(o.chars) || 0, fetchedAt: str(o.fetchedAt, 40) });

/** Add or refresh pages in an employee's knowledge index (newest kept, PAGES_MAX at most). */
export function addPages(index, pages) {
  const list = (index?.pages ?? []).map(normPage);
  for (const p of pages.map(normPage)) { const i = list.findIndex((x) => x.id === p.id); if (i >= 0) list[i] = p; else list.push(p); }
  return { $axf: KNOWLEDGE_SCHEMA, agent: str(index?.agent, 40), pages: list.slice(-PAGES_MAX) };
}

/** The digest an employee's brief carries: each page's title, URL and opening text, capped at DIGEST_MAX. */
export function knowledgeDigest(index, textOf) {
  const pages = (index?.pages ?? []).map(normPage); if (!pages.length) return '';
  const per = Math.max(200, Math.floor(DIGEST_MAX / pages.length) - 80);
  const body = pages.map((p) => `- ${p.title || p.url} (${p.url}): ${String(textOf(p.id) ?? '').replace(/\s+/g, ' ').slice(0, per)}`).join('\n');
  return `Your trained website knowledge (${pages.length} page${pages.length === 1 ? '' : 's'}):\n${body}`.slice(0, DIGEST_MAX);
}
