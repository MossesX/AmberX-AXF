#!/usr/bin/env node
/**
 * Claude settings CLI (claude-settings@1, core.mjs). What every Claude session runs (or calls claude_settings_get for)
 * at its start and before acting.
 *
 *   node apps/console-web/plugins/claude-settings/claude-settings.mjs                 every setting, plain words
 *   … get [key] [--json]                     one setting, or all of them
 *   … set key=value [key=value…] [--by who] [--json]   non-owner settings only (owner-only ones: Brett, in the console)
 *   … registry [--json]                      the open registry (groups + settings)
 *   … view [get] --device <id> | view set k=v… --device <id> | view devices   the view per device
 *   … policy [get] | policy plan             axHub's live tool policy; what the default would change
 *   … policy set                             always refused: only Brett's own hub session changes it
 *   … tick [--json]                          (console server) what No wait needs now; reads {values, pass} on stdin
 *   … owner-set                              (console server) {patch, owner, by} on stdin; the owner comes from
 *                                            Brett's signed-in request and is ignored inside a Claude session
 *   … system-off <key> <why>                 (console server) a toggle back to off (night, pass ended)
 * Exit codes: 0 ok · 1 failed · 2 usage · 4 denied.
 */
import { readFileSync } from 'node:fs';
import { SettingsError, getView, hubBase, loadRegistry, noWaitTick, passChange, passFor, readPolicy, readViews, setSettings, setView, systemOff, view } from './core.mjs';
import { counts, planDefaults } from './web/policy-core.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const stdin = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
const out = (o, text) => process.stdout.write(json ? `${JSON.stringify(o)}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
const pairs = (list) => Object.fromEntries(list.map((a) => { const i = a.indexOf('='); if (i < 1) { process.stderr.write('usage: key=value …\n'); process.exit(2); } return [a.slice(0, i), a.slice(i + 1)]; }));
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function lines(v) {
  const rows = [`Claude settings (${v.live ? 'live on axHub' : `NOT live: ${v.store}`})`];
  for (const g of v.groups) {
    const ss = v.settings.filter((s) => s.group === g.id);
    if (!ss.length) continue;
    rows.push('', `${g.label}`);
    for (const s of ss) rows.push(`  ${s.key} = ${show(s.value)}${s.owner === true ? '  [owner-only]' : s.owner === 'raise' ? '  [owner raises]' : s.locked ? '  [locked]' : ''}  — ${s.description}`);
  }
  return rows.join('\n');
}

try {
  const cmd = args.shift() || 'get';
  if (cmd === 'get') {
    const v = view();
    const key = args[0];
    if (key) {
      const s = v.settings.find((x) => x.key === key);
      if (!s) throw new SettingsError('not_found', `no Claude setting ${key}`);
      out({ ok: true, setting: s }, `${s.key} = ${show(s.value)}  — ${s.description} (${s.who})`);
    } else out({ ok: true, ...v }, lines(v));
  } else if (cmd === 'registry') {
    const r = loadRegistry();
    out({ ok: true, ...r }, r.settings.map((s) => `${s.key} (${s.kind}, ${s.group}${s.owner ? `, owner${s.owner === 'raise' ? ' raises' : ''}` : ''})`).join('\n'));
  } else if (cmd === 'set') {
    const by = flag('--by') || process.env.AXF_SESSION || process.env.AXF_AGENT || 'cli';
    const patch = {};
    for (const a of args) { const i = a.indexOf('='); if (i < 1) { process.stderr.write(`usage: set key=value …\n`); process.exit(2); } patch[a.slice(0, i)] = a.slice(i + 1); }
    const r = setSettings(patch, { owner: null, by });
    out({ ok: true, changed: r.changed }, r.changed.length ? r.changed.map((c) => `${c.key}: ${show(c.from)} → ${show(c.to)}`).join('\n') : 'nothing changed');
  } else if (cmd === 'owner-set') {
    const { patch, owner, by } = stdin();
    const r = setSettings(patch, { owner: owner ?? null, by: by || 'console' });
    const values = r.view.values;
    out({ ok: true, changed: r.changed, pass: passChange(r.changed, values), passInput: passFor(values), view: r.view });
  } else if (cmd === 'view') {
    const device = flag('--device');
    const by = flag('--by') || process.env.AXF_SESSION || process.env.AXF_AGENT || 'cli';
    const name = flag('--name');
    const sub = args.shift() || 'get';
    if (sub === 'devices') {
      const devices = Object.entries(readViews().devices).map(([id, e]) => ({ device: id, ...e }));
      out({ ok: true, devices }, devices.map((d) => `${d.device}${d.name ? ` (${d.name})` : ''}: ${d.mode}, tabs ${d.position}, ${d.labels}`).join('\n') || 'no device has saved a view');
    } else if (sub === 'get') {
      const v = getView(device);
      out({ ok: true, view: v }, `${device}: ${v.mode}, tabs ${v.position}, ${v.labels}${v.saved ? '' : ' (default)'}`);
    } else if (sub === 'set') {
      const patch = pairs(args);
      const v = setView(device, patch, { by, name });
      out({ ok: true, view: v }, `${device}: ${v.mode}, tabs ${v.position}, ${v.labels}`);
    } else { process.stderr.write('usage: view [get|set k=v…|devices] --device <id>\n'); process.exit(2); }
  } else if (cmd === 'policy') {
    const sub = args.shift() || 'get';
    if (sub === 'set') throw new SettingsError('denied', "axHub tool policy is owner-only: Brett changes it from his own hub session (Settings → Plugins → Claude → Approvals & veto). No session, token or CLI can.");
    if (sub !== 'get' && sub !== 'plan') { process.stderr.write('usage: policy [get|plan]\n'); process.exit(2); }
    const p = await readPolicy();
    const rules = loadRegistry().policyDefaults;
    if (sub === 'get') out({ ok: true, ...p, rules, ...(p.table ? { counts: counts(p.table) } : {}) }, p.available ? p.table.services.map((s) => `${s.namespace}: ${s.tools.map((t) => `${t.name}=${t.policy}`).join(' ')}`).join('\n') : p.message);
    else {
      const plan = p.available ? planDefaults(p.table, rules) : [];
      out({ ok: true, hub: p.hub ?? hubBase(), available: p.available, plan, ...(p.message ? { message: p.message } : {}) }, p.available ? (plan.map((c) => `${c.service}.${c.tool}: ${c.from} → ${c.to} (${c.why})`).join('\n') || 'already at the default') : p.message);
    }
  } else if (cmd === 'tick') {
    const { pass, timeZone } = stdin();
    const v = view();
    out({ ok: true, ...noWaitTick(v.values, pass, new Date(), timeZone || process.env.AXF_TIMEZONE || 'America/New_York') });
  } else if (cmd === 'system-off') {
    const [key, ...why] = args;
    out({ ok: true, ...systemOff(key, why.join(' ') || 'system') });
  } else { process.stderr.write('usage: claude-settings.mjs [get [key] | set k=v… | registry] [--json]\n'); process.exit(2); }
} catch (e) {
  const code = e instanceof SettingsError ? e.code : 'unexpected';
  out({ ok: false, code, message: e?.message ?? String(e) }, `${code}: ${e?.message ?? e}`);
  process.exit(code === 'denied' ? 4 : 1);
}
