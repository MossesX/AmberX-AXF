#!/usr/bin/env node
/** The Theme manager toolbar (toolbar:theme-manager): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'theme-manager.json': ['use', 'back', 'preview', 'scope', 'pick', 'restore'] }, { label: 'Theme manager toolbar' });
// Restore to default is destructive: drawn in the danger tone, asks first, and needs confirm through the API
const restore = JSON.parse(readFileSync(new URL('./assets/toolbar/theme-manager.json', import.meta.url), 'utf8')).data.groups.flatMap((g) => g.items).find((i) => i.id === 'restore');
assert.equal(restore.destructive, true);
assert.ok(restore.confirm);
