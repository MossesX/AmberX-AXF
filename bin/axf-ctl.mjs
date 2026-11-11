#!/usr/bin/env node
// `axf-ctl …` = `axf ctl …`: the control registry on the command line (apps/console-web/lib/registry/cli.mjs).
import { main } from '../apps/console-web/lib/registry/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
