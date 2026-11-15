#!/usr/bin/env node
/**
 * rules-brief — the briefs a headless build gets instead of the CLAUDE.md chain (framework/core/rules-brief.mjs).
 *
 *   node framework/cli/rules-brief.mjs compose --brief <file> [--model m] [--agent a] [--name n] [--job j] [--build id] [--surface s] [--json]
 *        prints the rules brief for that launch. Exit 3 = lean launches are off or nothing applies: load the full chain.
 *   … list [--json]                     every brief with its conditions
 *   … get <id> [--json]                 one brief
 *   … save [--by who]                   one brief as JSON on stdin (same id = replaced)
 *   … delete <id> [--by who]
 *   … settings lean=on|off maxChars=N   the document's own switches
 *   … conditions --json                 the condition list (the editor reads it)
 *   … preview --task-file <f> [--build id] [--model m] [--agent a] --json     what a launch would get
 *
 * Store: /projects/_shared/_data/claude/rules-briefs.json on the hub (AXF_RULES_BRIEFS_FILE elsewhere); the seed
 * framework/schemas/rules-briefs.json applies until a document exists. Exit codes: 0 ok · 1 failed · 2 usage · 3 no brief.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, compose, launchContext, normBrief, normDoc } from '../core/rules-brief.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '..', '..'));
const SEED = join(HERE, '..', 'schemas', 'rules-briefs.json');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function storeFile() {
  if (process.env.AXF_RULES_BRIEFS_FILE) return process.env.AXF_RULES_BRIEFS_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, '_shared', '_data', 'claude', 'rules-briefs.json') : join(ROOT, '.axf-console', 'plugins', 'claude-settings', 'rules-briefs.json');
}
export const load = () => normDoc(readJson(storeFile()), readJson(SEED));
function store(doc, by) {
  const file = storeFile();
  mkdirSync(dirname(file), { recursive: true });
  const out = { ...doc, updatedAt: new Date().toISOString(), updatedBy: String(by || process.env.AXF_SESSION || 'cli').slice(0, 80) };
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 1)}\n`);
  renameSync(tmp, file);
  return out;
}
const readRel = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return null; } };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const say = (o, text) => process.stdout.write(json ? `${JSON.stringify({ ok: true, ...o })}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
  const fail = (code, message, exit = 1) => { process.stdout.write(json ? `${JSON.stringify({ ok: false, code, message })}\n` : ''); process.stderr.write(`rules-brief: ${message}\n`); process.exit(exit); };
  const stdin = () => { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return null; } };
  const context = (task) => launchContext({ task, surface: flag('--surface') || process.env.AXF_SURFACE || 'headless', model: flag('--model') || process.env.AXF_MODEL || '', agent: flag('--agent') || process.env.AXF_AGENT || '', job: flag('--job') || process.env.AXF_AGENT_JOB || '', build: flag('--build') || process.env.AXF_BUILD_ID || flag('--name') || '', profile: process.env.AXF_BUILD_PROFILE || '' });
  const cmd = args.shift() || 'list';
  const doc = load();
  if (cmd === 'compose') {
    if (!doc.lean) fail('off', 'lean launches are switched off', 3);
    const file = flag('--brief');
    if (!file) fail('usage', 'compose --brief <file>', 2);
    let task = ''; try { task = readFileSync(file, 'utf8'); } catch { fail('invalid', `no brief at ${file}`, 2); }
    const r = compose(doc, context(task), readRel);
    if (!r.text) fail('empty', 'no rules brief applies', 3);
    say(r, r.text);
  } else if (cmd === 'preview') {
    const file = flag('--task-file');
    const task = file ? readFileSync(file, 'utf8') : '';
    say({ ...compose(doc, context(task), readRel), lean: doc.lean });
  } else if (cmd === 'list') {
    say({ ...doc, store: storeFile(), conditions: CONDITIONS }, doc.briefs.map((b) => `${b.enabled ? '●' : '○'} ${b.id} (${b.mode}) ${b.name}  when ${JSON.stringify(b.when)}`).join('\n'));
  } else if (cmd === 'conditions') {
    say({ conditions: CONDITIONS });
  } else if (cmd === 'get') {
    const b = doc.briefs.find((x) => x.id === args[0]);
    if (!b) fail('not_found', `no rules brief ${args[0]}`);
    say({ brief: b }, b.text);
  } else if (cmd === 'save') {
    const n = normBrief(stdin());
    if (!n) fail('invalid', 'send a brief as JSON with a name');
    if (n.mode === 'saved' && !n.text.trim()) fail('invalid', 'a saved brief needs text');
    const i = doc.briefs.findIndex((b) => b.id === n.id);
    const briefs = [...doc.briefs];
    if (i >= 0) briefs[i] = n; else briefs.push(n);
    say({ brief: n, ...store({ ...doc, briefs }, flag('--by')) }, `saved ${n.id}`);
  } else if (cmd === 'delete') {
    if (!doc.briefs.some((b) => b.id === args[0])) fail('not_found', `no rules brief ${args[0]}`);
    const briefs = doc.briefs.filter((b) => b.id !== args[0]);
    if (!briefs.length) fail('invalid', 'keep at least one brief: switch lean launches off to go back to the full chain');
    say(store({ ...doc, briefs }, flag('--by')), `deleted ${args[0]}`);
  } else if (cmd === 'settings') {
    const patch = {};
    for (const a of args) {
      const [k, v] = a.split('=');
      if (k === 'lean') patch.lean = ['on', 'true', '1'].includes(v);
      else if (k === 'maxChars' && Number(v) >= 500) patch.maxChars = Number(v);
      else fail('usage', 'settings lean=on|off maxChars=N', 2);
    }
    say(store({ ...doc, ...patch }, flag('--by')), 'saved');
  } else fail('usage', `unknown command ${cmd}`, 2);
}
