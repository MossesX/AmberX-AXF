#!/usr/bin/env node
/** The Changes & features toolbar (toolbar:changes-grid): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'changes-grid.json': ['reload', 'collapse'] }, { label: 'Changes & features toolbar' });
