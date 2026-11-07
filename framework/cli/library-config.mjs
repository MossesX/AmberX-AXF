#!/usr/bin/env node
/**
 * library-config — the no-code library import wizard on the command line (library-config@1 / library-instance@1,
 * engine: framework/core/library-config.mjs). The same steps the App Designer, the console API / MCP and voice will run.
 *
 *   node framework/cli/library-config.mjs manifest <library>                 the library's configuration manifest (JSON)
 *   node framework/cli/library-config.mjs steps <library>                    the wizard's steps in words (what to ask)
 *   node framework/cli/library-config.mjs wizard <library> --app <dir> [--answers file.json] [--set <step>.<id>=<value>]…
 *                                                                           [--id <instance id>] [--by <who>] [--dry-run]
 *        scripted run: answers = { capabilities: {...}, connections: {...}, settings: {...}, credentials: {...} }
 *        → writes <app>/library-instances/<id>.json and prints the install config (what `axf install` would write)
 *   node framework/cli/library-config.mjs instances <app dir>                every configured instance in the app
 *   node framework/cli/library-config.mjs show <app dir> <instance id>       one instance + its summary in words
 *   node framework/cli/library-config.mjs reconfigure <app dir> <id> [--answers f] [--set …]…
 *   node framework/cli/library-config.mjs disable|enable|remove <app dir> <id>
 *   node framework/cli/library-config.mjs install-config <app dir> <id>     the libraries.<key> block for the instance
 *
 * Credentials are references only (env:NAME, secret:KEY, hub:PATH); a value is refused. Removed instances stay as a
 * record (status removed) so a later "put it back" has its history.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/library-config.mjs';
import { libraryInfo, listLibraries } from './libraries.mjs';

const INSTANCES_DIR = 'library-instances';

function parseArgs(argv) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const k = a.slice(2);
    if (k === 'dry-run' || k === 'json') { flags[k] = true; continue; }
    const v = argv[i + 1]; i++;
    if (k === 'set') (flags.set ??= []).push(v); else flags[k] = v;
  }
  return { flags, rest };
}

const instancesDir = (app) => join(resolve(app), INSTANCES_DIR);
const instancePath = (app, id) => join(instancesDir(app), `${id}.json`);
export function readInstances(app) {
  const dir = instancesDir(app);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter((i) => i?.$axf === L.LIBRARY_INSTANCE);
}
function writeInstance(app, inst) {
  mkdirSync(instancesDir(app), { recursive: true });
  writeFileSync(instancePath(app, inst.id), `${JSON.stringify(inst, null, 2)}\n`);
  return instancePath(app, inst.id);
}
function readInstance(app, id) {
  const p = instancePath(app, id);
  if (!existsSync(p)) throw new Error(`no instance "${id}" in ${app} (${INSTANCES_DIR}/)`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function manifestOf(idOrModule) { return L.manifestFrom(libraryInfo(idOrModule)); }

/** Turn --set step.id=value flags into the answers object (values parsed as JSON when they look like it). */
export function answersFromSets(sets = []) {
  const out = {};
  for (const s of sets) {
    const m = /^([a-z]+)\.([^=]+)=(.*)$/s.exec(s);
    if (!m) throw new Error(`--set wants <step>.<id>=<value>, got "${s}"`);
    const [, step, id, raw] = m;
    let v = raw;
    if (/^(\{|\[|true$|false$|-?\d)/.test(raw)) { try { v = JSON.parse(raw); } catch { v = raw; } }
    const keys = id.split('.');
    let at = (out[step] ??= {});
    while (keys.length > 1) { const k = keys.shift(); at = (at[k] ??= {}); }
    at[keys[0]] = v;
  }
  return out;
}

/** Run every step with the answers given (scripted). Returns { draft, errors } — errors name the step. */
export function runScripted(m, answers, startDraft) {
  let draft = startDraft ?? L.newDraft(m);
  const errors = [];
  for (const step of L.wizardSteps(m)) {
    if (!answers?.[step.id]) continue;
    const r = L.answerStep(m, draft, step.id, answers[step.id]);
    draft = r.draft; errors.push(...r.errors.map((e) => `${step.id}: ${e}`));
  }
  return { draft, errors };
}

function stepsInWords(m) {
  const lines = [`${m.name} ${m.version} (${m.library}) — wizard mode: ${m.wizard.mode}`, m.wizard.intro, ''];
  for (const s of L.wizardSteps(m)) {
    lines.push(`## ${s.title} [${s.id}]`, s.ask);
    for (const f of s.fields) {
      const extra = f.type === 'bool' ? ` (default ${f.default ? 'on' : 'off'}${Array.isArray(f.requires) && f.requires.length ? `, needs ${f.requires.join(', ')}` : ''})`
        : f.type === 'ref' ? ` → ${L.CONNECTION_REF_PREFIX[f.kind]}<id>${f.required ? ', required' : ''}${f.many ? ', several' : ''}`
          : f.type === 'credential-ref' ? ` → env:NAME | secret:KEY | hub:PATH${f.required ? ', required' : ''}` : ` (${f.type}${f.default !== undefined ? `, default ${JSON.stringify(f.default)}` : ''})`;
      lines.push(`- ${f.label} [${f.id}]${extra}${f.help ? `: ${f.help}` : ''}`);
      for (const p of f.params ?? []) lines.push(`    - ${p.label} [${p.key}] (${p.type}${p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : ''})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const { flags, rest } = parseArgs(argv);
  const [cmd, a, b] = rest;
  const out = (obj, text) => console.log(flags.json ? JSON.stringify(obj, null, 2) : text ?? JSON.stringify(obj, null, 2));
  const now = new Date().toISOString();
  const by = flags.by || process.env.AXF_AGENT || process.env.USER || 'cli';
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n')); return; }
  if (cmd === 'list') { const libs = listLibraries().map((l) => { const m = L.manifestFrom(l); return { library: m.library, module: m.module, name: m.name, capabilities: m.capabilities.length, connections: m.connections.length, settings: m.settings.length, credentials: m.credentials.length, steps: m.wizard.steps }; }); return out(libs, libs.map((l) => `${l.module.padEnd(18)} ${String(l.capabilities).padStart(2)} cap ${String(l.connections).padStart(2)} conn ${String(l.settings).padStart(2)} set ${String(l.credentials).padStart(2)} cred  ${l.name}`).join('\n')); }
  if (cmd === 'manifest') { if (!a) throw new Error('manifest <library>'); const m = manifestOf(a); const e = L.manifestErrors(m); if (e.length) throw new Error(e.join('; ')); return console.log(JSON.stringify(m, null, 2)); }
  if (cmd === 'steps') { if (!a) throw new Error('steps <library>'); const m = manifestOf(a); return out(L.wizardSteps(m), stepsInWords(m)); }
  if (cmd === 'wizard' || cmd === 'reconfigure') {
    const app = cmd === 'wizard' ? flags.app : a;
    if (!app) throw new Error(`${cmd}: --app <dir> is required`);
    const prev = cmd === 'reconfigure' ? readInstance(app, b) : null;
    const m = manifestOf(cmd === 'wizard' ? a : prev.library);
    const answers = { ...(flags.answers ? JSON.parse(readFileSync(flags.answers, 'utf8')) : {}) };
    for (const [step, v] of Object.entries(answersFromSets(flags.set))) answers[step] = { ...(answers[step] ?? {}), ...v };
    const { draft, errors } = runScripted(m, answers, prev ? L.draftFromInstance(m, prev) : null);
    const blocking = [...errors, ...L.draftErrors(m, draft)];
    if (blocking.length) { console.error(`Not applied:\n- ${blocking.join('\n- ')}`); process.exitCode = 2; return; }
    const appName = resolve(app).split('/').pop();
    const inst = prev ? L.reconfigure(m, prev, draft, { now, by, surface: 'cli' }) : L.instanceFrom(m, draft, { now, app: appName, id: flags.id, by, surface: 'cli' });
    const summary = L.instanceSummary(m, inst);
    if (flags['dry-run']) return out({ instance: inst, summary, installConfig: L.installConfig(m, inst) }, `${summary.join('\n')}\n\n(dry run: nothing written)`);
    const p = writeInstance(app, inst);
    return out({ file: p, instance: inst, summary, installConfig: L.installConfig(m, inst) }, `${summary.join('\n')}\n\nSaved ${p}\nInstall config (${m.manifestKey}): ${JSON.stringify(L.installConfig(m, inst))}`);
  }
  if (cmd === 'instances') { if (!a) throw new Error('instances <app dir>'); const list = readInstances(a); return out(list, list.map((i) => `${i.id.padEnd(28)} ${i.status.padEnd(10)} ${i.library} ${i.version}  ${i.capabilities.join(', ')}`).join('\n') || 'No configured libraries.'); }
  if (cmd === 'show') { const inst = readInstance(a, b); const m = manifestOf(inst.library); return out({ instance: inst, summary: L.instanceSummary(m, inst), errors: L.instanceErrors(m, inst) }, `${L.instanceSummary(m, inst).join('\n')}\n\n${JSON.stringify(inst, null, 2)}`); }
  if (cmd === 'install-config') { const inst = readInstance(a, b); const m = manifestOf(inst.library); return console.log(JSON.stringify({ [m.manifestKey]: L.installConfig(m, inst) }, null, 2)); }
  if (cmd === 'disable' || cmd === 'enable' || cmd === 'remove') {
    const inst = readInstance(a, b);
    const next = L.setStatus(inst, cmd === 'disable' ? 'disabled' : cmd === 'enable' ? 'configured' : 'removed', { now, by });
    const p = writeInstance(a, next);
    return out({ file: p, instance: next }, `${next.id} → ${next.status} (${p})`);
  }
  throw new Error(`unknown command "${cmd}" (run with no arguments for help)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`library-config: ${e.message}`); process.exit(1); });
}
