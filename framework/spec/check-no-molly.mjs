// Guard (Nov 16 2026, build remove-molly-completely-delete-the-molly-add-on-bundle-from-agent-manager-the): the
// molly-guide plugin, the Molly agent add-on bundle and the _offer_molly auto-install stay out of the console.
// The separate axf-molly project (the gate's later backend) is a different thing and is allowed.
// Run: node framework/spec/check-no-molly.mjs            (checks the repo, then self-tests on a scratch tree)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Paths that must not exist (relative to the console app).
export const GONE_PATHS = ['plugins/molly-guide', 'plugins/agent-manager/addons/molly'];

// Files that may name Molly because they retire her: the add-on retirement on start and its test, the systems check
// items that clean the old app's VPS leftovers, and the build-breaker's generated history of past asks.
export const ALLOWED = [
  'plugins/agent-manager/server/__init__.py',
  'plugins/agent-manager/test.py',
  'plugins/systems-check/server/retired.py',
  'plugins/systems-check/test.py',
  'plugins/build-breaker/data/',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '__pycache__', '.vite', 'coverage']);
const TEXT = /\.(m?[jt]sx?|cjs|py|json|jsonl|md|html|css|ya?ml|toml|txt|sh)$/i;
// "molly" as its own word or id part, but not the axf-molly project.
const MOLLY = /(?<!axf-)\bmolly(?:[-_][a-z]+)?\b|_offer_molly|mollyGuide|mollyOffered/gi;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.axf-')) continue; // local preview files carry the worktree path
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile() && st.size < 4_000_000) yield p;
  }
}

/** Every problem under a console app folder: removed paths that came back, files named after Molly, and mentions. */
export function findMolly(appDir) {
  const problems = [];
  for (const p of GONE_PATHS) if (existsSync(join(appDir, p))) problems.push(`${p}: removed, must not come back`);
  for (const file of walk(appDir)) {
    const rel = relative(appDir, file).split('\\').join('/');
    if (ALLOWED.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a))) continue;
    if (/(?<!axf-)molly/i.test(rel.split('/').pop())) { problems.push(`${rel}: file named after Molly`); continue; }
    if (!TEXT.test(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hits = line.match(MOLLY);
      if (hits) problems.push(`${rel}:${i + 1}: ${hits.join(', ')}`);
    });
  }
  return problems;
}

// 1. The console as it is now.
const console_ = join(ROOT, 'apps/console-web');
const found = findMolly(console_);
if (found.length) {
  console.error(`Molly is back in the console (${found.length}):\n  ${found.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}
console.log('ok the console has no molly-guide, Molly add-on bundle or _offer_molly');

// 2. The retirement on start still names the old add-on, and no bundle folder ships it.
const am = readFileSync(join(console_, 'plugins/agent-manager/server/__init__.py'), 'utf8');
assert.match(am, /RETIRED_ADDONS = \([^)]*"molly"/, 'agent-manager keeps retiring an installed Molly copy');
assert.doesNotMatch(am, /def _offer_molly|_offer_molly\(\)/, 'no _offer_molly auto-install');
console.log('ok agent-manager retires an installed copy and does not offer one');

// 3. Self-test: the guard fails on each way Molly could come back, and passes on axf-molly and the allowed files.
const tmp = mkdtempSync(join(tmpdir(), 'no-molly-'));
const put = (rel, body) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
try {
  put('src/App.tsx', "export const owner = 'axf-molly';\n");
  put('plugins/agent-manager/server/__init__.py', 'RETIRED_ADDONS = ("molly",)\n');
  put('plugins/build-breaker/data/asks.jsonl', '{"plugin":"molly-guide"}\n');
  assert.deepEqual(findMolly(tmp), [], 'axf-molly and the allowed files pass');
  const fails = (rel, body, why) => {
    put(rel, body);
    assert.ok(findMolly(tmp).length > 0, `the guard catches ${why}`);
    rmSync(join(tmp, rel.split('/')[0]), { recursive: true, force: true });
    put('src/App.tsx', "export const owner = 'axf-molly';\n");
    put('plugins/agent-manager/server/__init__.py', 'RETIRED_ADDONS = ("molly",)\n');
    put('plugins/build-breaker/data/asks.jsonl', '{"plugin":"molly-guide"}\n');
  };
  fails('plugins/molly-guide/plugin.json', '{}', 'the molly-guide plugin folder');
  fails('plugins/agent-manager/addons/molly/addon.json', '{}', 'the Molly add-on bundle');
  fails('plugins/agent-manager/server/boot.py', '_offer_molly()\n', 'the _offer_molly auto-install');
  fails('src/boot.ts', "rt.open('molly-guide');\n", 'a console boot line that opens the guide');
  fails('src/assets/molly-welcome.svg', '<svg/>', 'a popup asset named after Molly');
  console.log('ok self-test: each way back is caught; axf-molly and the retirement files pass');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
