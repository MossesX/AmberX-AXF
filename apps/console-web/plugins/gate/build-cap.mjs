#!/usr/bin/env node
/**
 * Build cap (VPS Configuration → Build cap): how many builds the VPS runs at once, read from the two places that
 * decide it and shown side by side.
 *   hard cap          framework/cli/build-limit.mjs → maxBuilds (the host never runs more; only Brett changes it)
 *   emergency slots   the same file → emergencySlots (a second pool, counted apart; only Brett changes it)
 *   stepsInParallel   the orchestrator's pipeline setting (steps of one build sent at once; anyone with the console)
 *
 *   node build-cap.mjs status [--json]                 build-cap@1
 *   node build-cap.mjs set stepsInParallel <n> [--json]
 * The server routes (GET / POST build-cap) run this file; the owner-only keys are written by the route itself, with
 * Brett's signed-in session, through build-limit.mjs.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../../../..');
export const LIMIT_CLI = resolve(ROOT, 'framework/cli/build-limit.mjs');
export const PIPELINE_CLI = resolve(HERE, '../build-orchestrator/pipeline.mjs'); // axf-plugin:build-orchestrator
export const OWNER_KEYS = Object.freeze(['maxBuilds', 'emergencySlots']);
export const RANGES = Object.freeze({ maxBuilds: [1, 64], emergencySlots: [0, 8], stepsInParallel: [1, 12] });

/** How many steps really run at once, and the plain line shown when the two numbers disagree ('' when they agree). */
export function capNote({ hardCap, stepsInParallel }) {
  const cap = Number(hardCap); const par = Number(stepsInParallel);
  if (!Number.isFinite(cap) || !Number.isFinite(par)) return { effective: null, note: '' };
  const effective = Math.min(cap, par);
  if (par > cap) return { effective, note: `Steps in parallel is ${par} but Builds at once is ${cap}: only ${cap} run at once.` };
  if (par < cap) return { effective, note: `Builds at once allows ${cap}, but one build sends at most ${par} steps at once.` };
  return { effective, note: '' };
}

/** build-cap@1 from the two raw answers (build-limit-status@1 and the pipeline settings). */
export function buildCap(limit, settings) {
  const hardCap = limit?.max ?? limit?.limit?.maxBuilds ?? null;
  const stepsInParallel = settings?.stepsInParallel ?? null;
  return {
    $axf: 'build-cap@1', ok: true, at: new Date().toISOString(),
    hardCap, live: limit?.live ?? null, free: limit?.free ?? null,
    emergencySlots: limit?.emergency?.max ?? limit?.limit?.emergencySlots ?? null, emergencyLive: limit?.emergency?.live ?? null,
    stepsInParallel, ...capNote({ hardCap, stepsInParallel }),
    setBy: limit?.limit?.setBy ?? '', setAt: limit?.limit?.setAt ?? '', ranges: RANGES, ownerOnly: OWNER_KEYS,
  };
}

/** Check one value against its range: the whole number, or throws with the plain reason. */
export function checkValue(key, value) {
  const r = RANGES[key];
  if (!r) throw Object.assign(new Error(`unknown setting ${key} (${Object.keys(RANGES).join(', ')})`), { code: 'invalid' });
  const n = Number(value);
  if (!Number.isInteger(n) || n < r[0] || n > r[1]) throw Object.assign(new Error(`${key} is a whole number from ${r[0]} to ${r[1]}`), { code: 'invalid' });
  return n;
}

function json(cli, args) {
  const p = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const line = (p.stdout || '').trim();
  try { return JSON.parse(cli === PIPELINE_CLI ? line.split('\n').pop() : line); } catch { throw Object.assign(new Error((p.stderr || line || 'no answer').trim().slice(-300)), { code: 'unavailable' }); }
}

export function status() {
  const s = json(PIPELINE_CLI, ['settings']);
  if (s.ok === false) throw Object.assign(new Error(s.error || 'the orchestrator did not answer'), { code: 'unavailable' });
  return buildCap(json(LIMIT_CLI, ['status']), s.settings);
}

export function setStepsInParallel(value) {
  const n = checkValue('stepsInParallel', value);
  const r = json(PIPELINE_CLI, ['set', `stepsInParallel=${n}`]);
  if (r.ok === false) throw Object.assign(new Error(r.error || 'the orchestrator refused'), { code: 'failed' });
  return status();
}

export function line(c) {
  return [`builds at once ${c.hardCap} (${c.live ?? '?'} running, ${c.free ?? '?'} free) · emergency slots ${c.emergencySlots} · steps in parallel ${c.stepsInParallel}`, c.note].filter(Boolean).join('\n');
}

export async function main(argv) {
  const asJson = argv.includes('--json');
  const [cmd = 'status', key = '', value = ''] = argv.filter((a) => a !== '--json');
  const say = (c) => console.log(asJson ? JSON.stringify(c) : line(c));
  try {
    if (cmd === 'status') { say(status()); return 0; }
    if (cmd === 'set') {
      if (OWNER_KEYS.includes(key)) throw Object.assign(new Error(`Only Brett sets ${key}, from his own signed-in console (Builds → VPS Configuration → Build cap).`), { code: 'forbidden' });
      if (key !== 'stepsInParallel') throw Object.assign(new Error('usage: build-cap set stepsInParallel <n>'), { code: 'invalid' });
      say(setStepsInParallel(value)); return 0;
    }
    throw Object.assign(new Error('axf gate build-cap status | set stepsInParallel <n>'), { code: 'invalid' });
  } catch (e) {
    if (asJson) console.log(JSON.stringify({ ok: false, code: e.code || 'failed', message: e.message })); else console.error(e.message);
    return e.code === 'invalid' ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c));
