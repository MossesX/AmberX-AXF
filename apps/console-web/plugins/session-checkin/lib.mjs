/**
 * session-checkin — shared logic for checkin.mjs (the hook), install.mjs (the installer) and the console plugin.
 * Node 22, no dependencies. Spec: .claude/SESSION-CHECKIN.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(PLUGIN_DIR, '..', '..', '..', '..');
export const CHECKIN = join(PLUGIN_DIR, 'checkin.mjs');
export const VERSION = '1.0.0';
/** Marks our hook entries in a settings file (we only ever touch entries whose command contains it). */
export const HOOK_MARK = 'session-checkin/checkin.mjs';
export const REL_CHECKIN = 'apps/console-web/plugins/session-checkin/checkin.mjs';

export const QUESTIONS = [
  { id: 'location', label: 'Location', required: true, help: 'Where the session runs: VPS terminal, cloud container, desktop/laptop. Always asked first; it decides which other questions apply.' },
  { id: 'repo', label: 'Repo', help: 'Remote, branch, HEAD, clean/dirty and behind/ahead of GitHub; a mismatch with the expected repo is flagged before any work.' },
  { id: 'container', label: 'Container', help: 'Host, Docker container or the temporary cloud container.' },
  { id: 'project', label: 'Project', help: 'The project this work belongs to.' },
  { id: 'memory', label: 'Memory files', help: 'Where memory loaded from and the list of files; any file can be opened read-only.' },
  { id: 'model', label: 'Model', help: 'Recommended model (top three only) vs the one running; the switch command when they differ.' },
  { id: 'effort', label: 'Effort + cost', help: 'Effort level, each with the fixed baseline build\'s estimated cost.' },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MODELS = {
  fable: { label: 'Fable 5.1', api: 'claude-fable-5-1' },
  opus: { label: 'Opus 5.5', api: 'claude-opus-5-5' },
  sonnet: { label: 'Sonnet 5.5', api: 'claude-sonnet-5-5' },
};

export function defaultConfig() {
  return {
    $axf: 'session-checkin-config@1',
    // Off by default (Oct 26 2026, Brett: no questions at login). true = the old start-of-session question rounds.
    ask: false,
    questions: Object.fromEntries(QUESTIONS.map((q) => [q.id, true])),
    sources: ['startup'],
    allowSkip: true,
    allowSameAsLast: true,
    unattended: 'log',
    expected: { repo: 'MossesX/AmberX-AXF', project: 'AmberX AXF', vpsContainer: 'host' },
    archive: 'auto',
    memoryDirs: ['_claude'],
    defaultEffort: 'high',
    baseline: 'baseline-v1',
  };
}

/** Validate + normalise a config (from the wizard, a file or the CLI). Unknown keys are dropped. */
export function normaliseConfig(c = {}) {
  const d = defaultConfig();
  const q = { ...d.questions };
  for (const k of Object.keys(q)) if (c.questions && typeof c.questions[k] === 'boolean') q[k] = c.questions[k];
  q.location = true;
  const sources = Array.isArray(c.sources) ? c.sources.filter((s) => ['startup', 'resume', 'clear', 'compact', 'fork'].includes(s)) : d.sources;
  const str = (v, def, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
  const archive = c.archive === 'auto' || c.archive == null ? 'auto' : str(c.archive, 'auto', 400);
  if (archive !== 'auto' && !archive.startsWith('/')) throw new Error('archive must be "auto" or an absolute folder path');
  const dirs = Array.isArray(c.memoryDirs) ? c.memoryDirs.filter((x) => typeof x === 'string' && x && !x.includes('..')).slice(0, 8) : d.memoryDirs;
  return {
    $axf: d.$axf, ask: c.ask === true, questions: q, sources: sources.length ? sources : ['startup'],
    allowSkip: c.allowSkip !== false, allowSameAsLast: c.allowSameAsLast !== false,
    unattended: c.unattended === 'off' ? 'off' : 'log',
    expected: { repo: str(c.expected?.repo, d.expected.repo), project: str(c.expected?.project, d.expected.project), vpsContainer: str(c.expected?.vpsContainer, d.expected.vpsContainer) },
    archive, memoryDirs: dirs.length ? dirs : d.memoryDirs,
    defaultEffort: EFFORTS.includes(c.defaultEffort) ? c.defaultEffort : d.defaultEffort,
    baseline: str(c.baseline, d.baseline, 40),
  };
}

export const readJson = (f, def = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return def; } };
export function writeJsonAtomic(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, f);
}

export function loadConfig(path) {
  const candidates = [path, process.env.CLAUDE_PROJECT_DIR && join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'session-checkin.local.json'),
    process.env.CLAUDE_PROJECT_DIR && join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'session-checkin.json'), join(homedir(), '.claude', 'session-checkin.json')].filter(Boolean);
  for (const p of candidates) { const c = readJson(p); if (c) return { config: normaliseConfig(c), path: p }; }
  return { config: defaultConfig(), path: null };
}

/* ------------------------------------------------------------------ install targets + hook entries */

/**
 * Where the check-in can be installed.
 *   local   <dir>/.claude/settings.local.json   this clone only, not committed (the console's clone on the VPS)
 *   shared  <dir>/.claude/settings.json          every clone once committed and pushed (phone/cloud sessions too)
 *   user    ~/.claude/settings.json              every folder on this device (run the installer on that device)
 */
export function targetPaths(target, dir = REPO_ROOT) {
  if (target === 'user') {
    const home = join(homedir(), '.claude');
    return { settings: join(home, 'settings.json'), config: join(home, 'session-checkin.json'), checkinCmd: `"${CHECKIN}"`, configCmd: `"${join(home, 'session-checkin.json')}"` };
  }
  const local = target === 'local';
  const cfgName = local ? 'session-checkin.local.json' : 'session-checkin.json';
  return {
    settings: join(dir, '.claude', local ? 'settings.local.json' : 'settings.json'),
    config: join(dir, '.claude', cfgName),
    checkinCmd: `"$CLAUDE_PROJECT_DIR/${REL_CHECKIN}"`,
    configCmd: `"$CLAUDE_PROJECT_DIR/.claude/${cfgName}"`,
  };
}

export function hookEntries(target, config, dir) {
  const t = targetPaths(target, dir);
  return {
    SessionStart: { matcher: config.sources.join('|'), hooks: [{ type: 'command', command: `node ${t.checkinCmd} detect --config ${t.configCmd}`, timeout: 30 }] },
    SessionEnd: { hooks: [{ type: 'command', command: `node ${t.checkinCmd} end --config ${t.configCmd}`, timeout: 15 }] },
  };
}

const isOurs = (entry) => (entry?.hooks ?? []).some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARK));

/** Settings with our hooks removed (everything else kept exactly). */
export function withoutOurHooks(settings) {
  const s = structuredClone(settings ?? {});
  if (!s.hooks || typeof s.hooks !== 'object') return s;
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    s.hooks[ev] = s.hooks[ev].filter((e) => !isOurs(e));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

export function withOurHooks(settings, entries) {
  const s = withoutOurHooks(settings);
  s.hooks = s.hooks ?? {};
  for (const [ev, entry] of Object.entries(entries)) s.hooks[ev] = [...(s.hooks[ev] ?? []), entry];
  return s;
}

export function installedIn(settingsFile) {
  const s = readJson(settingsFile);
  if (!s?.hooks) return null;
  const found = {};
  for (const [ev, list] of Object.entries(s.hooks)) for (const e of Array.isArray(list) ? list : []) if (isOurs(e)) found[ev] = { matcher: e.matcher ?? '', command: e.hooks.find((h) => h.command?.includes(HOOK_MARK))?.command };
  return Object.keys(found).length ? found : null;
}

/* ------------------------------------------------------------------ detection */

const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 4000, cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); return r.status === 0 ? r.stdout.trim() : null; };
const onPath = (bin) => !!run('sh', ['-c', `command -v ${bin}`]);

export function detectLocation() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') return { id: 'cloud', label: 'Cloud container (Claude Code on the web / phone)', host: '' };
  const inDocker = existsSync('/.dockerenv') || /docker|containerd|kubepods/.test(readFileSafe('/proc/1/cgroup'));
  if (inDocker && process.env.AXF_ROOT) return { id: 'console', label: 'Dev Console server (preview)', host: hostname() };
  if (existsSync('/opt/axf/.axf-console') || existsSync('/opt/axhub') || existsSync('/data/coolify')) return { id: 'vps', label: `VPS terminal${process.env.SSH_CONNECTION ? ' (ssh/mosh)' : ''}`, host: hostname() };
  return { id: 'desktop', label: 'Desktop / laptop', host: hostname() };
}
function readFileSafe(f) { try { return readFileSync(f, 'utf8'); } catch { return ''; } }

/** owner/repo from any remote URL, with credentials and proxy prefixes dropped. */
export function repoSlug(url) {
  if (!url) return '';
  const m = /[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : '';
}

export function detectRepo(cwd, expected, fetch = true) {
  if (!run('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'])) return { present: false };
  const slug = repoSlug(run('git', ['-C', cwd, 'remote', 'get-url', 'origin']));
  const branch = run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']) ?? '';
  const head = run('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD']) ?? '';
  const dirty = (run('git', ['-C', cwd, 'status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
  const fetched = fetch ? run('git', ['-C', cwd, 'fetch', '--quiet', 'origin'], { timeout: 8000 }) !== null : false;
  const counts = run('git', ['-C', cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  const [ahead, behind] = counts ? counts.split(/\s+/).map(Number) : [null, null];
  const ok = !expected || slug.toLowerCase() === expected.toLowerCase();
  return { present: true, slug, branch, head, dirty, ahead, behind, fetched, ok, root: run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']) ?? cwd };
}

export function detectContainer(location, expectedVps) {
  if (location.id === 'cloud') return { id: 'cloud', label: 'Temporary cloud container (only pushed work and archived data survive it)', ok: true };
  const inDocker = existsSync('/.dockerenv') || /docker|containerd|kubepods/.test(readFileSafe('/proc/1/cgroup'));
  const id = inDocker ? `docker:${hostname()}` : 'host';
  const ok = location.id !== 'vps' || !expectedVps || expectedVps === id || (expectedVps === 'host' && !inDocker);
  return { id, label: inDocker ? `Docker container ${hostname()}` : 'Host (no container)', ok };
}

export function detectProject(root, expected) {
  const m = readJson(join(root, 'project.manifest.json'));
  const name = m?.displayName || m?.name || basename(root);
  const claudeProject = process.env.CLAUDE_PROJECT_UUID ? 'a claude.ai Project is attached (its name is not visible to hooks)' : '';
  return { detected: name, expected, claudeProject };
}

export function listMemory(root, config) {
  const files = [];
  const dirs = [];
  for (const d of config.memoryDirs) {
    const abs = resolve(root, d);
    if (!existsSync(abs)) continue;
    dirs.push({ dir: relative(root, abs) || d, mirror: existsSync(join(abs, '.axhub-mirror')) });
    const add = (f, st) => files.push({ path: relative(root, f), size: st.size, updated: st.mtime.toISOString().slice(0, 10) });
    add.skipReadme = true;
    walk(abs, add);
  }
  const userMd = join(homedir(), '.claude', 'CLAUDE.md');
  if (existsSync(userMd)) { const st = statSync(userMd); files.push({ path: '~/.claude/CLAUDE.md', size: st.size, updated: st.mtime.toISOString().slice(0, 10) }); }
  const hubClient = onPath('claude-sync');
  const projectsMounted = existsSync(process.env.AXHUB_PROJECTS_DIR || '/projects');
  const source = !dirs.length ? 'none found'
    : projectsMounted ? 'axHub /projects (mounted here)'
    : hubClient ? 'axHub, synced into _claude/ by claude-sync at session start'
    : 'the project\'s own _claude/ copy (claude-sync not installed here, so it may lag the hub)';
  return { source, hubClient, dirs, files: files.map((f, i) => ({ n: i + 1, ...f })) };
}
function walk(dir, fn, depth = 0) {
  if (depth > 4) return;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || (fn.skipReadme && name === 'README.md')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn, depth + 1); else if (st.size < 2_000_000) fn(p, st);
  }
}

/** Resolve "3", "RULES" or "memory/RULES.md" to a memory file (read-only access only). */
export function memoryFile(root, config, ref) {
  const { files } = listMemory(root, config);
  const r = String(ref ?? '').trim().toLowerCase();
  const f = files.find((x) => String(x.n) === r) ?? files.find((x) => x.path.toLowerCase() === r) ?? files.find((x) => basename(x.path).toLowerCase().replace(/\.md$/, '') === r.replace(/\.md$/, ''));
  if (!f) return null;
  return { ...f, abs: f.path.startsWith('~/') ? join(homedir(), f.path.slice(2)) : join(root, f.path) };
}

export function runningModel(hookInput) {
  const m = hookInput?.model;
  const id = typeof m === 'string' ? m : m?.id ?? m?.display_name ?? process.env.ANTHROPIC_MODEL ?? '';
  const key = /fable/i.test(id) ? 'fable' : /opus/i.test(id) ? 'opus' : /sonnet/i.test(id) ? 'sonnet' : /haiku/i.test(id) ? 'haiku' : '';
  return { id: id || 'unknown', key };
}

export function pendingItems(root) {
  const out = run(process.execPath, [join(root, 'framework/cli/pending.mjs')], { cwd: root, timeout: 6000 });
  if (!out) return [];
  return out.split('\n').filter((l) => /^Pending\s/.test(l)).map((l) => { const m = /^Pending\s+(\w+)\s+Added \S+\s+(.*?)\s+\(([^)]+)\)\s*$/.exec(l); return m ? { model: m[1].toLowerCase(), title: m[2], id: m[3] } : null; }).filter(Boolean);
}

/** The next build-queue step and its model (read-only; never writes the queue). */
export async function nextBuildStep(root) {
  try {
    const persist = await import(join(root, 'framework/cli/persist.mjs'));
    const core = await import(join(root, 'framework/plan/build-queue-core.mjs'));
    const prefer = (rel) => { const r = persist.persistRoot?.(); const p = r ? join(r, rel) : null; return p && existsSync(p) ? p : join(root, rel); };
    const plan = readJson(prefer('framework/plan/plan.json'));
    const q = readJson(prefer('framework/plan/build-queue.json'));
    if (!plan) return null;
    const v = core.computeQueue(plan.features, q);
    const s = v.steps.find((x) => x.id === v.next);
    return s ? { id: s.id, title: s.title, model: s.model, reason: s.modelReason } : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ baseline cost */

export function baselineData() {
  const dir = join(PLUGIN_DIR, 'baseline');
  // Prices: the framework's shared file (model-pricing@1, also used by the Codebase changes hooks and the Build
  // manager), else this plugin's own baseline/pricing.json (older checkouts).
  const shared = readJson(join(REPO_ROOT, 'framework', 'schemas', 'model-pricing.json'), null);
  const pricing = shared?.models ? shared : readJson(join(dir, 'pricing.json'), { models: {} });
  return { pricing, calibration: readJson(join(dir, 'calibration.json'), { runs: [], seed: {} }) };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Estimated USD for one baseline build at model × effort: measured median when calibrated, seed tokens otherwise. */
export function estimate(model, effort, data = baselineData()) {
  const price = data.pricing.models?.[model];
  const runs = (data.calibration.runs ?? []).filter((r) => r.model === model && r.effort === effort && r.pass !== false);
  const tokens = runs.length
    ? { input: median(runs.map((r) => r.input ?? 0)), output: median(runs.map((r) => r.output ?? 0)), cacheRead: median(runs.map((r) => r.cacheRead ?? 0)) }
    : data.calibration.seed?.[effort] ?? null;
  const calibrated = runs.length > 0;
  if (!tokens) return { model, effort, usd: null, calibrated, note: 'no token data' };
  if (!price || price.input == null || price.output == null) return { model, effort, usd: null, calibrated, tokens, note: 'no prices yet' };
  const usd = (tokens.input * price.input + tokens.output * price.output + (tokens.cacheRead ?? 0) * (price.cacheRead ?? price.input)) / 1e6;
  const asOf = data.pricing.asOf ?? null;
  const stale = asOf ? (Date.now() - Date.parse(asOf)) / 864e5 > 60 : true;
  return { model, effort, usd: Math.round(usd * 1000) / 1000, calibrated, runs: runs.length, tokens, pricesAsOf: asOf, stale };
}
export const money = (e) => (e.usd == null ? '—' : `$${e.usd.toFixed(e.usd < 1 ? 3 : 2)}${e.calibrated ? '' : ' uncalibrated'}${e.stale ? ', prices may be stale' : ''}`);

/* ------------------------------------------------------------------ archive (session-log@1) */

async function persistRoot() {
  try { const p = await import(join(REPO_ROOT, 'framework/cli/persist.mjs')); return p.persistRoot?.() ?? null; } catch { return null; }
}

/** Folders the archive is read from (merged by id), first = preferred write location. */
export async function archiveRoots(config) {
  const roots = [];
  if (config?.archive && config.archive !== 'auto') roots.push(config.archive);
  const hub = await persistRoot();
  if (hub) roots.push(join(hub, 'sessions'));
  if (existsSync('/opt/axf/.axf-console') && resolve('/opt/axf') !== REPO_ROOT) roots.push('/opt/axf/sessions');
  roots.push(join(REPO_ROOT, 'sessions'));
  return [...new Set(roots)];
}

export function newId(location, at = new Date()) {
  const rnd = Math.random().toString(16).slice(2, 6);
  return `${at.toISOString().slice(0, 19).replace(/:/g, '-')}Z-${location || 'x'}-${rnd}`;
}

const STR = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
const SECRETISH = /token|secret|password|passwd|api[-_]?key|authorization|cookie|private/i;
/** Keep only known fields, short strings, no secret-looking keys or values. */
export function cleanRecord(r) {
  const scrub = (v, depth = 0) => {
    if (depth > 4) return null;
    if (Array.isArray(v)) return v.slice(0, 60).map((x) => scrub(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRETISH.test(k)).slice(0, 40).map(([k, x]) => [k, scrub(x, depth + 1)]));
    if (typeof v === 'string') return /(ghp_|gho_|github_pat_|sk-ant-|xox[bp]-|Bearer\s)/.test(v) ? '[removed]' : v.slice(0, 400);
    return typeof v === 'number' || typeof v === 'boolean' || v == null ? v : String(v).slice(0, 200);
  };
  const keep = ['id', 'claudeSessionId', 'startedAt', 'client', 'source', 'unattended', 'skipped', 'sameAsLast', 'location', 'repo', 'container', 'project', 'memory', 'model', 'effort', 'estimate', 'pending', 'notes', 'end', 'checkinVersion'];
  const out = { $axf: 'session-log@1' };
  for (const k of keep) if (r[k] !== undefined) out[k] = scrub(r[k]);
  out.id = STR(out.id, 80);
  return out;
}

export async function writeRecord(record, config) {
  const r = cleanRecord(record);
  if (!r.id || !/^[\w.-]+$/.test(r.id)) r.id = newId(r.location?.answer ?? r.location?.detected);
  r.startedAt = r.startedAt ?? new Date().toISOString();
  const [y, m] = [r.startedAt.slice(0, 4), r.startedAt.slice(5, 7)];
  const errors = [];
  for (const root of await archiveRoots(config)) {
    try { const f = join(root, y, m, `${r.id}.json`); writeJsonAtomic(f, r); return { file: f, root, inRepo: root === join(REPO_ROOT, 'sessions'), record: r }; } catch (e) { errors.push(`${root}: ${e.message}`); }
  }
  throw new Error(`could not write the session record (${errors.join('; ')})`);
}

export async function readRecords(config, { limit = 500 } = {}) {
  const byId = new Map();
  for (const root of await archiveRoots(config)) {
    if (!existsSync(root)) continue;
    walk(root, (f) => { if (!f.endsWith('.json')) return; const r = readJson(f); if (r?.$axf === 'session-log@1' && r.id && !byId.has(r.id)) byId.set(r.id, { ...r, _file: f }); });
  }
  return [...byId.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit);
}

/** One line per session for lists. */
export function summary(r) {
  const flags = [];
  if (r.repo && r.repo.ok === false) flags.push('repo');
  if (r.container && r.container.ok === false) flags.push('container');
  if (r.repo?.behind > 0) flags.push('behind');
  if (r.model?.switchNeeded) flags.push('model');
  return {
    id: r.id, startedAt: r.startedAt, location: r.location?.answer ?? r.location?.detected ?? '', repo: r.repo?.slug ?? r.repo?.answer ?? '', branch: r.repo?.branch ?? '', head: r.repo?.head ?? '',
    project: r.project?.answer ?? r.project?.detected ?? '', model: r.model?.picked ?? r.model?.recommended ?? '', effort: r.effort?.picked ?? '', usd: r.estimate?.usd ?? null,
    unattended: !!r.unattended, skipped: !!r.skipped, flags, status: r.unattended || r.skipped ? 'none' : flags.some((f) => f === 'repo' || f === 'container') ? 'mismatch' : flags.length ? 'flag' : 'ok', ended: r.end?.at ?? null,
  };
}
