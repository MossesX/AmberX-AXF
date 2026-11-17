#!/usr/bin/env node
/**
 * The merge queue toolbar (toolbar:push-banner.merge-queue): wired, drawn and reachable by deep link, REST, MCP, CLI and
 * voice. Merging stays with the queue: no button merges a PR itself.
 */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'push-banner-merge-queue.json': ['add', 'up', 'down', 'remove', 'run', 'ci', 'red'] }, { forbid: /\/(merge|merge-branch|auto-merge-run|pr)$/, label: 'Merge queue toolbar' });
