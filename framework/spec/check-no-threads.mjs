#!/usr/bin/env node
// The old handoff system stays gone (Brett, Nov 4 2026: "Now delete all the old handoff section entirely."; build
// handoff-2): no `_claude/THREADS.md`, no `_claude/handoff/`, no dated handoff notes, no Claude handoff plugin, and no
// code, rule, template, brief boilerplate, hook or check that reads or writes them. Session sync (spec/HANDOFF.md,
// `_claude/sync/<project>`) is what sessions use instead. Exit 1 on any reference; history (reports, journals, the builds
// store and its exports, change-log and session archives, rebuild reports, STATUS.md) is not scanned: it records the past.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATTERNS = [
  { re: /_claude\/THREADS\.md|\bTHREADS\.md\b|ACTIVE-THREADS/, what: 'the threads log (THREADS.md)' },
  { re: /_claude\/handoff\//, what: 'the handoff kit folder (_claude/handoff/)' },
  { re: /notes\/handoffs\/|\bhandoff-20\d\d-\d\d-\d\d\.md/, what: 'a dated handoff note' },
  { re: /claude-handoff|claude_handoff/, what: 'the Claude handoff plugin' },
  { re: /AXF_THREADS_FILE|appendThreads\(|THREADS_REL|Live build log/, what: 'a THREADS writer' },
];
const GONE = ['_claude/THREADS.md', '_claude/handoff', '_claude/shared/notes/handoffs', '_claude/memory/handoff-2026-11-01.md', '_claude/memory/handoff-2026-11-02.md', 'apps/console-web/plugins/claude-handoff'];
// history and generated data: what happened is allowed to say THREADS; nothing reads it any more
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-single', 'build', '.gradle', '__pycache__', '.axf-console', 'journal', 'reports', 'changes', 'sessions', 'rebuilds', 'harvest', 'data', 'plans']);
const SKIP_FILES = [/^_claude\/builds\/(store|origins|orchestrator)\.json$/, /^_claude\/builds\/profiles\//, /^framework\/plan\/profiles\//, /^framework\/plan\/(pending|build-queue)\.json$/, /^_claude\/memory\/STATUS\.md$/, /^framework\/spec\/check-no-threads\.mjs$/, /^framework\/spec\/HANDOFF\.md$/, /^_claude\/memory\/decisions\.md$/, /(^|\/)_claude\/(shared\/)?notes\//, /\.(log|jsonl|lock|png|jpg|webp|svg|ico|woff2?|ttf|apk|zip)$/i, /^\.brief\.md$/, /^tracker\.json$/, /^framework\/catalog\//, /^install_instructions\.md$/, /^install_steps\.md$/];
const TEXT = /\.(md|mjs|cjs|js|ts|tsx|mts|json|py|css|html|ya?ml|yml|kt|kts|sh|txt|toml)$/i;

let fails = 0; let files = 0;
const problems = [];
for (const g of GONE) if (existsSync(join(ROOT, g))) { fails++; problems.push(`${g} is back (it was deleted on Nov 4 2026)`); }
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const f = join(dir, name); const rel = relative(ROOT, f);
    let st; try { st = statSync(f); } catch { continue; }
    if (st.isDirectory()) { walk(f); continue; }
    if (!TEXT.test(name) || SKIP_FILES.some((re) => re.test(rel))) continue;
    if (st.size > 4 * 1024 * 1024) continue;
    files++;
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => { for (const p of PATTERNS) if (p.re.test(line)) { fails++; problems.push(`${rel}:${i + 1}  ${p.what}: ${line.trim().slice(0, 120)}`); break; } });
  }
}
walk(ROOT);
for (const p of problems.slice(0, 80)) console.error(`✗ ${p}`);
if (problems.length > 80) console.error(`… and ${problems.length - 80} more`);
console.log(`${fails ? '✗' : '✓'} no-threads: ${fails} reference(s) to the old handoff system in ${files} file(s)`);
process.exit(fails ? 1 : 0);
