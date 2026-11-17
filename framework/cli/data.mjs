#!/usr/bin/env node
/**
 * axf data — the console's data on axf-data from the command line (works with the console down: it talks to axf-data
 * directly with AXF_DATA_URL + AXF_DATA_TOKEN, the env files deploy/install-data.sh writes).
 *
 *   axf data [status] [<ns>…]                     mode, drift and next step per namespace, axf-data reachable, last backup
 *   axf data backup | verify                      back up axf-data now | re-check the newest backup (background job)
 *   axf data mode <ns> <shadow|cutover|rollback|local> [--window <min>] [--accept-drift]
 *   axf data drift <ns> [--tail n]                the drift log of a namespace
 *   axf data migrate [plan|apply|verify] [<ns>…|--all]   framework/cli/data-migrate.mjs (dry run by default)
 *   axf data get <key> | list <ns> [--prefix p]   read one key / list a namespace
 *   axf data tables [--sync chats|ledger|<key>]   the Postgres tables (rows, bytes, what each holds), SQLite mirrors; --sync mirrors one now
 *   axf data engine [sqlite|shadow|postgres] [--accept-drift]   which engine axf-data reads from, drift, next move; with a mode: move it
 *   --json on every command
 *
 * The console's Data store settings screen, its REST routes, plugin commands (MCP) and voice actions run the same
 * calls (they are listed in that plugin's README / help).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remoteStore } from '../core/data-files.mjs';

const HELP = `axf data [status|backup|verify|mode|drift|migrate|get|list|tables|engine] … (see framework/cli/data.mjs)`;
const ENGINES = ['sqlite', 'shadow', 'postgres'];
const MIRRORS = { chats: 'plugins/chat-viewer/chats.db', ledger: 'plugins/shipped-features/ledger.sqlite' };
const fmtBytes = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const json = args.includes('--json');
  const sub = ['status', 'backup', 'verify', 'mode', 'drift', 'migrate', 'get', 'list', 'tables', 'engine', 'help'].includes(args[0]) ? args.shift() : 'status';
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text(v));
  if (sub === 'help') { console.log(HELP); return 0; }
  const call = async (method, path, body) => {
    const r = await fetch(`${process.env.AXF_DATA_URL.replace(/\/+$/, '')}/v1/${path}`, { method, headers: { authorization: `Bearer ${process.env.AXF_DATA_TOKEN || ''}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || `axf-data answered ${r.status}`), { code: j.code });
    return j;
  };
  if (sub === 'migrate') { process.argv = [process.argv[0], fileURLToPath(new URL('./data-migrate.mjs', import.meta.url)), ...args]; await import('./data-migrate.mjs'); return 0; }
  if (sub === 'status' || sub === 'drift' || sub === 'mode') {
    const mode = await import('./data-mode.mjs');
    const pass = sub === 'mode' ? [args[1], args[0], ...args.slice(2)] : [sub, ...args];
    process.argv = [process.argv[0], fileURLToPath(new URL('./data-mode.mjs', import.meta.url)), ...pass];
    if (sub === 'mode' && (!args[0] || !['shadow', 'cutover', 'rollback', 'local'].includes(args[1]))) { console.error('axf data mode <ns> <shadow|cutover|rollback|local>'); return 2; }
    // data-mode.mjs runs its CLI when it is the entry; here it is imported, so run it the same way
    const flag = (k) => { const i = pass.indexOf(`--${k}`); return i < 0 ? undefined : pass[i + 1] && !pass[i + 1].startsWith('--') ? pass[i + 1] : true; };
    const names = pass.slice(1).filter((a, i, l) => !a.startsWith('--') && !(i > 0 && ['--window', '--tail', '--by'].includes(l[i - 1])));
    const r = await mode.run({ cmd: pass[0], only: names, store: remoteStore(), by: 'svc:cli', windowMin: flag('window') === true ? undefined : flag('window'), acceptDrift: !!flag('accept-drift'), tail: Number(flag('tail')) || 20 });
    if (r.$axf === 'data-mode-status@1') {
      let backup = null; if (r.remote.ok) { try { backup = (await call('GET', '_meta/backup')).last; } catch { /* the token may not read _meta */ } }
      out({ ...r, backup }, (v) => [`axf-data: ${v.remote.configured ? (v.remote.ok ? `up (cursor ${v.remote.cursor})` : 'NOT reachable') : 'not configured (AXF_DATA_URL)'}${v.backup ? ` · last backup ${v.backup.at} ${v.backup.verify?.ok ? 'verified' : 'NOT verified'}` : ''}`, ...v.namespaces.map((n) => `  ${n.ns.padEnd(28)} ${n.mode.padEnd(9)} drift ${String(n.drift).padStart(3)}  next: ${n.next}${n.nextReason ? ` (${n.nextReason})` : ''}`), ...(sub === 'drift' ? v.namespaces.flatMap((n) => (n.entries || []).map((e) => `    ${e.at} ${e.op} ${e.kind} ${e.key}${e.error ? ` — ${e.error}` : ''}`)) : [])].join('\n'));
    } else out(r, (v) => v.results.map((x) => `${x.ok ? '✓' : '✗'} ${x.ns}: ${x.from} → ${x.to || x.from}${x.reason ? `  ${x.reason}` : ''}`).join('\n'));
    return r.ok === false ? 1 : 0;
  }
  const store = remoteStore();
  if (!store) { console.error('axf data: AXF_DATA_URL is unset (source /root/hub/data/axf-data/conf/env/cli.env)'); return 1; }
  try {
    if (sub === 'backup' || sub === 'verify') { const j = await call('POST', '_meta/backup', sub === 'verify' ? { verify: true } : {}); out(j, (v) => `${sub === 'backup' ? 'Backup' : 'Verify'} ${v.state} on axf-data${v.file ? ` (${v.file})` : ''}: \`axf data status\` shows the result`); return 0; }
    if (sub === 'tables') {
      const si = args.indexOf('--sync');
      if (si >= 0) {
        const src = MIRRORS[args[si + 1]] || args[si + 1];
        if (!src) { console.error('axf data tables --sync chats|ledger|<key>'); return 2; }
        const j = await call('POST', '_meta/tables/sync', { source: src });
        out(j, (v) => `Mirror ${v.state} for ${v.source} → ${v.prefix}_*: \`axf data tables\` shows the rows`);
        return 0;
      }
      const t = await call('GET', '_meta/tables');
      out(t, (v) => [`axf-data engine: ${v.engine}${v.note ? ` (${v.note})` : ''}`,
        ...(v.tables || []).map((x) => `  ${x.name.padEnd(22)} ${String(x.rows).padStart(9)} rows  ${fmtBytes(x.bytes).padStart(9)}  ${x.group.padEnd(6)} ${x.holds || ''}`),
        ...(v.mirrors || []).map((m) => `  mirror ${m.prefix}: ${m.source} at ${m.at} ${m.ok ? 'ok' : `FAILED ${m.error}`} (${Object.entries(m.tables || {}).map(([k, x]) => `${k} ${x.rows}`).join(', ')})`)].join('\n'));
      return 0;
    }
    if (sub === 'engine') {
      const to = args.find((a) => ENGINES.includes(a));
      const e = to ? await call('POST', '_meta/engine', { mode: to, acceptDrift: args.includes('--accept-drift') }) : await call('GET', '_meta/engine');
      out(e, (v) => [`axf-data reads from ${v.mode}${v.since ? ` since ${v.since}` : ''}${v.by ? ` (${v.by})` : ''}; drift ${v.drift}${v.lastDriftAt ? ` (last ${v.lastDriftAt})` : ''}; next: ${v.next}`,
        ...Object.entries(v.counts || {}).map(([k, c]) => `  ${k.padEnd(9)} ${c.error ? c.error : `${Object.values(c).reduce((a, b) => a + b, 0)} keys`}`),
        ...(v.drift_tail || []).slice(-5).map((d) => `  drift ${d.at} ${d.op} ${d.kind} ${d.key}${d.error ? ` — ${d.error}` : ''}`)].join('\n'));
      return 0;
    }
    if (sub === 'get') { const r = await store.get(args[0]); out(r, (v) => (v ? (v.data instanceof Uint8Array ? `${v.path}: ${v.size} bytes (${v.contentType}), rev ${v.rev}` : JSON.stringify(v.data, null, 2)) : 'not found')); return r ? 0 : 1; }
    if (sub === 'list') { const pi = args.indexOf('--prefix'); const r = await store.list(args[0], { prefix: pi >= 0 ? args[pi + 1] : '' }); out(r, (v) => v.items.map((i) => `${i.path}  rev ${i.rev}  ${i.kind}  ${i.size} B`).join('\n') + (v.next ? `\n… more after ${v.next}` : '')); return 0; }
  } catch (e) { console.error(`axf data ${sub}: ${e.code || 'error'}: ${e.message}`); return 1; }
  console.log(HELP); return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
