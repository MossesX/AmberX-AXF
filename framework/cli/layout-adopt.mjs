#!/usr/bin/env node
/**
 * layout-adopt — move px breakpoints onto the layout's viewport attributes (every layout parameter is a token,
 * Nov 2026, build token-control s2).
 *
 *   node framework/cli/layout-adopt.mjs <path…> [--check] [--layout <asset.json>]
 *
 * CSS media queries can't read a custom property, so a stylesheet can't follow the layout asset's cut-offs
 * (tinyMaxWidth 480 / smallMaxWidth 640 / phoneMaxWidth 760 / mediumMaxWidth 900 / largeMaxWidth 1200). The runtime
 * watches them and stamps data-fx-tiny / -small / -narrow / -medium / -large on the root. This tool rewrites
 *
 *   @media (max-width: 640px) { .a, .b { … } .c { … } }
 *   @media (min-width: 761px) { .d { … } }
 * into
 *   :where([data-fx-small]) .a, :where([data-fx-small]) .b { … } :where([data-fx-small]) .c { … }
 *   :where(:not([data-fx-narrow])) .d { … }
 *
 * `:where()` adds no specificity, so the cascade is the one the media query had. A px lands on the smallest cut-off at
 * or above it (720 → narrow, 900 → medium, 1500 → large); above the largest cut-off there is no attribute, so the block
 * is left and reported. Blocks it can't rewrite safely (a compound media list, a nested at-rule, a `${}` in a CSS
 * template) are left and reported; those are fixed by hand. `--check` lists what would change and exits 1 if anything.
 * In .ts/.tsx files only CSS inside template strings is touched (the same text rewrite).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutBreakpointAttr } from '../core/engines/layout-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const MEDIA = /@media\s*(?:screen\s+and\s*)?\(\s*(max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*\{/g;

/** Index of the `}` closing the block whose `{` is at `open`, or -1. */
function closeOf(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level `selector { body }` rules of a block's inner text (comments and whitespace between them are kept in order). */
function rulesOf(inner) {
  const out = [];
  let i = 0;
  while (i < inner.length) {
    const open = inner.indexOf('{', i);
    if (open < 0) { if (inner.slice(i).trim()) out.push({ text: inner.slice(i) }); break; }
    const close = closeOf(inner, open);
    if (close < 0) return null;
    const head = inner.slice(i, open);
    // a comment before the selector stays as is
    const m = head.match(/^([\s\S]*?)(\s*)([^/{}]*)$/);
    const lead = m ? m[1] + m[2] : '';
    const selector = (m ? m[3] : head).trim();
    if (!selector) return null;
    out.push({ lead, selector, body: inner.slice(open, close + 1) });
    i = close + 1;
  }
  return out;
}

/** A selector list split on its top-level commas only (a comma inside :is() / :has() / :not() / an attribute stays). */
export function splitSelectors(list) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of list) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Rewrite one source; returns { out, changed: [...], left: [...] }. */
export function adoptLayoutSource(src, layout = null) {
  const changed = [];
  const left = [];
  let out = '';
  let last = 0;
  MEDIA.lastIndex = 0;
  let m;
  while ((m = MEDIA.exec(src))) {
    const start = m.index;
    const open = start + m[0].length - 1;
    const close = closeOf(src, open);
    const line = src.slice(0, start).split('\n').length;
    const kind = m[1];
    const px = Number(m[2]);
    const bp = layoutBreakpointAttr(px, kind, layout);
    const inner = close < 0 ? '' : src.slice(open + 1, close);
    const why = close < 0 ? 'unbalanced braces' : !bp ? `no cut-off at or above ${px}px (the largest is largeMaxWidth); choose a cut-off or drop the rule` : /\$\{/.test(inner) ? 'a ${} expression inside the block' : /@[a-z-]+\s*[^;{]*\{/.test(inner) ? 'a nested at-rule' : null;
    if (why) { left.push({ line, px, kind, why }); MEDIA.lastIndex = close < 0 ? src.length : close + 1; continue; }
    const rules = rulesOf(inner);
    if (!rules || rules.some((r) => r.text !== undefined)) { left.push({ line, px, kind, why: 'declarations the tool can\'t split into rules' }); MEDIA.lastIndex = close + 1; continue; }
    const prefix = bp.negate ? `:where(:not([${bp.attr}])) ` : `:where([${bp.attr}]) `;
    const indent = (src.slice(0, start).match(/(^|\n)([ \t]*)$/) ?? ['', '', ''])[2];
    const oneLine = !inner.includes('\n');
    const pieces = rules.map((r) => {
      const sel = splitSelectors(r.selector).map((s) => prefix + s).join(', ');
      return `${sel} ${r.body}`;
    });
    const text = oneLine ? pieces.join(' ') : pieces.map((p, i) => (i === 0 ? p : `\n${indent}${p}`)).join('');
    out += src.slice(last, start) + text;
    last = close + 1;
    changed.push({ line, px, kind, attr: bp.attr, rules: rules.length });
    MEDIA.lastIndex = close + 1;
  }
  out += src.slice(last);
  return { out, changed, left };
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'vendor' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(css|tsx?)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const li = args.indexOf('--layout');
  const layout = li >= 0 ? JSON.parse(readFileSync(args[li + 1], 'utf8')).data : null;
  const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--layout');
  if (!paths.length) { console.log('usage: node framework/cli/layout-adopt.mjs <path…> [--check] [--layout <asset.json>]'); process.exit(2); }
  let files = 0, blocks = 0, leftovers = 0;
  for (const f of paths.flatMap((p) => walk(resolve(p))).filter((f) => !f.includes(`${'/'}src${'/'}axf${'/'}`))) {
    const src = readFileSync(f, 'utf8');
    if (!/@media/.test(src)) continue;
    const { out, changed, left } = adoptLayoutSource(src, layout);
    const rel = relative(ROOT, f);
    for (const c of changed) console.log(`${rel}:${c.line}  ${check ? 'would move' : 'moved'} @media (${c.kind}-width: ${c.px}px) → :where(${c.kind === 'min' ? ':not(' : ''}[${c.attr}]${c.kind === 'min' ? ')' : ''}) (${c.rules} rule${c.rules === 1 ? '' : 's'})`);
    for (const l of left) { leftovers++; console.log(`${rel}:${l.line}  left @media (${l.kind}-width: ${l.px}px): ${l.why}`); }
    if (changed.length) { files++; blocks += changed.length; if (!check) writeFileSync(f, out); }
  }
  console.log(`${check ? 'would move' : 'moved'} ${blocks} media block(s) in ${files} file(s)${leftovers ? `, ${leftovers} left for a hand fix` : ''}`);
  process.exit(check && (blocks || leftovers) ? 1 : 0);
}
