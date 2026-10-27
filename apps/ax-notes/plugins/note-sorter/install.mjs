#!/usr/bin/env node
// Installs this plugin into AX Notes: adds it to app/src/main/assets/axnotes/plugins.json (checked first: manifest,
// entry class, settings sub-tab, menu hooks, dependencies). Rebuild the app afterwards. See ../manage.mjs.
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../manage.mjs';

process.exit(run(['install', basename(dirname(fileURLToPath(import.meta.url))), ...process.argv.slice(2)]));
