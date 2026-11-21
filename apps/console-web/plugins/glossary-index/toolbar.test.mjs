#!/usr/bin/env node
/** The Glossary toolbar (toolbar:glossary-index): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'glossary-index.json': ['search','undescribed','drafts','rebuild','demo'] }, { label: 'Glossary toolbar' });
