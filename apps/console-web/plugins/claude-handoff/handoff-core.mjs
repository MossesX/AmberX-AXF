/**
 * Claude handoff kit (claude-handoff@1): everything a NEW Claude account needs to pick up AmberX AXF, as markdown
 * files in the repo (`_claude/handoff/`), plus the one prompt that routes the new account to them.
 *
 * Three kinds of sources, each recorded with where it lives and where it goes on the new account:
 *   - repo     instructions, rules, memory, specs and manifests in this repo (CLAUDE.md, _claude/, framework/spec, …):
 *              the new account reads them from the same repo, so the kit only indexes them (path + hash) and copies a
 *              curated set into context/ for claude.ai Project knowledge;
 *   - user     files under a machine's ~/.claude (user CLAUDE.md, commands, agents, skills, settings hooks, auto-memory)
 *              collected by `handoff.mjs collect` on every machine: copied (secrets redacted) into user/<host>/;
 *   - claude   things only claude.ai knows (Projects, artifacts such as the Pending Builds page, connectors, its
 *              memory): a registry kept in the console (sources/claude-ai.json), with how to recreate each one.
 *
 * Pure apart from reading the repo: no network, no writes (handoff.mjs writes). Never copies secrets: secret-looking
 * files are never sources, values that look like keys are redacted, settings keep env NAMES only.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const FORMAT = 'claude-handoff@1';
export const KIT_DIR = '_claude/handoff';
export const REMIND_HOURS = 6;
export const MAX_FILE = 400_000; // bytes per copied file
export const MAX_USER_FILE = 64_000;
export const MAX_CONTEXT_TOTAL = 1_800_000;
export const HOST_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/* ---------------- secrets ---------------- */

// Same key patterns as the assistant contract (framework/core/assistant.ts SECRET_PATTERN) plus private keys, bearer
// headers and NAME=value lines whose name says it is a secret.
const KEY_PATTERN = /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|fc-[a-f0-9]{24,})\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const BEARER = /\b(Bearer|token)\s+(?!\$\{)(?=[^\s]*\d)[A-Za-z0-9._~+/=-]{24,}/gi; // a real token has digits; prose like "Bearer call/post/put" doesn't
const NAMED = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY))(\s*[=:]\s*)(["']?)(?!\$\{)([^\s"'`]{12,})\3/g;
export const REDACTED = '[redacted secret]';

export function redact(text) {
  if (!text) return text;
  return String(text)
    .replace(PRIVATE_KEY, REDACTED)
    .replace(KEY_PATTERN, REDACTED)
    .replace(BEARER, (_m, w) => `${w} ${REDACTED}`)
    .replace(NAMED, (_m, name, sep, q) => `${name}${sep}${q}${REDACTED}${q}`);
}

/** Files that are never copied, whatever a list says. */
export function secretLooking(path) {
  const n = String(path).split('/').pop().toLowerCase();
  return /^\.env(\.|$)/.test(n) || /(^|[._-])(secrets?|credentials?)(\.|$)/.test(n) || /\.(pem|key|p12|pfx|keystore|jks)$/.test(n)
    || /^id_(rsa|ed25519|ecdsa|dsa)/.test(n) || n === '.anthropic-key' || n === 'token' || n.endsWith('.token');
}

/* ---------------- small helpers ---------------- */

export const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const isFile = (p) => { try { const st = lstatSync(p); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } };
const isDir = (p) => { try { const st = lstatSync(p); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const mdLine = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const fence = (s) => { const t = String(s ?? ''); const n = Math.max(3, ...[...t.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)); return '`'.repeat(n); };

function* walk(dir, { ext = /\.md$/, skip = new Set() } = {}) {
  if (!isDir(dir)) return;
  for (const n of readdirSync(dir).sort()) {
    if (n.startsWith('.') && n !== '.claude') continue;
    const p = join(dir, n);
    if (skip.has(n) || skip.has(p)) continue;
    if (isDir(p)) yield* walk(p, { ext, skip });
    else if (isFile(p) && ext.test(n) && !secretLooking(n)) yield p;
  }
}

/* ---------------- repo sources ---------------- */

/** Every repo file a new account needs to build to spec, with the role it plays. Paths are repo-relative. */
export function repoSources(root) {
  const out = [];
  const add = (abs, role) => {
    const rel = relative(root, abs).split('\\').join('/');
    if (out.some((s) => s.path === rel) || !isFile(abs) || secretLooking(rel)) return;
    out.push({ path: rel, role });
  };
  add(join(root, 'CLAUDE.md'), 'instructions');
  add(join(root, 'project.manifest.json'), 'manifest');
  add(join(root, '.mcp.json'), 'mcp');
  add(join(root, '.claude/settings.json'), 'claude-settings');
  for (const p of walk(join(root, '.claude/commands'))) add(p, 'command');
  for (const p of walk(join(root, '.claude/skills'))) add(p, 'skill');
  for (const p of walk(join(root, '.claude/agents'))) add(p, 'agent');
  for (const p of walk(join(root, '_claude'), { skip: new Set([join(root, KIT_DIR), 'shots']) })) {
    const rel = relative(join(root, '_claude'), p);
    add(p, rel.startsWith('rules') || rel.startsWith('shared/rules') ? 'rules' : rel.startsWith('instructions') || rel.startsWith('shared/instructions') ? 'instructions' : rel === 'README.md' ? 'instructions' : 'memory');
  }
  for (const p of walk(join(root, 'framework/spec'), { skip: new Set(['fixtures']) })) if (!relative(join(root, 'framework/spec'), p).includes('/')) add(p, 'spec');
  add(join(root, 'apps/console-web/plugins/README.md'), 'spec');
  add(join(root, 'framework/boilerplates/README.md'), 'spec');
  for (const base of ['apps', 'projects']) {
    if (!isDir(join(root, base))) continue;
    for (const n of readdirSync(join(root, base)).sort()) {
      const d = join(root, base, n);
      if (!isDir(d)) continue;
      add(join(d, 'project.manifest.json'), 'manifest');
      add(join(d, 'CLAUDE.md'), 'instructions');
      for (const p of walk(join(d, '_claude'), { skip: new Set(['shared', 'shots']) })) add(p, 'memory');
    }
  }
  return out.map((s) => {
    const text = readText(join(root, s.path)) ?? '';
    return { ...s, bytes: Buffer.byteLength(text), sha: sha(text) };
  });
}

/** The files copied into context/ for a claude.ai Project's knowledge (the rest stays index-only). */
export const DEFAULT_CONTEXT = [
  'CLAUDE.md',
  '_claude/README.md',
  '_claude/shared/rules/RULES.md',
  '_claude/rules/RULES.md',
  '_claude/instructions/README.md',
  '_claude/memory/README.md',
  '_claude/memory/amberx-axf.md',
  '_claude/memory/decisions.md',
  '_claude/memory/docs/build-reporting.md',
  '_claude/memory/docs/build-steps.md',
  '_claude/memory/docs/axf-architecture.md',
  'project.manifest.json',
  'framework/spec/PORTING.md',
  'framework/spec/THEMING.md',
  'framework/spec/INTEROP.md',
  'apps/console-web/plugins/README.md',
];

export const contextName = (path) => path.replace(/^_claude\//, 'claude__').replace(/\//g, '__');

/* ---------------- user-scope (a machine's ~/.claude) ---------------- */

/**
 * A machine's Claude files, as `handoff.mjs collect` sends them: user CLAUDE.md, commands, agents, skills, output
 * styles, auto-memory per project, settings (hooks, permissions, env NAMES), MCP servers (names + URLs) and which
 * secret files exist (never their content).
 */
export function collectUserScope(home, host, now = new Date().toISOString()) {
  const claude = join(home, '.claude');
  const files = [];
  const add = (abs, kind) => {
    if (!isFile(abs) || secretLooking(abs) || files.length >= 400) return;
    let text = readText(abs);
    if (text === null) return;
    const truncated = Buffer.byteLength(text) > MAX_USER_FILE;
    if (truncated) text = text.slice(0, MAX_USER_FILE);
    files.push({ path: relative(home, abs).split('\\').join('/'), kind, bytes: Buffer.byteLength(text), sha: sha(text), truncated, content: redact(text) });
  };
  add(join(claude, 'CLAUDE.md'), 'user-instructions');
  for (const [dir, kind] of [['commands', 'command'], ['agents', 'agent'], ['output-styles', 'output-style']]) for (const p of walk(join(claude, dir))) add(p, kind);
  for (const p of walk(join(claude, 'skills'), { skip: new Set(['synced']) })) add(p, 'skill'); // synced = the account's own skills, which follow the account
  if (isDir(join(claude, 'projects'))) {
    for (const n of readdirSync(join(claude, 'projects')).sort()) for (const p of walk(join(claude, 'projects', n, 'memory'))) add(p, 'auto-memory');
  }
  return { $axf: 'claude-handoff-machine@1', host, collectedAt: now, files, settings: summarizeSettings(readJson(join(claude, 'settings.json'))), mcp: summarizeMcp(readJson(join(home, '.claude.json'))), secrets: secretFiles(home) };
}

/** Hooks (commands redacted), permission counts, model, env NAMES only. */
export function summarizeSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const hooks = [];
  for (const [event, list] of Object.entries(s.hooks ?? {})) {
    for (const g of Array.isArray(list) ? list : []) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (typeof h?.command === 'string') hooks.push({ event, matcher: typeof g.matcher === 'string' ? g.matcher : '', command: redact(h.command).slice(0, 400) });
    }
  }
  return {
    hooks,
    env: Object.keys(s.env ?? {}).sort(),
    model: typeof s.model === 'string' ? s.model : undefined,
    permissions: { allow: (s.permissions?.allow ?? []).length, deny: (s.permissions?.deny ?? []).length, defaultMode: s.permissions?.defaultMode },
    enabledPlugins: Object.keys(s.enabledPlugins ?? {}).sort(),
  };
}

export function summarizeMcp(j) {
  const servers = j?.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {};
  return Object.entries(servers).map(([name, v]) => ({ name, type: v?.type ?? (v?.command ? 'stdio' : 'http'), url: typeof v?.url === 'string' ? v.url.replace(/[?#].*$/, '') : undefined, command: typeof v?.command === 'string' ? v.command : undefined })).slice(0, 50);
}

export const SECRET_FILES = ['.anthropic-key', '.config/axhub/token', '.claude/.credentials.json', '.config/gh/hosts.yml', '.ssh/id_ed25519'];
export function secretFiles(home) {
  return SECRET_FILES.filter((p) => existsSync(join(home, p)));
}

/** Validate a machine record sent to the console (sizes, names, shapes). Returns the error or ''. */
export function machineError(m) {
  if (!m || typeof m !== 'object' || m.$axf !== 'claude-handoff-machine@1') return 'not a claude-handoff-machine@1 record';
  if (typeof m.host !== 'string' || !HOST_RE.test(m.host)) return 'host must be lowercase letters, digits, dots, dashes';
  if (!Array.isArray(m.files) || m.files.length > 400) return 'files must be a list of at most 400';
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || f.path.includes('..') || f.path.startsWith('/') || f.content.length > MAX_USER_FILE * 2) return `bad file entry ${String(f?.path).slice(0, 80)}`;
    if (secretLooking(f.path)) return `secret-looking file refused: ${f.path}`;
  }
  return '';
}

/* ---------------- claude.ai-side registry ---------------- */

export const CLAUDE_KINDS = ['project', 'artifact', 'connector', 'memory', 'style', 'other'];

/** Seed for the registry: what the repo already knows lives on claude.ai (manifest links, connectors in use). */
export function defaultClaudeAi(manifest) {
  const links = manifest?.links ?? {};
  const items = [
    { id: 'project', kind: 'project', name: manifest?.displayName ?? 'AmberX AXF', url: '', notes: 'The claude.ai Project for this repo.', recreate: 'Create a Project with the same name and description; instructions = INSTRUCTIONS.md, knowledge = every file in context/.' },
  ];
  if (links.pendingBuilds) items.push({ id: 'pending-builds', kind: 'artifact', name: 'AXF Pending Builds', url: links.pendingBuilds, notes: 'Artifact page with db collection `builds`; mirrors framework/plan/pending.json field for field.', recreate: 'Ask Claude to publish a Pending Builds page from framework/plan/pending.json (fields: id, title, detail, model, status, notes, subPrompts, estimate, dates in epoch ms), then put its new link in project.manifest.json → links.pendingBuilds.' });
  if (links.kernelChecklist) items.push({ id: 'kernel-checklist', kind: 'artifact', name: 'Kernel checklist', url: links.kernelChecklist, notes: 'Checklist artifact for the kernel build.', recreate: 'Rebuild from framework/plan/build-queue.json and framework/catalog/status.json; update links.kernelChecklist.' });
  items.push(
    { id: 'axhub', kind: 'connector', name: 'axHub', url: 'https://axhub.amberxai.com/mcp', notes: 'Connector hub (list_services, describe_service, call, axhub.memory_*). Approvals at https://axhub.amberxai.com/auth/admin/approvals.', recreate: 'Settings → Connectors → Add custom connector → the URL; sign in with the hub (token AXHUB_MCP_TOKEN, never pasted in chat).' },
    { id: 'axf-console', kind: 'connector', name: 'AXF Dev Console MCP', url: 'https://console.amberxai.com/mcp', notes: '26 tools (pending_list, build_next, …); bearer = AXF_TOKEN.', recreate: 'Add as a custom connector, or reach it through axHub (it is axHub\'s first downstream service).' },
    { id: 'github', kind: 'connector', name: 'GitHub (account MossesX)', url: 'https://github.com/apps/claude', notes: 'Repos MossesX/AmberX-AXF, axHub, Build-Pilot, xGallery.', recreate: 'Connect GitHub as MossesX and give the Claude GitHub app access to the repos.' },
    { id: 'hostinger', kind: 'connector', name: 'Hostinger', url: '', notes: 'DNS for amberxai.com (rule: DNS is done by the session, logged in /projects/_shared/_data/dns/log.md).', recreate: 'Add the Hostinger connector; token from hPanel → Account → API.' },
    { id: 'memory', kind: 'memory', name: 'claude.ai memory', url: '', notes: 'Paste the account\'s memory (Settings → Capabilities → Memory) in the console so it travels with the kit.', recreate: 'Import with the memory import (claude.ai → Settings → Memory) from user/claude-ai/memory.md.' },
  );
  return { $axf: 'claude-handoff-claude-ai@1', items, memory: '', projectInstructions: '', updatedAt: '' };
}

export function claudeAiError(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.items)) return 'items must be a list';
  if (r.items.length > 100) return 'at most 100 items';
  for (const it of r.items) {
    if (!it || typeof it.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(it.id)) return 'every item needs an id (lowercase, dashes)';
    if (!CLAUDE_KINDS.includes(it.kind)) return `kind must be one of ${CLAUDE_KINDS.join(', ')}`;
    for (const k of ['name', 'url', 'notes', 'recreate']) if (it[k] !== undefined && (typeof it[k] !== 'string' || it[k].length > 2000)) return `${k} must be text (≤ 2000)`;
    if (it.url && !/^https:\/\//.test(it.url)) return 'urls must be https';
  }
  for (const k of ['memory', 'projectInstructions']) if (r[k] !== undefined && (typeof r[k] !== 'string' || r[k].length > 100_000)) return `${k} must be text (≤ 100 000)`;
  return '';
}

/* ---------------- secrets the project needs (names only) ---------------- */

export const KNOWN_SECRETS = [
  { name: 'AXF_TOKEN', where: 'console env (.axf-console/env) + your shell for .mcp.json', what: 'Dev Console token (API, /mcp, plugin routes).' },
  { name: 'GITHUB_TOKEN', where: 'console secrets / env', what: 'Fine-grained token for MossesX repos: Contents + Actions + Pull requests write.' },
  { name: 'ANTHROPIC_API_KEY', where: '~/.anthropic-key (0600) via claude-pick, or console AI assistant profile', what: 'Only when using an API key instead of the Claude plan.' },
  { name: 'AXHUB_TOKEN', where: '~/.config/axhub/token (claude-sync login)', what: 'axHub MCP bearer for claude-sync and changes.mjs.' },
  { name: 'HOSTINGER_API_TOKEN', where: 'axHub vault (hostinger-token) / console secrets', what: 'Hostinger API (VPS, DNS).' },
  { name: 'COOLIFY_TOKEN', where: 'console secrets', what: 'Coolify API.' },
  { name: 'AXF_WALL_SECRET', where: '.axf-console/wall-secret = AXHUB_WALL_SECRET on the hub', what: 'axHub wall signature (made by the installer).' },
  { name: 'ANDROID_DEBUG_KEYSTORE', where: 'GitHub Actions secret', what: 'Stable debug signing key for app APKs (base64).' },
];

/** Secret names referenced as ${VAR} in .mcp.json and the known list, merged. */
export function secretNames(root) {
  const mcp = readText(join(root, '.mcp.json')) ?? '';
  const refs = [...mcp.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]);
  const out = [...KNOWN_SECRETS];
  for (const n of refs) if (!out.some((s) => s.name === n)) out.push({ name: n, where: 'environment', what: 'Referenced by .mcp.json.' });
  return out;
}

/* ---------------- fingerprint ---------------- */

/** One hash over every source (repo files, machines, claude.ai registry): changes when anything the kit holds changes. */
export function fingerprint({ repo, machines, claudeAi }) {
  const parts = [
    ...repo.map((s) => `r:${s.path}:${s.sha}`),
    ...Object.values(machines ?? {}).sort((a, b) => a.host.localeCompare(b.host)).flatMap((m) => m.files.map((f) => `u:${m.host}:${f.path}:${f.sha}`).concat(`u:${m.host}:settings:${sha(JSON.stringify(m.settings ?? null))}:${sha(JSON.stringify(m.mcp ?? []))}`)),
    `c:${sha(JSON.stringify({ items: claudeAi?.items ?? [], memory: claudeAi?.memory ?? '', pi: claudeAi?.projectInstructions ?? '' }))}`,
  ];
  return sha(parts.join('\n'));
}

/** What changed between the kit's recorded sources and now: added / changed / removed paths. */
export function diffSources(before, now) {
  const b = new Map((before ?? []).map((s) => [s.path, s.sha]));
  const n = new Map(now.map((s) => [s.path, s.sha]));
  const added = [...n.keys()].filter((p) => !b.has(p));
  const changed = [...n.keys()].filter((p) => b.has(p) && b.get(p) !== n.get(p));
  const removed = [...b.keys()].filter((p) => !n.has(p));
  return { added, changed, removed, count: added.length + changed.length + removed.length };
}

/* ---------------- the kit ---------------- */

/**
 * Build every kit file as { path (inside the kit), content }. `info` = { root, manifest, repo (sources), machines,
 * claudeAi, commit, branch, now, context (paths) }.
 */
export function buildKit(info) {
  const { root, manifest = {}, repo, machines = {}, claudeAi = defaultClaudeAi(manifest), commit = '', branch = 'main', now = new Date().toISOString() } = info;
  const contextPaths = (info.context ?? DEFAULT_CONTEXT).filter((p, i, a) => a.indexOf(p) === i);
  const files = [];
  const put = (path, content) => files.push({ path, content });
  const P = projectFacts(manifest, commit, branch, now);

  // context/: copies for claude.ai Project knowledge
  const context = [];
  let total = 0;
  for (const rel of contextPaths) {
    if (secretLooking(rel) || rel.includes('..')) continue;
    const text = readText(join(root, rel));
    if (text === null) continue;
    const body = redact(text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n\n[cut at ${MAX_FILE} bytes: read the full file in the repo]\n` : text);
    if (total + body.length > MAX_CONTEXT_TOTAL) break;
    total += body.length;
    const name = contextName(rel);
    context.push({ name, from: rel, bytes: Buffer.byteLength(body) });
    put(`context/${name}`, body);
  }

  // user/<host>/: copies of each machine's ~/.claude files
  const hosts = Object.values(machines).filter((m) => m && HOST_RE.test(m.host)).sort((a, b) => a.host.localeCompare(b.host));
  for (const m of hosts) {
    for (const f of m.files) put(`user/${m.host}/${f.path.replace(/^\.claude\//, '')}`, redact(f.content));
    put(`user/${m.host}/settings-summary.json`, `${JSON.stringify({ settings: m.settings, mcp: m.mcp, secretsPresent: m.secrets ?? [] }, null, 2)}\n`);
  }
  if (claudeAi.memory?.trim()) put('user/claude-ai/memory.md', `# claude.ai memory (pasted in the console)\n\n${redact(claudeAi.memory.trim())}\n`);
  if (claudeAi.projectInstructions?.trim()) put('user/claude-ai/project-instructions.md', `# claude.ai Project instructions (as they were on the old account)\n\n${redact(claudeAi.projectInstructions.trim())}\n`);
  put('sources/claude-ai.json', `${JSON.stringify({ ...claudeAi, memory: redact(claudeAi.memory ?? ''), projectInstructions: redact(claudeAi.projectInstructions ?? '') }, null, 2)}\n`);

  const secrets = secretNames(root);
  put('README.md', readmeMd(P));
  put('HANDOFF.md', handoffMd(P, repo, context, hosts, claudeAi));
  put('PROJECT.md', projectMd(P, manifest, root));
  put('INSTRUCTIONS.md', instructionsMd(P));
  put('FILES.md', filesMd(P, repo, context));
  put('USER-SCOPE.md', userScopeMd(P, hosts));
  put('CLAUDE-AI.md', claudeAiMd(P, claudeAi));
  put('SECRETS.md', secretsMd(P, secrets));
  put('SETUP.md', setupMd(P, hosts, claudeAi));
  const prompt = assemblePrompt(P);
  put('PROMPT.md', `# The handoff prompt\n\nPaste this into a new session on the new Claude account (claude.ai/code is best: it works on the repo itself).\n\n${fence(prompt)}text\n${prompt}\n${fence(prompt)}\n`);

  const fp = fingerprint({ repo, machines, claudeAi });
  const manifestOut = {
    $axf: FORMAT, generatedAt: now, project: P.name, displayName: P.displayName, repo: P.repo, branch, commit, fingerprint: fp,
    sources: repo.map(({ path, role, sha: h, bytes }) => ({ path, role, sha: h, bytes })),
    machines: hosts.map((m) => ({ host: m.host, collectedAt: m.collectedAt, files: m.files.length })),
    claudeAi: { items: claudeAi.items.length, memory: !!claudeAi.memory?.trim(), updatedAt: claudeAi.updatedAt || '' },
    files: [...files.map((f) => ({ path: f.path, sha: sha(f.content) })), { path: 'handoff.json', sha: '' }],
  };
  put('handoff.json', `${JSON.stringify(manifestOut, null, 2)}\n`);
  return { files, prompt, fingerprint: fp, manifest: manifestOut };
}

export function projectFacts(manifest, commit, branch, now) {
  const repo = manifest?.repo ?? {};
  const slug = repo.owner && repo.name ? `${repo.owner}/${repo.name}` : 'MossesX/AmberX-AXF';
  return {
    name: manifest?.name ?? 'amberx-axf', displayName: manifest?.displayName ?? 'AmberX AXF',
    description: manifest?.description ?? '', repo: slug, url: repo.url ?? `https://github.com/${slug}`, visibility: repo.visibility ?? 'private',
    branch: branch || repo.defaultBranch || 'main', commit, now, date: now.slice(0, 10), kit: KIT_DIR,
  };
}

/** The prompt typed into a new session on the new account. Short; everything else is in the files it routes to. */
export function assemblePrompt(P) {
  const at = P.commit ? ` (kit built ${P.date}, commit ${P.commit.slice(0, 12)})` : ` (kit built ${P.date})`;
  return [
    `I'm moving my project "${P.displayName}" to this Claude account. Set everything up so development picks up exactly where it left off, built to the same spec and rules.`,
    '',
    `Source of truth: the GitHub repo ${P.repo} (${P.visibility}), branch ${P.branch}. Keep working on that same repo: never create a new repository, fork it or copy the project somewhere else; commit and push to ${P.repo} as before. The handoff kit is in ${P.kit}/${at}.`,
    '',
    `1. Open the repo ${P.url}. In Claude Code (claude.ai/code): work in ${P.repo} itself (if access is refused, ask me to connect GitHub as ${P.repo.split('/')[0]} and give the Claude GitHub app access to the repo). In a claude.ai chat: read it through the GitHub connector.`,
    `2. Read ${P.kit}/HANDOFF.md in full and follow it. It lists, in reading order, every instruction, rule, memory and spec file (all in the repo; CLAUDE.md imports the rules) and the files that lived outside the repo (claude.ai and ~/.claude on each machine), with their copies in ${P.kit}/.`,
    `3. Make the claude.ai Project: name "${P.displayName}", description from ${P.kit}/PROJECT.md, custom instructions = ${P.kit}/INSTRUCTIONS.md, knowledge = every file in ${P.kit}/context/. claude.ai has no API for Projects, so give me the name, description and instructions ready to paste and the list of files to upload, then wait while I create it.`,
    `4. Recreate the user-level files from ${P.kit}/user/ as ${P.kit}/USER-SCOPE.md says (user CLAUDE.md, commands, skills, agents, settings hooks, auto-memory) and point them at the repo files, not at copies.`,
    `5. Recreate the claude.ai-side items in ${P.kit}/CLAUDE-AI.md (Pending Builds page, connectors, memory).`,
    `6. Secrets: ${P.kit}/SECRETS.md has names only. Never invent or guess a value; ask me for each one and never write it into the repo, _claude/ or chat logs.`,
    `7. Go through ${P.kit}/SETUP.md and tell me what is done and what still needs me. Then follow the repo's rules (pick the model before any build, check the pending list) and don't build anything until I ask.`,
  ].join('\n');
}

/* ---------------- markdown files ---------------- */

const GEN = (P) => `<!-- generated by the Claude handoff plugin (${FORMAT}) on ${P.now}; edit the sources, not this file -->`;

function readmeMd(P) {
  return `${GEN(P)}
# Claude handoff kit

Everything a **new Claude account** needs to pick up **${P.displayName}** (${P.repo}) and keep building it to spec.
Start at [HANDOFF.md](HANDOFF.md); the prompt that sends a new account here is [PROMPT.md](PROMPT.md).

The Dev Console's **Tools → Claude handoff** keeps this folder current (it reminds every ${REMIND_HOURS} hours). Don't edit these
files by hand: change the sources (CLAUDE.md, \`_claude/\`, the claude.ai list in the console) and refresh the kit.
`;
}

function handoffMd(P, repo, context, hosts, claudeAi) {
  const order = (role) => repo.filter((s) => s.role === role).map((s) => `- \`${s.path}\``).join('\n') || '- (none)';
  return `${GEN(P)}
# Handoff: ${P.displayName} on a new Claude account

Repo **${P.repo}** · branch **${P.branch}**${P.commit ? ` · built at commit \`${P.commit.slice(0, 12)}\`` : ''} · kit date ${P.date}.

**Routing rule for the new account:** the repo is the memory. Read the files below from the repo, at their repo
paths, at the start of every session. The copies in this kit (\`context/\`, \`user/\`) exist only for places that can't
read the repo (claude.ai Project knowledge, a fresh ~/.claude); whenever a copy and the repo differ, the repo wins.

## 1. Read in this order

1. \`CLAUDE.md\` — project context and Status (it imports \`_claude/shared/rules/RULES.md\` and \`_claude/rules/RULES.md\`).
2. Rules:
${order('rules')}
3. Instructions:
${order('instructions')}
4. Memory (decisions in \`_claude/memory/decisions.md\`, specs in \`_claude/memory/docs/\`):
${order('memory')}
5. Specs the code must conform to:
${order('spec')}
6. Project manifests (no project is loaded or compiled without a valid one):
${order('manifest')}
7. Claude Code project config: ${repo.filter((s) => ['claude-settings', 'command', 'skill', 'agent', 'mcp'].includes(s.role)).map((s) => `\`${s.path}\``).join(', ') || '(none)'}

Full index with hashes: [FILES.md](FILES.md).

## 2. Files that live outside the repo

| Where | What | In this kit | Recreate with |
| --- | --- | --- | --- |
${hosts.map((m) => `| ~/.claude on \`${m.host}\` | ${m.files.length} files (collected ${m.collectedAt.slice(0, 16).replace('T', ' ')} UTC) | \`user/${m.host}/\` | [USER-SCOPE.md](USER-SCOPE.md) |`).join('\n') || '| ~/.claude on each machine | not collected yet | — | [USER-SCOPE.md](USER-SCOPE.md) |'}
| claude.ai | ${claudeAi.items.length} items (Project, artifacts, connectors, memory) | \`sources/claude-ai.json\`${claudeAi.memory?.trim() ? ', `user/claude-ai/memory.md`' : ''} | [CLAUDE-AI.md](CLAUDE-AI.md) |
| axHub \`/projects/${P.name}/\` | \`_claude/\` (main copy) + \`_data/\` (pending list, plan, build queue, changes log …) | the repo copies are synced snapshots | \`claude-sync\` (see SETUP.md) |
| Secrets | names only | [SECRETS.md](SECRETS.md) | ask Brett; never in files |

## 3. Set up

Follow [SETUP.md](SETUP.md) top to bottom. The claude.ai Project: [INSTRUCTIONS.md](INSTRUCTIONS.md) + \`context/\` (${context.length} files).
`;
}

function projectMd(P, manifest, root) {
  const nested = [];
  for (const base of ['apps', 'projects']) {
    if (!isDir(join(root, base))) continue;
    for (const n of readdirSync(join(root, base)).sort()) {
      const m = readJson(join(root, base, n, 'project.manifest.json'));
      if (m?.name) nested.push(`| \`${m.name}\` | ${mdLine(m.displayName)} | \`${base}/${n}\` | ${mdLine(m.kind)} |`);
    }
  }
  return `${GEN(P)}
# ${P.displayName}

- **Name** (hub folder \`/projects/${P.name}\`): \`${P.name}\`
- **Description:** ${P.description}
- **Repo:** ${P.url} (${P.visibility}, default branch \`${P.branch}\`)
- **Kind:** ${manifest.kind ?? ''} · **status:** ${manifest.status ?? ''} · **version:** ${manifest.version ?? ''}
- **Deploy:** ${Object.entries(manifest.deploy ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}
- **Owner:** GitHub \`MossesX\` (Brett)

## Projects in this repo

| Name | Display name | Folder | Kind |
| --- | --- | --- | --- |
| \`${P.name}\` | ${mdLine(P.displayName)} | \`.\` | ${mdLine(manifest.kind)} |
${nested.join('\n')}

## Related repos

- **MossesX/axHub** — connector hub at https://axhub.amberxai.com (one MCP server; holds \`/projects\` = the shared _claude and _data).
- **MossesX/Build-Pilot** — plugin-driven app designer built on AXF.
- **MossesX/xGallery** — standalone gallery (not on AXF).
`;
}

/** The claude.ai Project custom instructions: short, routes to the repo. */
export function instructionsMd(P) {
  return `${GEN(P)}
# ${P.displayName}: claude.ai Project instructions

Paste everything below the line into the Project's custom instructions.

---

You are working on **${P.displayName}** (GitHub ${P.repo}, ${P.visibility}). ${P.description}

**The repo is the memory and the source of truth.** At the start of every conversation read, from the repo (GitHub connector or Claude Code working in the repo): \`CLAUDE.md\`, \`_claude/shared/rules/RULES.md\`, \`_claude/rules/RULES.md\`, \`_claude/memory/decisions.md\`, then what the task needs from \`_claude/memory/docs/\` and \`framework/spec/\`. The files in this Project's knowledge are copies from \`${P.kit}/context/\` (${P.date}); when they differ from the repo, the repo wins.

Rules that always apply (full text in the rules files):
- Before any build, recommend Fable, Opus or Sonnet with one line of why and wait for Brett's pick; check the pending list (\`framework/plan/pending.json\`, or the Dev Console MCP \`pending_list\`).
- Report every build to the Build manager on axHub before starting (\`_claude/memory/docs/build-reporting.md\`; in claude.ai write the entry with \`axhub.memory_write\`).
- Everything visible is an asset (asset@1); UIs read only engine-compiled tokens. Engine compatibility across ports is a hard constraint (Android work is on hold except where the rules say).
- No secrets anywhere (repo, _claude, _data, chat). Ask Brett for values; never guess them.
- Brett works from his phone: lead with the result, short paragraphs; ask with tap-to-pick choices.
- When he states a rule or decision, save it in \`_claude/\` (rules/, instructions/, memory/decisions.md) and commit.

Services: axHub connector (https://axhub.amberxai.com/mcp) reaches his VPS, GitHub, Hostinger and the Dev Console MCP; approvals at https://axhub.amberxai.com/auth/admin/approvals.
`;
}

function filesMd(P, repo, context) {
  return `${GEN(P)}
# Every source file (${repo.length})

Read from the repo at these paths. \`sha\` = first 16 hex of sha256 at kit time (${P.date}); a file whose sha changed
since is newer in the repo than in this kit.

| Path | Role | Bytes | sha |
| --- | --- | ---: | --- |
${repo.map((s) => `| \`${s.path}\` | ${s.role} | ${s.bytes} | \`${s.sha}\` |`).join('\n')}

## Copied into context/ (claude.ai Project knowledge)

| Kit file | From |
| --- | --- |
${context.map((c) => `| \`context/${c.name}\` | \`${c.from}\` |`).join('\n')}
`;
}

function userScopeMd(P, hosts) {
  const per = hosts.map((m) => `### \`${m.host}\` (collected ${m.collectedAt})

| File (under ~) | Kind | Bytes | Kit copy |
| --- | --- | ---: | --- |
${m.files.map((f) => `| \`${f.path}\` | ${f.kind}${f.truncated ? ' (cut)' : ''} | ${f.bytes} | \`user/${m.host}/${f.path.replace(/^\.claude\//, '')}\` |`).join('\n') || '| (no files) | | | |'}

- Hooks in ~/.claude/settings.json: ${m.settings?.hooks?.length ? '' : 'none'}
${(m.settings?.hooks ?? []).map((h) => `  - ${h.event}${h.matcher ? ` (${h.matcher})` : ''}: \`${mdLine(h.command)}\``).join('\n')}
- Settings env names: ${(m.settings?.env ?? []).map((e) => `\`${e}\``).join(', ') || 'none'} · model: ${m.settings?.model ?? 'default'} · permissions: ${m.settings?.permissions?.allow ?? 0} allow / ${m.settings?.permissions?.deny ?? 0} deny · plugins: ${(m.settings?.enabledPlugins ?? []).join(', ') || 'none'}
- MCP servers (~/.claude.json): ${(m.mcp ?? []).map((s) => `${s.name} (${s.type}${s.url ? ` ${s.url}` : ''})`).join(', ') || 'none'}
- Secret files present (values never copied): ${(m.secrets ?? []).map((s) => `\`~/${s}\``).join(', ') || 'none'}
`).join('\n');
  return `${GEN(P)}
# User-scope files (~/.claude on each machine)

These live outside the repo, so a new account doesn't get them from the repo. Copies (secrets redacted) are in
\`user/<host>/\`. The kit is refreshed from every machine that runs \`handoff.mjs collect\` (the SessionStart hook does it
once an hour: \`node apps/console-web/plugins/claude-handoff/handoff.mjs hooks install\`).

## Recreate on the new account's machines

1. **User CLAUDE.md** (\`~/.claude/CLAUDE.md\`): copy \`user/<host>/CLAUDE.md\`; anything in it about this project should
   point to the repo files (\`CLAUDE.md\`, \`_claude/\`) instead of repeating them.
2. **Commands, agents, skills, output styles:** copy \`user/<host>/{commands,agents,skills,output-styles}/\` to the same
   folders under \`~/.claude/\`.
3. **Auto-memory** (\`~/.claude/projects/<path>/memory/\`): Claude Code keys it by the project's folder path. Copy each
   \`user/<host>/projects/<old path>/memory/\` to the folder that matches the repo's folder on the new machine, or better, move lasting
   facts into \`_claude/memory/\` in the repo and commit.
4. **Hooks:** don't copy settings.json. Install the same hooks with their own installers so paths are right:
   - \`bash deploy/claude-pick.sh --install\` (model/sign-in picker, claude-sync, codebase-changes hooks)
   - \`node apps/console-web/plugins/claude-handoff/handoff.mjs hooks install\` (keeps this kit's user copies current)
   - the other plugins' hook installers (build reporting, session check-in, activity banner), where those were installed: each plugin's line in CLAUDE.md names its command.
5. **MCP servers:** add them again (\`claude mcp add …\`); tokens come from SECRETS.md names, asked for, never copied.

## Machines

${per || '_No machine has sent its files yet. Run `node apps/console-web/plugins/claude-handoff/handoff.mjs collect` on each one._'}
`;
}

function claudeAiMd(P, c) {
  return `${GEN(P)}
# claude.ai-side items

Only claude.ai knows these; a new account starts without them. Kept in the Dev Console (Tools → Claude handoff →
claude.ai items) and saved here in \`sources/claude-ai.json\`.

| Kind | Name | Old link | Notes | Recreate |
| --- | --- | --- | --- | --- |
${c.items.map((it) => `| ${it.kind} | ${mdLine(it.name)} | ${it.url ? `<${it.url}>` : '—'} | ${mdLine(it.notes)} | ${mdLine(it.recreate)} |`).join('\n')}

- claude.ai memory: ${c.memory?.trim() ? 'copied to `user/claude-ai/memory.md`' : 'not pasted yet (Tools → Claude handoff → claude.ai items → Memory)'}
- Old Project instructions: ${c.projectInstructions?.trim() ? 'copied to `user/claude-ai/project-instructions.md` (the new ones are INSTRUCTIONS.md)' : 'not pasted (the new ones are INSTRUCTIONS.md)'}

After recreating an artifact, put its new link in \`project.manifest.json\` → \`links\` and in the console's list.
`;
}

function secretsMd(P, secrets) {
  return `${GEN(P)}
# Secrets (names only)

Values never go in the repo, \`_claude/\`, \`_data\`, \`/projects\`, chat or this kit. The new account asks Brett for each
one and stores it where the table says.

| Name | Where it goes | What it is |
| --- | --- | --- |
${secrets.map((s) => `| \`${s.name}\` | ${mdLine(s.where)} | ${mdLine(s.what)} |`).join('\n')}
`;
}

function setupMd(P, hosts, c) {
  return `${GEN(P)}
# Setup checklist for the new account

Tick each line; say which ones still need Brett.

## A. Repo access
- [ ] GitHub connected as \`MossesX\`; the Claude GitHub app has access to ${P.repo} (and axHub, Build-Pilot).
- [ ] The new account works in ${P.repo} itself (claude.ai/code or the GitHub connector), not a new repo or a fork; \`git log -1\` is at or after \`${P.commit.slice(0, 12) || 'the kit commit'}\`.

## B. claude.ai Project
- [ ] Project **${P.displayName}** created; description = PROJECT.md's description.
- [ ] Custom instructions = INSTRUCTIONS.md (below its line).
- [ ] Knowledge = every file in \`context/\`.
${c.items.filter((it) => it.kind !== 'project').map((it) => `- [ ] ${it.kind}: ${it.name} — ${it.recreate}`).join('\n')}

## C. Claude Code (each machine)
- [ ] \`bash deploy/claude-pick.sh --install\` on the VPS (and any computer): model picker, claude-sync, hooks.
- [ ] \`claude-sync login\` then \`claude-sync sync\` in the repo's folder: \`_claude/\` and \`data.shared\` match the hub (\`/projects/${P.name}/\`).
- [ ] User files recreated from \`user/\` (USER-SCOPE.md)${hosts.length ? `: ${hosts.map((m) => m.host).join(', ')}` : ''}.
- [ ] \`.mcp.json\` works: \`AXF_TOKEN\` set in the shell (SECRETS.md).

## D. Check it picked up
- [ ] \`node framework/cli/project.mjs validate --all\` passes.
- [ ] \`node framework/cli/pending.mjs\` lists the pending builds.
- [ ] A new session reads CLAUDE.md and the rules by itself (ask it "what are the rules before a build?").
- [ ] Dev Console → Tools → Claude handoff shows the kit as current.
`;
}
