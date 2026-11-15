#!/usr/bin/env node
/**
 * Retirement gate: AmberX is retired only once Phone Connect is installed and working on Brett's phone.
 *
 *   node apps/console-web/plugins/phone-connect/retire-check.mjs [--wait 120] [--json]
 *
 * Asks the running console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN) through Phone Connect's
 * own REST routes, the same ones MCP, the CLI and voice use:
 *   1. a phone is paired                         GET  status
 *   2. its heartbeat is online (within 45 s)     GET  status
 *   3. a test notification is acked              POST notify {kind: fyi}  → GET commands/<id> until acked
 *   4. an open_url is acked                      POST open {url}         → GET commands/<id> until acked
 *   5. the recorder status answers               GET  recorder/status (the phone's own report)
 * Exit 0 = every check passed (retire AmberX); 3 = waiting on Brett's phone (each failed check says what to do);
 * 2 = the console can't be asked (no token / unreachable). Nothing here changes anything but the two test commands.
 */
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const JSON_OUT = !!flag('json', false);
const WAIT_S = Number(flag('wait', 120)) || 120;
const BASE = (process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com').replace(/\/+$/, '');
const TOKEN = process.env.AXF_TOKEN || '';
const ROOT = `${BASE}/api/plugins/phone-connect`;
const CHECK_URL = 'https://console.amberxai.com/?phone-connect-check=1';

async function call(method, path, body) {
  const r = await fetch(`${ROOT}/${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-axf-via': 'cli' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual',
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: { message: text.slice(0, 200) } }; }
  return { status: r.status, json };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Waits for one queued command to be acked by the phone. */
async function acked(id) {
  const end = Date.now() + WAIT_S * 1000;
  while (Date.now() < end) {
    const r = await call('GET', `commands/${encodeURIComponent(id)}`);
    const st = r.json?.status;
    if (st === 'acked') return { ok: true, result: r.json.result };
    if (st === 'failed' || st === 'expired') return { ok: false, why: `${st}: ${r.json?.result?.error?.message ?? 'no answer'}` };
    await sleep(3000);
  }
  return { ok: false, why: `not acked within ${WAIT_S} s (still ${'queued or delivered'})` };
}

export async function gate() {
  const checks = [];
  const add = (id, ok, detail, todo = '') => checks.push({ id, ok, detail, ...(ok ? {} : { todo }) });
  if (!TOKEN) return { ok: false, unreachable: true, checks: [{ id: 'console', ok: false, detail: 'AXF_TOKEN is not set', todo: 'Run where the console token is available (the VPS).' }] };
  let st;
  try { st = await call('GET', 'status'); } catch (e) { return { ok: false, unreachable: true, checks: [{ id: 'console', ok: false, detail: `console unreachable: ${e.message}`, todo: 'Check the console is up.' }] }; }
  if (st.status === 404) return { ok: false, unreachable: true, checks: [{ id: 'plugin', ok: false, detail: 'Phone Connect is not installed or is switched off on the console', todo: 'Land pull request 712 and switch Phone Connect on (Settings → Plugins).' }] };
  const dev = st.json?.device;
  add('paired', !!dev, dev ? `${dev.name} (${dev.deviceId})` : 'no phone paired', 'Install the Phone Connect APK, sign in, and pair it from Settings → Plugins → Phone Connect.');
  add('online', !!dev?.online, dev ? dev.presence : 'not paired', 'Open Phone Connect on the phone once and leave Monitor on.');
  if (dev?.online) {
    const n = await call('POST', 'notify', { kind: 'fyi', title: 'Phone Connect check', body: 'The retirement gate is checking this phone.', via: 'cli' });
    const nid = n.json?.command?.id;
    const na = nid ? await acked(nid) : { ok: false, why: n.json?.why || n.json?.error?.message || `answered ${n.status}` };
    add('notify', na.ok, na.ok ? 'test notification acked' : na.why, 'Switch FYI notifications on for the phone, keep Monitor on, and run this again.');
    const o = await call('POST', 'open', { url: CHECK_URL, via: 'cli' });
    const oid = o.json?.command?.id;
    const oa = oid ? await acked(oid) : { ok: false, why: o.json?.error?.message || `answered ${o.status}` };
    add('open_url', oa.ok, oa.ok ? `opened (${oa.result?.data?.opened ?? 'ok'})` : oa.why, 'Allow "Display over other apps" for Phone Connect, then run this again.');
  } else {
    add('notify', false, 'skipped: the phone is not online', 'Get the phone online first.');
    add('open_url', false, 'skipped: the phone is not online', 'Get the phone online first.');
  }
  const rec = await call('GET', 'recorder/status');
  const answers = rec.status === 200 && typeof rec.json?.running === 'boolean' && !!rec.json?.device;
  add('recorder_status', answers, answers ? (rec.json.running ? `recording ${rec.json.session}` : 'recorder off, answering') : `answered ${rec.status}`, 'Pair the phone; the recorder reports with every heartbeat.');
  return { ok: checks.every((c) => c.ok), checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await gate();
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else {
    for (const c of r.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.id.padEnd(16)} ${c.detail}${c.ok ? '' : `\n    → ${c.todo}`}`);
    console.log(r.ok ? 'Phone Connect is working: AmberX can be retired.' : r.unreachable ? 'The console could not be asked.' : 'Waiting on Brett\'s phone: AmberX stays until this passes.');
  }
  process.exit(r.ok ? 0 : r.unreachable ? 2 : 3);
}
