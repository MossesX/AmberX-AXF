#!/usr/bin/env node
/** The Sessions toolbar (toolbar:session-checkin): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'session-checkin.json': ['refresh', 'flagged', 'settings'] }, { label: 'Sessions toolbar' });
