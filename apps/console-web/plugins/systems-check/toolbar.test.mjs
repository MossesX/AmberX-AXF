#!/usr/bin/env node
/** The Systems check toolbar (toolbar:systems-check): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'systems-check.json': ['run', 'fix-all', 'mute', 'source'] }, { label: 'Systems check toolbar' });
