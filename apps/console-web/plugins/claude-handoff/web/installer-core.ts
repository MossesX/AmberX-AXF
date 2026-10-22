/**
 * The installer window's plan (pure: no React, no timers), so it can be tested on its own (installer-check.mts).
 *
 * Every real file and item the kit is made of becomes one step, grouped into categories in install order. Each step
 * reads (bytes in), checks, then writes (bytes out) and takes a time that grows with its size; the whole run is
 * stretched to about TARGET_MS so it reads like an installer, not a blink. One step ("Publish to GitHub") waits on the
 * real work (POST /assemble) and holds near the end until it answers.
 */

export interface PlanFile { path: string; role: string; bytes: number }
export interface Plan {
  repo: PlanFile[]; context: string[];
  machines: { host: string; files: { path: string; kind: string; bytes: number }[] }[];
  claudeAi: { id: string; kind: string; name: string }[]; memory: boolean; secrets: string[];
  project: { name: string; displayName: string; repo: string };
}

export type StepKind = 'copy' | 'index' | 'write' | 'wait' | 'check' | 'skip';
export interface Step { id: string; label: string; detail: string; bytes: number; kind: StepKind; ms: number }
export interface Category { id: string; label: string; icon: string; features: string[]; steps: Step[] }

export const TARGET_MS = 75_000;
export const MIN_STEP_MS = 420;
export const MAX_STEP_MS = 3_200;
/** Where in a step reading stops and writing starts (fractions of the step). */
export const READ_END = 0.55;
export const CHECK_END = 0.7;

const ROLE_CATS: { id: string; label: string; icon: string; roles: string[]; features: string[] }[] = [
  { id: 'rules', label: 'Rules', icon: 'shield', roles: ['rules'], features: ['Read every rule', 'Keep locked rules locked', 'Route the new account to them'] },
  { id: 'instructions', label: 'Instructions', icon: 'list', roles: ['instructions'], features: ['Read CLAUDE.md and its imports', 'Index instruction files', 'Route to repo paths'] },
  { id: 'memory', label: 'Memory', icon: 'layers', roles: ['memory'], features: ['Read decisions and docs', 'Hash every file', 'Record the reading order'] },
  { id: 'specs', label: 'Specs', icon: 'code', roles: ['spec'], features: ['Read the conformance specs', 'Index them', 'Mark them required reading'] },
  { id: 'manifests', label: 'Project manifests', icon: 'package', roles: ['manifest'], features: ['Read every manifest', 'Check names and repos', 'List the projects'] },
  { id: 'claude-code', label: 'Claude Code config', icon: 'terminal', roles: ['claude-settings', 'command', 'skill', 'agent', 'mcp'], features: ['Read project settings', 'Read commands and skills', 'Record MCP servers (no tokens)'] },
];

const KIT_FILES: [string, string][] = [
  ['README.md', 'what the folder is'], ['HANDOFF.md', 'the starting point + reading order'], ['PROJECT.md', 'name, description, repos'],
  ['INSTRUCTIONS.md', 'claude.ai Project instructions'], ['FILES.md', 'every source with its hash'], ['USER-SCOPE.md', 'machine files + how to recreate'],
  ['CLAUDE-AI.md', 'claude.ai-only items'], ['SECRETS.md', 'secret names only'], ['SETUP.md', 'checklist for the new account'],
  ['PROMPT.md', 'the prompt'], ['handoff.json', 'fingerprint of every source'],
];

const base = (p: string) => p.split('/').pop() ?? p;
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
export const formatBytes = kb;

/** Step time before stretching: a floor plus time for its size. */
export function rawMs(bytes: number, kind: StepKind): number {
  if (kind === 'skip') return MIN_STEP_MS * 0.6;
  if (kind === 'wait') return 6_000;
  if (kind === 'check') return 1_100;
  return Math.min(MAX_STEP_MS, MIN_STEP_MS + bytes / 90);
}

export function buildCategories(plan: Plan): Category[] {
  const cats: Category[] = [];
  const step = (id: string, label: string, detail: string, bytes: number, kind: StepKind): Step => ({ id, label, detail, bytes, kind, ms: rawMs(bytes, kind) });

  cats.push({
    id: 'preflight', label: 'Preflight', icon: 'zap', features: ['Find the repo', 'Read the project', 'Plan the install'],
    steps: [
      step('pre-repo', 'Find the repo clone', plan.project.repo || 'this clone', 0, 'check'),
      step('pre-manifest', 'Read the project manifest', plan.project.displayName || plan.project.name, 0, 'check'),
      step('pre-sources', 'Count the sources', `${plan.repo.length} repo files · ${plan.machines.length} machines · ${plan.claudeAi.length} claude.ai items`, 0, 'check'),
      step('pre-folder', 'Reserve the kit folder', '_claude/handoff/', 0, 'check'),
    ],
  });

  for (const c of ROLE_CATS) {
    const files = plan.repo.filter((f) => c.roles.includes(f.role));
    if (!files.length) continue;
    cats.push({ id: c.id, label: c.label, icon: c.icon, features: c.features, steps: files.map((f) => step(`${c.id}:${f.path}`, base(f.path), f.path, f.bytes, 'index')) });
  }

  const userSteps = plan.machines.flatMap((m) => m.files.map((f) => step(`user:${m.host}:${f.path}`, base(f.path), `~/${f.path} on ${m.host}`, f.bytes, 'copy')));
  cats.push({
    id: 'machines', label: 'Machine files (~/.claude)', icon: 'monitor', features: ['Collect each machine', 'Redact secrets', 'Copy to user/<host>/'],
    steps: userSteps.length ? userSteps : [step('user:none', 'No machine has sent its files yet', 'run handoff.mjs hooks install on each machine', 0, 'skip')],
  });

  cats.push({
    id: 'claude-ai', label: 'claude.ai items', icon: 'cloud', features: ['List the Project, artifacts, connectors', 'Write how to recreate each', 'Carry the memory'],
    steps: [
      ...plan.claudeAi.map((i) => step(`ai:${i.id}`, i.name || i.id, i.kind, 900, 'write')),
      plan.memory ? step('ai-pasted-memory', 'Pasted claude.ai memory', 'redacted copy', 2400, 'copy') : step('ai-pasted-memory', 'Pasted claude.ai memory', 'not pasted yet', 0, 'skip'),
    ],
  });

  cats.push({
    id: 'secrets', label: 'Secrets (names only)', icon: 'key', features: ['List every secret name', 'Never copy a value', 'Say where each one goes'],
    steps: plan.secrets.map((s) => step(`secret:${s}`, s, 'name only, value stays with you', 0, 'check')),
  });

  const ctx = plan.context.map((p) => plan.repo.find((f) => f.path === p) ?? { path: p, role: 'context', bytes: 4000 });
  cats.push({
    id: 'context', label: 'Project knowledge', icon: 'file', features: ['Copy the key files', 'Redact secrets', 'Flatten names for upload'],
    steps: ctx.map((f) => step(`ctx:${f.path}`, base(f.path), `context/${f.path.replace(/^_claude\//, 'claude__').replace(/\//g, '__')}`, f.bytes, 'copy')),
  });

  cats.push({
    id: 'kit', label: 'Write the kit', icon: 'save', features: ['Write the entry point', 'Write the guides', 'Fingerprint everything'],
    steps: KIT_FILES.map(([f, d]) => step(`kit:${f}`, f, d, 6000, 'write')),
  });

  cats.push({
    id: 'publish', label: 'Publish to GitHub', icon: 'upload', features: ['Build on the default branch', 'Commit _claude/handoff', 'Push'],
    steps: [step('publish', 'Publish the kit', 'commit + push (skipped when nothing changed)', 0, 'wait')],
  });

  cats.push({
    id: 'prompt', label: 'Assemble the prompt', icon: 'rocket', features: ['Pin the commit', 'Route to HANDOFF.md', 'Ready to paste'],
    steps: [step('prompt', 'Assemble the prompt', 'one paste for the new account', 0, 'check')],
  });

  // step ids are React keys: make them unique even if two sources share a name
  const seen = new Map<string, number>();
  for (const c of cats) for (const st of c.steps) { const n = seen.get(st.id) ?? 0; seen.set(st.id, n + 1); if (n) st.id = `${st.id}#${n}`; }

  // stretch the whole run to about TARGET_MS
  const total = cats.reduce((n, c) => n + c.steps.reduce((m, s) => m + s.ms, 0), 0);
  const k = total ? TARGET_MS / total : 1;
  for (const c of cats) for (const s of c.steps) s.ms = Math.round(s.ms * k);
  return cats;
}

export const totalMs = (cats: Category[]) => cats.reduce((n, c) => n + c.steps.reduce((m, s) => m + s.ms, 0), 0);
export const totalBytes = (cats: Category[]) => cats.reduce((n, c) => n + c.steps.reduce((m, s) => m + s.bytes, 0), 0);

/** Bytes read and written so far inside one step at progress p (0..1). */
export function stepBytes(s: Step, p: number): { read: number; written: number } {
  const reads = s.kind === 'index' || s.kind === 'copy';
  const writes = s.kind === 'copy' || s.kind === 'write';
  const read = reads ? s.bytes * Math.min(1, p / READ_END) : 0;
  const written = writes ? s.bytes * Math.max(0, Math.min(1, (p - CHECK_END) / (1 - CHECK_END))) : 0;
  return { read, written };
}

/** What a step is doing at progress p, for the live line under it. */
export function phaseLabel(s: Step, p: number): string {
  if (s.kind === 'skip') return 'skipped';
  if (s.kind === 'wait') return p < 0.9 ? 'working on GitHub…' : 'waiting for GitHub…';
  if (s.kind === 'check') return p < 0.5 ? 'checking…' : 'confirmed';
  if (p < READ_END) return s.kind === 'write' ? 'preparing…' : `reading ${kb(Math.round(s.bytes * (p / READ_END)))} / ${kb(s.bytes)}`;
  if (p < CHECK_END) return s.kind === 'index' ? 'hashing…' : 'redacting secrets…';
  return s.kind === 'index' ? 'indexing…' : `writing ${kb(Math.round(s.bytes * ((p - CHECK_END) / (1 - CHECK_END))))}`;
}
