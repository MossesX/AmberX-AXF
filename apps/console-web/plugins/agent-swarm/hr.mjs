/**
 * HR for the crew: builder hire requests (Brett approves, HR hires) and website training (hr-core.mjs has the rules).
 * Reached through `node framework/cli/agent-job.mjs <command>` (jobs.mjs main), REST /api/plugins/agent-swarm/hr/*,
 * the console MCP plugin commands of the same routes, and AmberX (the hire notification opens the request).
 *
 *   hire-requests                         every hire request (open first)
 *   hire-request [--build <id>] [--why …]  file one for builders (one open at a time) and notify Brett
 *   hire-approve <request>                Brett only (AXF_APPROVER + AXF_APPROVER_VIA from his console click or axHub)
 *   hire-deny <request>                   Brett only, same check
 *   train <agent> <url> [--crawl <n>]     fetch the page (and up to n same-site pages) into that employee's knowledge
 *   knowledge <agent>                     the pages an employee was trained on
 *   forget <agent> <page id | all>        remove trained pages
 *
 * Data (lifecycle.dataDir): hire-requests.json, profiles.json (persona, voice, category of hires),
 * knowledge/<agent>/index.json + <page id>.txt.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as hr from './hr-core.mjs';
import * as core from './web/swarm-core.mjs';
import { approverFrom } from '../../../../framework/core/model-switch.mjs';
import { dataDir, loadRoster, loadState, readJson, withState, writeJson } from './swarm.mjs';

const reqFile = () => join(dataDir(), 'hire-requests.json');
const profFile = () => join(dataDir(), 'profiles.json');
const kDir = (agent) => join(dataDir(), 'knowledge', agent.replace(/[^a-z0-9-]/gi, ''));

export const loadRequests = () => (readJson(reqFile(), { requests: [] })?.requests ?? []).map(hr.normHireRequest);
const saveRequests = (list) => { mkdirSync(dataDir(), { recursive: true }); writeJson(reqFile(), { $axf: 'hire-requests@1', requests: list }); };
export const loadProfiles = () => readJson(profFile(), { profiles: {} })?.profiles ?? {};

/** Post an alert to the running console (inside its container on the VPS). AXF_HR_CONSOLE=off: no post (tests). */
function postAlert(alert, env = process.env) {
  const name = env.AXF_HR_CONSOLE || env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off') return null;
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts"`;
  const r = spawnSync('docker', ['exec', '-i', name, 'sh', '-c', cmd], { input: JSON.stringify(alert), encoding: 'utf8', timeout: 30e3 });
  return r.error || r.status !== 0 ? null : (r.stdout || '').trim();
}

/** File a builder hire request (deduped) and notify Brett once. Returns { request, created }. */
export function requestHire({ build = '', why = '', job = hr.BUILDER_JOB, at = new Date().toISOString(), env = process.env } = {}) {
  const r = hr.fileHireRequest(loadRequests(), { job, build, why, at });
  if (r.created) {
    saveRequests(r.list);
    postAlert(hr.hireAlert(r.request), env);
    withState((s) => { core.post(s, [{ from: core.BOSS.id, kind: 'status', text: `No builder free${build ? ` for ${build}` : ''}. Asked Brett to approve a new hire.` }], at); });
  }
  return { request: r.request, created: r.created };
}

/** Brett's decision. Approve hires a builder (roster + profile) and returns it; deny closes the request. */
export function decideHire(id, decision, { env = process.env, headers = {}, findType, assignBuild } = {}) {
  const who = approverFrom(env, headers);
  if (!who.ok) throw new Error('a hire needs Brett\'s approval: his signed-in console click or an axHub approval. Nobody else can approve or deny it.');
  const at = new Date().toISOString();
  const open = loadRequests().find((r) => r.id === id);
  if (!open) throw new Error(`no hire request "${id}"`);
  if (decision === 'denied') { const d = hr.decideHireRequest(loadRequests(), id, 'denied', { by: who.by, via: who.via, at }); saveRequests(d.list); return { request: d.request }; }
  const jt = findType(open.job);
  const h = hr.hireBuilder(jt, loadRoster(), at);
  const d = hr.decideHireRequest(loadRequests(), id, 'approved', { by: who.by, via: who.via, at, hired: h.agent.id });
  withState((s) => {
    s.hired.push(h.agent); s.hiredSkills[h.skill.id] = s.hiredSkills[h.skill.id] ?? { id: h.skill.id, title: h.skill.title, body: h.skill.body };
    core.post(s, [core.hiredLine(h.agent.name, 'builds')], at);
  });
  const profiles = loadProfiles(); profiles[h.agent.id] = h.profile; writeJson(profFile(), { $axf: 'employee-profiles@1', profiles });
  saveRequests(d.list);
  // the build that was waiting goes to the new hire (its worktree may be gone: then the next build gets them)
  let assigned = '';
  if (open.build && assignBuild) { try { assignBuild(open.build, { agent: h.agent.id }); assigned = open.build; } catch { /* no worktree to attach */ } }
  return { request: d.request, agent: h.agent, profile: h.profile, assigned };
}

/* ------------------------------------------------------------------ website training */

const knownAgent = (id) => { if (!loadRoster().agents.some((a) => a.id === id)) throw new Error(`no employee "${id}" on the roster`); return id; };
export function knowledge(agent) {
  const idx = readJson(join(kDir(agent), 'index.json'), null) ?? { agent, pages: [] };
  return { ...idx, agent, pages: (idx.pages ?? []).map(hr.normPage) };
}
const pageTextOf = (agent) => (id) => { const f = join(kDir(agent), `${id}.txt`); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
/** The capped digest that goes into this employee's briefs ('' when untrained). */
export const digestFor = (agent) => hr.knowledgeDigest(knowledge(agent), pageTextOf(agent));

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'axf-employee-training/1', Accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(20e3) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/text\/|html|xml|json/.test(type)) throw new Error(`${url}: not a text page (${type || 'no type'})`);
  return (await res.text()).slice(0, 2_000_000);
}

/** Train an employee on a URL (and up to `crawl` more same-site pages). Returns { pages, errors }. */
export async function train(agent, url, { crawl = 0, fetchImpl = globalThis.fetch } = {}) {
  knownAgent(agent);
  let start; try { start = new URL(url); } catch { throw new Error(`"${url}" is not a URL`); }
  if (!/^https?:$/.test(start.protocol)) throw new Error('only http(s) pages can be trained on');
  const limit = Math.max(0, Math.min(hr.CRAWL_MAX, Number(crawl) || 0));
  const todo = [start.href]; const seen = new Set(); const pages = []; const errors = [];
  const at = new Date().toISOString();
  mkdirSync(kDir(agent), { recursive: true });
  while (todo.length && pages.length <= limit) {
    const u = todo.shift(); if (seen.has(u)) continue; seen.add(u);
    try {
      const html = await fetchPage(u, fetchImpl); const { title, text } = hr.pageText(html);
      if (!text) { errors.push(`${u}: no readable text`); continue; }
      const id = hr.pageId(u); writeFileSync(join(kDir(agent), `${id}.txt`), text);
      pages.push({ id, url: u, title, chars: text.length, fetchedAt: at });
      if (limit) for (const l of hr.sameSiteLinks(html, u)) if (!seen.has(l) && todo.length < limit * 4) todo.push(l);
    } catch (e) { errors.push(String(e.message).slice(0, 300)); }
  }
  const idx = hr.addPages(knowledge(agent), pages); idx.agent = agent;
  writeJson(join(kDir(agent), 'index.json'), idx);
  return { agent, pages, errors, total: idx.pages.length };
}

/** Remove one trained page, or all of them. */
export function forget(agent, pageId) {
  knownAgent(agent);
  if (pageId === 'all') { rmSync(kDir(agent), { recursive: true, force: true }); return { agent, removed: 'all', total: 0 }; }
  const idx = knowledge(agent); const before = idx.pages.length;
  idx.pages = idx.pages.filter((p) => p.id !== pageId);
  if (idx.pages.length === before) throw new Error(`${agent} has no trained page "${pageId}"`);
  rmSync(join(kDir(agent), `${pageId}.txt`), { force: true });
  writeJson(join(kDir(agent), 'index.json'), { $axf: hr.KNOWLEDGE_SCHEMA, agent, pages: idx.pages });
  return { agent, removed: pageId, total: idx.pages.length };
}

/** CLI commands (jobs.mjs main hands these over). Returns true when it handled cmd. */
export async function hrMain(cmd, rest, { out, val, findType, assignBuild }) {
  if (cmd === 'hire-requests') { const l = loadRequests().sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || b.at.localeCompare(a.at)); out({ ok: true, requests: l }, l.map((r) => `${r.id}  ${r.state.padEnd(8)} ${r.build || '—'}  ${r.hired ? `hired ${r.hired}` : r.why}`).join('\n') || 'No hire requests.'); return true; }
  if (cmd === 'hire-request') { const r = requestHire({ build: val('--build'), why: val('--why') || 'Requested by hand.' }); out({ ok: true, ...r }, `${r.created ? 'Filed' : 'Already open'}: ${r.request.id}`); return true; }
  if (cmd === 'hire-approve' || cmd === 'hire-deny') {
    const r = decideHire(rest[0], cmd === 'hire-approve' ? 'approved' : 'denied', { findType, assignBuild });
    out({ ok: true, ...r }, r.agent ? `Hired ${r.agent.name} (${r.agent.id}) as a builder.${r.assigned ? ` ${r.assigned} is assigned to them.` : ''}` : `Denied ${r.request.id}.`); return true;
  }
  if (cmd === 'train') { const r = await train(rest[0], rest[1], { crawl: val('--crawl') }); out({ ok: true, ...r }, `${r.agent}: ${r.pages.length} page(s) trained, ${r.total} in total${r.errors.length ? `\n! ${r.errors.join('\n! ')}` : ''}`); return true; }
  if (cmd === 'knowledge') { const k = knowledge(knownAgent(rest[0])); out({ ok: true, ...k, digest: digestFor(rest[0]) }, k.pages.map((p) => `${p.id}  ${p.title || '—'}  ${p.url}  (${p.chars} chars)`).join('\n') || `${rest[0]} has no trained pages.`); return true; }
  if (cmd === 'forget') { const r = forget(rest[0], rest[1]); out({ ok: true, ...r }, `${r.agent}: removed ${r.removed}, ${r.total} left`); return true; }
  return false;
}
