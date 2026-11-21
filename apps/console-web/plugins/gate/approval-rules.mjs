#!/usr/bin/env node
/**
 * Approval rules (VPS Configuration → Approval rules, approval-rules@1): axHub's match-pattern policy rules, read live,
 * with a draft of edits anyone may stage and only Brett saves.
 *
 *   node approval-rules.mjs status [--json]                         live rules, the draft, what Save would send
 *   node approval-rules.mjs add <service> <match> <allow|veto|confirm|deny|hold> [seconds] [--at <n>]
 *   node approval-rules.mjs edit <service> <n> <match|policy|vetoSeconds> <value>      ('' or - clears a field)
 *   node approval-rules.mjs remove <service> <n> · move <service> <n> <to>
 *   node approval-rules.mjs clear-own <service> [on|off]            let the rules decide: clear the tools' own entries on save
 *   node approval-rules.mjs default                                  stage Brett's default (veto only on VPS shell commands)
 *   node approval-rules.mjs discard [service]                        drop the draft
 *   node approval-rules.mjs stage --op '<json>'                      one edit as JSON (the route and the MCP tool)
 *
 * Reading uses the hub token (a bearer reads the table, never writes it). Nothing here can change the policy: every
 * edit lands in the draft file, and the draft reaches axHub only when Brett presses Save in his own console, from his
 * own hub session (web/ApprovalRulesTab.tsx → PUT /auth/api/policy). Rule numbers are 1-based, as the tab shows them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as files from '../../../../framework/core/data-files.mjs';
import { DRAFT_FRAME, lines, stage, view } from './web/approval-core.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const fail = (message, code = 'invalid') => Object.assign(new Error(message), { code });

/** The hub's address from AXHUB_URL (which may name /mcp). */
export const hubBase = (env = process.env) => String(env.AXHUB_URL || 'https://axhub.amberxai.com').replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
function hubToken(env) {
  if (env.AXHUB_TOKEN) return env.AXHUB_TOKEN.trim();
  try { return readFileSync(join(env.HOME || '', '.config', 'axhub', 'token'), 'utf8').trim(); } catch { return ''; }
}
/**
 * The live policy table (policy-table@1, framework/spec/AXHUB-POLICY-API.md), read with the hub token: a bearer reads,
 * never writes. → { hub, available: true, table } | { hub, available: false, message }, never a stale copy.
 */
export async function readPolicy({ env = process.env, fetch: f = globalThis.fetch } = {}) {
  const hub = hubBase(env);
  const token = hubToken(env);
  if (!token) return { hub, available: false, message: 'No axHub token here, so the rules cannot be read.' };
  try {
    const r = await f(`${hub}/auth/api/policy`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (r.status === 404) return { hub, available: false, message: "axHub doesn't have the policy API yet (axHub decisions 119 and 121)." };
    if (!r.ok) return { hub, available: false, message: `axHub answered ${r.status}.` };
    return { hub, available: true, table: await r.json() };
  } catch (e) { return { hub, available: false, message: `Can't reach axHub: ${String(e?.message ?? e).slice(0, 120)}` }; }
}

/** The plugin's data folder (the same one gate-store.mjs uses). */
export function dataDir(env = process.env) {
  if (env.AXF_GATE_DIR) return env.AXF_GATE_DIR;
  const consoleRoot = env.AXF_CONSOLE_ROOT || (existsSync('/opt/axf/.axf-console') ? '/opt/axf' : ROOT);
  return join(consoleRoot, '.axf-console', 'plugins', 'gate');
}
const draftFile = (env) => join(dataDir(env), 'approval-rules-draft.json');

export function readDraft(env = process.env) {
  // data-store@1: the draft follows the plugin's data folder onto axf-data (framework/core/data-files.mjs)
  try { const d = files.readJsonSync(draftFile(env), null); return d && d.$axf === DRAFT_FRAME && d.services && typeof d.services === 'object' ? d : null; } catch { return null; }
}
function writeDraft(services, by, reason, env) {
  const f = draftFile(env);
  if (!Object.keys(services).length) { files.removeSync(f); return null; }
  const doc = { $axf: DRAFT_FRAME, services, by: String(by || 'someone').slice(0, 60), at: new Date().toISOString(), ...(reason ? { reason: String(reason).slice(0, 300) } : {}) };
  files.writeJsonSync(f, doc, 1);
  return doc;
}

/** approval-rules@1: the live rules with the draft over them. */
export async function status({ env = process.env, read = readPolicy } = {}) {
  return view(await read({ env }), readDraft(env));
}

/** Stage one edit in the draft. → approval-rules@1 with `staged: true`. Never touches axHub's policy. */
export async function stageOp(op, { env = process.env, read = readPolicy, by = '' } = {}) {
  const live = await read({ env });
  if (!live.available || !live.table) throw fail(`axHub's policy can't be read, so nothing was staged: ${live.message || 'no answer'}`, 'unavailable');
  const cur = readDraft(env);
  const services = stage(cur?.services ?? {}, live.table, op);
  const reason = op?.op === 'default' ? view(live, null).default.reason : op?.op === 'discard' && !op.service ? '' : cur?.reason;
  const draft = writeDraft(services, by || op?.by, reason, env);
  const v = view(live, draft);
  return { ...v, staged: true, message: v.save ? 'Staged. Nothing changed on axHub yet: Brett saves it from his own console (Builds → VPS Configuration → Approval rules → Save).' : 'The draft matches what axHub already has: nothing to save.' };
}

const num = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw fail(`${what} is a rule number, starting at 1`); return n - 1; };

/** CLI words → one stage op. */
export function opFromArgs(cmd, a) {
  if (cmd === 'add') {
    const [service, match, decision, seconds] = a;
    if (!service || !match || !decision) throw fail('usage: approvals add <service> <match> <allow|veto|confirm|deny|hold> [seconds]');
    return { op: 'add', service, rule: { match, ...(decision === 'hold' ? {} : { policy: decision }), ...(seconds ? { vetoSeconds: seconds } : {}) } };
  }
  if (cmd === 'edit') {
    const [service, n, field, value = ''] = a;
    if (!service || !n || !['match', 'policy', 'vetoSeconds'].includes(field)) throw fail('usage: approvals edit <service> <n> <match|policy|vetoSeconds> <value>');
    return { op: 'edit', service, index: num(n, 'n'), rule: { [field]: value === '-' ? '' : value } };
  }
  if (cmd === 'remove') { const [service, n] = a; if (!service || !n) throw fail('usage: approvals remove <service> <n>'); return { op: 'remove', service, index: num(n, 'n') }; }
  if (cmd === 'move') { const [service, n, to] = a; if (!service || !n || !to) throw fail('usage: approvals move <service> <n> <to>'); return { op: 'move', service, index: num(n, 'n'), to: num(to, 'to') }; }
  if (cmd === 'clear-own') { const [service, on = 'on'] = a; if (!service) throw fail('usage: approvals clear-own <service> [on|off]'); return { op: 'clear-own', service, on: on !== 'off' }; }
  if (cmd === 'default') return { op: 'default' };
  if (cmd === 'discard') return { op: 'discard', ...(a[0] ? { service: a[0] } : {}) };
  throw fail(USAGE);
}

const USAGE = 'axf gate approvals [status] | add <service> <match> <allow|veto|confirm|deny|hold> [seconds] | edit <service> <n> <match|policy|vetoSeconds> <value> | remove <service> <n> | move <service> <n> <to> | clear-own <service> [on|off] | default | discard [service]';

export async function main(argv, { env = process.env, read = readPolicy, out = console.log, err = console.error } = {}) {
  const asJson = argv.includes('--json');
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const skip = new Set(); for (const f of ['--op', '--by', '--at']) { const i = argv.indexOf(f); if (i >= 0) { skip.add(i); skip.add(i + 1); } }
  const [cmd = 'status', ...rest] = argv.filter((a, i) => a !== '--json' && !skip.has(i));
  const say = (v) => out(asJson ? JSON.stringify(v) : [...lines(v), ...(v.staged ? [v.message] : [])].join('\n'));
  try {
    if (cmd === 'status') { say(await status({ env, read })); return 0; }
    if (cmd === 'save' || cmd === 'apply') throw fail('Only Brett saves approval rules, from his own signed-in console (Builds → VPS Configuration → Approval rules → Save). Sessions, MCP, the CLI and voice read the rules and stage edits.', 'forbidden');
    let op;
    if (cmd === 'stage') { try { op = JSON.parse(flag('--op') || ''); } catch { throw fail('stage needs --op with one edit as JSON, for example {"op":"add","service":"vps","rule":{"match":"run","policy":"veto"}}'); } }
    else { op = opFromArgs(cmd, rest); if (flag('--at') !== undefined && op.op === 'add') op.index = num(flag('--at'), '--at'); }
    say(await stageOp(op, { env, read, by: flag('--by') || env.AXF_ACTOR || env.AXF_SESSION || 'cli' }));
    return 0;
  } catch (e) {
    if (asJson) out(JSON.stringify({ ok: false, code: e.code || 'failed', message: e.message })); else err(e.message);
    return e.code === 'invalid' ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
