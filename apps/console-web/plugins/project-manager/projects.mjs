#!/usr/bin/env node
/**
 * Project Manager CLI (project-manager@1, core.mjs). The console routes run it, so the console, MCP, the CLI and voice
 * share one store.
 *
 *   node apps/console-web/plugins/project-manager/projects.mjs list [--json]
 *   … get <id>
 *   … create <name> [--type app|framework] [--description …] [--root apps/x] [--preview-url …] [--no-scaffold]
 *   … rename <id> <new name>
 *   … update <id> [--name …] [--type …] [--description …] [--preview-url …]
 *   … open <id>                      switch to it (the active project; opens its tab in the multi-project view)
 *   … close <id>                     close its tab (project and data stay)
 *   … delete <id> [--data]           remove it (--data also removes its builds/notes/data folder)
 *   … multi on|off [--layout tabs|split]
 *   … preview on|off [--mode float|dock] [--side right|bottom] [--project <id>]
 *   … settings                       the settings (JSON)
 *   … json <op>                      (console server) the op's input as JSON on stdin
 * Exit codes: 0 ok · 1 failed · 2 usage.
 */
import { readFileSync } from 'node:fs';
import * as core from './core.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const stdin = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } };
const out = (o, text) => process.stdout.write(json ? `${JSON.stringify(o)}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
const onOff = (v) => (v === undefined ? undefined : ['on', 'true', 'yes', '1'].includes(String(v).toLowerCase()));

function lines(v) {
  const s = v.settings;
  const rows = [`Projects (multi-project view ${s.multiView ? `on, ${s.layout}` : 'off'}; preview ${s.preview.open ? `${s.preview.mode}${s.preview.mode === 'dock' ? ` ${s.preview.side}` : ''}` : 'closed'})`];
  for (const p of v.projects) rows.push(`${p.active ? '*' : ' '} ${p.id.padEnd(22)} ${p.typeLabel.padEnd(28)} ${p.name}  ${p.consoleUrl}  builds ${p.counts.builds} · notes ${p.counts.notes} · data ${p.counts.data}`);
  return rows.join('\n');
}

/** One op with a JSON input: the console server and tests use this. */
export function run(op, input = {}) {
  switch (op) {
    case 'list': return core.view();
    case 'get': return core.get(input.id);
    case 'create': return core.create(input);
    case 'rename': return core.rename(input.id, input.name);
    case 'update': return core.update(input.id, input);
    case 'open': return core.open(input.id);
    case 'close': return core.close(input.id);
    case 'delete': return core.remove(input.id, { data: input.data });
    case 'settings': return input && Object.keys(input).length ? core.setSettings(input) : { ok: true, settings: core.load().settings };
    case 'preview': return core.preview(input);
    default: throw new core.ProjectError('invalid', `Unknown op "${op}".`);
  }
}

try {
  const cmd = args.shift() || 'list';
  let r;
  if (cmd === 'json') r = run(args.shift(), stdin());
  else if (cmd === 'list') { r = core.view(); out(r, lines(r)); process.exit(0); }
  else if (cmd === 'get') r = core.get(args[0]);
  else if (cmd === 'create') {
    const type = flag('--type'); const description = flag('--description'); const root = flag('--root'); const previewUrl = flag('--preview-url');
    const scaffold = !has('--no-scaffold');
    r = core.create({ name: args.join(' '), type: type || 'app', description, root, previewUrl, scaffold });
  } else if (cmd === 'rename') r = core.rename(args.shift(), args.join(' '));
  else if (cmd === 'update') {
    const id = args.shift(); const patch = {};
    for (const [f, k] of [['--name', 'name'], ['--type', 'type'], ['--description', 'description'], ['--preview-url', 'previewUrl']]) { const v = flag(f); if (v !== undefined) patch[k] = v; }
    r = core.update(id, patch);
  } else if (cmd === 'open' || cmd === 'switch') r = core.open(args[0]);
  else if (cmd === 'close') r = core.close(args[0]);
  else if (cmd === 'delete') { const data = has('--data'); r = core.remove(args[0], { data }); }
  else if (cmd === 'multi') { const layout = flag('--layout'); r = core.setSettings({ ...(args[0] ? { multiView: onOff(args[0]) } : {}), ...(layout ? { layout } : {}) }); }
  else if (cmd === 'preview') { const mode = flag('--mode'); const side = flag('--side'); const project = flag('--project'); r = core.preview({ open: onOff(args[0]), mode, side, project }); }
  else if (cmd === 'settings') r = { ok: true, settings: core.load().settings };
  else { process.stderr.write('usage: projects.mjs list|get|create|rename|update|open|close|delete|multi|preview|settings\n'); process.exit(2); }
  out(r);
} catch (e) {
  const r = { ok: false, code: e.code || 'failed', message: e.message };
  if (json) out(r); else process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
