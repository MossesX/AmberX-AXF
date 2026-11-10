/**
 * headless-context@1 — what a headless Claude Code run takes in (build brief-only-headless, Nov 8 2026, Brett:
 * "Headless builds must NOT load CLAUDE.md, the CLAUDE.md chain, memory folders, rules files or any auto-loaded context.
 * The ONLY input is the brief the orchestrator writes: exactly what that job needs, nothing more.").
 *
 * Pure: no file or process access. The launcher (deploy/claude-headless.sh) asks framework/cli/headless-context.mjs for
 * a launch plan, which is built here from the Claude settings (group "Headless sessions") and the brief's own needs:
 *
 *   env   CLAUDE_CODE_DISABLE_CLAUDE_MDS=1   no CLAUDE.md / CLAUDE.local.md / .claude/rules / @-imports, any level
 *         CLAUDE_CODE_DISABLE_AUTO_MEMORY=1  no auto-memory folder (MEMORY.md and its files)
 *         ENABLE_CLAUDEAI_MCP_SERVERS=false  no claude.ai connectors riding in on the account
 *   args  --setting-sources ""              no user / project / local settings files (their hooks print context)
 *         --settings <lean file>            only the reporting hooks, with the context-printing events muted
 *         --strict-mcp-config               no MCP server except the ones this job names (--mcp-config)
 *         --disable-slash-commands          no skills / commands list in the prompt
 *         --tools=<list>                     only the built-in tools a build uses (+ what the brief names)
 *         --disallowedTools=<list>           tools a build never uses (no sub-agents: Agent, Workflow)
 *
 * `--bare` would do most of this in one flag, but it never reads OAuth logins, and the builds run on Claude
 * subscriptions (deploy/claude-login.mjs), so it can't be used.
 *
 * Also here: what the stream's init event says actually loaded (`loadedFrom`), the start tokens of a run (`startOf`,
 * the context of the first request) and the brief budget check (`briefBudget`).
 */
export const FRAME = 'headless-context@1';

/** Defaults; the live values are Claude settings `headless.*` (group "Headless sessions", settings document on axHub). */
export const DEFAULTS = Object.freeze({
  briefOnly: true,                         // the whole profile; off = the old full chain
  mcp: '',                                 // MCP servers every run gets, comma list (default none)
  tools: 'Bash,Read,Edit,Write,Glob,Grep',  // built-in tools every run gets; 'default' = Claude Code's whole set
  disallowedTools: 'Agent,Workflow',       // one agent, no sub-agents (shared rule)
  hooks: 'quiet',                          // quiet = reporting hooks run, nothing they print reaches the context; none; all
  briefBudgetChars: 24000,                 // ~6K tokens: a bigger brief is sent with a warning on the build
  startTokenWarn: 25000,                   // a run that starts above this gets a warning on its meter
});

/** MCP servers the launcher knows how to give a run. Open list: a new server is an entry here plus its config builder. */
export const MCP_SERVERS = Object.freeze({
  axhub: { label: 'axHub', needs: ['AXHUB_TOKEN'], why: 'axHub calls (VPS, GitHub through the hub, approvals)' },
});

/** Hook events whose output Claude Code adds to the conversation: muted under hooks=quiet. */
export const CONTEXT_EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit']);
/** Hooks that exist only to load files into the context: dropped under hooks=quiet (their job is what brief-only removes). */
export const CONTEXT_ONLY_HOOKS = Object.freeze([/\bclaude-sync["']?\s+start\b/]);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const toolName = (s) => /^[A-Za-z][A-Za-z0-9_*().:-]{0,80}$/.test(s);

/** The settings, cleaned: Claude settings values (`headless.*` keys or a plain object) over the defaults. */
export function policyOf(values = {}) {
  const v = (k) => (values[`headless.${k}`] !== undefined ? values[`headless.${k}`] : values[k]);
  const num = (k, min, max) => { const n = Number(v(k)); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : DEFAULTS[k]; };
  const hooks = ['quiet', 'none', 'all'].includes(v('hooks')) ? v('hooks') : DEFAULTS.hooks;
  return {
    briefOnly: typeof v('briefOnly') === 'boolean' ? v('briefOnly') : DEFAULTS.briefOnly,
    mcp: list(v('mcp') ?? DEFAULTS.mcp).filter((m) => Object.hasOwn(MCP_SERVERS, m)),
    tools: String(v('tools') ?? DEFAULTS.tools).trim().toLowerCase() === 'default' ? 'default' : list(v('tools') ?? DEFAULTS.tools).filter(toolName),
    disallowedTools: list(v('disallowedTools') ?? DEFAULTS.disallowedTools).filter(toolName),
    hooks,
    briefBudgetChars: num('briefBudgetChars', 1000, 200000),
    startTokenWarn: num('startTokenWarn', 1000, 500000),
  };
}

/** Built-in tools the brief asks for on top of the set: a line `Needs tools: WebFetch, NotebookEdit`. */
export function briefTools(brief) {
  const out = new Set();
  for (const m of String(brief ?? '').matchAll(/^(?:<!--\s*)?needs[- ]tools\s*:\s*([A-Za-z0-9 ,_*().:-]*?)\s*(?:-->)?\s*$/gim)) for (const s of list(m[1])) if (toolName(s) && s.toLowerCase() !== 'none') out.add(s);
  return [...out];
}

/**
 * What the brief itself asks for: a line `Needs MCP: axhub` (or `<!-- needs-mcp: axhub -->`). Only known servers count.
 * The brief template (_claude/builds/BRIEF-TEMPLATE.md) carries the line; no line = no MCP.
 */
export function briefNeeds(brief) {
  const out = new Set();
  for (const m of String(brief ?? '').matchAll(/^(?:<!--\s*)?needs[- ]mcp\s*:\s*([A-Za-z0-9 ,_-]*?)\s*(?:-->)?\s*$/gim)) for (const s of list(m[1].toLowerCase())) if (Object.hasOwn(MCP_SERVERS, s)) out.add(s);
  return [...out];
}

/**
 * The lean settings file for a run: the hooks of the given settings files (user, project, local; in that order) kept
 * for their side effects (change log, activity, archive), with the context-printing events muted and the
 * context-only hooks dropped. hooks=none = no hooks, hooks=all = every hook as it was (context included).
 * → { settings, kept, muted, dropped }
 */
export function leanSettings(sources = [], hooks = DEFAULTS.hooks) {
  const out = {}; let kept = 0; let muted = 0; let dropped = 0;
  if (hooks !== 'none') {
    for (const src of sources) {
      if (!isObj(src) || !isObj(src.hooks)) continue;
      for (const [event, groups] of Object.entries(src.hooks)) {
        if (!Array.isArray(groups)) continue;
        for (const g of groups) {
          if (!isObj(g) || !Array.isArray(g.hooks)) continue;
          const hs = [];
          for (const h of g.hooks) {
            if (!isObj(h) || h.type !== 'command' || typeof h.command !== 'string') continue;
            if (hooks === 'quiet' && CONTEXT_ONLY_HOOKS.some((re) => re.test(h.command))) { dropped++; continue; }
            if (hooks === 'quiet' && CONTEXT_EVENTS.includes(event)) { hs.push({ ...h, command: `{ ${h.command} ; } >/dev/null 2>&1; true` }); muted++; continue; }
            hs.push({ ...h }); kept++;
          }
          if (hs.length) (out[event] ??= []).push({ ...(g.matcher !== undefined ? { matcher: g.matcher } : {}), hooks: hs });
        }
      }
    }
  }
  return { settings: Object.keys(out).length ? { hooks: out } : {}, kept, muted, dropped };
}

/**
 * The launch plan. `needs` = MCP servers the brief asks for; `have` = servers whose secrets are at hand.
 * → { briefOnly, env: {k: v}, args: [...] (settings file and MCP config paths are placeholders the CLI fills),
 *     mcp: [...], skippedMcp: [{id, why}], line }
 */
export function launchPlan(policy = policyOf(), { needs = [], tools = [], have = Object.keys(MCP_SERVERS) } = {}) {
  const p = isObj(policy) && 'briefOnly' in policy ? policy : policyOf(policy);
  const want = [...new Set([...p.mcp, ...needs])];
  const mcp = want.filter((m) => have.includes(m));
  const skippedMcp = want.filter((m) => !have.includes(m)).map((id) => ({ id, why: `missing ${MCP_SERVERS[id].needs.join(', ')}` }));
  if (!p.briefOnly) return { $axf: FRAME, briefOnly: false, env: {}, args: [], mcp, skippedMcp, line: '# context: full chain (brief-only is off in Claude settings → Headless sessions)' };
  const env = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
  const args = ['--setting-sources', '', '--settings', '{SETTINGS}', '--strict-mcp-config', '--disable-slash-commands'];
  if (mcp.length) args.push('--mcp-config', '{MCP}');
  const toolSet = p.tools === 'default' ? null : [...new Set([...p.tools, ...tools])].filter((t) => !p.disallowedTools.includes(t));
  if (toolSet?.length) args.push(`--tools=${toolSet.join(',')}`);   // = form: variadic flag
  if (p.disallowedTools.length) args.push(`--disallowedTools=${p.disallowedTools.join(',')}`);   // = form: the flag is variadic and would swallow the prompt
  const line = `# context: brief only · no CLAUDE.md, memory or settings files · tools ${toolSet?.length ? toolSet.join(', ') : 'default set'} · MCP ${mcp.length ? mcp.join(', ') : 'none'} · hooks ${p.hooks}`;
  return { $axf: FRAME, briefOnly: true, env, args, tools: toolSet ?? 'default', mcp, skippedMcp, line };
}

/** What the stream's `system/init` event says the run actually loaded. */
export function loadedFrom(init) {
  const e = isObj(init) ? init : {};
  const names = (a) => (Array.isArray(a) ? a.map((x) => (isObj(x) ? x.name : x)).filter((x) => typeof x === 'string') : []);
  const tools = names(e.tools);
  const mcp = Array.isArray(e.mcp_servers) ? e.mcp_servers.map((m) => (isObj(m) ? `${m.name}${m.status && m.status !== 'connected' ? ` (${m.status})` : ''}` : String(m))) : [];
  return {
    model: typeof e.model === 'string' ? e.model : '',
    tools: tools.length, mcpTools: tools.filter((t) => t.startsWith('mcp__')).length, mcp,
    slashCommands: names(e.slash_commands).length, skills: names(e.skills).length, agents: names(e.agents).length,
    plugins: names(e.plugins).length, memory: names(e.memory_paths ?? e.memory_files).length,
  };
}

/** The start of a run: the whole context of its first request (input + cache read + cache write), and its cost. */
export function startOf(usage) {
  const u = isObj(usage) ? usage : {};
  const input = u.input_tokens ?? 0; const read = u.cache_read_input_tokens ?? 0; const write = u.cache_creation_input_tokens ?? 0;
  return { tokens: input + read + write, input, cacheRead: read, cacheWrite: write };
}

/** The brief budget: ok, or a warning line naming the size and the budget. Never refuses a launch. */
export function briefBudget(brief, policy = policyOf()) {
  const chars = String(brief ?? '').length; const budget = policy.briefBudgetChars ?? DEFAULTS.briefBudgetChars;
  const tokens = Math.ceil(chars / 4);
  return chars > budget
    ? { ok: false, chars, tokens, budget, warning: `brief is ${chars} characters (~${tokens} tokens), over the ${budget}-character budget: trim it to what this job needs` }
    : { ok: true, chars, tokens, budget, warning: '' };
}

/** A line for a meter / log when a run started above the warning level. */
export const startWarning = (tokens, policy = policyOf()) => (tokens > policy.startTokenWarn ? `started with ${tokens} tokens of context, over the ${policy.startTokenWarn} warning level` : '');

/* --------------------------------------------------------------- self-contained briefs (rule snippets by tag) */
/** The heading a self-contained brief carries; a brief that has it already gets nothing added at launch. */
export const RULES_HEADING = '## Rules for this job';
/** Max characters of tag-picked rule snippets (each snippet is one rule bullet, never cut). */
export const TAG_SNIPPETS_MAX = 6000;

/** The rule bullets of a rules file with their tags (`<!-- axf-plugin:x -->`, `<!-- axf-build:x -->`). Pure. */
export function taggedRules(text) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    if (!/^- \*\*/.test(raw)) continue;
    const tags = [...raw.matchAll(/<!--\s*axf-(?:plugin|build):([a-z0-9][a-z0-9._-]*)\s*-->/g)].map((m) => m[1]);
    if (!tags.length) continue;
    const title = (/^- \*\*(.+?)\*\*/.exec(raw)?.[1] ?? '').replace(/\s*\(.*$/, '').replace(/[:.]$/, '').trim();
    out.push({ tags, title, line: raw.replace(/<!--.*?-->/g, '').replace(/\s+$/, '') });
  }
  return out;
}

/** Tags never picked by name: every brief names them in its standard lines (the step tick command), and the core rules
 * brief already carries what a headless run needs from them. */
export const COVERED_TAGS = Object.freeze(['build-orchestrator', 'codebase-changes']);

/** Tags the brief names: a known tag that appears in it as a word (e.g. "ui-review", "build-orchestrator"). */
export function briefTags(brief, known) {
  const t = String(brief ?? '').toLowerCase();
  return [...new Set(known)].filter((tag) => !COVERED_TAGS.includes(tag)).filter((tag) => new RegExp(`(^|[^a-z0-9-])${tag.replace(/[.]/g, '\\.')}([^a-z0-9-]|$)`).test(t)).sort();
}

/** Does the brief carry its own rules block (the heading with something under it besides comments)? */
export function hasRules(brief) {
  const t = String(brief ?? ''); const i = t.indexOf(RULES_HEADING);
  if (i < 0) return false;
  const rest = t.slice(i + RULES_HEADING.length); const end = rest.search(/\n## (?!#)/);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '').trim().length > 0;
}

/**
 * The rules block for a brief: the rules brief (rules-briefs@1 compose, saved snippets by condition) plus every rule
 * bullet whose tag the brief names, de-duplicated, under RULES_HEADING. `ruleTexts` = the rules files' text.
 * → { text, chars, tokens, tags: [...], snippets: n, already: bool }
 */
export function composeRules({ brief = '', rulesBrief = '', ruleTexts = [], max = TAG_SNIPPETS_MAX } = {}) {
  if (hasRules(brief)) return { text: '', chars: 0, tokens: 0, tags: [], snippets: 0, already: true };
  const rules = ruleTexts.flatMap(taggedRules);
  const tags = briefTags(brief, rules.flatMap((r) => r.tags));
  const seen = new Set(); const picked = []; let used = 0;
  for (const r of rules) {
    if (!r.tags.some((x) => tags.includes(x)) || seen.has(r.title)) continue;
    if (used + r.line.length > max) continue;
    seen.add(r.title); picked.push(r.line); used += r.line.length + 1;
  }
  const parts = [rulesBrief.trim(), picked.length ? `### Rules for what this job touches (${tags.join(', ')})\n${picked.join('\n')}` : ''].filter(Boolean);
  if (!parts.length) return { text: '', chars: 0, tokens: 0, tags, snippets: 0, already: false };
  const text = `${RULES_HEADING}\n${parts.join('\n\n')}`;
  return { text, chars: text.length, tokens: Math.ceil(text.length / 4), tags, snippets: picked.length, already: false };
}
