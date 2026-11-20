#!/usr/bin/env node
/** The Build Breaker toolbar (toolbar:build-breaker): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'build-breaker.json': ['reload', 'expand', 'collapse', 'clear'] }, { label: 'Build Breaker toolbar' });
