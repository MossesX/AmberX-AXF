#!/usr/bin/env node
/**
 * axf claude-link — the Terminal's Claude link tab from the command line: the console's connection to Claude and axHub.
 *
 *   axf claude-link tail [--kind mcp,error] [--q words] [--limit 50] [--since <id>] [--all] [--follow] [--json]
 *   axf claude-link state [--json]          connected, last event, counts per kind, the shared view
 *   axf claude-link clear                   clear the view (the log is kept)
 *   axf claude-link open                    open the Terminal on the Claude link tab in Brett's open console
 *   axf claude-link pause | resume          pause / resume the open tab
 *   axf claude-link filter [--kind a,b|all] [--q words]
 *
 * Talks to the running console: AXF_CONSOLE_URL (default https://console.amberxai.com) with AXF_TOKEN. The same routes
 * as the tab, the plugin commands (MCP console-terminal_claude_link_*) and voice. --follow reads the live SSE feed and
 * resumes after the last id when the connection drops.
 */
const KINDS = ['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error'];
const base = () => `${(process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/+$/, '')}`;
const ROUTE = '/api/claude-link'; // the axf.claude-link@1 capability mount (whichever plugin provides it)
const headers = (extra = {}) => ({ ...(process.env.AXF_TOKEN ? { authorization: `Bearer ${process.env.AXF_TOKEN}` } : {}), ...extra });

async function req(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${base()}${path}`, { method, headers: headers(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { detail: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${data?.detail ?? data?.message ?? ''}`.trim());
  return data;
}

export function parse(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) f[k] = true; else { f[k] = nx; i++; } } else f._.push(a);
  }
  return f;
}

export function kindsArg(v) {
  if (v === undefined || v === true || v === 'all' || v === '') return '';
  const ks = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  const bad = ks.filter((k) => !KINDS.includes(k));
  if (bad.length) throw new Error(`unknown kind ${bad.join(', ')} (one of ${KINDS.join(', ')})`);
  return ks.join(',');
}

const time = (ts) => new Date(ts).toISOString().slice(11, 19);
export const line = (e) => `${time(e.ts)} ${e.kind.padEnd(10)} ${String(e.source).padEnd(13)} ${[e.account, e.model].filter(Boolean).join(' · ')}${e.account || e.model ? '  ' : ''}${e.session ? `[${e.session}] ` : ''}${e.summary}`;

async function follow(q, json) {
  let last = Number(q.get('since') || 0);
  for (;;) {
    try {
      if (last) q.set('since', String(last));
      const r = await fetch(`${base()}${ROUTE}/stream?${q}`, { headers: headers({ accept: 'text/event-stream', ...(last ? { 'last-event-id': String(last) } : {}) }) });
      if (!r.ok || !r.body) throw new Error(`stream: ${r.status}`);
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev === 'link' && data) { const e = JSON.parse(data); last = e.id; console.log(json ? data : line(e)); }
        }
      }
    } catch (err) { console.error(`claude-link: ${err.message}; reconnecting…`); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function main(argv = process.argv.slice(2)) {
  const f = parse(argv);
  const [cmd = 'tail'] = f._;
  const json = !!f.json;
  switch (cmd) {
    case 'tail': {
      const q = new URLSearchParams();
      const kind = kindsArg(f.kind); if (kind) q.set('kind', kind);
      if (typeof f.q === 'string') q.set('q', f.q);
      if (f.since) q.set('since', String(f.since));
      if (f.all) q.set('all', '1');
      q.set('limit', String(Number(f.limit) || 50));
      const r = await req(`${ROUTE}?${q}`);
      if (json && !f.follow) console.log(JSON.stringify(r, null, 1));
      else for (const e of r.items) console.log(json ? JSON.stringify(e) : line(e));
      if (f.follow) { q.delete('limit'); q.delete('all'); if (r.items.length) q.set('since', String(r.items[r.items.length - 1].id)); await follow(q, json); }
      return 0;
    }
    case 'state': {
      const s = await req(`${ROUTE}/state`);
      if (json) { console.log(JSON.stringify(s, null, 1)); return 0; }
      const hub = s.connected === null ? 'axHub not called yet' : s.connected ? 'axHub answers' : `axHub unreachable (${s.why})`;
      console.log(`${hub} · ${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'no events'} · ${s.held}/${s.size} held${s.view?.paused ? ' · paused' : ''}`);
      if (s.last) console.log(`last: ${line(s.last)}`);
      return 0;
    }
    case 'clear': { const r = await req(`${ROUTE}/clear`, { method: 'POST' }); console.log(`cleared the view after event ${r.clearedAt} (the log is kept)`); return 0; }
    case 'pause': case 'resume': { const v = await req(`${ROUTE}/${cmd}`, { method: 'POST' }); console.log(v.paused ? 'paused' : 'following'); return 0; }
    case 'filter': {
      const body = { kinds: kindsArg(f.kind) || 'all', ...(typeof f.q === 'string' ? { q: f.q } : {}) };
      const v = await req(`${ROUTE}/filter`, { method: 'POST', body });
      console.log(`kinds: ${v.kinds.join(', ') || 'all'} · text: ${v.q || '(none)'}`);
      return 0;
    }
    case 'open': {
      const r = await req('/api/console-control', { method: 'POST', body: { $axf: 'console-control@1', verb: 'open', address: 'view:terminal/tab:claude-link' } });
      console.log(r.ok === false ? `not opened: ${r.message ?? r.code}` : 'opened the Claude link tab in the open console');
      return r.ok === false ? 1 : 0;
    }
    default:
      console.error('usage: axf claude-link tail|state|clear|open|pause|resume|filter [--follow] [--kind a,b] [--q words] [--json]');
      return 2;
  }
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(`claude-link: ${e.message}`); process.exitCode = 1; });
}
