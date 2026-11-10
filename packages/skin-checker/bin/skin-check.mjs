#!/usr/bin/env node
/**
 * Launcher for the skin checker CLI (packages/skin-checker/src/cli.ts). The package is TypeScript with explicit .ts
 * imports: Node 22.6+ runs it directly with type stripping (on by default from 22.18); older Node goes through tsx.
 *   node packages/skin-checker/bin/skin-check.mjs check fresh --json
 * Same arguments and exit codes as `axf skin …` (see cli.ts).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const [major, minor] = process.versions.node.split('.').map(Number);
const strips = major > 22 || (major === 22 && minor >= 6);
const cmd = strips
  ? [process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, ...process.argv.slice(2)]]
  : ['npx', ['-y', 'tsx', CLI, ...process.argv.slice(2)]];
const r = spawnSync(cmd[0], cmd[1], { stdio: 'inherit' });
if (r.error) {
  process.stderr.write(`skin-check: could not start ${cmd[0]}: ${r.error.message}\n`);
  process.exit(2);
}
process.exit(r.status ?? 2);
