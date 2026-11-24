#!/usr/bin/env node
/** The Theme editor toolbar (toolbar:theme-editor): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'theme-editor.json': ['copy', 'revert', 'copy-json', 'paste', 'load-file'] }, { label: 'Theme editor toolbar' });
