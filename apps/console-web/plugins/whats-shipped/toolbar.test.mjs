#!/usr/bin/env node
/** The What's shipped toolbar (toolbar:whats-shipped): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'whats-shipped.json': ['mark-read', 'check', 'settings'] }, { label: "What's shipped toolbar" });
