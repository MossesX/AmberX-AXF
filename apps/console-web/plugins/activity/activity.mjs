#!/usr/bin/env node
/**
 * activity.mjs — report work in progress to the console's Activity banner (activity@1).
 *
 *   node activity.mjs start <id> "<title>" [--detail text] [--url https://…] [--steps "a,b,c"]
 *   node activity.mjs update <id> [--detail text] [--progress 0.4] [--step "name=running"]
 *   node activity.mjs done <id> [--detail text]      fail <id> [--detail text]      cancel <id>
 *   node activity.mjs list [--json]
 *   node activity.mjs hook                            Claude Code hook: reads the hook's JSON on stdin
 *   node activity.mjs hooks install|remove|status [--settings <file>]   (default ~/.claude/settings.json)
 *   node activity.mjs hooks install --user <name>     as root: that user's ~/.claude/settings.json, and opens the drop
 *                                                     folders so its sessions can report
 *   node activity.mjs hooks ensure [--all]            install only where an event is missing (--all: root and every
 *                                                     /home/<user> with a .claude folder); what claude-headless.sh and
 *                                                     the systems check's Auto fix run
 *
 * Where it writes: a JSON file per item in the plugin's reports folder, which the console reads:
 *   AXF_ACTIVITY_DIR (the plugin data folder), else /opt/axf/.axf-console/plugins/activity when it exists (the VPS
 *   clone the console container mounts), else this repo's .axf-console/plugins/activity.
 * With AXF_CONSOLE_URL + AXF_TOKEN set (and --console) it posts to the console API instead.
 *
 * The hook never blocks Claude Code: it always exits 0, quickly, whatever happens. Prompts are cut short and anything
 * that looks like a token or password is hidden before it's written.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, lstatSync, copyFileSync, chmodSync, chownSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const MARK = /activity\.mjs"? hook$/;
const STATES = ['queued', 'running', 'waiting', 'done', 'failed', 'cancelled'];

export function dataDir(env = process.env) {
  if (env.AXF_ACTIVITY_DIR) return env.AXF_ACTIVITY_DIR;
  const vps = join(env.AXF_DIR || '/opt/axf', '.axf-console');
  if (existsSync(vps)) return join(vps, 'plugins', 'activity');
  return join(REPO, '.axf-console', 'plugins', 'activity');
}
const reportsDir = () => join(dataDir(), 'reports');
/** Where each machine user's hook says it is alive (hooks@1 health: `<user>.json`), read by the systems check. */
const hooksDir = () => join(dataDir(), 'hooks');

const SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}|(?:token|secret|password|passwd|api[_-]?key|key)\s*[=:]\s*\S{6,})/gi;
export function redact(s, limit = 400) {
  const t = String(s ?? '').replace(SECRET, '[hidden]').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ');
  return t.length > limit ? `${t.slice(0, limit - 1)}…` : t;
}
const safeName = (id) => `${String(id).replace(/[^A-Za-z0-9_.@+-]/g, '_').slice(0, 150)}.json`;
const validId = (id) => /^[A-Za-z0-9_.:@/+-]{1,160}$/.test(String(id ?? '')) && !String(id).includes('..');

function readItem(id) {
  const p = join(reportsDir(), safeName(id));
  try { if (lstatSync(p).isSymbolicLink()) return null; return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function write(patch) {
  if (!validId(patch.id)) throw new Error('an id is letters, digits and . : @ / + - _');
  const now = Date.now();
  const prev = readItem(patch.id) ?? {};
  const it = { ...prev, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: now };
  it.startedAt ??= now;
  it.source ??= 'reports';
  if (!it.title) throw new Error('a new item needs a title');
  if (['done', 'failed', 'cancelled'].includes(it.state)) { if (!patch.finishedAt) it.finishedAt = now; } else delete it.finishedAt;
  it.title = redact(it.title, 160);
  if (it.detail != null) it.detail = redact(it.detail, 2000);
  const dir = reportsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = join(dir, safeName(it.id));
  try { if (lstatSync(p).isSymbolicLink()) throw new Error('refusing a symlink'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(it), { mode: 0o600 });
  renameSync(tmp, p);
  return it;
}

async function post(path, body) {
  const url = process.env.AXF_CONSOLE_URL, tok = process.env.AXF_TOKEN;
  if (!url || !tok) throw new Error('--console needs AXF_CONSOLE_URL and AXF_TOKEN');
  const u = new URL(`/api/plugins/activity/${path}`, url);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('the console address must be https');
  const r = await fetch(u, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`console answered ${r.status}`);
  return r.json();
}

/* ---------------- Claude Code hook ---------------- */

const tail = (p) => (p ? basename(String(p)) : '');
function toolLine(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Bash') return `Running: ${redact(String(i.command ?? '').split('\n')[0], 100)}`;
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return `Editing ${tail(i.file_path ?? i.notebook_path)}`;
  if (name === 'Read') return `Reading ${tail(i.file_path)}`;
  if (name === 'Grep' || name === 'Glob') return `Searching ${redact(i.pattern ?? '', 60)}`;
  if (name === 'WebSearch') return `Searching the web: ${redact(i.query ?? '', 80)}`;
  if (name === 'WebFetch') return `Reading ${(() => { try { return new URL(i.url).hostname; } catch { return 'a web page'; } })()}`;
  if (name === 'Agent' || name === 'Task') return `Started a helper: ${redact(i.description ?? '', 60)}`;
  if (String(name).startsWith('mcp__')) return `Using ${String(name).split('__').slice(1).join(' · ')}`;
  return `Using ${name}`;
}

/**
 * What kind of work a tool call is (Brett, Oct 24 2026: building, editing, deleting, pushing, pulling, merging and
 * thinking all show in the banner): null = nothing worth its own line.
 */
export function activityKind(name, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return 'edit';
  if (name !== 'Bash') return null;
  const c = runnable(i.command);
  // whole git sub-commands only: `git merge-base`, `git rev-parse`, `git log`, `git status`, `git diff` are reads
  if (/\bgit\s+push(?![\w-])/.test(c)) return 'push';
  if (/\bgit\s+(merge|rebase|cherry-pick)(?![\w-])/.test(c)) return 'merge';
  if (/\bgit\s+(pull|fetch)(?![\w-])/.test(c)) return 'pull';
  if (/\bgit\s+(rm(?![\w-])|branch\s+-[dD]\b)/.test(c) || removesRealFiles(runnable(i.command, { quotes: false }))) return 'delete';
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?build\b|\bvite\s+build\b|\bgradle\b|\bdocker\s+(build|compose\s+build)\b|\bmake\b|\btsc\b|\bcargo\s+build\b/.test(c)) return 'build';
  return null;
}
/**
 * Scratch a delete doesn't count for (Brett, Oct 31 2026: `rm /tmp/...` isn't "Deleting"): temp folders, build output
 * and caches, the re-baked framework copy, logs and temp files, and shell variables that name a temp path.
 */
const SCRATCH = [
  /^(\/tmp|\/var\/tmp|\/dev\/shm)(\/|$)/, /^["']?\$\{?(TMPDIR|TMP|TEMP|tmp\w*|\w*_?tmp|\w*scratch\w*|\w*_TMP)\}?/i,
  /(^|\/)(node_modules|dist|build|out|coverage|\.cache|__pycache__|\.pytest_cache|\.vite|\.turbo|\.next|tmp|temp|scratch)(\/|$)/,
  /(^|\/)src\/axf\/?$/, /\.(tmp|log|pyc|bak|swp|lock)$/, /(^|\/)axf-[\w.-]*-[A-Za-z0-9]{6}(\/|$)/,
];
const isScratch = (p) => SCRATCH.some((re) => re.test(p.replace(/^["']|["']$/g, '')));
/**
 * The part of a shell command that runs: heredoc bodies (text written to a file, e.g. `cat > /tmp/x.sh <<EOF … git merge …`)
 * and quoted strings (`grep "git push"`, commit messages) are left out, so words in them don't count as work.
 */
export function runnable(cmd, { quotes = true } = {}) {
  const t = String(cmd ?? '').replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, (m) => m.split('\n')[0]);
  return quotes ? t.replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, '""') : t;
}
/** Does a shell command remove anything that isn't scratch? Only `rm` / `rmdir` / `unlink` as the command of a segment. */
export function removesRealFiles(cmd) {
  for (const seg of String(cmd ?? '').split(/&&|\|\||[;|\n]|\$\(|`/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    while (words.length && (/^\w+=/.test(words[0]) || ['sudo', 'command', 'xargs', 'nohup', 'exec'].includes(words[0]))) words.shift();
    if (!['rm', 'rmdir', 'unlink'].includes(words[0])) continue;
    const targets = words.slice(1).filter((w) => !w.startsWith('-') && w !== '2>/dev/null' && !w.startsWith('>'));
    if (!targets.length || targets.some((t) => !isScratch(t))) return true;
  }
  return false;
}
/** Kinds that get their own line in the banner (edits stay steps of the session: there are too many). */
const OWN_LINE = new Set(['push', 'pull', 'merge', 'delete', 'build']);
const VERB = { push: 'Pushing', pull: 'Pulling', merge: 'Merging', delete: 'Deleting', build: 'Building' };

/** A push / pull / merge / delete / build by Claude Code as its own item: running on PreToolUse, done or failed on PostToolUse. */
export function hookChild(ev) {
  const sid = String(ev.session_id ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12);
  const tid = String(ev.tool_use_id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(-16);
  if (!sid || !tid) return null;
  const kind = activityKind(ev.tool_name, ev.tool_input);
  if (!OWN_LINE.has(kind)) return null;
  const where = tail(ev.cwd) || 'Claude Code';
  const cmd = redact(String(ev.tool_input?.command ?? '').split('\n')[0], 140);
  const base = { id: `claude:${sid}:${tid}`, kind, source: 'claude-code', title: `${VERB[kind]} · ${where}`, by: 'Claude Code', detail: cmd };
  if (ev.hook_event_name === 'PreToolUse') return { ...base, state: 'running', startedAt: Date.now(), finishedAt: undefined };
  if (ev.hook_event_name === 'PostToolUse') {
    const r = ev.tool_response && typeof ev.tool_response === 'object' ? ev.tool_response : {};
    const failed = r.is_error === true || r.interrupted === true || (typeof r.exit_code === 'number' && r.exit_code !== 0) || (typeof r.exitCode === 'number' && r.exitCode !== 0);
    return { ...base, state: failed ? 'failed' : 'done', finishedAt: undefined };
  }
  return null;
}

export function hookPatch(ev, prev) {
  const sid = String(ev.session_id ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12);
  if (!sid) return null;
  const id = `claude:${sid}`;
  const where = tail(ev.cwd) || 'Claude Code';
  const base = { id, kind: 'thinking', source: 'claude-code', title: `Claude Code · ${where}`, by: 'Claude Code' };
  const steps = Array.isArray(prev?.steps) ? prev.steps.map((s) => ({ ...s, state: s.state === 'running' ? 'done' : s.state })) : [];
  // the session's command lines still running (ids), so Stop / SessionEnd can close them (Oct 31 2026: ghosts)
  const open = Array.isArray(prev?.open) ? prev.open.filter((x) => typeof x === 'string').slice(-40) : [];
  const child = hookChild(ev);
  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      return { ...base, state: 'running', startedAt: Date.now(), finishedAt: undefined, steps: [], open, detail: `Asked: ${redact(String(ev.prompt ?? '').replace(/\s+/g, ' ').trim(), 160)}` };
    case 'PreToolUse': {
      const line = toolLine(ev.tool_name, ev.tool_input);
      return { ...base, kind: activityKind(ev.tool_name, ev.tool_input) ?? 'claude', state: 'running', steps: [...steps, { name: line, state: 'running' }].slice(-15), open: child ? [...open.filter((x) => x !== child.id), child.id] : open, ...(prev?.title ? {} : { startedAt: Date.now() }) };
    }
    case 'PostToolUse':
      return { ...base, state: 'running', steps: prev?.steps ?? [], open: child ? open.filter((x) => x !== child.id) : open }; // back to thinking
    case 'Notification':
      return { ...base, state: 'waiting', steps, open, detail: `${prev?.detail ? `${prev.detail}\n` : ''}Waiting for you: ${redact(ev.message ?? 'needs your input', 160)}`.slice(-2000) };
    case 'Stop':
    case 'SessionEnd':
      return { ...base, kind: 'claude', state: 'done', steps, open: [], finishedAt: undefined };
    default:
      return null;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 2_000_000) break; }
  return Buffer.concat(chunks).toString('utf8');
}

async function hook() {
  let ev = {};
  try {
    ev = JSON.parse(await readStdin());
    const sid = String(ev.session_id ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12);
    const prev = sid ? readItem(`claude:${sid}`) : null;
    if (ev.hook_event_name !== 'UserPromptSubmit' && !prev) return; // only sessions that asked something show up
    const patch = hookPatch(ev, prev);
    if (patch) write(patch);
    const child = hookChild(ev);
    if (child) write(child);
    if (sid && (ev.hook_event_name === 'Stop' || ev.hook_event_name === 'SessionEnd')) closeChildren(sid, prev?.open);
  } catch { /* never get in Claude Code's way */ } finally {
    try { noteHookEvent(ev?.hook_event_name); } catch { /* the health note is best effort */ }
  }
}

/** Finish every command line a session left running: the ones it knows of, plus any in the folder (when it may list it). */
export function closeChildren(sid, known = []) {
  const ids = new Set((Array.isArray(known) ? known : []).filter((x) => typeof x === 'string' && x.startsWith(`claude:${sid}:`)));
  try {
    const pre = safeName(`claude:${sid}:`).replace(/\.json$/, '');
    for (const f of readdirSync(reportsDir())) {
      if (!f.startsWith(pre) || !f.endsWith('.json')) continue;
      try { const id = JSON.parse(readFileSync(join(reportsDir(), f), 'utf8'))?.id; if (typeof id === 'string' && id.startsWith(`claude:${sid}:`)) ids.add(id); } catch { /* not readable */ }
    }
  } catch { /* a drop folder others can't list: the known ones are enough */ }
  let n = 0;
  for (const id of ids) {
    const it = id && readItem(id);
    if (!it || !['queued', 'running', 'waiting'].includes(it.state)) continue;
    write({ id, title: it.title, state: 'done', detail: `${it.detail ?? ''}\n(closed when the session stopped)`.trim(), finishedAt: undefined });
    n++;
  }
  return n;
}

/* ---------------- hook health (systems check: hook events stop arriving, an event missing) ---------------- */

const who = () => { try { return userInfo().username.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40) || 'user'; } catch { return 'user'; } };

/** Records that this user's hook fired (`hooks/<user>.json`: last time per event, which events its settings lack). */
export function noteHookEvent(event, { user = who(), settings = join(homedir(), '.claude', 'settings.json'), now = Date.now() } = {}) {
  if (!HOOK_EVENTS.includes(event)) return null;
  const dir = hooksDir();
  const p = join(dir, `${user}.json`);
  let prev = {};
  try { if (!lstatSync(p).isSymbolicLink()) prev = JSON.parse(readFileSync(p, 'utf8')); } catch { /* first one */ }
  const recheck = event === 'UserPromptSubmit' || !Array.isArray(prev.missing);
  const st = { $axf: 'activity-hooks@1', user, settings, missing: recheck ? hooksStatus(settings).missing : prev.missing,
    events: { ...(prev.events ?? {}), [event]: now }, updatedAt: now };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 });
  renameSync(tmp, p);
  return st;
}

/* ---------------- installing the hook ---------------- */

const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const settingsFile = (args) => args.settings || join(homedir(), '.claude', 'settings.json');
const isOurs = (e) => (e?.hooks ?? []).some((h) => typeof h?.command === 'string' && MARK.test(h.command));
function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

export function withoutOurHooks(s) {
  const out = structuredClone(s ?? {});
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue;
    out.hooks[ev] = out.hooks[ev].filter((e) => !isOurs(e));
    if (!out.hooks[ev].length) delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}
export function withOurHooks(s, script) {
  const out = withoutOurHooks(s);
  out.hooks ??= {};
  const command = `node "${script}" hook`;
  for (const ev of HOOK_EVENTS) out.hooks[ev] = [...(out.hooks[ev] ?? []), { ...(ev === 'PreToolUse' || ev === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command, timeout: 5 }] }];
  return out;
}
export function hooksInstalled(file) { const s = readJson(file); return !!s?.hooks && Object.values(s.hooks).some((l) => Array.isArray(l) && l.some(isOurs)); }
/** Which of our events a settings file has and lacks (an install from before PostToolUse lacks it: the ghost lines). */
export function hooksStatus(file) {
  const s = readJson(file);
  const has = HOOK_EVENTS.filter((ev) => Array.isArray(s?.hooks?.[ev]) && s.hooks[ev].some(isOurs));
  return { file, installed: has.length > 0, complete: has.length === HOOK_EVENTS.length, missing: HOOK_EVENTS.filter((ev) => !has.includes(ev)) };
}

function saveSettings(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

export function installHooks(file, script = fileURLToPath(import.meta.url)) {
  const cur = readJson(file);
  if (existsSync(file) && cur === null) throw new Error(`${file} isn't valid JSON; not touching it`);
  saveSettings(file, withOurHooks(cur ?? {}, script));
}
/** A machine user's home and ids (getent), or null. */
function account(name) {
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(String(name ?? ''))) throw new Error(`not a user name: ${name}`);
  try {
    const [, , uid, gid, , home] = execFileSync('getent', ['passwd', name], { encoding: 'utf8' }).trim().split(':');
    return { name, uid: Number(uid), gid: Number(gid), home };
  } catch { return null; }
}
/**
 * Lets other machine users' sessions report: the data folder traverse-only for others (0711: nothing in it can be
 * listed or read), and the reports and hooks drop folders write-only + sticky (1733: each user writes and replaces only
 * its own files; the console, as root, reads them all). Only root can do it; anyone else gets false.
 */
export function openDropFolders() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;
  const d = dataDir();
  for (const sub of [d, reportsDir(), hooksDir()]) mkdirSync(sub, { recursive: true, mode: 0o700 });
  chmodSync(d, 0o711);
  chmodSync(reportsDir(), 0o1733);
  chmodSync(hooksDir(), 0o1733);
  return true;
}
/** Install for another user (root): their settings file, owned by them, plus the drop folders and their health note. */
export function installFor(name, script = fileURLToPath(import.meta.url)) {
  const a = account(name);
  if (!a) throw new Error(`no user ${name} on this machine`);
  const file = join(a.home, '.claude', 'settings.json');
  installHooks(file, script);
  try { chownSync(dirname(file), a.uid, a.gid); chownSync(file, a.uid, a.gid); if (existsSync(`${file}.bak`)) chownSync(`${file}.bak`, a.uid, a.gid); } catch { /* not root: it's ours already */ }
  if (a.uid !== 0) openDropFolders();
  const st = noteHookEvent('UserPromptSubmit', { user: name, settings: file });
  try { if (a.uid !== 0) chownSync(join(hooksDir(), `${name}.json`), a.uid, a.gid); } catch { /* same user */ }
  return { ...hooksStatus(file), user: name, health: !!st };
}
/** Every account whose sessions should report: root plus each /home/<user> with a .claude folder. */
export function claudeUsers() {
  const out = [];
  if (typeof process.getuid === 'function' && process.getuid() === 0) out.push('root');
  try { for (const n of readdirSync('/home')) if (existsSync(join('/home', n, '.claude')) && account(n)) out.push(n); } catch { /* no /home */ }
  return out;
}
export function removeHooks(file) {
  if (!existsSync(file)) return false;
  const cur = readJson(file);
  if (cur === null || !hooksInstalled(file)) return false;
  saveSettings(file, withoutOurHooks(cur));
  return true;
}

/* ---------------- CLI ---------------- */

function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; } } else pos.push(a);
  }
  return { pos, flags };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'hook') return hook();
  const { pos, flags } = parse(rest);
  const out = (x) => console.log(flags.json ? JSON.stringify(x, null, 2) : typeof x === 'string' ? x : `${x.state.padEnd(9)} ${x.id}  ${x.title}`);
  const send = async (patch, finish) => {
    if (flags.console) return out(finish ? await post('finish', { id: patch.id, state: patch.state, detail: patch.detail }) : await post('report', patch));
    return out(write(patch));
  };
  switch (cmd) {
    case 'start': {
      const [id, ...title] = pos;
      const steps = typeof flags.steps === 'string' ? flags.steps.split(',').map((n, i) => ({ name: n.trim(), state: i === 0 ? 'running' : 'queued' })).filter((s) => s.name) : undefined;
      return send({ id, title: title.join(' '), state: 'running', startedAt: Date.now(), finishedAt: undefined, detail: flags.detail === true ? undefined : flags.detail, url: flags.url, steps, by: flags.by ?? process.env.USER });
    }
    case 'update': {
      const [id] = pos; const prev = readItem(id) ?? {};
      let steps;
      if (typeof flags.step === 'string') {
        const [name, st = 'running'] = flags.step.split('=');
        steps = [...(prev.steps ?? [])];
        const at = steps.findIndex((s) => s.name === name);
        if (at >= 0) steps[at] = { name, state: STATES.includes(st) ? st : 'running' }; else steps.push({ name, state: STATES.includes(st) ? st : 'running' });
      }
      return send({ id, title: prev.title, state: flags.state ?? prev.state ?? 'running', detail: flags.detail === true ? undefined : flags.detail, progress: flags.progress !== undefined ? Number(flags.progress) : undefined, steps });
    }
    case 'done': case 'fail': case 'cancel': {
      const [id] = pos; const prev = readItem(id);
      const state = cmd === 'done' ? 'done' : cmd === 'fail' ? 'failed' : 'cancelled';
      if (!prev && !flags.console) throw new Error(`no item ${id}`);
      return send({ id, title: prev?.title, state, detail: flags.detail === true ? undefined : flags.detail, steps: prev?.steps?.map((s) => ({ ...s, state: s.state === 'running' || s.state === 'queued' ? state : s.state })) }, true);
    }
    case 'list': {
      const dir = reportsDir();
      const items = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean) : [];
      if (flags.json) return console.log(JSON.stringify(items, null, 2));
      console.log(items.length ? items.map((x) => `${x.state.padEnd(9)} ${x.id}  ${x.title}`).join('\n') : `nothing reported (${dir})`);
      return;
    }
    case 'remove': {
      const p = join(reportsDir(), safeName(pos[0])); if (existsSync(p)) unlinkSync(p); return;
    }
    case 'hooks': {
      const file = settingsFile(flags); const sub = pos[0] ?? 'status';
      if (sub === 'install' && typeof flags.user === 'string') { const r = installFor(flags.user); console.log(`Claude Code hooks added for ${r.user} in ${r.file}: ${r.complete ? 'all events' : `missing ${r.missing.join(', ')}`}.`); return; }
      if (sub === 'install') { installHooks(file); noteHookEvent('UserPromptSubmit', { settings: file }); console.log(`Claude Code hooks added to ${file} (backup ${file}.bak). New Claude Code sessions report to the Activity banner.`); return; }
      if (sub === 'ensure') {
        // only where something is missing: claude-headless.sh runs it before every session, the Auto fix with --all
        const users = flags.all ? claudeUsers() : [null];
        for (const u of users) {
          const f = u && u !== who() ? join(account(u)?.home ?? '/nonexistent', '.claude', 'settings.json') : file;
          const st = hooksStatus(f);
          if (st.complete) { console.log(`ok ${u ?? who()}: ${f}`); continue; }
          const r = u && u !== who() ? installFor(u) : (installHooks(f), noteHookEvent('UserPromptSubmit', { settings: f }), hooksStatus(f));
          console.log(`fixed ${u ?? who()}: ${f} (was missing ${st.missing.join(', ')}; now ${r.complete ? 'complete' : `missing ${r.missing.join(', ')}`})`);
        }
        if (flags.all) openDropFolders();
        return;
      }
      if (sub === 'remove') { console.log(removeHooks(file) ? `hooks removed from ${file}` : `no Activity hooks in ${file}`); return; }
      { const st = hooksStatus(file); console.log(st.complete ? `installed in ${file} (all ${HOOK_EVENTS.length} events)` : st.installed ? `incomplete in ${file}: missing ${st.missing.join(', ')} (run hooks install)` : `not installed in ${file}`); if (flags['exit-code'] && !st.complete) process.exitCode = 1; }
      return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n').replace(/^ ?\*\/?/gm, ''));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { if (process.argv[2] === 'hook') process.exit(0); console.error(`activity: ${e.message}`); process.exit(1); });
}
