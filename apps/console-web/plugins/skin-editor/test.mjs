#!/usr/bin/env node
/**
 * Web model self-test (plain node): the pure helpers the Skin editor page relies on, over the engine.
 *   node apps/console-web/plugins/skin-editor/test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_RANK, classifyToken, normalizeToken, searchTokens, tokensAtLevel } from '../../../../framework/core/engines/token-registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const registry = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/token-registry.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/console-web/plugins/skin-editor/plugin.json'), 'utf8'));
let n = 0;
const ok = (name, cond) => { n++; if (!cond) { console.error(`FAIL ${name}`); process.exitCode = 1; } else console.log(`  ok  ${name}`); };

// the registry the page lists
ok('registry has the basics', ['--fx-bg', '--fx-accent', '--fx-font', '--fx-space', '--fx-radius-md'].every((id) => registry.tokens.some((t) => t.id === id && t.level === 'basic')));
ok('every token has a plain sentence', registry.tokens.every((t) => /[.!?]$/.test(t.description) && t.description.length > 8));
ok('levels nest', tokensAtLevel(registry.tokens, 'basic').length < tokensAtLevel(registry.tokens, 'pro').length && tokensAtLevel(registry.tokens, 'pro').length < tokensAtLevel(registry.tokens, 'advanced').length);
ok('search by words hits the description', searchTokens(registry.tokens, { q: 'accent' }).some((t) => t.id === '--fx-accent'));
ok('control sets recorded for the themed tokens', registry.tokens.find((t) => t.id === '--fx-accent')?.set?.target === 'tokens.theme' && registry.tokens.find((t) => t.id === '--fx-radius-md')?.set?.path === 'radius.md');
ok('layout tokens are advanced', registry.tokens.filter((t) => t.id.startsWith('--fx-layout-')).every((t) => t.level === 'advanced' && t.area === 'layout'));
ok('state read from names', classifyToken('--fx-btn-bg-hover').state === 'hover' && classifyToken('--fx-grid-row-bg-selected').state === 'selected');
ok('normalizeToken fills from the name', normalizeToken({ id: '--fx-tab-bar-bg', source: 'test' })?.element === 'tab-group');
ok('level ranks', LEVEL_RANK.basic < LEVEL_RANK.pro && LEVEL_RANK.pro < LEVEL_RANK.advanced);

// the manifest registers what the plugin reads (the CI check enforces it; this is the quick local version)
const css = readFileSync(join(ROOT, 'apps/console-web/plugins/skin-editor/web/skin-editor.css'), 'utf8');
const read = new Set([...css.matchAll(/--fx-[a-z0-9]+(?:-[a-z0-9]+)*/g)].map((m) => m[0]));
ok('manifest tokens.uses covers the stylesheet', [...read].every((id) => manifest.tokens.uses.includes(id)));
ok('every used token is registered', manifest.tokens.uses.every((id) => registry.tokens.some((t) => t.id === id)));

console.log(process.exitCode ? `\n${n} checks, failures above` : `\nall good (${n} checks)`);
