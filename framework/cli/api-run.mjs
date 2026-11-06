#!/usr/bin/env node
/**
 * api-run — every run on an API key waits for Brett (framework/core/api-run.mjs), called by deploy/claude-headless.sh.
 *
 *   gate --name n --brief f --model m [--build id]    exit 0 go (prints run=<id> on an API run) · 4 waiting · 5 denied or expired
 *   wait <id>                                         blocks until decided; exit 0 approved, 5 otherwise
 *   start <id> --session s · finish <id> [--meter f] [--cost usd]
 *   list [--json] · get <id> [--json] · ack <id>
 *   decide <id> approve|deny                          console server only: {owner} on stdin, refused inside any Claude session
 * Store: /projects/_shared/_data/claude/api-runs/<id>.json (AXF_API_RUNS_DIR elsewhere).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, expired, isApiRun, minutesLeft, newRun, owed } from '../core/api-run.mjs';
import { nonHumanSource } from '../core/model-switch.mjs';
import { estimateCost } from './model-pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '..', '..'));
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const dir = () => { if (process.env.AXF_API_RUNS_DIR) return process.env.AXF_API_RUNS_DIR; const p = process.env.AXHUB_PROJECTS_DIR || '/projects'; return existsSync(p) ? join(p, '_shared', '_data', 'claude', 'api-runs') : join(ROOT, '.axf-console', 'api-runs'); };
const fileOf = (id) => { if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(id ?? '')) throw new Error('bad run id'); return join(dir(), `${id}.json`); };
export const getRun = (id) => readJson(fileOf(id));
function put(r) { const f = fileOf(r.id); mkdirSync(dirname(f), { recursive: true }); writeFileSync(`${f}.tmp`, JSON.stringify(r, null, 1)); renameSync(`${f}.tmp`, f); return r; }
export function listRuns() {
  let names = []; try { names = readdirSync(dir()).filter((f) => f.endsWith('.json')); } catch { /* none yet */ }
  const now = Date.now();
  return names.map((n) => readJson(join(dir(), n))).filter(Boolean).map((r) => (expired(r, now) ? put({ ...r, status: 'expired' }) : r)).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
}
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'run';

/** The launch's request: one per brief; a finished one lets the same brief ask again. */
function gate({ name, brief, model, build }, env = process.env) {
  if (!isApiRun(env)) return { code: 0 };
  const text = readFileSync(brief, 'utf8');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 10);
  const open = listRuns().find((r) => r.briefHash === hash && r.name === name && !['done', 'expired'].includes(r.status));
  const r = open ?? (() => {
    const b = build ? readJson(join(ROOT, '_claude', 'builds', 'store.json'))?.builds?.find((x) => x.id === build) : null;
    const minutes = minutesLeft(b);
    const at = new Date().toISOString();
    return put(newRun({ id: `${slug(name)}-${hash}-${Date.now().toString(36)}`, name, build: build ?? '', model, minutes, estimateUsd: estimateCost(model, minutes), briefHash: hash, title: b?.title ?? text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? name, at }));
  })();
  if (r.status === 'denied') return { code: 5, run: r.id, line: `API run ${r.id} was denied by ${r.decidedBy}; not starting` };
  if (r.status === 'waiting') return { code: 4, run: r.id, line: `API run ${r.id} waits for Brett's approval in the console (estimate $${r.estimateUsd ?? '?'}, ~${r.minutes} min)` };
  return { code: 0, run: r.id };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const say = (o, text) => process.stdout.write(json ? `${JSON.stringify({ ok: true, ...o })}\n` : `${text ?? JSON.stringify(o, null, 2)}\n`);
  try {
    const cmd = args.shift() || 'list';
    if (cmd === 'gate') {
      const v = gate({ name: flag('--name') ?? 'run', brief: flag('--brief'), model: flag('--model') ?? '', build: flag('--build') });
      if (v.run) process.stdout.write(`run=${v.run}\n`);
      if (v.line) process.stdout.write(`${v.line}\n`);
      process.exit(v.code);
    } else if (cmd === 'wait') {
      for (;;) {
        const r = listRuns().find((x) => x.id === args[0]);
        if (r?.status === 'approved') process.exit(0);
        if (!r || r.status !== 'waiting') process.exit(5);
        await new Promise((f) => { setTimeout(f, 15000); });
      }
    } else if (cmd === 'start') {
      const r = getRun(args[0]); if (r) put({ ...r, status: 'running', startedAt: new Date().toISOString(), session: flag('--session') ?? '' }); say({});
    } else if (cmd === 'finish') {
      const r = getRun(args[0]);
      const meter = flag('--meter'); const cost = flag('--cost');
      const usd = cost !== undefined ? Number(cost) : Number(readJson(meter ?? '')?.costUsd);
      if (r) put({ ...r, status: 'done', finishedAt: new Date().toISOString(), finalUsd: Number.isFinite(usd) ? usd : null });
      say({});
    } else if (cmd === 'list') {
      const runs = listRuns(); say({ runs, owed: owed(runs).map((r) => r.id) }, runs.map((r) => `${r.status}  ${r.id}  est $${r.estimateUsd ?? '?'}  final $${r.finalUsd ?? '?'}`).join('\n') || 'no API runs');
    } else if (cmd === 'get') {
      say({ run: getRun(args[0]) });
    } else if (cmd === 'decide') {
      const r = getRun(args[0]); if (!r) throw new Error('no such run');
      let input = {}; try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no owner */ }
      say({ run: put(decide(r, args[1], { owner: input.owner, source: nonHumanSource(process.env), at: new Date().toISOString() })) });
    } else if (cmd === 'ack') {
      const r = getRun(args[0]); if (r) put({ ...r, acknowledgedAt: new Date().toISOString() }); say({});
    } else { process.stderr.write(`api-run: unknown command ${cmd}\n`); process.exit(2); }
  } catch (e) {
    process.stdout.write(json ? `${JSON.stringify({ ok: false, code: 'denied', message: String(e?.message ?? e).slice(0, 300) })}\n` : '');
    process.stderr.write(`api-run: ${e?.message ?? e}\n`); process.exit(1);
  }
}
