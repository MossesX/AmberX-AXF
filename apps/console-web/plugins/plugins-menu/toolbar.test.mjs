#!/usr/bin/env node
/** The Plugins menu toolbar (toolbar:plugins-menu): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'plugins-menu.json': ['list', 'reload', 'settings'] }, { label: 'Plugins menu toolbar' });
