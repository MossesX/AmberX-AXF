#!/usr/bin/env node
/** The Plugin Manager toolbar (toolbar:plugin-manager): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'plugin-manager.json': ['toggle', 'settings', 'logs', 'deps', 'clashes', 'install', 'update'] }, { label: 'Plugin Manager toolbar' });
