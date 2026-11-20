#!/usr/bin/env node
/** The Skin editor toolbars (toolbar:skin-editor, toolbar:token-registry): wired, drawn and reachable by deep link, REST, MCP, CLI and voice. */
import { pageToolbarTest } from '../../../../framework/spec/page-toolbar-test.mjs';
pageToolbarTest(import.meta.url, { 'skin-editor.json': ['pick-screen', 'pick-element', 'every-element', 'undo', 'registry'], 'token-registry.json': ['skin-editor'] }, { label: 'Skin editor toolbars' });
