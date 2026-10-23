// @ts-nocheck — a Node script run with tsx (test.py); the console typecheck has no Node types
/** Installer plan checks (pure part): `npx -y tsx apps/console-web/plugins/claude-handoff/installer-check.mts` (run by test.py). */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_MS, buildCategories, phaseLabel, stepBytes, totalMs } from './web/installer-core.ts';

const here = dirname(fileURLToPath(import.meta.url));
let ok = 0;
const check = (c: unknown, m: string) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } ok++; };
const plan = JSON.parse(execFileSync('node', [join(here, 'handoff.mjs'), 'plan'], { encoding: 'utf8' }));
const cats = buildCategories({ ...plan, machines: [{ host: 'vps', files: [{ path: '.claude/CLAUDE.md', kind: 'user-instructions', bytes: 500 }] }], claudeAi: [...plan.claudeAi, { id: 'memory', kind: 'memory', name: 'claude.ai memory' }], memory: true });
const ids = cats.flatMap((c) => c.steps.map((s) => s.id));
check(new Set(ids).size === ids.length, 'every step id is unique (React keys)');
check(new Set(cats.map((c) => c.id)).size === cats.length, 'every category id is unique');
check(['preflight', 'rules', 'instructions', 'memory', 'specs', 'manifests', 'machines', 'claude-ai', 'secrets', 'context', 'kit', 'publish', 'prompt'].every((id) => cats.some((c) => c.id === id)), 'all categories present, in install order');
check(cats.at(-2)!.id === 'publish' && cats.at(-1)!.id === 'prompt', 'publish then prompt last');
check(cats.find((c) => c.id === 'publish')!.steps[0]!.kind === 'wait', 'publish waits on the real work');
const repoSteps = cats.filter((c) => ['rules', 'instructions', 'memory', 'specs', 'manifests', 'claude-code'].includes(c.id)).reduce((n, c) => n + c.steps.length, 0);
check(repoSteps === plan.repo.length, `every repo file is one step (${repoSteps})`);
check(Math.abs(totalMs(cats) - TARGET_MS) < 200, 'the run is stretched to about the target time');
check(cats.every((c) => c.steps.length > 0 && c.features.length > 0), 'no empty category');
const s = cats.find((c) => c.id === 'memory')!.steps[0]!;
check(stepBytes(s, 0).read === 0 && stepBytes(s, 1).read === s.bytes && stepBytes(s, 1).written === 0, 'index steps read, never write');
check(phaseLabel(s, 0.1).startsWith('reading') && phaseLabel(s, 0.6) === 'hashing…', 'live phase labels');
console.log(`installer-check: ${ok} checks passed`);
