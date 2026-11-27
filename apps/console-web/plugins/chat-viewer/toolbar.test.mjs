#!/usr/bin/env node
/** The Chats toolbar (toolbar:chat-viewer): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'chat-viewer.json': ['sync', 'search', 'export'] }, { label: 'Chats toolbar' });
