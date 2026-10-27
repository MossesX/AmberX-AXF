#!/usr/bin/env node
/** Installs this AX Notes plugin: Gradle include, app dependency, plugin-list entry (see lifecycle.mjs). --dry-run, --json. */
import { main } from './lifecycle.mjs';
main('install', process.argv.slice(2));
