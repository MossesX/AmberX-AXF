#!/usr/bin/env node
/** Plan Studio's toolbar (toolbar:plan-studio): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'plan-studio-plans.json': ['new', 'search', 'park', 'build', 'category', 'media'] }, { label: 'Plan Studio toolbar' });
