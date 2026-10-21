/**
 * session-archive@1 — every Claude session that worked on Brett's projects, with what ran it, every prompt, what each
 * prompt cost and changed, and the cost record the Build manager uses (Brett, Oct 21 2026).
 *
 * Pure and IO-free: the recorder (framework/cli/session-archive.mjs), the console and the tests share it.
 *
 * A session record:
 *   { $axf, id, source (claude-code | claude-ai | other), sessionId, project, title, startedAt, endedAt, minutes,
 *     system { host, container, app, appVersion, entrypoint, surface, device, via, os, cwd, repo, branch },
 *     user, models[], prompts[], totals, files[], changeIds[], features[], subagents, costSource, notes[] }
 *   prompt = { i, at, kind, text, model, tokens {input, output, cacheRead, cacheWrite, thinking}, costUsd,
 *              costEstimated, seconds, tools {name: n}, commands, files[], changeIds[], features[], output }
 *
 * Costs: Claude Code transcripts carry real token counts per reply, priced with framework/schemas/model-pricing.json
 * (costEstimated false); a model without a price stays null. claude.ai chats have no token counts: their tokens are
 * estimated from the text (CHAT_HEURISTIC, costEstimated true). Claude Code's own session total (cost-state) is kept as
 * totals.reportedUsd when present.
 */

export const SOURCES = ['claude-code', 'claude-ai', 'other'];
export const LIMITS = { prompt: 600, output: 300, title: 120, files: 400, prompts: 2000 };
/** How a claude.ai chat's tokens are estimated (no counts exist): ~4 characters a token, each turn re-reads the chat so far plus a fixed overhead (system prompt, tools, project files). */
export const CHAT_HEURISTIC = { charsPerToken: 4, overheadTokens: 12000, model: 'claude-opus' };

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clip = (v, n) => { const s = str(v).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const ms = (iso) => { const t = Date.parse(str(iso)); return Number.isFinite(t) ? t : 0; };
const r4 = (x) => Math.round(x * 10000) / 10000;

/* ---------------- redaction ---------------- */

const SECRET_RES = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, /sk-[A-Za-z0-9]{20,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, /((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^\s"']{6,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
/** Hide anything that looks like a secret, then cut short. */
export function redact(text, n = LIMITS.prompt) {
  let s = str(text);
  for (const re of SECRET_RES) s = s.replace(re, (m, pre) => (typeof pre === 'string' && pre && m.startsWith(pre) ? `${pre}[hidden]` : '[hidden]'));
  return clip(s, n);
}
/** A prompt as the person typed it: system reminders and attachments wrappers removed. */
export function promptText(content) {
  const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text) : [];
  return parts.map((t) => str(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<(command-name|command-message|command-args|local-command-stdout)>[\s\S]*?<\/\1>/g, (m) => m.replace(/<[^>]+>/g, ' '))).join('\n').trim();
}

/* ---------------- where it ran ---------------- */

/** Claude Code's entrypoint → surface + app + device guess. Open: unknown entrypoints keep their name. */
export function surfaceOf(entrypoint, hints = {}) {
  const e = str(entrypoint);
  if (/remote_cowork|remote/.test(e)) return { surface: 'claude-code-cloud', app: hints.origin === 'claude_ai_chat' ? 'claude.ai (Claude Code in the cloud)' : 'Claude Code on the web', device: hints.device || 'browser or Claude app' };
  if (/sdk|headless|print/.test(e)) return { surface: 'headless', app: 'Claude Code (headless)', device: hints.device || 'server' };
  if (/vscode|jetbrains|ide/.test(e)) return { surface: 'ide', app: `Claude Code in ${/jetbrains/.test(e) ? 'JetBrains' : 'VS Code'}`, device: hints.device || 'computer' };
  if (/desktop/.test(e)) return { surface: 'desktop', app: 'Claude desktop app', device: hints.device || 'computer' };
  if (/github/.test(e)) return { surface: 'github-action', app: 'Claude Code GitHub Action', device: 'GitHub runner' };
  if (e === 'cli' || !e) return { surface: hints.host && /srv\d|vps/i.test(hints.host) ? 'vps-claude-code' : 'claude-code', app: 'Claude Code (terminal)', device: hints.device || (hints.via ? `${hints.via}` : 'terminal') };
  return { surface: e.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 32), app: `Claude Code (${e})`, device: hints.device || '' };
}

/** Which of Brett's projects a working folder / repo belongs to. Open list: callers may pass more rules. */
export const PROJECT_RULES = [
  { project: 'amberx-axf', test: /amberx[-_]?axf|\/axf(\/|$)|axf-console/i },
  { project: 'axhub', test: /axhub|hubx/i },
  { project: 'build-pilot', test: /build[-_]?pilot|pilot/i },
];
export function projectOf(...hints) {
  const hay = hints.map(str).join(' ');
  for (const r of PROJECT_RULES) if (r.test.test(hay)) return r.project;
  return 'other';
}

/* ---------------- Claude Code transcripts ---------------- */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHG_RE = /chg-\d{8}-[0-9a-f]{10}/g;

/**
 * One Claude Code transcript (JSONL text) → a session record. `ctx`: {file, host, container, via, user, os, project,
 * pricing: {costUsd(model, tokens)} (inject framework/cli/model-pricing.mjs), toRepoPath(path)}.
 * Streamed replies repeat a message id on several lines: each id counts once (its last usage wins).
 */
export function parseTranscript(text, ctx = {}) {
  const price = ctx.pricing?.costUsd ?? (() => null);
  const lines = str(text).split('\n');
  let sessionId = '', title = '', entrypoint = '', version = '', cwd = '', branch = '', userType = '', origin = '';
  let first = '', last = '', reported = null, subagents = 0;
  const prompts = [];
  const usageById = new Map(); // message id → {prompt index, usage, model}
  const notes = [];
  let cur = null;
  const newPrompt = (j, kind, textIn) => {
    if (prompts.length >= LIMITS.prompts) return;
    cur = { i: prompts.length + 1, at: str(j.timestamp), kind, text: redact(textIn), model: '', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
      costUsd: 0, costEstimated: false, seconds: 0, tools: {}, commands: 0, files: [], changeIds: [], features: [], output: '', _end: str(j.timestamp) };
    prompts.push(cur);
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.sessionId && !sessionId) sessionId = str(j.sessionId);
    if (j.timestamp) { if (!first || j.timestamp < first) first = j.timestamp; if (!last || j.timestamp > last) last = j.timestamp; }
    if (j.type === 'ai-title' && j.aiTitle) title = str(j.aiTitle);
    if (j.type === 'summary' && j.summary && !title) title = str(j.summary);
    if (j.type === 'cost-state' && Number.isFinite(j.totalCostUSD)) reported = j.totalCostUSD;
    if (j.entrypoint && !entrypoint) entrypoint = str(j.entrypoint);
    if (j.version) version = str(j.version);
    if (j.cwd && !cwd) cwd = str(j.cwd);
    if (j.gitBranch && j.gitBranch !== 'HEAD') branch = str(j.gitBranch);
    if (j.userType && !userType) userType = str(j.userType);
    if (j.type === 'system' && typeof j.content === 'string' && j.content.includes('claude_ai_chat')) origin = 'claude_ai_chat';
    if (j.isSidechain) { subagents++; }
    // the codebase-changes hook tells the session which change entry it opened: that links the prompt to a build
    if ((j.type === 'attachment' || j.type === 'system' || j.isMeta) && cur && /Codebase changes\] Entry chg-/.test(line)) for (const m of line.match(/Entry (chg-\d{8}-[0-9a-f]{10})/g) ?? []) { const id = m.slice(6); if (!cur.changeIds.includes(id)) cur.changeIds.push(id); }
    if (j.type === 'user' && !j.isSidechain && j.message?.role === 'user') {
      const c = j.message.content;
      const isResult = Array.isArray(c) && c.some((b) => b?.type === 'tool_result');
      const kind = j.origin?.kind ? str(j.origin.kind) : isResult ? '' : 'human';
      if (isResult) {
        // tool results are not scanned (listings name every entry); the hook's "Entry … was opened" line is
      } else if (kind && !j.isMeta) {
        const t = promptText(c);
        if (t) newPrompt(j, kind === 'human' ? 'prompt' : kind, t);
        for (const m of t.match(CHG_RE) ?? []) if (cur && !cur.changeIds.includes(m)) cur.changeIds.push(m);
      }
      continue;
    }
    if (j.type === 'assistant' && j.message) {
      const msg = j.message;
      if (!cur) newPrompt(j, 'start', '(session start)');
      if (!cur) continue;
      if (j.timestamp && j.timestamp > cur._end) cur._end = j.timestamp;
      if (msg.usage && msg.model !== '<synthetic>') usageById.set(msg.id ?? `anon-${usageById.size}`, { p: cur, model: str(msg.model), u: msg.usage });
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === 'tool_use') {
          const name = str(b.name);
          cur.tools[name] = (cur.tools[name] ?? 0) + 1;
          if (name === 'Bash') cur.commands++;
          const fp = b.input?.file_path ?? b.input?.notebook_path;
          if (EDIT_TOOLS.has(name) && fp) { const p = ctx.toRepoPath ? ctx.toRepoPath(str(fp)) : str(fp); if (p && !cur.files.includes(p) && cur.files.length < 200) cur.files.push(p); }
          // a change entry the prompt wrote or updated (changes.mjs commands, axhub memory_write of changes/…/<id>.json)
          const inp = JSON.stringify(b.input ?? '');
          if (/memory_write[\s\S]*changes\/\d{4}\/\d{2}\/chg-|changes\.mjs\\?"? (open|step|result|update|beat|close)\b/.test(inp)) for (const m of inp.match(CHG_RE) ?? []) if (!cur.changeIds.includes(m)) cur.changeIds.push(m);
        } else if (b?.type === 'text' && b.text && !j.isSidechain) cur.output = redact(b.text, LIMITS.output);
      }
    }
  }
  // usage → prompts (once per message id)
  const models = new Set();
  for (const { p, model, u } of usageById.values()) {
    const t = { input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0, cacheRead: Number(u.cache_read_input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0 };
    p.tokens.input += t.input; p.tokens.output += t.output; p.tokens.cacheRead += t.cacheRead; p.tokens.cacheWrite += t.cacheWrite;
    p.tokens.thinking += Number(u.output_tokens_details?.thinking_tokens) || 0;
    const c = price(model, t);
    if (c == null) { p.unpriced = true; } else p.costUsd += c;
    if (model) { models.add(model); if (!p.model || !/haiku/.test(model)) p.model = p.model && p.model !== model && !/haiku/.test(p.model) ? p.model : model; }
  }
  for (const [k, p] of prompts.entries()) {
    const next = prompts[k + 1];
    p.seconds = Math.max(0, Math.round((ms(p._end) - ms(p.at)) / 1000));
    p.costUsd = r4(p.costUsd);
    delete p._end;
    if (p.unpriced) { p.costNote = 'a model in this prompt has no price in model-pricing.json'; delete p.unpriced; }
    void next;
  }
  const sys = surfaceOf(entrypoint, { host: ctx.host, via: ctx.via, origin, device: ctx.device });
  const files = [...new Set(prompts.flatMap((p) => p.files))].slice(0, LIMITS.files);
  const changeIds = [...new Set(prompts.flatMap((p) => p.changeIds))];
  const firstPrompt = prompts.find((p) => p.kind === 'prompt');
  const rec = {
    $axf: 'session-archive@1', id: `cc-${sessionId || ctx.fallbackId || 'unknown'}`, source: 'claude-code', sessionId,
    project: ctx.project || projectOf(cwd, ctx.repo, ctx.file, title, firstPrompt?.text),
    title: clip(title || firstPrompt?.text || 'Claude Code session', LIMITS.title),
    startedAt: first, endedAt: last, minutes: first && last ? Math.max(0, Math.round((ms(last) - ms(first)) / 60000)) : 0,
    system: { host: str(ctx.host), container: str(ctx.container), app: sys.app, appVersion: version, entrypoint, surface: sys.surface, device: sys.device, via: str(ctx.via), os: str(ctx.os), cwd, repo: str(ctx.repo), branch },
    user: str(ctx.user) || (userType === 'external' ? 'Brett' : userType || 'unknown'),
    models: [...models].sort(), prompts, files, changeIds, features: [], subagents,
    costSource: 'transcript', notes,
  };
  rec.totals = totalsOf(rec, reported);
  return rec;
}

/** Totals over prompts (+ Claude Code's own reported session cost when known). */
export function totalsOf(rec, reported = rec.totals?.reportedUsd ?? null) {
  const t = { prompts: 0, turns: rec.prompts.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0, costEstimated: false, toolCalls: 0, commands: 0, filesTouched: rec.files.length };
  for (const p of rec.prompts) {
    if (p.kind === 'prompt') t.prompts++;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking']) t[k] += p.tokens?.[k] ?? 0;
    t.costUsd += p.costUsd ?? 0;
    if (p.costEstimated) t.costEstimated = true;
    t.toolCalls += Object.values(p.tools ?? {}).reduce((a, b) => a + b, 0);
    t.commands += p.commands ?? 0;
  }
  t.costUsd = r4(t.costUsd);
  if (reported != null) t.reportedUsd = r4(reported);
  return t;
}

/* ---------------- claude.ai chats ---------------- */

/**
 * A claude.ai chat → a session record with estimated tokens. `chat`: {id, url, title, project, startedAt, endedAt,
 * model?, device?, app?, user?, messages: [{role: human|assistant, at?, text, tools?: {name: n}, files?: []}]}.
 */
export function fromChat(chat, ctx = {}) {
  const price = ctx.pricing?.costUsd ?? (() => null);
  const h = { ...CHAT_HEURISTIC, ...(ctx.heuristic ?? {}) };
  const model = str(chat.model) || h.model;
  const prompts = [];
  let context = 0; // tokens the chat holds so far
  const msgs = Array.isArray(chat.messages) ? chat.messages : [];
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    if (m?.role !== 'human' && m?.role !== 'user') continue;
    const reply = msgs.slice(k + 1).find((x) => x?.role === 'assistant');
    const inTok = Math.ceil(str(m.text).length / h.charsPerToken);
    const outTok = Math.ceil(str(reply?.text).length / h.charsPerToken);
    const tokens = { input: h.overheadTokens + context + inTok, output: outTok, cacheRead: 0, cacheWrite: 0, thinking: 0 };
    const c = price(model, tokens);
    prompts.push({ i: prompts.length + 1, at: str(m.at), kind: 'prompt', text: redact(m.text), model, tokens, costUsd: c == null ? 0 : r4(c), costEstimated: true,
      seconds: m.at && reply?.at ? Math.max(0, Math.round((ms(reply.at) - ms(m.at)) / 1000)) : 0, tools: { ...(reply?.tools ?? {}) }, commands: 0,
      files: (reply?.files ?? []).slice(0, 200).map(str), changeIds: [...new Set(`${str(m.text)} ${str(reply?.text)}`.match(CHG_RE) ?? [])], features: [], output: redact(reply?.text, LIMITS.output) });
    context += inTok + outTok;
  }
  const rec = {
    $axf: 'session-archive@1', id: `ai-${str(chat.id).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'unknown'}`, source: 'claude-ai', sessionId: str(chat.id),
    project: str(chat.project) || projectOf(chat.title), title: clip(chat.title || prompts[0]?.text || 'claude.ai chat', LIMITS.title),
    startedAt: str(chat.startedAt || prompts[0]?.at), endedAt: str(chat.endedAt || prompts.at(-1)?.at),
    minutes: chat.startedAt && chat.endedAt ? Math.max(0, Math.round((ms(chat.endedAt) - ms(chat.startedAt)) / 60000)) : 0,
    system: { host: 'claude.ai', container: '', app: str(chat.app) || 'claude.ai', appVersion: '', entrypoint: 'claude.ai', surface: 'claude-ai', device: str(chat.device) || 'phone or browser', via: '', os: '', cwd: '', repo: '', branch: '', url: str(chat.url) },
    user: str(chat.user) || 'Brett', models: [model], prompts, files: [...new Set(prompts.flatMap((p) => p.files))], changeIds: [...new Set(prompts.flatMap((p) => p.changeIds))],
    features: [], subagents: 0, costSource: 'estimated from text', notes: [`Tokens estimated: ${h.charsPerToken} characters a token, ${h.overheadTokens} tokens of overhead a turn, each turn re-reads the chat so far.`],
  };
  rec.totals = totalsOf(rec, null);
  return rec;
}

/* ---------------- features touched ---------------- */

/**
 * Features (plan / pending / queue items) a prompt touched: a file under a path an item names, a change entry about it
 * (buildRef), or its id in the prompt. `catalog`: [{key, id, kind, title, paths: [], aliases: []}];
 * `changeRefs`: change id → buildRef key.
 */
export function matchFeatures(prompt, catalog = [], changeRefs = {}) {
  const out = new Set();
  for (const c of prompt.changeIds ?? []) if (changeRefs[c]) out.add(changeRefs[c]);
  const files = prompt.files ?? [];
  const hay = str(prompt.text).toLowerCase();
  for (const it of catalog) {
    if ((it.paths ?? []).some((p) => p && files.some((f) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`)))) out.add(it.key);
    else if ([it.id, ...(it.aliases ?? [])].some((a) => a && a.length >= 5 && hay.includes(a.toLowerCase()))) out.add(it.key);
  }
  return [...out];
}

/** Fill prompt.features + record.features. Returns the record (same object). */
export function attachFeatures(rec, catalog, changeRefs) {
  for (const p of rec.prompts) p.features = matchFeatures(p, catalog, changeRefs);
  rec.features = [...new Set(rec.prompts.flatMap((p) => p.features))];
  return rec;
}

/* ---------------- the cost record (Build manager) ---------------- */

/**
 * What every build cost, from the sessions: each prompt's cost goes to the change entries it names (else the last one
 * the session named before it, else "not linked"), and a change entry's cost goes to its build (buildRef).
 * `changes`: change id → {title, buildRef?: {kind,id}, estimate?: {costUsd, minutes}}.
 * Returns {builds: [...], changes: [...], unlinked: {...}, totals}.
 */
export function costRecord(sessions, changes = {}) {
  const byChange = new Map();
  const add = (key, s, p, share) => {
    const r = byChange.get(key) ?? { change: key, sessions: new Set(), prompts: 0, costUsd: 0, estimatedPart: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, first: '', last: '' };
    r.sessions.add(s.id); r.prompts += share;
    r.costUsd += (p.costUsd ?? 0) * share; if (p.costEstimated) r.estimatedPart += (p.costUsd ?? 0) * share;
    for (const k of Object.keys(r.tokens)) r.tokens[k] += Math.round((p.tokens?.[k] ?? 0) * share);
    if (!r.first || p.at < r.first) r.first = p.at; if (!r.last || p.at > r.last) r.last = p.at;
    byChange.set(key, r);
  };
  for (const s of sessions ?? []) {
    let carry = null;
    for (const p of s.prompts ?? []) {
      const ids = (p.changeIds ?? []).filter((x) => /^chg-/.test(x));
      if (ids.length) carry = ids[ids.length - 1];
      const to = ids.length ? ids : carry ? [carry] : ['(not linked)'];
      for (const id of to) add(id, s, p, 1 / to.length);
    }
  }
  const changeRows = [...byChange.values()].map((r) => {
    const c = changes[r.change] ?? {};
    const ref = c.buildRef ? `${c.buildRef.kind}:${c.buildRef.id}` : '';
    return { change: r.change, title: str(c.title) || (r.change === '(not linked)' ? 'Prompts not linked to a build' : r.change), build: ref, sessions: [...r.sessions], prompts: Math.round(r.prompts * 100) / 100,
      costUsd: r4(r.costUsd), costEstimatedUsd: r4(r.estimatedPart), estimateUsd: c.estimate?.costUsd ?? null, estimateMinutes: c.estimate?.minutes ?? null, tokens: r.tokens, first: r.first, last: r.last };
  }).sort((a, b) => b.costUsd - a.costUsd);
  const builds = new Map();
  for (const r of changeRows) {
    const key = r.build || (r.change === '(not linked)' ? '(not linked)' : `change:${r.change}`);
    const b = builds.get(key) ?? { build: key, title: r.build ? '' : r.title, changes: [], sessions: new Set(), prompts: 0, costUsd: 0, costEstimatedUsd: 0, estimateUsd: 0, hasEstimate: false };
    b.changes.push(r.change); r.sessions.forEach((x) => b.sessions.add(x)); b.prompts += r.prompts; b.costUsd += r.costUsd; b.costEstimatedUsd += r.costEstimatedUsd;
    if (r.estimateUsd != null) { b.estimateUsd += r.estimateUsd; b.hasEstimate = true; }
    if (!b.title) b.title = r.title;
    builds.set(key, b);
  }
  const buildRows = [...builds.values()].map((b) => ({ ...b, sessions: [...b.sessions], prompts: Math.round(b.prompts * 100) / 100, costUsd: r4(b.costUsd), costEstimatedUsd: r4(b.costEstimatedUsd), estimateUsd: b.hasEstimate ? r4(b.estimateUsd) : null, overUsd: b.hasEstimate ? r4(b.costUsd - b.estimateUsd) : null })).sort((a, b) => b.costUsd - a.costUsd);
  const totals = { sessions: (sessions ?? []).length, costUsd: r4(buildRows.reduce((a, b) => a + b.costUsd, 0)), estimatedUsd: r4(buildRows.reduce((a, b) => a + b.costEstimatedUsd, 0)), linkedUsd: r4(buildRows.filter((b) => b.build !== '(not linked)').reduce((a, b) => a + b.costUsd, 0)) };
  return { builds: buildRows, changes: changeRows, totals };
}

/* ---------------- browsing ---------------- */

/** The short form for lists (no prompt texts beyond the first). */
export function summary(rec) {
  return { id: rec.id, source: rec.source, project: rec.project, title: rec.title, startedAt: rec.startedAt, endedAt: rec.endedAt, minutes: rec.minutes,
    system: rec.system, user: rec.user, models: rec.models, totals: rec.totals, changeIds: rec.changeIds, features: rec.features, files: rec.files.length,
    firstPrompt: rec.prompts.find((p) => p.kind === 'prompt')?.text ?? '', costSource: rec.costSource, subagents: rec.subagents };
}

/** Filter summaries: project, source, surface, host, device, model, since/until, min cost, change, feature, q (title/prompt/files/host/app). */
export function filterSessions(list, f = {}) {
  const q = str(f.q).toLowerCase().trim();
  return list.filter((s) => (!f.project || s.project === f.project) && (!f.source || s.source === f.source)
    && (!f.surface || s.system?.surface === f.surface) && (!f.host || str(s.system?.host).includes(f.host))
    && (!f.model || (s.models ?? []).some((m) => m.toLowerCase().includes(String(f.model).toLowerCase())))
    && (!f.since || s.startedAt >= f.since) && (!f.until || s.startedAt <= f.until)
    && (!f.minCost || (s.totals?.costUsd ?? 0) >= Number(f.minCost))
    && (!f.change || (s.changeIds ?? []).includes(f.change)) && (!f.feature || (s.features ?? []).includes(f.feature))
    && (!q || [s.title, s.firstPrompt, s.id, s.project, s.user, ...(Object.values(s.system ?? {})), ...(s.changeIds ?? []), ...(s.features ?? [])].some((v) => str(v).toLowerCase().includes(q))));
}

/** Counts and sums for the header: by project, source, surface, device/app, model, day. */
export function aggregate(list) {
  const groups = { project: {}, source: {}, surface: {}, app: {}, model: {}, day: {} };
  const bump = (g, k, s) => { const r = groups[g][k || 'unknown'] ?? { sessions: 0, prompts: 0, costUsd: 0 }; r.sessions++; r.prompts += s.totals?.prompts ?? 0; r.costUsd = r4(r.costUsd + (s.totals?.costUsd ?? 0)); groups[g][k || 'unknown'] = r; };
  for (const s of list) {
    bump('project', s.project, s); bump('source', s.source, s); bump('surface', s.system?.surface, s); bump('app', s.system?.app, s);
    bump('model', (s.models ?? []).filter((m) => !/haiku/.test(m))[0] ?? s.models?.[0], s); bump('day', str(s.startedAt).slice(0, 10), s);
  }
  const t = list.reduce((a, s) => ({ sessions: a.sessions + 1, prompts: a.prompts + (s.totals?.prompts ?? 0), costUsd: r4(a.costUsd + (s.totals?.costUsd ?? 0)), estimatedUsd: r4(a.estimatedUsd + (s.totals?.costEstimated ? s.totals.costUsd : 0)), input: a.input + (s.totals?.input ?? 0), output: a.output + (s.totals?.output ?? 0) }), { sessions: 0, prompts: 0, costUsd: 0, estimatedUsd: 0, input: 0, output: 0 });
  return { totals: t, groups };
}
