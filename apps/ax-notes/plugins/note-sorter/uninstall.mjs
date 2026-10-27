#!/usr/bin/env node
/**
 * Uninstalls this AX Notes plugin completely: removes every marked line and its plugin-list entry, then checks nothing
 * outside the folder still names it (exit 1 if something does). --all also deletes the folder. --dry-run, --json, --check.
 */
import { main } from './lifecycle.mjs';
main('uninstall', process.argv.slice(2));
