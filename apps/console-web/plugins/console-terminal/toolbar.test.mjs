#!/usr/bin/env node
/** The Terminal and sessions toolbar (toolbar:terminal.sessions): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'terminal-sessions.json': ['new', 'split', 'jump', 'mirror', 'copy', 'clear', 'claude'] }, { label: 'Terminal toolbar' });
