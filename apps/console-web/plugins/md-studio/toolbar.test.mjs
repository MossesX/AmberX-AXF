#!/usr/bin/env node
/** The MD Studio toolbar (toolbar:md-studio): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'md-studio.json': ['save', 'edit', 'layouts', 'reload'] }, { label: 'MD Studio toolbar' });
