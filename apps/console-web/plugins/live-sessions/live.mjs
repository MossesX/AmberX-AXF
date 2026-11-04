#!/usr/bin/env node
/**
 * Live sessions CLI + Claude Code hook. An interactive Claude Code session checks in with the console, sends its new
 * transcript lines (the console redacts and records them), and shows its human "You're being watched" / "Recording"
 * whenever that changes (the hook's systemMessage).
 *
 *   node apps/console-web/plugins/live-sessions/live.mjs hook            Claude Code hook: reads the hook JSON on stdin
 *                                                                        (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)
 *   … list [--human|--headless] [--json]                                 every session going on
 *   … notice <session>                                                   watched / recording for one session
 *   … hook-config                                                        the hooks block to put in ~/.claude/settings.json
 *
 * Needs AXF_CONSOLE_URL (default https://console.amberxai.com) and AXF_TOKEN. Account: AXF_ACCOUNT, else the
 * CLAUDE_CONFIG_DIR folder name (a helper account), else "main". Agent: AXF_AGENT. Headless runs (`claude -p`,
 * AXF_SURFACE=headless) never check in here: the console reads their stream logs. A hook never blocks or fails a session.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, join } from 'node:path';

const URL_BASE = (process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/$/, '');
const TOKEN = process.env.AXF_TOKEN || '';
const API = `${URL_BASE}/api/plugins/live-sessions`;
const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'axf-live');
const KEEP_TYPES = new Set(['user', 'assistant', 'system', 'summary']);
const MAX_BATCH = 400_000;

const account = () => process.env.AXF_ACCOUNT || (process.env.CLAUDE_CONFIG_DIR ? basename(process.env.CLAUDE_CONFIG_DIR).replace(/^\./, '') : 'main');
const headless = (h) => process.env.AXF_SURFACE === 'headless' || /^sdk/.test(String(h?.entrypoint || process.env.CLAUDE_CODE_ENTRYPOINT || ''));

async function call(path, body, method = 'POST') {
  if (!TOKEN) throw new Error('AXF_TOKEN is not set');
  const r = await fetch(`${API}/${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `HTTP ${r.status}`);
  return j;
}

function readState(sid) {
  try { return JSON.parse(readFileSync(join(STATE_DIR, `${sid}.json`), 'utf8')); } catch { return { offset: 0, notice: '' }; }
}
function writeState(sid, s) { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(join(STATE_DIR, `${sid}.json`), JSON.stringify(s)); }

/** New whole lines of the transcript since the saved offset, only the message kinds the recording keeps. */
export function newLines(path, offset) {
  if (!path || !existsSync(path)) return { lines: [], offset };
  const size = statSync(path).size;
  if (size < offset) offset = 0; // a new transcript file
  const len = Math.min(size - offset, MAX_BATCH);
  if (len <= 0) return { lines: [], offset };
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, len, offset); } finally { closeSync(fd); }
  const cut = buf.lastIndexOf(10);
  if (cut < 0) return { lines: [], offset };
  const lines = [];
  let entry = '';
  for (const raw of buf.subarray(0, cut).toString('utf8').split('\n')) {
    try {
      const o = JSON.parse(raw);
      if (o.entrypoint) entry = o.entrypoint;
      if (KEEP_TYPES.has(o.type) && !o.isSidechain) lines.push(raw);
    } catch { /* half a line or not JSON */ }
  }
  return { lines, offset: offset + cut + 1, entrypoint: entry };
}

async function hook() {
  let h = {};
  try { h = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no input */ }
  const sid = String(h.session_id || '');
  if (!sid || headless(h)) return;
  const st = readState(sid);
  const { lines, offset, entrypoint } = newLines(h.transcript_path, st.offset || 0);
  if (/^sdk/.test(entrypoint || '')) return;
  const ev = h.hook_event_name || '';
  const body = {
    id: `cc:${sid}`, client: 'code', account: account(), device: process.env.AXF_DEVICE || hostname(), app: 'Claude Code',
    title: st.title || basename(h.cwd || process.cwd()), agent: process.env.AXF_AGENT || undefined, model: process.env.AXF_MODEL || undefined,
    thinking: process.env.AXF_EFFORT || undefined, doing: ev === 'PostToolUse' ? `${h.tool_name || 'tool'}` : ev === 'UserPromptSubmit' ? 'reading your message' : ev === 'Stop' ? 'waiting for you' : undefined,
    ended: ev === 'SessionEnd', lines,
  };
  if (ev === 'UserPromptSubmit' && h.prompt && !st.title) body.title = st.title = String(h.prompt).split('\n')[0].slice(0, 80);
  let j;
  try { j = await call('checkin', body); } catch { return; } // the console is down: the session goes on, next hook retries
  const text = j?.notice?.text || '';
  writeState(sid, { ...st, offset, notice: text });
  if (text !== (st.notice || '') && text) process.stdout.write(JSON.stringify({ systemMessage: `👀 ${text}` }));
  else if (!text && st.notice) process.stdout.write(JSON.stringify({ systemMessage: 'Nobody is watching this session now.' }));
}

const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];
function hookConfig(script) {
  const cmd = `node ${script} hook`;
  return { hooks: Object.fromEntries(HOOKS.map((e) => [e, [{ ...(e === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: cmd, timeout: 10 }] }]])) };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const json = rest.includes('--json');
  if (cmd === 'hook') return hook().catch(() => undefined);
  if (cmd === 'hook-config') { console.log(JSON.stringify(hookConfig(new URL(import.meta.url).pathname), null, 2)); return; }
  if (cmd === 'list') {
    const kind = rest.includes('--human') ? 'human' : rest.includes('--headless') ? 'headless' : '';
    const r = await fetch(`${API}/sessions?kind=${kind}`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.json());
    if (json) { console.log(JSON.stringify(r)); return; }
    console.log(r.counts?.label ?? '');
    for (const s of r.rows ?? []) console.log(`${s.kind.padEnd(8)} ${s.agent.name.padEnd(14)} ${s.status.padEnd(5)} ${(s.app || '').padEnd(14)} ${s.device.padEnd(12)} ${s.title}`);
    return;
  }
  if (cmd === 'notice' && rest[0]) {
    const r = await fetch(`${API}/sessions/${encodeURIComponent(rest[0])}/notice`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.json());
    console.log(json ? JSON.stringify(r) : r.text || 'Not watched, not recording.');
    return;
  }
  console.log('usage: live.mjs hook | hook-config | list [--human|--headless] [--json] | notice <session>');
  process.exitCode = cmd ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
