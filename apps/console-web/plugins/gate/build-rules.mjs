#!/usr/bin/env node
/**
 * Build rules CLI (build-rules@1): the same ops as REST /api/plugins/gate/build-rules…, the gate_build_rules_* MCP tools
 * and the voice actions gate.build-rules.*. `axf gate build-rules …` reaches the same code through gate.mjs.
 *
 *   node apps/console-web/plugins/gate/build-rules.mjs list [--doer vps|session] [--kind k] [--phase p] [--enabled b] [--q text]
 *   node apps/console-web/plugins/gate/build-rules.mjs get <id> | on <id> | off <id> | delete <id> [--confirm t]
 *   node apps/console-web/plugins/gate/build-rules.mjs add <id> --title "…" --text "…" --doer … --kind … --phase …
 *   node apps/console-web/plugins/gate/build-rules.mjs edit <id> <field> <value>
 *   node apps/console-web/plugins/gate/build-rules.mjs history [id] | runs [id] | run <build> --phase p [--dry-run] | brief <build>
 *   --json prints the record; --by and --reason say who and why. Exit 0 ok · 1 failed · 2 usage · 3 confirm first.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './gate.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  main(argv.length ? ['build-rules', ...argv] : ['build-rules', 'list']).then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message ?? e); process.exitCode = 1; });
}
