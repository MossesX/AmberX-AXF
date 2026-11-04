#!/usr/bin/env node
/**
 * builds-events — tell subscribers that the builds store changed (build-todo-sync@1 `storeEvent` frames), so a
 * synced view (the Build to-do sync plugin's lists, anything else later) follows a step the moment it is ticked
 * instead of polling. Called by builds-store.mjs after every write; harmless when nobody subscribed.
 *
 *   Subscribers: <console root>/.axf-console/builds-subscribers.json   (AXF_BUILDS_SUBSCRIBERS = another file)
 *     { "$axf": "builds-subscribers@1", "subscribers": [ { "id": "<plugin folder>", "url": "https://…/api/plugins/<plugin folder>/events", "token": "…" } ] }
 *   (the first subscriber is the Build to-do sync plugin, which adds its own line on install)  axf-plugin:build-todo-sync
 *   The console root is AXF_CONSOLE_ROOT (default /opt/axf, the checkout the console runs from), the same place
 *   builds-live.mjs writes the console's copy of the store, so a worktree's writes reach the console's subscribers too.
 *   Off: AXF_BUILDS_NOTIFY=0, or a test / scratch store (AXF_BUILDS_STORE, AXF_DATA_DIR) unless AXF_BUILDS_NOTIFY=1.
 *
 *   node framework/cli/builds-events.mjs list                         who is subscribed
 *   node framework/cli/builds-events.mjs subscribe <id> <url> [--token-env NAME | --token-file F]   add or replace one
 *   node framework/cli/builds-events.mjs unsubscribe <id>
 *   node framework/cli/builds-events.mjs send '<frame json>'          post one frame now (what the background child runs)
 *   node framework/cli/builds-events.mjs ping                         post a test frame and print each subscriber's answer
 *
 * Each post has a short timeout and never throws into the writer: the plugin's own poll / reconcile catches anything missed.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeEvent } from '../core/build-todo-sync.mjs';

const SELF = fileURLToPath(import.meta.url);
const env = (k, d = '') => process.env[k] ?? d;
const testStore = () => !!process.env.AXF_BUILDS_STORE || !!(process.env.AXF_DATA_DIR && process.env.AXF_DATA_DIR !== 'off');
export const notifyOn = () => env('AXF_BUILDS_NOTIFY') === '1' || (env('AXF_BUILDS_NOTIFY') !== '0' && !testStore());
export const subscribersFile = () => env('AXF_BUILDS_SUBSCRIBERS') || join(env('AXF_CONSOLE_ROOT', '/opt/axf'), '.axf-console', 'builds-subscribers.json');
export const TIMEOUT_MS = 4000;

export function readSubscribers(file = subscribersFile()) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return (Array.isArray(j?.subscribers) ? j.subscribers : []).filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
      .map((s) => ({ id: s.id.slice(0, 80), url: s.url.slice(0, 500), token: typeof s.token === 'string' ? s.token : '', tokenEnv: typeof s.tokenEnv === 'string' ? s.tokenEnv : '' }));
  } catch { return []; }
}
export function writeSubscribers(list, file = subscribersFile()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ $axf: 'builds-subscribers@1', updatedAt: new Date().toISOString(), subscribers: list }, null, 1)}\n`);
  try { chmodSync(tmp, 0o600); } catch { /* best effort */ }
  renameSync(tmp, file);
}
export function subscribe(entry, file = subscribersFile()) {
  const list = readSubscribers(file).filter((s) => s.id !== entry.id);
  list.push({ id: entry.id, url: entry.url, token: entry.token ?? '', tokenEnv: entry.tokenEnv ?? '' });
  writeSubscribers(list, file);
  return list;
}
export function unsubscribe(id, file = subscribersFile()) { const list = readSubscribers(file).filter((s) => s.id !== id); writeSubscribers(list, file); return list; }

/** POST one frame to every subscriber; → [{ id, ok, status | error }]. Never throws. */
export async function send(frame, { file = subscribersFile(), timeoutMs = TIMEOUT_MS } = {}) {
  const subs = readSubscribers(file);
  const body = JSON.stringify(storeEvent(frame));
  return Promise.all(subs.map(async (s) => {
    const token = s.token || (s.tokenEnv ? env(s.tokenEnv) : '');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body, signal: ctl.signal });
      return { id: s.id, ok: r.ok, status: r.status };
    } catch (e) { return { id: s.id, ok: false, error: String(e?.message ?? e).slice(0, 200) }; } finally { clearTimeout(timer); }
  }));
}

/** After a store write: post in a background child (the writer returns at once). AXF_BUILDS_NOTIFY_SYNC=1 posts inline (tests). */
export function notifySoon(frame) {
  if (!notifyOn() || !existsSync(subscribersFile()) || !readSubscribers().length) return false;
  const f = storeEvent(frame);
  if (env('AXF_BUILDS_NOTIFY_SYNC') === '1') { return send(f); }
  try {
    const c = spawn(process.execPath, [SELF, 'send', JSON.stringify(f)], { detached: true, stdio: 'ignore', env: process.env });
    c.unref();
    return true;
  } catch { return false; }
}

async function main(argv) {
  const [cmd = 'list', ...rest] = argv.filter((a) => a !== '--json');
  const json = argv.includes('--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'list') { const l = readSubscribers(); return out({ ok: true, file: subscribersFile(), subscribers: l.map(({ token: _t, ...s }) => s) }, l.length ? l.map((s) => `${s.id.padEnd(24)} ${s.url}${s.token || s.tokenEnv ? ' (token)' : ''}`).join('\n') : `no subscribers (${subscribersFile()})`); }
  if (cmd === 'subscribe') {
    const [id, url] = rest; if (!id || !url) throw new Error('subscribe <id> <url> [--token-env NAME | --token-file F]');
    const te = rest.indexOf('--token-env'); const tf = rest.indexOf('--token-file');
    const token = tf >= 0 ? readFileSync(resolve(rest[tf + 1]), 'utf8').replace(/^AXF_TOKEN=/m, '').trim().split('\n').pop().trim() : '';
    const list = subscribe({ id, url, token, tokenEnv: te >= 0 ? rest[te + 1] : '' });
    return out({ ok: true, subscribers: list.length }, `subscribed ${id} → ${url}`);
  }
  if (cmd === 'unsubscribe') { const list = unsubscribe(rest[0]); return out({ ok: true, subscribers: list.length }, `unsubscribed ${rest[0]}`); }
  if (cmd === 'send') { const r = await send(JSON.parse(rest[0] || '{}')); return out({ ok: true, results: r }, r.map((x) => `${x.id}: ${x.ok ? 'ok' : `failed (${x.error ?? x.status})`}`).join('\n')); }
  if (cmd === 'ping') { const r = await send({ rev: 0, by: 'ping', action: 'ping', builds: [] }); return out({ ok: r.every((x) => x.ok), results: r }, r.length ? r.map((x) => `${x.id}: ${x.ok ? `ok ${x.status}` : `failed (${x.error ?? x.status})`}`).join('\n') : 'no subscribers'); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message); process.exitCode = 1; });
}
