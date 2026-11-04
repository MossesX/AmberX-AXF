#!/usr/bin/env node
/**
 * Claude settings CLI (claude-settings@1, core.mjs). What every Claude session runs (or calls claude_settings_get for)
 * at its start and before acting.
 *
 *   node apps/console-web/plugins/claude-settings/claude-settings.mjs                 every setting, plain words
 *   … get [key] [--json]                     one setting, or all of them
 *   … set key=value [key=value…] [--by who] [--json]   non-owner settings only (owner-only ones: Brett, in the console)
 *   … registry [--json]                      the open registry (groups + settings)
 *   … tick [--json]                          (console server) what No wait needs now; reads {values, pass} on stdin
 *   … owner-set                              (console server) {patch, owner, by} on stdin; the owner comes from
 *                                            Brett's signed-in request and is ignored inside a Claude session
 *   … system-off <key> <why>                 (console server) a toggle back to off (night, pass ended)
 * Exit codes: 0 ok · 1 failed · 2 usage · 4 denied.
 */
import { readFileSync } from 'node:fs';
import { SettingsError, loadRegistry, noWaitTick, passChange, passFor, setSettings, systemOff, view } from './core.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const stdin = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
const out = (o, text) => process.stdout.write(json ? `${JSON.stringify(o)}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
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
