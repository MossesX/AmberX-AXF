#!/usr/bin/env node
/**
 * checkin — the session check-in hook and its archive (session-log@1). Installed by install.mjs.
 *
 *   checkin.mjs detect [--config f] [--json]     SessionStart hook: detect, then tell Claude which questions to ask
 *   checkin.mjs log [--config f]                 stdin: the filled-in record → archive (prints where it went)
 *   checkin.mjs end [--config f]                 SessionEnd hook: stamp the end time + commits on the session's record
 *   checkin.mjs open <n|name> [--config f]       print one memory file, read-only
 *   checkin.mjs list [--json] [--limit n] [--location x] [--model x] [--mismatch]
 *   checkin.mjs get <id> [--json]
 *   checkin.mjs baseline [--json]                baseline build cost per model × effort (+ how to calibrate)
 *   checkin.mjs calibrate --model m --effort e --input N --output N [--cache-read N] [--wall S] [--tool-calls N] [--fail]
 *
 * Nothing secret is ever written: records keep known fields only, secret-looking keys and values are dropped.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'detect';
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(`--${k}`);
const { config, path: configPath } = L.loadConfig(opt('config'));

/** Read all of stdin (a hook's JSON input, or a record piped to `log`); empty when run from a terminal. */
async function readStdin(timeoutMs = 10000) {
  if (process.stdin.isTTY) return '';
  return new Promise((done) => {
    let buf = '';
    const t = setTimeout(() => done(buf), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => { clearTimeout(t); done(buf); });
    process.stdin.on('error', () => { clearTimeout(t); done(buf); });
  });
}
const parse = (t) => { try { return t.trim() ? JSON.parse(t) : {}; } catch { return {}; } };

async function detect() {
  const input = parse(await readStdin(3000));
  const source = input.source ?? 'startup';
  if (!config.sources.includes(source) && !has('force')) return;
  // No questions at login (Oct 26 2026, Brett): the hook stays silent unless its config says ask: true.
  if (!config.ask && !has('force')) return;
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const location = L.detectLocation();
  const repo = config.questions.repo ? L.detectRepo(cwd, config.expected.repo, !has('no-fetch')) : { present: false };
  const root = repo.present ? repo.root : cwd;
  const container = L.detectContainer(location, config.expected.vpsContainer);
  const project = L.detectProject(root, config.expected.project);
  const memory = config.questions.memory ? L.listMemory(root, config) : null;
  const running = L.runningModel(input);
  const effortNow = input.effort?.level || process.env.CLAUDE_EFFORT || '';
  const pending = L.pendingItems(root);
  const next = await L.nextBuildStep(root);
  const recommended = next?.model ?? 'opus';
  const data = L.baselineData();
  const estimates = Object.fromEntries(Object.keys(L.MODELS).map((m) => [m, Object.fromEntries(L.EFFORTS.map((e) => [e, L.estimate(m, e, data)]))]));
  const records = await L.readRecords(config, { limit: 200 });
  const last = records.find((r) => (r.location?.answer ?? r.location?.detected) === location.id && !r.unattended && !r.skipped) ?? null;
  const unattended = process.env.CLAUDE_CODE_SESSION_ATTENDED === '0' || /^sdk/.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? '') || process.env.AXF_CHECKIN_UNATTENDED === '1';

  const skeleton = {
    id: L.newId(location.id), claudeSessionId: input.session_id ?? null, startedAt: new Date().toISOString(), client: 'claude-code', source,
    unattended: false, skipped: false, sameAsLast: false, checkinVersion: L.VERSION,
    location: { detected: location.id, answer: null, host: location.host },
    repo: repo.present ? { detected: repo.slug, answer: null, slug: repo.slug, branch: repo.branch, head: repo.head, dirty: repo.dirty, ahead: repo.ahead, behind: repo.behind, ok: repo.ok } : { detected: 'none', answer: null },
    container: { detected: container.id, answer: null, ok: container.ok },
    project: { detected: project.detected, expected: project.expected, answer: null },
    memory: memory ? { source: memory.source, files: memory.files.length, opened: [] } : null,
    model: { recommended, why: next ? `next build step ${next.id}: ${next.reason}` : 'default (Opus)', running: running.id, picked: null, switchNeeded: null },
    effort: { current: effortNow || null, picked: null, applied: null },
    estimate: null,
    pending: pending.filter((p) => p.model === recommended).map((p) => p.id),
  };
  if (has('json')) { console.log(JSON.stringify({ skeleton, location, repo, container, project, memory, running, pending, next, estimates, last, unattended, config })); return; }

  if (unattended) {
    if (config.unattended === 'off') return;
    const rec = { ...skeleton, unattended: true, location: { ...skeleton.location, answer: location.id }, repo: { ...skeleton.repo, answer: skeleton.repo.detected }, container: { ...skeleton.container, answer: container.id }, project: { ...skeleton.project, answer: project.detected }, model: { ...skeleton.model, picked: last?.model?.picked ?? running.key ?? null }, effort: { ...skeleton.effort, picked: effortNow || last?.effort?.picked || null } };
    try { const w = await L.writeRecord(rec, config); console.log(`[session check-in] unattended run logged (${w.inRepo ? 'repo sessions/ — commit it' : w.root}). No questions asked.`); } catch (e) { console.log(`[session check-in] could not log this unattended run: ${e.message}`); }
    return;
  }

  const q = config.questions;
  const yes = (b) => (b ? '✓' : '✗ MISMATCH');
  const lines = [];
  const push = (s = '') => lines.push(s);
  push('SESSION CHECK-IN (session-checkin plugin) — do this before anything else in this session, even if the first message asks for something.');
  push('');
  push('Detected:');
  push(`  location: ${location.label}${location.host ? ` · host ${location.host}` : ''}`);
  if (q.repo) push(repo.present ? `  repo: ${repo.slug || '(no origin)'} · ${repo.branch} · ${repo.head} · ${repo.dirty ? `${repo.dirty} uncommitted change(s)` : 'clean'} · ${repo.behind == null ? 'no upstream' : `${repo.behind} behind / ${repo.ahead} ahead${repo.fetched ? '' : ' (not fetched)'}`} · expected ${config.expected.repo} ${yes(repo.ok)}` : '  repo: not in a git repo');
  if (q.container) push(`  container: ${container.label} ${location.id === 'vps' ? `· expected ${config.expected.vpsContainer} ${yes(container.ok)}` : ''}`);
  if (q.project) push(`  project: ${project.detected} · expected ${project.expected}${project.claudeProject ? ` · ${project.claudeProject}` : ''}`);
  if (memory) {
    push(`  memory: ${memory.source} · ${memory.files.length} file(s):`);
    for (const f of memory.files.slice(0, 30)) push(`    ${String(f.n).padStart(2)}. ${f.path} (${Math.max(1, Math.round(f.size / 1024))} KB, ${f.updated})`);
    if (memory.files.length > 30) push(`    … ${memory.files.length - 30} more (checkin.mjs open <n> works for all)`);
  }
  if (q.model) {
    push(`  model: running ${running.id}${running.key ? ` (${L.MODELS[running.key]?.label ?? running.key})` : ''} · recommended ${L.MODELS[recommended].label}${next ? ` for the next build step "${next.title}"` : ''}`);
    if (pending.length) push(`  pending builds: ${pending.length} parked (${pending.map((p) => `${p.id} → ${p.model}`).join(', ')})`);
  }
  if (q.effort) push(`  effort: current ${effortNow || 'client default'} · baseline ${config.baseline} (pricing ${data.pricing.asOf ?? 'not set'})`);
  if (last) push(`  last check-in here: ${last.startedAt?.slice(0, 16).replace('T', ' ')} · ${last.model?.picked ?? '?'} · ${last.effort?.picked ?? '?'}`);
  push('');
  push('Ask the user these questions with the multiple-choice question tool (plain text if that tool is unavailable), the detected value first and marked "(detected)". Leave out questions that don\'t apply. Two rounds, at most four per round:');
  const r1 = [], r2 = [];
  r1.push('Location — Where is this session running? Options: VPS terminal / Cloud container / Desktop-laptop (detected first).');
  if (q.repo && repo.present) r1.push(`Repo — Is ${repo.slug} (${repo.branch} @ ${repo.head}) the right repo?${repo.behind > 0 ? ` It is ${repo.behind} commit(s) behind origin: offer to pull.` : ''}${repo.ok ? '' : ` It is NOT the expected ${config.expected.repo}: say so and offer to switch.`}`);
  if (q.container && location.id !== 'desktop') r1.push(`Container — ${container.label}: right place?${container.ok ? '' : ' MISMATCH with the expected one: say so.'}`);
  if (q.project) r1.push(`Project — Confirm "${project.detected}"${project.detected !== project.expected ? ` (expected "${project.expected}")` : ''} or name another.`);
  if (memory) r2.push(`Memory — Show the numbered file list above; the user can pick files to open read-only. Open one with: node "${L.CHECKIN}" open <n>. Never edit, save or delete memory from this step.`);
  if (q.model) r2.push(`Model — Recommend ${L.MODELS[recommended].label} (${skeleton.model.why}); options Fable 5.1 / Opus 5.5 / Sonnet 5.5 (top three only), recommended first. Say which model is running. If the pick differs, tell the user to run /model <fable|opus|sonnet> (you can't switch models yourself).`);
  if (q.effort && !data.pricing.asOf) r2.push('Effort — options low / medium / high / xhigh / max (no baseline prices set yet, so no cost estimate; say so in one line). Default ' + config.defaultEffort + '. If the client can\'t set effort from here, record applied "client default".');
  else if (q.effort) {
    const m = running.key && L.MODELS[running.key] ? running.key : recommended;
    const $ = (e) => (e.usd == null ? '—' : `$${e.usd.toFixed(e.usd < 1 ? 3 : 2)}`);
    const uncal = Object.values(estimates).some((byE) => Object.values(byE).some((e) => !e.calibrated));
    r2.push(`Effort — options ${L.EFFORTS.map((e) => `${e} ${$(estimates[m][e])}`).join(' · ')} on ${L.MODELS[m].label} (other models: ${Object.keys(L.MODELS).filter((x) => x !== m).map((x) => `${L.MODELS[x].label} ${L.EFFORTS.map((e) => $(estimates[x][e])).join('/')}`).join('; ')}). Default ${config.defaultEffort}. Say these are the fixed baseline build's cost, not today's task${uncal ? ', estimated from placeholder token counts until a real run is measured' : ''}; prices as of ${data.pricing.asOf}${estimates[m].high?.stale ? ' (may be stale)' : ''}. If the client can't set effort from here, the user can use /effort <level>; record what was applied.`);
  }
  push('  Round 1:'); r1.forEach((t, i) => push(`    ${i + 1}. ${t}`));
  if (r2.length) { push('  Round 2:'); r2.forEach((t, i) => push(`    ${r1.length + i + 1}. ${t}`)); }
  push('');
  push('Rules:');
  push('  - A repo or container MISMATCH, or being behind origin, is flagged before any other work.');
  if (config.allowSkip) push('  - "skip": ask nothing; log the record with skipped: true and the detected values.');
  if (config.allowSameAsLast && last) push('  - "same as last": reuse the last check-in\'s answers for this location (shown above in one line); still flag mismatches.');
  push('  - Then write the record: fill every "answer"/"picked"/"applied" field (and memory.opened, model.switchNeeded, estimate = {baseline, model, effort, usd, calibrated, pricesAsOf}), and pipe it as JSON to:');
  push(`      node "${L.CHECKIN}" log${configPath ? ` --config "${configPath}"` : ''}`);
  push('    If it says the record went to the repo\'s sessions/ folder, include that file in your next commit.');
  push('  - Never put tokens, keys or message text in the record.');
  push('');
  push(`Record to fill in (session-log@1): ${JSON.stringify(skeleton)}`);
  // Claude Code caps hook output at 10,000 characters: drop file-list lines first if a project has very many
  let text = lines.join('\n');
  while (text.length > 9500 && lines.some((l) => /^ {4}\s*\d+\. /.test(l))) { lines.splice(lines.findLastIndex((l) => /^ {4}\s*\d+\. /.test(l)), 1); text = lines.join('\n'); }
  console.log(text.slice(0, 9900));
}

async function log() {
  const r = parse(await readStdin());
  if (!r || typeof r !== 'object' || !Object.keys(r).length) { console.error('expected the session record as JSON on stdin'); process.exit(2); }
  const w = await L.writeRecord(r, config);
  console.log(`session check-in logged: ${w.record.id} → ${w.file}${w.inRepo ? '\n(this went to the repo\'s sessions/ folder: commit it so it reaches the archive)' : ''}`);
}

async function end() {
  const input = parse(await readStdin(3000));
  const sid = input.session_id;
  if (!sid) return;
  const recs = await L.readRecords(config, { limit: 300 });
  const r = recs.find((x) => x.claudeSessionId === sid);
  if (!r) return;
  const root = r.repo?.slug && process.env.CLAUDE_PROJECT_DIR ? process.env.CLAUDE_PROJECT_DIR : null;
  let commits = [];
  if (root && r.startedAt) {
    const out = spawnSync('git', ['-C', root, 'log', `--since=${r.startedAt}`, '--format=%h'], { encoding: 'utf8', timeout: 4000 });
    commits = out.status === 0 ? out.stdout.split('\n').filter(Boolean).slice(0, 50) : [];
  }
  const { _file, ...rest } = r;
  rest.end = { at: new Date().toISOString(), reason: L.cleanRecord({ notes: input.reason ?? '' }).notes ?? null, commits };
  try { L.writeJsonAtomic(_file, L.cleanRecord(rest)); } catch { /* best effort */ }
}

function open() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ref = argv[1];
  const f = ref && L.memoryFile(root, config, ref);
  if (!f) { console.error(`No memory file "${ref ?? ''}". Files:\n${L.listMemory(root, config).files.map((x) => `  ${x.n}. ${x.path}`).join('\n')}`); process.exit(1); }
  if (!existsSync(f.abs) || statSync(f.abs).size > 400_000) { console.error('file missing or too large to print'); process.exit(1); }
  console.log(`── ${f.path} (read-only) ──\n${readFileSync(f.abs, 'utf8')}`);
}

async function list() {
  let rows = (await L.readRecords(config, { limit: Number(opt('limit') ?? 500) })).map(L.summary);
  if (opt('location')) rows = rows.filter((r) => r.location === opt('location'));
  if (opt('model')) rows = rows.filter((r) => r.model === opt('model'));
  if (has('mismatch')) rows = rows.filter((r) => r.status === 'mismatch' || r.status === 'flag');
  if (has('json')) { console.log(JSON.stringify({ sessions: rows, roots: await L.archiveRoots(config) })); return; }
  if (!rows.length) { console.log('No sessions archived yet.'); return; }
  for (const r of rows) console.log(`${r.startedAt?.slice(0, 16).replace('T', ' ')}  ${r.location.padEnd(8)} ${String(r.model).padEnd(7)} ${String(r.effort).padEnd(7)} ${r.status.padEnd(8)} ${r.repo} ${r.head}  ${r.id}`);
}

async function get() {
  const r = (await L.readRecords(config)).find((x) => x.id === argv[1]);
  if (!r) { console.error(`no session ${argv[1]}`); process.exit(1); }
  const { _file, ...rest } = r;
  console.log(has('json') ? JSON.stringify(rest) : JSON.stringify(rest, null, 2));
}

function baseline() {
  const data = L.baselineData();
  const table = Object.fromEntries(Object.keys(L.MODELS).map((m) => [m, Object.fromEntries(L.EFFORTS.map((e) => [e, L.estimate(m, e, data)]))]));
  if (has('json')) { console.log(JSON.stringify({ version: data.calibration.version, pricing: data.pricing, runs: data.calibration.runs ?? [], seed: data.calibration.seed ?? {}, estimates: table })); return; }
  console.log(`Baseline ${data.calibration.version} — prices as of ${data.pricing.asOf ?? 'not set'}${data.pricing.source ? ` (${data.pricing.source})` : ''}`);
  for (const m of Object.keys(L.MODELS)) console.log(`  ${L.MODELS[m].label.padEnd(11)} ${L.EFFORTS.map((e) => `${e} ${L.money(table[m][e])}`).join(' · ')}`);
  console.log(`\nCalibrate (measures one model × effort; costs a real run, so only when Brett approves):\n  1. git worktree add --detach /tmp/axf-baseline ${data.calibration.commit ?? 'baseline-v1'} && cd /tmp/axf-baseline\n  2. claude --model <model>   (set the effort), paste the task from ${join('apps/console-web/plugins/session-checkin/baseline', 'BASELINE-v1.md')}\n  3. when it finishes, read the token usage, then:\n     node ${L.CHECKIN} calibrate --model <fable|opus|sonnet> --effort <level> --input N --output N --cache-read N --wall SECONDS --tool-calls N [--fail]\n  4. git worktree remove /tmp/axf-baseline   (never merge or push it)`);
}

function calibrate() {
  const model = opt('model'), effort = opt('effort');
  if (!L.MODELS[model] || !L.EFFORTS.includes(effort)) { console.error('--model fable|opus|sonnet and --effort low|medium|high|xhigh|max are required'); process.exit(2); }
  const n = (k) => (opt(k) == null ? null : Math.max(0, Number(opt(k)) || 0));
  if (n('input') == null || n('output') == null) { console.error('--input and --output token counts are required'); process.exit(2); }
  const f = join(L.PLUGIN_DIR, 'baseline', 'calibration.json');
  const c = L.readJson(f, { version: 'baseline-v1', runs: [], seed: {} });
  c.runs = [...(c.runs ?? []), { at: new Date().toISOString(), model, effort, input: n('input'), output: n('output'), cacheRead: n('cache-read') ?? 0, wallSeconds: n('wall'), toolCalls: n('tool-calls'), pass: !has('fail') }];
  L.writeJsonAtomic(f, c);
  console.log(`recorded: ${model} · ${effort} → ${L.money(L.estimate(model, effort))} (commit ${f.replace(L.REPO_ROOT + '/', '')})`);
}

const cmds = { detect, log, end, open, list, get, baseline, calibrate };
if (!cmds[cmd]) { console.error(`unknown command "${cmd}" (${Object.keys(cmds).join(', ')})`); process.exit(2); }
try { await cmds[cmd](); } catch (e) {
  // a hook must never block a session: report and exit 0 for the hook commands
  console.log(`[session check-in] ${cmd} failed: ${e.message}`);
  process.exit(cmd === 'detect' || cmd === 'end' ? 0 : 1);
}
