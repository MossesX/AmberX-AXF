#!/usr/bin/env node
/**
 * stall-watchdog.mjs: watches the build dispatcher from outside it, fixes a stall, and tells Brett (stall-core.mjs decides).
 *
 * Brett, Nov 10 2026: "Why am I not being notified when it stalls? You need to be monitoring it so you know when it
 * stalls, then try to fix it, then let me know."
 *
 * Runs on the VPS host from its own cron, every minute (deploy/install-console.sh, axf-pipeline-watchdog), not from the
 * dispatcher's tick: a tick that crashes or hangs never reaches its own hooks (Nov 10 2026: every tick failed on a
 * broken store for 8.5 hours and nothing said so).
 *
 *   node apps/console-web/plugins/build-orchestrator/stall-watchdog.mjs status [--json]   what it sees now and the open spell
 *   … run [--force] [--dry] [--json]   one round: look, and when a stall has lasted CONFIRM_MIN, run the fixes in order
 *   … request [--by who] [--json]      ask the next round to fix at once (the console, voice, MCP; works off the host)
 *
 * Every fix attempt is a line under the spell's entry in the Automatic fixes note (the hub's shared notes,
 * "Automatic fixes/Dispatcher stalls.md", AmberX Notes) and an AmberX FYI (alerts source pipeline, key
 * pipeline:stall:<spell>:…); when every fix failed, one escalation with what is missing (pipeline:stall-escalate:<spell>).
 * Files: <pipeline dir>/stall.json (pipeline-stall@1), stall-request.json. Environment for tests: AXF_PIPELINE_DIR,
 * AXF_PIPELINE_LOG (the cron's log), AXF_STALL_TICK (the restart's tick command), AXF_STALL_NOTE (the note file, or off),
 * AXF_PIPELINE_CONSOLE=off, AXF_SLOTS_TMUX=off (sessions unknown), AXF_STALL_PS=off (no process scan).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './stall-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const PIPELINE = join(HERE, 'pipeline.mjs');
const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }

// the same folder pipeline.mjs uses, worked out here so a broken pipeline.mjs can't stop the watchdog from looking
export function pipeDir(env = process.env) {
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
const files = (env = process.env) => { const d = pipeDir(env); return { state: join(d, 'state.json'), stall: join(d, 'stall.json'), request: join(d, 'stall-request.json'), log: join(d, 'log.jsonl') }; };
const logLine = (o, env = process.env) => { try { appendFileSync(files(env).log, `${JSON.stringify({ at: nowIso(), ...o })}\n`); } catch { /* courtesy */ } };
export const loadStall = (env = process.env) => ({ $axf: S.SCHEMA, at: '', findings: [], spell: null, history: [], ...(readJson(files(env).stall, {}) ?? {}) });

// ------------------------------------------------------------------ what the dispatcher is doing

/** The last failed tick's message from the cron log (the line the CLI prints on a throw), when it came after the last good tick. */
export function lastTickError(env = process.env) {
  const f = env.AXF_PIPELINE_LOG || '/var/log/axf-pipeline.log';
  let text = '';
  try { const buf = readFileSync(f); text = buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('utf8'); } catch { return ''; }
  const lines = text.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^tick \d{4}-/.test(lines[i])) return '';
    if (/^pipeline: /.test(lines[i])) return lines[i].slice(10).trim();
  }
  return '';
}

/** Ticks still running: [{ pid, min }]. */
export function runningTicks(env = process.env) {
  if (env.AXF_STALL_PS === 'off') return [];
  const r = spawnSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split('\n').flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    return m && /node\S*\s+\S*pipeline\.mjs tick\b/.test(m[3]) && Number(m[1]) !== process.pid ? [{ pid: Number(m[1]), min: Number(m[2]) / 60 }] : [];
  });
}

/** tmux session names, or null when tmux can't answer (not installed, AXF_SLOTS_TMUX=off). No server = no sessions. */
function tmuxSessions(env = process.env) {
  if (env.AXF_SLOTS_TMUX === 'off') return null;
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
  if (r.error) return null;
  if (r.status !== 0) return /no server running|error connecting/i.test(r.stderr || '') || !(r.stderr || '').trim() ? [] : null;
  return r.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
}

/** Everything detect() needs, read fresh. A store that does not load is a tick problem: the builds are then unknown. */
export async function look(env = process.env) {
  const state = readJson(files(env).state, {}) ?? {};
  const ticks = runningTicks(env);
  const tick = { at: str(state.at, 40), error: lastTickError(env), runningMin: ticks.reduce((m, t) => Math.max(m, t.min), 0) };
  let builds = []; let storeError = '';
  try { const { loadStore } = await import('../../../../framework/cli/builds-store.mjs'); builds = loadStore().builds; }
  catch (e) { storeError = str(e.message, 300); if (!tick.error) tick.error = `the builds store does not load: ${storeError}`; }
  const names = tmuxSessions(env);
  const alive = (session, id) => (names === null ? null : names.includes(session) || names.some((n) => n.startsWith(`axf-${id}--`)));
  const findings = S.detect({ builds, tick, alive, waits: state.plan?.waits ?? [] });
  return { findings, builds, tick, ticks, storeError };
}

// ------------------------------------------------------------------ the fixes

const pipeline = () => import('./pipeline.mjs');

async function fixSelfcheck(ctx) {
  const P = await pipeline();
  const r = P.selfCheck({ reason: 'stall watchdog', by: 'stall-watchdog', env: ctx.env, alert: () => false });
  if (!r.ran) throw new Error(r.why || 'the self-check did not run');
  return `${r.fixes.length ? `fixed ${r.fixes.length}: ${r.fixes.join('; ')}` : 'nothing to release'}. ${r.line}`;
}

async function fixRelease(ctx) {
  const P = await pipeline();
  const done = [];
  try { P.slotsNow(); } catch { /* pruning is best effort */ }
  for (const f of ctx.findings.filter((x) => x.kind === 'dead')) {
    for (const id of f.ids) {
      const b = ctx.builds.find((x) => x.id === id);
      P.setPipeline(id, { session: '', slot: '', account: '', note: 'released by the stall watchdog: its session was gone' },
        { status: 'queued', note: `Stall watchdog: session ${b?.pipeline?.session || '?'} on ${b?.pipeline?.account || '?'} was gone; released and back in the Queue.`, by: 'stall-watchdog', action: 'pipeline:stall-release' });
      done.push(id);
    }
  }
  for (const b of P.reapBuilds()) done.push(b.id);
  return done.length ? `released ${done.join(', ')}: back in the Queue` : 'no dead slot to release';
}

async function fixAutoqueue(ctx) {
  const P = await pipeline();
  const want = S.autoQueueable(ctx.builds);
  const done = [];
  for (const b of want) { P.queue(b.id, { by: 'stall watchdog (Urgent / High, Queue empty)' }); done.push(b.id); }
  return done.length ? `queued ${done.join(', ')}` : 'no Urgent / High build waits in Pending (or the Queue has work)';
}

async function fixRestart(ctx) {
  const env = ctx.env; const notes = [];
  for (const t of runningTicks(env)) {
    if (t.min < S.HUNG_TICK_MIN) continue;
    try { process.kill(t.pid, 'SIGTERM'); notes.push(`stopped a tick hung for ${Math.round(t.min)} min (pid ${t.pid})`); } catch (e) { notes.push(`could not stop pid ${t.pid}: ${e.message}`); }
  }
  if (!env.AXF_STALL_TICK && !existsSync('/etc/cron.d/axf-pipeline')) notes.push('the dispatcher cron (/etc/cron.d/axf-pipeline) is missing: re-run deploy/install-console.sh');
  const cmd = env.AXF_STALL_TICK
    ? ['bash', ['-c', env.AXF_STALL_TICK]]
    : ['flock', ['-w', '120', '/run/axf-pipeline.lock', 'timeout', '600', process.execPath, PIPELINE, 'tick']];
  const r = spawnSync(cmd[0], cmd[1], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 660e3, env });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (!env.AXF_STALL_TICK) { try { appendFileSync(env.AXF_PIPELINE_LOG || '/var/log/axf-pipeline.log', `${out}\n`); } catch { /* the log is a courtesy */ } }
  if (r.error || r.status !== 0) throw new Error([...notes, `the tick failed (exit ${r.status ?? r.error?.code}): ${str(out.split('\n').filter(Boolean).pop() || 'no output', 300)}`].join('; '));
  const launched = /launched (?!none)(.+)$/m.exec(out)?.[1];
  return [...notes, `ran a tick${launched ? `: launched ${str(launched, 200)}` : ''}`].join('; ');
}

const FIX_FN = { selfcheck: fixSelfcheck, release: fixRelease, autoqueue: fixAutoqueue, restart: fixRestart };

// ------------------------------------------------------------------ telling Brett

function notePath(env = process.env) {
  if (env.AXF_STALL_NOTE) return env.AXF_STALL_NOTE === 'off' ? '' : env.AXF_STALL_NOTE;
  const claude = join(env.AXHUB_PROJECTS_DIR || '/projects', '_shared', '_claude');
  return existsSync(claude) ? join(claude, 'notes', 'Automatic fixes', 'Dispatcher stalls.md') : '';
}

/** Append to the Automatic fixes note (owned like the rest of the hub's shared notes, so the Notes view can edit it). */
export function noteAppend(text, env = process.env) {
  const f = notePath(env); if (!f) return false;
  try {
    const fresh = !existsSync(f);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, fresh ? `# Automatic fixes: dispatcher stalls\n\nWritten by the stall watchdog (build orchestrator): every stall it saw, each fix it tried, and how it ended.\n${text}` : text, { mode: 0o660 });
    if (!env.AXF_STALL_NOTE) { try { const o = statSync(dirname(dirname(dirname(f)))); for (const p of [dirname(f), f]) chownSync(p, o.uid, o.gid); } catch { /* ownership is a courtesy */ } }
    return true;
  } catch (e) { logLine({ event: 'stall-note-failed', error: str(e.message, 200) }, env); return false; }
}

async function sender(env) {
  if (env.AXF_PIPELINE_CONSOLE === 'off') return () => null;
  try { const P = await pipeline(); return P.makeConsole(env); } catch { return () => null; }
}

// ------------------------------------------------------------------ one round

/**
 * Look; open, follow or close the spell; when it is time, run the fixes in order with a fresh look after each, stop at
 * the first that clears it, announce each attempt, and escalate once when none did. Returns what it did.
 */
export async function run({ env = process.env, force = false, dry = false, now = Date.now(), send = null } = {}) {
  const f = files(env);
  const asked = readJson(f.request);
  force = force || !!asked;
  const mem = loadStall(env);
  let seen = await look(env);
  const post = send ?? await sender(env);
  const alert = (kind, d) => { const a = S.alertFor(kind, d); let ok = false; try { ok = !!post('POST', '/api/alerts', a); } catch { ok = false; } return { key: a.key, title: a.title, sent: ok }; };
  const d = S.decide(seen.findings, mem.spell, { now, force });
  const out = { at: new Date(now).toISOString(), action: d.action, why: d.why || '', findings: seen.findings, attempts: [], alerts: [], escalated: false, cleared: false };
  let spell = mem.spell;
  if (d.action === 'none') spell = null;
  if (d.action === 'clear') {
    if (spell?.rounds && !spell.fixedBy) {
      noteAppend(S.noteClose(out.at, 'Cleared: builds are moving again.'), env);
      if (!dry) out.alerts.push(alert('cleared', { spell: spell.id, what: `Was: ${spell.lines.join(' ')}` }));
    }
    if (spell?.escalatedAt && !dry) { try { post('POST', '/api/alerts/resolve', { keys: [`pipeline:stall-escalate:${spell.id}`] }); } catch { /* best effort */ } }
    out.cleared = !!spell?.rounds;
    mem.history = [...(mem.history ?? []), ...(spell?.rounds ? [{ id: spell.id, since: spell.since, until: out.at, lines: spell.lines, fixedBy: spell.fixedBy || 'cleared by itself', escalated: !!spell.escalatedAt }] : [])].slice(-20);
    spell = null;
  }
  if (d.action === 'wait') spell = S.spellFor(seen.findings, spell, now);
  if (d.action === 'fix') {
    spell = S.spellFor(seen.findings, spell, now);
    if (dry) out.attempts = S.FIXES.map((fix) => ({ fix, dry: true }));
    else {
      const round = (spell.rounds ?? 0) + 1;
      const quiet = !!spell.escalatedAt; // after the escalation, retries are logged, and only a fix reaches the phone
      if (round === 1) noteAppend(S.noteEntry(spell), env); else noteAppend(S.noteClose(out.at, `Round ${round}: still stuck (${seen.findings.map((x) => x.kind).join(', ')}).`), env);
      for (const fix of S.FIXES) {
        const a = { fix, at: nowIso(), ok: false, result: '', error: '' };
        try { a.result = await FIX_FN[fix]({ env, findings: seen.findings, builds: seen.builds }); } catch (e) { a.error = str(e.message, 400); }
        seen = await look(env);
        a.ok = !seen.findings.length; a.still = seen.findings.map((x) => x.line).join(' ');
        out.attempts.push(a);
        noteAppend(S.noteAttempt(a), env);
        logLine({ event: 'stall-fix', spell: spell.id, round, fix, ok: a.ok, result: str(a.result, 200), error: a.error }, env);
        if (!quiet || a.ok) out.alerts.push(alert('attempt', { spell: spell.id, round, fix, ok: a.ok, result: a.result || `Failed: ${a.error}`, still: a.still }));
        if (a.ok) break;
      }
      spell = { ...spell, rounds: round, lastRound: out.at, attempts: [...(spell.attempts ?? []), ...out.attempts.map(({ still, ...x }) => x)].slice(-24) };
      const fixed = out.attempts.find((a) => a.ok);
      if (fixed) {
        spell.fixedBy = S.FIX_LABEL[fixed.fix];
        noteAppend(S.noteClose(nowIso(), `Fixed by ${spell.fixedBy}.`), env);
        out.alerts.push(alert('fixed', { spell: spell.id, what: `Was: ${spell.lines.join(' ')}`, by: spell.fixedBy }));
        if (spell.escalatedAt) { try { post('POST', '/api/alerts/resolve', { keys: [`pipeline:stall-escalate:${spell.id}`] }); } catch { /* best effort */ } }
        mem.history = [...(mem.history ?? []), { id: spell.id, since: spell.since, until: nowIso(), lines: spell.lines, fixedBy: spell.fixedBy, escalated: !!spell.escalatedAt }].slice(-20);
        spell = null;
      } else if (!spell.escalatedAt) {
        const needs = S.missing(seen.findings, out.attempts);
        spell.escalatedAt = nowIso(); spell.needs = needs; out.escalated = true;
        noteAppend(S.noteClose(spell.escalatedAt, `Every fix failed: told Brett. Needed: ${needs.join(' / ')}`), env);
        out.alerts.push(alert('escalate', { spell: spell.id, what: seen.findings.map((x) => x.line).join('\n'), needs }));
      }
    }
  }
  if (!dry) {
    try { rmSync(f.request, { force: true }); } catch { /* gone */ }
    writeJson(f.stall, { $axf: S.SCHEMA, at: out.at, findings: seen.findings, spell, history: mem.history ?? [], last: { action: out.action, why: out.why, attempts: out.attempts.length, escalated: out.escalated, cleared: out.cleared } });
  }
  out.spell = spell;
  return out;
}

/** Ask the next round to fix at once (anywhere the pipeline folder is shared: the console's container too). */
export function request({ by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const r = { at: nowIso(), by: str(by, 80) };
  writeJson(files(env).request, r);
  logLine({ event: 'stall-requested', ...r }, env);
  return r;
}

/** What the watchdog saw on its last round, the open spell and the last spells (the console, voice and MCP read this). */
export function status(env = process.env) {
  const s = loadStall(env);
  const ageMin = s.at ? Math.round((Date.now() - Date.parse(s.at)) / 60e3) : null;
  return { ok: true, $axf: S.SCHEMA, at: s.at, ageMin, watching: ageMin !== null && ageMin <= 3, stalled: !!s.spell, findings: s.findings, spell: s.spell, history: s.history, last: s.last ?? null, requested: readJson(files(env).request)?.at || '' };
}

// ------------------------------------------------------------------ CLI

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const [cmd = 'status'] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'status') {
    const s = status();
    return out(s, [`Stall watchdog · last look ${s.at || 'never'}${s.ageMin !== null ? ` (${s.ageMin} min ago)` : ''}${s.watching ? '' : ' · NOT WATCHING (cron axf-pipeline-watchdog?)'}`,
      s.findings.length ? s.findings.map((x) => `  stuck: ${x.line}`).join('\n') : '  nothing stuck',
      s.spell ? `  spell ${s.spell.id} since ${s.spell.since} · rounds ${s.spell.rounds}${s.spell.escalatedAt ? ` · escalated ${s.spell.escalatedAt}` : ''}` : '',
      ...(s.history ?? []).slice(-5).map((h) => `  past: ${h.since} → ${h.until}: ${h.fixedBy}`)].filter(Boolean).join('\n'));
  }
  if (cmd === 'run') {
    const r = await run({ force: args.includes('--force'), dry: args.includes('--dry') });
    return out({ ok: true, ...r }, [`stall ${r.at}: ${r.action}${r.why ? ` (${r.why})` : ''}`, ...r.findings.map((x) => `  stuck: ${x.line}`),
      ...r.attempts.map((a) => `  ${a.fix}: ${a.dry ? 'would run' : a.ok ? 'FIXED' : a.error ? `failed: ${a.error}` : 'still stuck'}${a.result ? ` · ${a.result}` : ''}`), r.escalated ? '  escalated to Brett' : '', r.cleared ? '  cleared' : ''].filter(Boolean).join('\n'));
  }
  if (cmd === 'request') { const r = request({ by: flag('by', process.env.AXF_ACTOR || 'cli') }); return out({ ok: true, requested: r.at, last: status() }, 'stall check asked for: the next watchdog round (within a minute) runs the fixes'); }
  throw Object.assign(new Error('usage: stall-watchdog.mjs status | run [--force] [--dry] | request [--by who] [--json]'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`stall-watchdog: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  });
}
