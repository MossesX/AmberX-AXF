#!/usr/bin/env node
// Uninstalls this plugin from AX Notes: takes it out of app/src/main/assets/axnotes/plugins.json so it is no longer
// compiled or loaded; the app deletes its data, settings, generated lists and triggers on the phone at the next launch.
//   --all      also delete this folder and its tagged doc lines (<!-- axf-plugin:<folder> -->)
//   --dry-run  show what would change
// Ends with `manage.mjs check <folder> --after-uninstall` (nothing may still name the plugin). See ../manage.mjs.
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../manage.mjs';

process.exit(run(['uninstall', basename(dirname(fileURLToPath(import.meta.url))), ...process.argv.slice(2)]));
