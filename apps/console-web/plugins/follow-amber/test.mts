// @ts-nocheck: a Node test, not part of the console's build
/**
 * Follow Amber self-test (the plugins' test.mts glob runs this with plain node). The pure part imports the framework
 * through the console's `@console/*` paths, so it runs under tsx with the console's tsconfig: web/check.mts.
 *
 *   node --experimental-strip-types apps/console-web/plugins/follow-amber/test.mts
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync('npx', ['-y', 'tsx', '--tsconfig', join(here, '..', '..', 'tsconfig.json'), join(here, 'web', 'check.mts')], { stdio: 'inherit', cwd: join(here, '..', '..') });
process.exit(r.status ?? 1);
