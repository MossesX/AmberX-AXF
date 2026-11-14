#!/usr/bin/env node
/**
 * component-tokens@1 CLI (build own-token-sets-for-grids-and-tab-groups): the grid and tab-group token families
 * (core/engines/component-tokens.mjs is the one schema) as a list, as the :root defaults block axf.css carries, and
 * the writer that keeps that block equal to the schema.
 *
 *   node framework/cli/component-tokens.mjs list [grid|tabs] [--json]   every token: path, variable, kind, level, default, description
 *   node framework/cli/component-tokens.mjs css                          the :root block (what axf.css must carry)
 *   node framework/cli/component-tokens.mjs write                        rewrite the block in framework/ui/axf.css
 *   node framework/cli/component-tokens.mjs check                        exit 1 when any copy's block differs from the schema
 *
 * Values a skin or an instance may set are the engine's (componentTokenValue); the Token control plugin reaches the
 * same tokens as control@1 `tokens.style grid.<token> | tabs.<token>` and `tokens.instances <family>.<instance>.<token>`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_TOKEN_FAMILIES, componentTokenList } from '../core/engines/component-tokens.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CSS_BEGIN = '  /* component-tokens@1 begin (generated: node framework/cli/component-tokens.mjs write; the CI check keeps it equal to core/engines/component-tokens.mjs) */';
export const CSS_END = '  /* component-tokens@1 end */';

/** The :root lines: one per token, family by family, each default exactly as the schema says. */
export function componentTokensCss() {
  const lines = [CSS_BEGIN];
  for (const [family, fam] of Object.entries(COMPONENT_TOKEN_FAMILIES)) {
    lines.push(`  /* ${fam.label} (${fam.prefix}*): ${fam.doc} */`);
    for (const x of componentTokenList().filter((x) => x.family === family)) lines.push(`  ${x.var}: ${x.default};`);
  }
  lines.push(CSS_END);
  return lines.join('\n');
}

/** The stylesheet that carries the block: framework/ui/axf.css (apps' src/axf copies are baked from it at build time, never edited by hand). */
export function cssFiles() {
  return [join(ROOT, 'framework/ui/axf.css')];
}

/** The block a stylesheet carries now, or null when it has none. */
export function blockIn(css) {
  const a = css.indexOf(CSS_BEGIN);
  const b = css.indexOf(CSS_END);
  return a >= 0 && b > a ? css.slice(a, b + CSS_END.length) : null;
}

/** The stylesheet with the block replaced (or inserted at the end of the first :root rule). */
export function withBlock(css) {
  const block = componentTokensCss();
  const cur = blockIn(css);
  if (cur) return css.replace(cur, block);
  const root = css.indexOf(':root {');
  const close = css.indexOf('\n}', root);
  if (root < 0 || close < 0) throw new Error('no :root rule to put the component tokens in');
  return `${css.slice(0, close)}\n${block}${css.slice(close)}`;
}

/** Files whose block is missing or stale. */
export function staleFiles() {
  return cssFiles().filter((f) => blockIn(readFileSync(f, 'utf8')) !== componentTokensCss());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'list', ...rest] = process.argv.slice(2);
  const json = rest.includes('--json');
  if (cmd === 'list') {
    const fam = rest.find((a) => !a.startsWith('--'));
    const rows = componentTokenList().filter((x) => !fam || x.family === fam);
    if (json) console.log(JSON.stringify(rows, null, 2));
    else for (const x of rows) console.log(`${x.path.padEnd(30)} ${x.var.padEnd(34)} ${x.kind.padEnd(8)} ${x.level.padEnd(9)} ${x.default.padEnd(40)} ${x.description}`);
    if (!json) console.log(`${rows.length} token(s)`);
  } else if (cmd === 'css') {
    console.log(componentTokensCss());
  } else if (cmd === 'write') {
    for (const f of cssFiles()) { const css = readFileSync(f, 'utf8'); const next = withBlock(css); if (next !== css) { writeFileSync(f, next); console.log(`wrote ${relative(ROOT, f)}`); } }
  } else if (cmd === 'check') {
    const stale = staleFiles();
    if (stale.length) { console.log(`component tokens: ${stale.length} stylesheet(s) differ from the schema (run node framework/cli/component-tokens.mjs write):\n  ${stale.map((f) => relative(ROOT, f)).join('\n  ')}`); process.exit(1); }
    console.log(`component tokens: ${cssFiles().length} stylesheet(s) carry the schema's ${componentTokenList().length} defaults`);
  } else {
    console.log('usage: component-tokens.mjs list [grid|tabs] [--json] | css | write | check');
    process.exit(2);
  }
}
