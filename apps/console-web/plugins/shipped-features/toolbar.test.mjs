#!/usr/bin/env node
/** The Shipped features toolbar (toolbar:shipped-features): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'shipped-features.json': ['sync','import','backfill'] }, { label: 'Shipped features toolbar' });
