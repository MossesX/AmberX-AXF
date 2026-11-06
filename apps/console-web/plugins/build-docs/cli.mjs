#!/usr/bin/env node
/**
 * Build docs — CLI and the console server's one way in (it runs `node cli.mjs '<json>'` and reads the last line).
 *
 *   node cli.mjs index                                   builds the right-click menus offer (id, status, steps)
 *   node cli.mjs options                                 dialog choices: lengths, audiences, voices, design packages, layouts
 *   node cli.mjs list                                    jobs, newest first
 *   node cli.mjs get <job>                               a job with its script and docs
 *   node cli.mjs source <build>[/<step>]                 what a build is made of (gather.mjs) + the video's focus picks
 *   node cli.mjs docs <build>[/<step>]… [--audience me|developer|end-user] [--depth brief|standard|deep] [--notes "…"] [--write]
 *                                                        template docs (no AI) to stdout, or into <folder>/docs/ with --write
 *   node cli.mjs script <build>[/<step>]… [--length 60] [--focus "…"] [--viewport desktop|phone]   fallback click-path script
 *   node cli.mjs cancel <job>
 *   node cli.mjs '{"op": "…", …}'                        the JSON form (what the server sends); prints one JSON line
 *
 * JSON ops: index, options, list, get, source, create, prepare, write-docs, plan-script, edit-script, approve, cancel,
 * update, rerun, remove, record-command.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.mjs';
import * as jobs from './jobs.mjs';
import { gather, index, ROOT } from './gather.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = HERE.split(/[\\/]/).pop();
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

/** Design packages and layouts the video dialog offers (framework/assets). */
export function looks() {
  const read = (type) => {
    const d = join(ROOT, 'framework/assets', type);
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(join(d, f))).filter((a) => a?.id).map((a) => ({ id: a.id, label: a.name ?? a.id, data: a.data ?? {} }));
  };
  return { themes: read('design-package'), layouts: read('layout').map(({ id, label }) => ({ id, label })) };
}

/** The look the recorder forces for a video (record.mjs LOOK_B64): the design package's slots, the layout on top. */
export function lookFor(options) {
  const o = core.normVideoOptions(options);
  if (!o.theme && !o.layout) return null;
  const { themes } = looks();
  const pkg = themes.find((t) => t.id === o.theme);
  const slots = {};
  if (pkg) { for (const [k, v] of Object.entries(pkg.data)) if (typeof v === 'string') slots[k] = v; Object.assign(slots, pkg.data.extras?.slots ?? {}); }
  if (o.layout) slots.layout = o.layout;
  return Object.keys(slots).length ? { id: pkg?.id ?? `layout-${o.layout}`, slots } : null;
}

export function options() {
  const { themes, layouts } = looks();
  return {
    ok: true, docs: core.DOC_DEFAULTS, video: core.VIDEO_DEFAULTS,
    audiences: core.AUDIENCES, depths: core.DEPTHS, lengths: core.LENGTHS, lengthRange: core.LENGTH_RANGE,
    viewports: Object.keys(core.VIEWPORTS), voices: core.VOICES, speedRange: core.SPEED_RANGE,
    themes: themes.map(({ id, label }) => ({ id, label })), layouts, dataDir: jobs.dataDir(),
  };
}

function validTargets(targets) {
  const all = index();
  const ts = (targets ?? []).map(core.parseTarget).filter(Boolean);
  if (!ts.length) throw new Error('pick at least one build or step');
  for (const t of ts) {
    const b = all.find((x) => x.id === t.build);
    if (!b) throw new Error(`no build "${t.build}"`);
    if (!core.documentable(b, t.step)) throw new Error(t.step ? `step ${t.step} of ${t.build} isn't done yet` : `${t.build} has nothing built yet`);
  }
  return ts;
}

/** Gather every target of a job (saved as source-<n>.json); returns the sources and, per kind, the AI prompts. */
async function prepare(id) {
  const j = jobs.update(id, { state: 'gathering', progress: 5, message: 'Reading the build', say: 'Reading the build record, report and diff' });
  const sources = [];
  for (const [n, t] of j.targets.entries()) { const s = await gather(t); jobs.writeSource(id, n, s); sources.push(s); }
  const per = Math.max(core.LENGTH_RANGE.min, Math.round((j.options.length ?? 60) / sources.length));
  const prompts = sources.map((s) => (j.kind === 'docs' ? core.aiDocPrompt(s, j.options) : core.aiScriptPrompt(s, { ...j.options, length: per })));
  const warn = [...new Set(sources.flatMap((s) => s.warnings))];
  jobs.update(id, { state: j.kind === 'docs' ? 'writing' : 'planning', progress: 20, message: warn.length ? `Note: ${warn.join('; ')}` : '', say: `Read ${sources.length} build${sources.length === 1 ? '' : 's'}` });
  return { ok: true, sources: sources.map((s) => ({ build: s.build.id, step: s.step?.id ?? '', warnings: s.warnings, docPath: core.docPath(s) })), prompts };
}

/** Docs from the AI answers (one per target, '' = none) or the template; written into the job folder. */
function writeDocs(id, answers = []) {
  const j = jobs.getJob(id);
  const sources = jobs.readSources(id);
  let usedAi = false;
  const files = sources.map((s, n) => {
    const ai = j.options.ai ? core.cleanAiDoc(answers[n] ?? '') : '';
    if (ai) usedAi = true;
    const text = ai || core.templateDoc(s, j.options);
    const key = `${s.build.id}${s.step ? `-${s.step.id}` : ''}`;
    jobs.writeDoc(id, key, text);
    return { path: core.docPath(s), build: s.build.id, key, text };
  });
  jobs.update(id, { state: 'publishing', progress: 70, mode: usedAi ? 'ai' : 'template', outputs: { docs: files.map((f) => ({ path: f.path, build: f.build, url: '' })) }, message: 'Opening the pull request', say: `Wrote ${files.length} doc${files.length === 1 ? '' : 's'} (${usedAi ? 'AI' : 'template'})` });
  return { ok: true, files };
}

/** The video's script from the AI answers or the fallback planner; the job then waits for Brett's approval. */
function planVideo(id, answers = []) {
  const j = jobs.getJob(id);
  const sources = jobs.readSources(id);
  const per = Math.max(core.LENGTH_RANGE.min, Math.round(j.options.length / sources.length));
  let usedAi = false;
  const parts = sources.map((s, n) => {
    const o = { ...j.options, length: per };
    const ai = j.options.ai && answers[n] ? core.parseAiScript(answers[n], s, o) : null;
    if (ai) usedAi = true;
    return ai ?? core.planScript(s, o);
  });
  const script = core.mergeScripts(parts, j.options, j.title);
  const errors = core.scriptErrors(script);
  if (errors.length) { jobs.update(id, { state: 'failed', message: errors.slice(0, 3).join('; '), say: 'The script could not be made' }); return { ok: false, error: errors.join('; ') }; }
  jobs.writeScript(id, script);
  writeFileSync(join(jobs.jobDir(id), 'transcript.md'), core.transcript(script));
  jobs.update(id, { state: 'script-ready', progress: 30, mode: usedAi ? 'ai' : 'template', outputs: { script: 'script.json' }, message: `Script ready: ${script.chapters.length} parts, about ${core.fmtLength(core.scriptSeconds(script))}. Approve it to record.`, say: `Script planned (${usedAi ? 'AI' : 'from the build’s screens'})` });
  return { ok: true, script, seconds: core.scriptSeconds(script), words: core.scriptWords(script) };
}

/** The VPS command that records an approved video (a veto call through axHub runs it on the host). */
export function recordCommand(id, checkout = process.env.AXF_VPS_CHECKOUT || '/opt/axf') {
  jobs.jobDir(id); // validates the id: nothing but [a-z0-9-] reaches the shell
  const log = join(jobs.dataDir(), 'jobs', id, 'run.log');
  return `cd ${checkout} && nohup node framework/cli/agent-slots.mjs heavy -- node apps/console-web/plugins/${FOLDER}/runner.mjs ${id} > ${log} 2>&1 &`;
}

export async function run(req) {
  const r = req && typeof req === 'object' ? req : {};
  const by = typeof r.by === 'string' ? r.by.slice(0, 80) : '';
  switch (r.op) {
    case 'index': return { ok: true, builds: index() };
    case 'options': return options();
    case 'list': return { ok: true, jobs: jobs.listJobs(Number(r.limit) || 200) };
    case 'get': {
      const job = jobs.getJob(r.id); if (!job) throw new Error(`no job ${r.id}`);
      const docs = job.kind === 'docs' ? jobs.readSources(r.id).map((s) => { const key = `${s.build.id}${s.step ? `-${s.step.id}` : ''}`; return { key, path: core.docPath(s), text: jobs.readDoc(r.id, key) }; }) : [];
      return { ok: true, job, script: jobs.readScript(r.id), docs, record: job.kind === 'video' ? recordCommand(r.id) : '' };
    }
    case 'source': {
      const t = core.parseTarget(r.target); if (!t) throw new Error('bad target');
      const s = await gather(t);
      return { ok: true, source: s, features: core.featureChoices(s), docPath: core.docPath(s) };
    }
    case 'create': {
      const targets = validTargets(r.targets);
      const all = index();
      const title = (typeof r.title === 'string' && r.title.trim()) || targets.map((t) => { const b = all.find((x) => x.id === t.build); return `${core.shortName(b)}${t.step ? ` · ${t.step}` : ''}`; }).join(', ');
      return { ok: true, job: jobs.createJob({ kind: r.kind, targets, options: r.options, by, title: title.slice(0, 200) }) };
    }
    case 'prepare': return prepare(r.id);
    case 'write-docs': return writeDocs(r.id, Array.isArray(r.answers) ? r.answers.map(String) : []);
    case 'plan-script': return planVideo(r.id, Array.isArray(r.answers) ? r.answers.map(String) : []);
    case 'edit-script': {
      const j = jobs.getJob(r.id); if (!j) throw new Error(`no job ${r.id}`);
      if (j.state !== 'script-ready') throw new Error(`the script can only change while it waits for approval (job is ${j.state})`);
      const next = r.script ? core.fitScript(core.normScript(r.script, j.options, jobs.readScript(r.id) ?? {}), { ...j.options, length: core.LENGTH_RANGE.max }) : core.editScript(jobs.readScript(r.id), r.edits);
      const errors = core.scriptErrors(next); if (errors.length) throw new Error(errors.slice(0, 3).join('; '));
      jobs.writeScript(r.id, next);
      writeFileSync(join(jobs.jobDir(r.id), 'transcript.md'), core.transcript(next));
      jobs.update(r.id, { message: `Script edited: about ${core.fmtLength(core.scriptSeconds(next))}. Approve it to record.`, say: `Script edited${by ? ` by ${by}` : ''}` });
      return { ok: true, script: next, seconds: core.scriptSeconds(next) };
    }
    case 'approve': {
      const j = jobs.getJob(r.id); if (!j) throw new Error(`no job ${r.id}`);
      if (j.kind !== 'video') throw new Error('only videos wait for approval');
      if (j.state !== 'script-ready') throw new Error(`job is ${j.state}, not waiting for approval`);
      const errors = core.scriptErrors(jobs.readScript(r.id)); if (errors.length) throw new Error(errors.slice(0, 3).join('; '));
      const job = jobs.update(r.id, { state: 'queued', progress: 32, message: 'Approved: waiting for the VPS (one veto call, then a heavy slot)', say: `Script approved${by ? ` by ${by}` : ''}` });
      return { ok: true, job, command: recordCommand(r.id) };
    }
    case 'cancel': return { ok: true, job: jobs.cancel(r.id, by) };
    case 'update': return { ok: true, job: jobs.update(r.id, r.patch ?? {}) };
    case 'rerun': {
      const j = jobs.getJob(r.id); if (!j) throw new Error(`no job ${r.id}`);
      const n = core.rerun(j, r.tweaks ?? {}, by);
      validTargets(n.targets.map(core.targetKey));
      jobs.saveJob(n);
      return { ok: true, job: n };
    }
    case 'remove': {
      const j = jobs.getJob(r.id); if (!j) throw new Error(`no job ${r.id}`);
      if (core.ACTIVE.includes(j.state) && j.state !== 'queued') throw new Error('cancel it first');
      return jobs.removeJob(r.id);
    }
    case 'record-command': return { ok: true, command: recordCommand(r.id) };
    default: throw new Error(`unknown op ${r.op}`);
  }
}

function flags(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; f[k] = v; } else f._.push(a);
  }
  return f;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd?.startsWith('{')) { console.log(JSON.stringify(await run(JSON.parse(cmd)))); return; }
  const f = flags(rest);
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, '')); return; }
  if (cmd === 'index') { const b = index().filter((x) => core.documentable(x)); console.log(f.json ? JSON.stringify(b) : b.map((x) => `${x.id.padEnd(36)} ${x.status.padEnd(9)} ${x.steps.filter((s) => s.done).length}/${x.steps.length} steps`).join('\n')); return; }
  if (cmd === 'options') { console.log(JSON.stringify(options(), null, 1)); return; }
  if (cmd === 'list') { const l = jobs.listJobs(); console.log(f.json ? JSON.stringify(l) : l.map((j) => `${j.id}  ${j.kind.padEnd(5)} ${core.STATE_LABEL[j.state].padEnd(28)} ${j.title}`).join('\n') || 'No jobs yet.'); return; }
  if (cmd === 'get' || cmd === 'cancel') { console.log(JSON.stringify(await run({ op: cmd, id: f._[0], by: 'cli' }), null, 1)); return; }
  if (cmd === 'source') { const r = await run({ op: 'source', target: f._[0] }); console.log(JSON.stringify(f.json ? r : { ...r.source, report: r.source.report?.path, readme: r.source.readme?.path, help: r.source.help.length, diff: { ref: r.source.diff.ref, files: r.source.diff.files.length } }, null, 1)); return; }
  if (cmd === 'docs') {
    for (const t of f._.map(core.parseTarget).filter(Boolean)) {
      const s = await gather(t);
      const text = core.templateDoc(s, { audience: f.audience, depth: f.depth, notes: typeof f.notes === 'string' ? f.notes : '' });
      if (f.write) { const p = join(ROOT, core.docPath(s)); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); console.log(`wrote ${core.docPath(s)}`); } else console.log(text);
    }
    return;
  }
  if (cmd === 'script') {
    const o = { length: Number(f.length) || 60, focus: typeof f.focus === 'string' ? f.focus : '', viewport: f.viewport };
    const parts = []; for (const t of f._.map(core.parseTarget).filter(Boolean)) parts.push(core.planScript(await gather(t), { ...o, length: Math.round(o.length / Math.max(1, f._.length)) }));
    const s = core.mergeScripts(parts, o);
    console.log(f.json ? JSON.stringify(s) : `${core.transcript(s)}\n(~${core.fmtLength(core.scriptSeconds(s))}, ${core.scriptWords(s)} words)`);
    return;
  }
  throw new Error(`unknown command ${cmd} (try: help)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv[2]?.startsWith('{')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
