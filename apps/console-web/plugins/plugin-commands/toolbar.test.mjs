#!/usr/bin/env node
/** The Plugin commands toolbar (toolbar:plugin-commands): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'plugin-commands.json': ['refresh'] }, { label: 'Plugin commands toolbar' });
