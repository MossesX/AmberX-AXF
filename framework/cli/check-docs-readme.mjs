#!/usr/bin/env node
/**
 * Every build ships a basic readme (Brett, Nov 4 2026): a change that adds a new plugin, app or module folder must add
 * `docs/README.md` inside it in the same PR. Plain Markdown, no docs engine. Folders that already exist on the base are
 * grandfathered (they get a readme, or a section in one, when a build changes them; that part is a brief rule, not CI).
 *
 *   node framework/cli/check-docs-readme.mjs [--base <ref>] [--self-test]
 *
 * Base: --base, else AXF_DOCS_BASE, else HEAD^1 in GitHub Actions (a PR checkout is the merge commit, whose first
 * parent is the base branch; a push to main compares with the previous commit; needs fetch-depth 2), else the merge
 * base with origin/main. No base reachable = skipped with a note, never a false failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where new module folders live: a pattern of path segments, `*` = the folder's own name. Open list: add roots here. */
export const ROOTS = [
  ['apps', '*', 'plugins', '*'],
  ['apps', '*'],
  ['framework', 'libs', '*'],
  ['framework', 'android', '*'],
];

/** The module folder an added file belongs to, or null (most specific root first). */
export function moduleOf(file) {
  const parts = file.split('/');
  for (const root of ROOTS) {
    if (parts.length <= root.length) continue;   // a file right in the root (apps/README.md) is not a module
    if (root.every((seg, i) => seg === '*' ? !parts[i].startsWith('.') : seg === parts[i])) return parts.slice(0, root.length).join('/');
  }
  return null;
}

/** New module folders (in `added`, absent from the base) that lack docs/README.md. */
export function missingReadmes(added, { existedOnBase, hasFile }) {
  const mods = [...new Set(added.map(moduleOf).filter(Boolean))].sort();
  return mods.filter((m) => !existedOnBase(m) && !hasFile(`${m}/docs/README.md`));
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

function selfTest() {
  const assert = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); };
  assert(moduleOf('apps/console-web/plugins/foo/plugin.json') === 'apps/console-web/plugins/foo', 'plugin file → plugin folder');
  assert(moduleOf('apps/newapp/package.json') === 'apps/newapp', 'app file → app folder');
  assert(moduleOf('framework/libs/tree/core.ts') === 'framework/libs/tree', 'library file → library folder');
  assert(moduleOf('framework/android/lib-x/build.gradle.kts') === 'framework/android/lib-x', 'android module');
  assert(moduleOf('apps/README.md') === null && moduleOf('framework/core/x.ts') === null, 'files outside module roots are ignored');
  const old = new Set(['apps/console-web', 'apps/console-web/plugins/old']);
  const env = (files) => ({ existedOnBase: (m) => old.has(m), hasFile: (f) => files.includes(f) });
  const added = ['apps/console-web/plugins/old/new.mjs', 'apps/console-web/plugins/fresh/plugin.json', 'apps/console-web/plugins/fresh/x.mjs'];
  assert(missingReadmes(added, env([])).join() === 'apps/console-web/plugins/fresh', 'new plugin without a readme fails, the old one is grandfathered');
  assert(missingReadmes(added, env(['apps/console-web/plugins/fresh/docs/README.md'])).length === 0, 'new plugin with docs/README.md passes');
  console.log('check-docs-readme: self-test passed');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const at = args.indexOf('--base');
  let base = at >= 0 ? args[at + 1] : process.env.AXF_DOCS_BASE;
  if (!base) base = process.env.GITHUB_ACTIONS ? 'HEAD^1' : tryGit('merge-base', 'origin/main', 'HEAD');
  if (!base || tryGit('rev-parse', '--verify', '--quiet', `${base}^{commit}`) === null) {
    console.log(`check-docs-readme: skipped (base ${base || 'origin/main'} not reachable; CI needs fetch-depth: 2)`);
    return;
  }
  const root = git('rev-parse', '--show-toplevel');
  const added = (tryGit('diff', '--name-only', '--diff-filter=A', base, 'HEAD') || '').split('\n').filter(Boolean);
  const missing = missingReadmes(added, {
    existedOnBase: (m) => tryGit('cat-file', '-e', `${base}:${m}`) !== null,
    hasFile: (f) => existsSync(join(root, f)),
  });
  if (!missing.length) { console.log(`check-docs-readme: ok (${added.length} added file(s) checked against ${base})`); return; }
  for (const m of missing) console.error(`✗ ${m}: new folder without ${m}/docs/README.md (what it does, how to use it, commands, troubleshooting; plain Markdown)`);
  console.error('check-docs-readme: every build ships a basic Markdown readme for the plugin / app / module it adds (_claude/rules/RULES.md).');
  process.exit(1);
}

main();
