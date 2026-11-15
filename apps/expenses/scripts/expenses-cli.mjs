#!/usr/bin/env node
/**
 * Expenses CLI over the ledger API (`/api/expenses/v1`, build expenses-port). Node 22, no install.
 *
 *   node apps/expenses/scripts/expenses-cli.mjs list [--from 2026-10-01] [--to …] [--category food] [--account Discover] [--q text] [--limit 20]
 *   … get <id>
 *   … add --merchant "Dunkin" --amount 4.25 [--date 2026-11-04] [--category food] [--account Discover] [--note …] [--income]
 *   … edit <id> [--amount 5] [--merchant …] [--category …] [--account …] [--date …] [--note …] [--disputed true|false]
 *   … accounts [--from …] [--to …]
 *   … totals [--by category|account|month|merchant] [--from …] [--to …]
 *   … export [--format csv|json] [--from …] [--to …] [> file]
 *   --json prints the raw response.
 *
 * Where and as whom: EXPENSES_URL (default https://expenses.amberxai.com), EXPENSES_API_TOKEN or the token file the
 * installer writes (EXPENSES_TOKEN_FILE, default /opt/expenses-axf/.app/api-token, root only), EXPENSES_USER (sent as
 * X-Expenses-User; the server's EXPENSES_API_USER otherwise).
 */
import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {}; const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; } }
  else pos.push(a);
}
const asJson = flags.json === true;

if (!cmd || cmd === 'help' || flags.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
  process.exit(cmd ? 0 : 1);
}

const base = (process.env.EXPENSES_URL || 'https://expenses.amberxai.com').replace(/\/$/, '') + '/api/expenses/v1';
const tokenFile = process.env.EXPENSES_TOKEN_FILE || '/opt/expenses-axf/.app/api-token';
const token = process.env.EXPENSES_API_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) { console.error(`No API token: set EXPENSES_API_TOKEN or run where ${tokenFile} is readable.`); process.exit(2); }

async function call(method, path, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (process.env.EXPENSES_USER) headers['x-expenses-user'] = process.env.EXPENSES_USER;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) { console.error(`${r.status}: ${text.slice(0, 300)}`); process.exit(1); }
  return r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
}

const qs = (keys) => { const p = new URLSearchParams(); for (const k of keys) if (typeof flags[k] === 'string') p.set(k, flags[k]); const s = p.toString(); return s ? `?${s}` : ''; };
const usd = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2);
const entryInput = () => {
  const b = {};
  for (const k of ['merchant', 'date', 'category', 'account', 'note', 'currency']) if (typeof flags[k] === 'string') b[k] = flags[k];
  for (const k of ['amount', 'tax', 'tip']) if (typeof flags[k] === 'string') { const n = Number(flags[k]); if (!Number.isFinite(n)) { console.error(`--${k} must be a number`); process.exit(2); } b[k] = n; }
  for (const k of ['disputed', 'reimbursable']) if (flags[k] !== undefined) b[k] = flags[k] === true || flags[k] === 'true';
  if (flags.income) b.kind = 'income';
  if (flags.expense) b.kind = 'expense';
  return b;
};
const line = (e) => `${e.date}  ${usd(e.totalCents).padStart(10)}  ${(e.merchant || '').slice(0, 28).padEnd(28)}  ${(e.category || '').padEnd(12)}  ${(e.paymentMethod || '').padEnd(12)}  ${e.id}${e.kind === 'income' ? '  (income)' : ''}${e.disputed ? '  (disputed)' : ''}`;

const out = await (async () => {
  switch (cmd) {
    case 'list': return call('GET', '/entries' + qs(['from', 'to', 'category', 'account', 'kind', 'q', 'limit']));
    case 'get': return call('GET', `/entries/${encodeURIComponent(pos[0] ?? '')}`);
    case 'add': return call('POST', '/entries', entryInput());
    case 'edit': if (!pos[0]) { console.error('edit <id> …'); process.exit(2); } return call('PATCH', `/entries/${encodeURIComponent(pos[0])}`, entryInput());
    case 'accounts': return call('GET', '/accounts' + qs(['from', 'to']));
    case 'totals': return call('GET', '/totals' + qs(['from', 'to', 'category', 'account', 'kind', 'q', 'by']));
    case 'export': return call('GET', '/export' + qs(['format', 'from', 'to', 'category', 'account', 'kind', 'q']));
    default: console.error(`unknown command ${cmd} (help lists them)`); process.exit(2);
  }
})();

if (asJson || typeof out === 'string') { process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out, null, 2) + '\n'); process.exit(0); }
if (out.entries) { for (const e of out.entries) console.log(line(e)); console.log(`${out.count} of ${out.of ?? out.count} entries`); }
else if (out.entry) console.log(line(out.entry));
else if (out.accounts) for (const a of out.accounts) console.log(`${a.account.padEnd(16)} ${String(a.count).padStart(5)} entries  spent ${usd(a.spentCents).padStart(11)}  income ${usd(a.incomeCents).padStart(11)}  last ${a.last}`);
else if (out.totals) {
  const t = out.totals;
  console.log(`${t.count} entries  spent ${usd(t.spentCents)}  income ${usd(t.incomeCents)}  net ${usd(t.netCents)}`);
  for (const [k, v] of Object.entries(t.by ?? {}).sort((a, b) => b[1].cents - a[1].cents)) console.log(`  ${k.padEnd(24)} ${String(v.count).padStart(5)}  ${usd(v.cents).padStart(11)}`);
} else console.log(JSON.stringify(out, null, 2));
