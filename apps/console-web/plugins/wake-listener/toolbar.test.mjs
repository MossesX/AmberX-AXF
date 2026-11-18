#!/usr/bin/env node
/** The Wake word toolbar (toolbar:wake-listener): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'wake-listener.json': ['on','off','claude-on','claude-off'] }, { label: 'Wake word toolbar' });
