#!/usr/bin/env node
/** The Claude handoff toolbars (look roller, files): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'claude-handoff-look.json': ['roll', 'undo', 'tokens', 'reset'], 'claude-handoff-files.json': ['refresh'] }, { label: 'Claude handoff toolbars' });
