#!/usr/bin/env node
/**
 * Claude handoff kit CLI (claude-handoff@1). Builds and publishes `_claude/handoff/` and collects each machine's
 * ~/.claude files for it. The console's server part runs the same commands.
 *
 *   node handoff.mjs status [--json]                 is the kit current? what changed since it was built
 *   node handoff.mjs build [--out <dir>] [--json]    write the kit (default _claude/handoff in this checkout)
 *   node handoff.mjs prompt                          print the handoff prompt
 *   node handoff.mjs plan                            what the kit is made of, by category (JSON, sizes only)
 *   node handoff.mjs session [--save] [--json]       what's still open (change log, pending builds, open PRs, notes) as a
 *                                                    summary for an existing Project on another account; --save keeps it
 *                                                    for the kit (_claude/handoff/ACTIVE-THREADS.md)
 *   node handoff.mjs publish [--json]                build on GitHub's current branch and push _claude/handoff (GITHUB_TOKEN)
 *   node handoff.mjs collect [--host <name>] [--out <file>] [--quiet] [--throttle <s>]
 *                                                    this machine's ~/.claude → the console (data folder, or the
 *                                                    console API with AXF_TOKEN, else ~/.axf-handoff/ to send later)
 *   node handoff.mjs hooks install|remove|status [--settings <file>]   SessionStart hook: collect once an hour
 *
 * Data (machines/<host>.json, claude-ai.json, config.json, session.json + session.md): AXF_HANDOFF_DATA, else <repo>/.axf-console/plugins/claude-handoff.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONTEXT, DEFAULT_SESSION_NOTES, HOST_RE, KIT_DIR, SESSION_FILE, buildKit, openChanges, openPending, projectFacts, sessionMd, sessionPrompt, sessionThreads, secretNames, collectUserScope, defaultClaudeAi, diffSources, fingerprint, machineError, repoSources,
} from './handoff-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPT = join(HERE, 'handoff.mjs');
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const DATA = resolve(process.env.AXF_HANDOFF_DATA || join(ROOT, '.axf-console/plugins/claude-handoff'));
const DEFAULT_CONSOLE = 'https://console.amberxai.com';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
function writeJson(p, data, mode = 0o600) {
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  renameSync(tmp, p);
}
const git = (args, cwd = ROOT) => {
  const r = spawnSync('git', ['-c', 'safe.directory=*', ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? r.stdout.trim() : '';
};

/* ---------------- inputs ---------------- */

export function loadMachines(dir = DATA) {
  const out = {};
  const d = join(dir, 'machines');
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d).sort()) {
    if (!n.endsWith('.json')) continue;
    const m = readJson(join(d, n));
    if (m && !machineError(m)) out[m.host] = m;
  }
  return out;
}

export function loadClaudeAi(root = ROOT, dir = DATA) {
  const saved = readJson(join(dir, 'claude-ai.json'));
  if (saved?.items) return saved;
  // a fresh console (or a new account) starts from the list the last published kit carried
  const kit = readJson(join(root, KIT_DIR, 'sources/claude-ai.json'));
  if (kit?.items) return kit;
  return defaultClaudeAi(readJson(join(root, 'project.manifest.json')));
}

export function loadConfig(dir = DATA) {
  const c = readJson(join(dir, 'config.json')) ?? {};
  const extra = Array.isArray(c.context) ? c.context.filter((p) => typeof p === 'string' && !p.includes('..') && !p.startsWith('/')) : [];
  return { context: [...DEFAULT_CONTEXT, ...extra.filter((p) => !DEFAULT_CONTEXT.includes(p))], extraContext: extra };
}

/** The saved Handoff Session summary: this console's, else the one the last published kit carried, else none. */
export function loadSession(root = ROOT, dir = DATA) {
  for (const p of [join(dir, 'session.md'), join(root, KIT_DIR, SESSION_FILE)]) {
    try { const t = readFileSync(p, 'utf8'); if (t.trim()) return t; } catch { /* next */ }
  }
  return '';
}

export function inputs(root = ROOT, dir = DATA) {
  return {
    session: loadSession(root, dir),
    root,
    manifest: readJson(join(root, 'project.manifest.json')) ?? {},
    repo: repoSources(root),
    machines: loadMachines(dir),
    claudeAi: loadClaudeAi(root, dir),
    context: loadConfig(dir).context,
  };
}

/* ---------------- status / build ---------------- */

export function status(root = ROOT, dir = DATA) {
  const inp = inputs(root, dir);
  const kit = readJson(join(root, KIT_DIR, 'handoff.json'));
  const fp = fingerprint(inp);
  const changes = diffSources(kit?.sources ?? [], inp.repo);
  const kitHosts = new Map((kit?.machines ?? []).map((m) => [m.host, m.collectedAt]));
  const machines = Object.values(inp.machines).map((m) => ({ host: m.host, collectedAt: m.collectedAt, files: m.files.length, inKit: kitHosts.get(m.host) === m.collectedAt }));
  return {
    kit: kit ? { generatedAt: kit.generatedAt, commit: kit.commit, fingerprint: kit.fingerprint, files: kit.files?.length ?? 0 } : null,
    fingerprint: fp, current: !!kit && kit.fingerprint === fp, changes,
    machines, claudeAi: { items: inp.claudeAi.items.length, memory: !!inp.claudeAi.memory?.trim(), updatedAt: inp.claudeAi.updatedAt || '' },
    sources: inp.repo.length, head: git(['rev-parse', 'HEAD'], root), branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], root),
  };
}

export function build(root = ROOT, dir = DATA, { commit, branch, now } = {}) {
  const inp = inputs(root, dir);
  return buildKit({ ...inp, commit: commit ?? git(['rev-parse', 'HEAD'], root), branch: branch ?? (inp.manifest.repo?.defaultBranch || 'main'), now });
}

/** What the kit is made of, categorised, for the installer window (sizes only; no file content, no secret values). */
export function plan(root = ROOT, dir = DATA) {
  const inp = inputs(root, dir);
  return {
    repo: inp.repo.map(({ path, role, bytes }) => ({ path, role, bytes })),
    context: inp.context.filter((p) => inp.repo.some((s) => s.path === p) || p === 'CLAUDE.md'),
    machines: Object.values(inp.machines).map((m) => ({ host: m.host, files: m.files.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes })) })),
    claudeAi: inp.claudeAi.items.map((i) => ({ id: i.id, kind: i.kind, name: i.name })),
    memory: !!inp.claudeAi.memory?.trim(),
    secrets: secretNames(root).map((s) => s.name),
    project: { name: inp.manifest.name ?? '', displayName: inp.manifest.displayName ?? '', repo: inp.manifest.repo ? `${inp.manifest.repo.owner}/${inp.manifest.repo.name}` : '' },
  };
}

/** Replace a kit folder with the built files. Only a folder named "handoff" (or one passed with --out) is ever removed. */
export function writeKit(kit, outDir) {
  const out = resolve(outDir);
  if (out.split('/').pop() !== 'handoff' && !process.env.AXF_HANDOFF_ANY_OUT) throw new Error(`refusing to replace ${out}: the kit folder is named "handoff"`);
  rmSync(out, { recursive: true, force: true });
  for (const f of kit.files) {
    const p = resolve(out, f.path);
    if (!p.startsWith(out + '/')) throw new Error(`bad kit path ${f.path}`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
  return out;
}

/** Build on origin's current branch in a temporary worktree (so the kit matches what GitHub serves) and push it. */
export async function publish(dir = DATA, log = () => {}) {
  const { publishChange } = await import('../../../../framework/cli/plugin-lifecycle.mjs');
  let built = null;
  const r = publishChange((wt, g) => {
    const head = g(['-C', wt, 'rev-parse', 'HEAD']).out;
    const manifest = readJson(join(wt, 'project.manifest.json')) ?? {};
    built = build(wt, dir, { commit: head, branch: manifest.repo?.defaultBranch || 'main' });
    // the kit changes only when a source does (its date and commit alone never make a new commit)
    if (readJson(join(wt, KIT_DIR, 'handoff.json'))?.fingerprint === built.fingerprint) return;
    writeKit(built, join(wt, KIT_DIR));
    g(['-C', wt, 'add', '-A', '--', KIT_DIR]);
  }, 'Refresh the Claude handoff kit (_claude/handoff)', log, 'GitHub already has this handoff kit');
  // keep this checkout's copy the same as GitHub's, so status reads "current" until a source changes
  if (built && r.pushed) writeKit(built, join(ROOT, KIT_DIR));
  return { ...r, fingerprint: built?.fingerprint, files: built?.files.length ?? 0, prompt: built?.prompt ?? '' };
}

/* ---------------- Handoff Session ---------------- */

/** Change-log entries (change-log@1) from the shared data folder: one JSON file per entry under changes/<YYYY>/<MM>/. */
export async function loadChanges(maxFiles = 3000) {
  const { dataPath } = await import('../../../../framework/cli/persist.mjs');
  const base = dataPath('changes');
  const out = [];
  const walk = (d, depth) => {
    let names = [];
    try { names = readdirSync(d).sort().reverse(); } catch { return; }
    for (const n of names) {
      if (out.length >= maxFiles) return;
      const p = join(d, n);
      if (depth < 2 && /^\d{2,4}$/.test(n)) walk(p, depth + 1);
      else if (depth === 2 && n.endsWith('.json')) { const e = readJson(p); if (e?.id) out.push(e); }
    }
  };
  walk(base, 0);
  return out;
}

export async function loadPending() {
  const { dataPath } = await import('../../../../framework/cli/persist.mjs');
  return readJson(dataPath('framework/plan/pending.json'))?.items ?? [];
}

/** Open pull requests on the project's repo, or null + why when GitHub can't be read. */
export async function loadPrs(slug) {
  const gh = await import('../../../../framework/cli/github.mjs');
  if (!gh.githubToken()) return { prs: null, note: 'Not read: this console has no GITHUB_TOKEN. List them with the GitHub connector.' };
  try {
    const repo = gh.parseRepo(slug);
    const client = gh.createGitHub({ userAgent: 'axf-claude-handoff', timeoutMs: 15_000 });
    const list = await client.paginate(gh.repoPath(repo, ['pulls'], { state: 'open', per_page: 50 }), { maxPages: 2, maxItems: 100 });
    return { prs: list.map((p) => ({ number: p.number, title: String(p.title ?? ''), draft: !!p.draft, head: p.head?.ref ?? '', base: p.base?.ref ?? '', updatedAt: p.updated_at ?? '', url: `https://github.com/${slug}/pull/${Number(p.number)}` })), note: '' };
  } catch (e) { return { prs: null, note: `Not read: GitHub answered "${gh.scrub(String(e?.message ?? e)).slice(0, 160)}".` }; }
}

export function sessionNotes(dir = DATA) {
  const n = readJson(join(dir, 'session.json'))?.notes;
  return typeof n === 'string' ? n : DEFAULT_SESSION_NOTES;
}

/** Build the summary (and keep it for the kit with save). */
/** The hand-written open-threads list (one per line: `Title: where it stood`), recreated on the other account. */
export function sessionThreadNotes(dir = DATA) {
  const t = readJson(join(dir, 'session.json'))?.threads;
  return typeof t === 'string' ? t : '';
}

export async function session({ root = ROOT, dir = DATA, save = false, now = new Date().toISOString() } = {}) {
  const manifest = readJson(join(root, 'project.manifest.json')) ?? {};
  const P = projectFacts(manifest, git(['rev-parse', 'HEAD'], root), manifest.repo?.defaultBranch || 'main', now);
  const [changes, pending, pr] = await Promise.all([loadChanges(), loadPending(), loadPrs(P.repo)]);
  const markdown = sessionMd({ P, now, changes, pending, prs: pr.prs, prsNote: pr.note, notes: sessionNotes(dir), threads: sessionThreadNotes(dir) });
  if (save) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'session.md'), markdown, { mode: 0o600 });
  }
  return {
    markdown, prompt: sessionPrompt(markdown), savedAt: save ? now : '',
    counts: { changes: openChanges(changes).length, pending: openPending(pending).length, prs: pr.prs ? pr.prs.length : null, threads: sessionThreads({ changes, prs: pr.prs, threads: sessionThreadNotes(dir), now }).length },
  };
}

/* ---------------- collect (any machine) ---------------- */

export function hostName(flag) {
  const h = String(flag || process.env.AXF_HANDOFF_HOST || hostname()).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 63);
  return HOST_RE.test(h) ? h : 'machine';
}

export async function collect(flags = {}, env = process.env) {
  const host = hostName(flags.host);
  const queueDir = join(homedir(), '.axf-handoff');
  const stamp = join(queueDir, `.last-${host}`);
  const throttle = Number(flags.throttle) || 0;
  if (throttle && existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < throttle * 1000) return { skipped: 'throttled', host };
  const rec = collectUserScope(flags.home ? resolve(flags.home) : homedir(), host);
  let where;
  if (flags.out) { writeJson(resolve(flags.out), rec); where = resolve(flags.out); }
  else if (env.AXF_HANDOFF_DATA || existsSync(join(ROOT, '.axf-console'))) { writeJson(join(DATA, 'machines', `${host}.json`), rec); where = DATA; }
  else if (env.AXF_TOKEN) {
    const base = (env.AXF_CONSOLE_URL || DEFAULT_CONSOLE).replace(/\/+$/, '');
    if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) throw new Error('AXF_CONSOLE_URL must be https');
    const res = await fetch(`${base}/api/plugins/claude-handoff/machines`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AXF_TOKEN}` }, body: JSON.stringify(rec), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`the console answered ${res.status}`);
    where = base;
  } else { writeJson(join(queueDir, `${host}.json`), rec); where = `${queueDir} (set AXF_TOKEN to send it to the console)`; }
  mkdirSync(queueDir, { recursive: true, mode: 0o700 });
  writeFileSync(stamp, new Date().toISOString(), { mode: 0o600 });
  return { host, files: rec.files.length, where };
}

/* ---------------- hooks ---------------- */

const MARK = 'claude-handoff/handoff.mjs';
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes(MARK);
export const claudeSettings = () => join(homedir(), '.claude', 'settings.json');
export function hookCommand(script = SCRIPT) { return `node "${script}" collect --quiet --throttle 3600 || true`; }
export function withHook(s, script = SCRIPT) {
  const out = withoutHook(s);
  out.hooks = out.hooks ?? {};
  out.hooks.SessionStart = [...(out.hooks.SessionStart ?? []), { hooks: [{ type: 'command', command: hookCommand(script), timeout: 30 }] }];
  return out;
}
export function withoutHook(s) {
  const out = { ...(s ?? {}) };
  if (!out.hooks) return out;
  out.hooks = { ...out.hooks };
  for (const [ev, list] of Object.entries(out.hooks)) {
    if (!Array.isArray(list)) continue;
    const kept = list.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length);
    if (kept.length) out.hooks[ev] = kept; else delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}
export const hookInstalled = (s) => Object.values(s?.hooks ?? {}).some((l) => Array.isArray(l) && l.some((g) => (g.hooks ?? []).some(isOurs)));
function saveSettings(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}
export function hooks(action, file = claudeSettings()) {
  const cur = existsSync(file) ? readJson(file) : {};
  if (cur === null) throw new Error(`${file} isn't valid JSON; not touching it`);
  if (action === 'status') return hookInstalled(cur) ? `installed in ${file}` : `not installed in ${file}`;
  if (action === 'install') { saveSettings(file, withHook(cur)); return `installed in ${file}`; }
  if (action === 'remove') { if (!hookInstalled(cur)) return `not installed in ${file}`; saveSettings(file, withoutHook(cur)); return `removed from ${file}`; }
  throw new Error('hooks install|remove|status');
}

/* ---------------- CLI ---------------- */

function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const v = argv[i + 1];
    flags[a.slice(2)] = v === undefined || v.startsWith('--') ? true : (i++, v);
  }
  return { pos, flags };
}

async function main(argv) {
  const { pos: [cmd = 'status', sub], flags } = parse(argv);
  const out = (o, text) => console.log(flags.json ? JSON.stringify(o) : text);
  switch (cmd) {
    case 'status': {
      const s = status();
      return out(s, s.kit ? `${s.current ? 'current' : 'out of date'} — kit ${s.kit.generatedAt} (${s.kit.commit.slice(0, 12)}), ${s.changes.count} repo file(s) changed, ${s.machines.length} machine(s)` : 'no kit yet: run build or publish');
    }
    case 'build': {
      const kit = build();
      const dir = writeKit(kit, flags.out ? resolve(flags.out) : join(ROOT, KIT_DIR));
      return out({ dir, files: kit.files.length, fingerprint: kit.fingerprint, prompt: kit.prompt }, `wrote ${kit.files.length} files to ${dir}`);
    }
    case 'prompt': return console.log(build().prompt);
    case 'plan': return console.log(JSON.stringify(plan()));
    case 'session': {
      const r = await session({ save: !!flags.save });
      return out(r, r.markdown);
    }
    case 'publish': {
      const r = await publish(DATA, (l) => { if (!flags.json) console.error(l); });
      return out(r, r.pushed ? `pushed ${r.sha}` : 'GitHub already has this kit');
    }
    case 'collect': {
      try {
        const r = await collect(flags);
        if (!flags.quiet) out(r, r.skipped ? `skipped (${r.skipped})` : `${r.host}: ${r.files} file(s) → ${r.where}`);
      } catch (e) { if (!flags.quiet) throw e; }
      return;
    }
    case 'hooks': return console.log(hooks(sub ?? 'status', flags.settings ? resolve(flags.settings) : claudeSettings()));
    default: throw new Error(`unknown command ${cmd} (status | build | prompt | session | publish | collect | hooks)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
