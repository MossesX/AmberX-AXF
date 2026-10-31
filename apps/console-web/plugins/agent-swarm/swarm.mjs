#!/usr/bin/env node
/**
 * Agent swarm CLI. Reads the active build profile's orchestrator tracker (orchestrator@1; AXF_ORCH_FILE overrides),
 * the roster (agents/roster.json) and the swarm state (data folder; AXF_SWARM_DIR overrides).
 *
 *   node apps/console-web/plugins/agent-swarm/swarm.mjs roster              the agents and their skills
 *   … plan <buildId>…                    split builds into jobs: agent, model, leases, waves (several builds share one lease table)
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/swarm-core.mjs';
import { orchestratorPath } from '../../../../framework/cli/persist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const trackerFile = () => process.env.AXF_ORCH_FILE || orchestratorPath();
export const dataDir = () => process.env.AXF_SWARM_DIR || join(ROOT, '.axf-console/plugins/agent-swarm');

export function readJson(f, fallback) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } }
export function writeJson(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`); renameSync(tmp, f);
}

export function loadRoster() { return core.normRoster(readJson(join(HERE, 'agents/roster.json'), { agents: [] })); }
export function loadSkills() {
  const dir = join(HERE, 'agents/skills');
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => { const s = core.parseSkill(readFileSync(join(dir, f), 'utf8')); return [s.id, s]; }));
}
export function loadTracker() { const f = trackerFile(); return existsSync(f) ? readJson(f, { builds: [] }) : { builds: [] }; }
export function findBuilds(ids) {
  const t = loadTracker();
  return ids.map((id) => { const b = (t.builds ?? []).find((x) => x.id === id); if (!b) throw new Error(`no build "${id}" in ${trackerFile()}`); return b; });
}

export function plan(ids, opts = {}) { return core.planJobs(findBuilds(ids), loadRoster(), opts); }

function planText(p) {
  const out = [];
  p.waves.forEach((w, i) => { out.push(`Wave ${i + 1}:`); for (const id of w) { const j = p.jobs.find((x) => x.id === id); out.push(`  ${j.id.padEnd(28)} ${j.agent.padEnd(6)} ${j.model.padEnd(7)} ${String(j.budget.tokens).padStart(7)} tok · ${j.leases.join(', ') || '(no files)'}`); } });
  return [...out, ...p.warnings.map((w) => `! ${w}`)].join('\n') || 'Nothing to plan.';
}

export async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'roster', ...rest] = args;
  if (cmd === 'roster') {
    const r = loadRoster(); const sk = loadSkills(); const problems = core.checkRoster(r, sk);
    return out({ ok: true, roster: r, skills: sk, problems }, [...r.agents.map((a) => `${a.id.padEnd(6)} ${a.name.padEnd(12)} ${a.skill.padEnd(17)} ${a.models.join('/')}`), ...problems.map((p) => `! ${p}`)].join('\n'));
  }
  if (cmd === 'plan') { if (!rest.length) throw new Error('plan needs a build id'); const p = plan(rest); return out({ ok: true, plan: p }, planText(p)); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
