#!/usr/bin/env node
/**
 * AmberX listeners CLI (listener@1, core.mjs): every AmberX device's background listeners and their policies, on the hub.
 *
 *   node apps/console-web/plugins/amberx-listeners/listeners.mjs                     every device and listener, plain words
 *   … devices [--json]                       the devices (listener-state@1 documents the phones publish)
 *   … policies [--json]                      every listener's policy as the hub holds it
 *   … registry [--json]                      the listener registry (ids, labels, defaults)
 *   … set <id> field=value [field=value…] [--by who] [--json]
 *                                            set a policy (on, pauseOnCall, pauseForOtherApps, sound, retries, backoffMs, maxBackoffMs, cooldownMs)
 *   … restart <id> [--by who] [--json]       ask every phone to restart a listener
 * Exit codes: 0 ok · 1 failed · 2 usage.
 */
import { ListenersError, devices, policies, registry, requestRestart, setPolicy, stateLabel } from './core.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const by = flag('--by') ?? 'cli';
const out = (o, text) => process.stdout.write(json ? `${JSON.stringify(o)}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');

function devicesText(d) {
  if (!d.devices.length) return `No AmberX device has published its listeners yet (${d.dir}${d.live ? '' : ' · the hub is not mounted here'}).`;
  const lines = [];
  for (const dev of d.devices) {
    lines.push(`${dev.name} (${dev.device})${dev.stale ? ' · STALE' : ''} · ${dev.summary} · last report ${when(dev.at)}`);
    for (const l of dev.listeners) lines.push(`  ${l.label.padEnd(30)} ${l.stateLabel}${l.holdsMic ? ' · has the mic' : ''}${l.lastError ? ` · last error: ${l.lastError}` : ''}`);
  }
  return lines.join('\n');
}
function policiesText(p) {
  const lines = [`Policies (${p.live ? 'live on axHub' : 'NOT live'}: ${p.file})`];
  for (const [id, x] of Object.entries(p.policies)) {
    lines.push(`  ${x.label.padEnd(30)} ${x.fields.map((f) => `${f}=${x[f]}`).join(' ')}${x.restartAskedAt ? ` · restart asked ${x.restartAskedAt}` : ''}`);
  }
  return lines.join('\n');
}

try {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === 'all') { const d = devices(); const p = policies(); out({ ...d, policies: p.policies }, `${devicesText(d)}\n\n${policiesText(p)}`); }
  else if (cmd === 'devices') { const d = devices(); out(d, devicesText(d)); }
  else if (cmd === 'policies') { const p = policies(); out(p, policiesText(p)); }
  else if (cmd === 'registry') { const r = registry(); out({ ok: true, ...r }, r.listeners.map((l) => `${l.id.padEnd(20)} ${l.label} (${l.kind}, ${l.side})`).join('\n')); }
  else if (cmd === 'set') {
    const [id, ...pairs] = rest;
    if (!id || !pairs.length) { console.error('usage: listeners.mjs set <id> field=value [field=value…]'); process.exit(2); }
    const patch = {};
    for (const p of pairs) { const i = p.indexOf('='); if (i < 1) { console.error(`not field=value: ${p}`); process.exit(2); } patch[p.slice(0, i)] = p.slice(i + 1); }
    const r = setPolicy(id, patch, by);
    out(r, `${r.label}: ${Object.entries(r.policy).map(([k, v]) => `${k}=${v}`).join(' ')}${r.live ? '' : ' (NOT live: the hub is not mounted here)'}`);
  } else if (cmd === 'restart') {
    if (!rest[0]) { console.error('usage: listeners.mjs restart <id>'); process.exit(2); }
    const r = requestRestart(rest[0], by);
    out(r, `${r.label}: restart asked at ${r.restartAskedAt} (every phone restarts it on its next settings refresh)`);
  } else { console.error(`unknown command ${cmd}`); process.exit(2); }
} catch (e) {
  const code = e instanceof ListenersError ? e.code : 'failed';
  if (json) console.log(JSON.stringify({ ok: false, code, message: e.message })); else console.error(e.message);
  process.exit(1);
}

export { stateLabel };
