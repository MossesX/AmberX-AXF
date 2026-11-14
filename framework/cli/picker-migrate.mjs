#!/usr/bin/env node
/**
 * picker-migrate — move hand-made <select> drop-downs onto the framework's `Select` (picker@1), so they render the
 * themed PickerField while the picker swap is on and keep the native select otherwise.
 *
 *   node framework/cli/picker-migrate.mjs [--write] [--json] <file|dir>…
 *
 * Converts the common shape and leaves the rest for a person (listed as `skipped` with the reason):
 *
 *   <label …>Text<select className="fx-input …" value={V} onChange={(e) => f(e.target.value as T)} disabled={D} aria-label="…">
 *     <option value="x">X</option>                         literal rows
 *     {LIST.map((o) => <option key={…} value={…}>{…}</option>)}   one mapped list
 *   </select>
 *
 * → <Select label="Text" value={V} onChange={(v) => f(v as T)} disabled={D} options={[{ value: 'x', label: 'X' }, ...LIST.map((o) => ({ value: …, label: … }))]} />
 *
 * A row with value "" becomes `empty`. The label comes from aria-label, else the wrapping <label>'s text, else the
 * variable name. `Select` is added to the file's framework import. Dry run by default.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('--write');
const json = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));

function walk(p, out = []) {
  const st = statSync(p);
  if (st.isFile()) { if (/\.tsx$/.test(p)) out.push(p); return out; }
  for (const n of readdirSync(p)) if (!['node_modules', 'dist', 'vendor', 'axf'].includes(n) && !n.startsWith('.')) walk(join(p, n), out);
  return out;
}

/** The end of a JSX expression container starting at `{` (balanced braces, strings skipped). */
function braceEnd(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch === "'" || ch === '"' || ch === '`') { const q = ch; k++; while (k < s.length && s[k] !== q) { if (s[k] === '\\') k++; k++; } continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return k; }
  }
  return -1;
}

/** Attributes of an opening tag body: name → raw value (`"…"` or `{…}`), in order. */
function attrsOf(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const m = /^\s*([A-Za-z-]+)(=)?/.exec(body.slice(i));
    if (!m) break;
    i += m[0].length;
    if (!m[2]) { out.push([m[1], 'true']); continue; }
    if (body[i] === '"') { const e = body.indexOf('"', i + 1); out.push([m[1], body.slice(i, e + 1)]); i = e + 1; }
    else if (body[i] === '{') { const e = braceEnd(body, i); if (e < 0) return null; out.push([m[1], body.slice(i, e + 1)]); i = e + 1; }
    else return null;
  }
  return body.slice(i).trim() ? null : out;
}

const jsStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const inner = (raw) => (raw.startsWith('{') ? raw.slice(1, -1).trim() : jsStr(raw.slice(1, -1)));

function convertOne(open, children, before) {
  const attrs = attrsOf(open);
  if (!attrs) return { skip: 'attributes it cannot read' };
  const a = Object.fromEntries(attrs);
  if (a.multiple || a.size) return { skip: 'multiple / size' };
  if (!a.value || !a.onChange) return { skip: 'uncontrolled (no value / onChange)' };
  for (const k of Object.keys(a)) if (!['className', 'value', 'onChange', 'disabled', 'aria-label', 'title', 'style', 'key', 'id', 'required'].includes(k)) return { skip: `attribute ${k}` };
  // onChange: (e) => body using e.target.value only
  const h = /^\{\s*\(?\s*(\w+)\s*\)?\s*=>\s*([\s\S]+)\}$/.exec(a.onChange);
  if (!h) return { skip: 'onChange is not an inline arrow' };
  const [, ev, bodyRaw] = h;
  // the new parameter must not shadow a name the handler already uses
  const param = ['v', 'next', 'picked', 'chosen'].find((n) => !new RegExp(`\\b${n}\\b`).test(bodyRaw)) ?? 'pickedValue';
  const body = bodyRaw.replace(new RegExp(`\\b${ev}\\.(?:currentTarget|target)\\.value\\b`, 'g'), param);
  if (new RegExp(`\\b${ev}\\b`).test(body)) return { skip: 'onChange uses the event beyond its value' };
  // children
  let rest = children.trim();
  const rows = [];
  let empty;
  while (rest) {
    let m;
    if ((m = /^<option(\s[^>]*)?>([^<{]*)<\/option>/.exec(rest))) {
      const oa = attrsOf(m[1] ?? '') ?? [];
      const o = Object.fromEntries(oa);
      const text = m[2].trim();
      const value = o.value !== undefined ? inner(o.value) : jsStr(text);
      if (value === "''") empty = jsStr(text);
      else rows.push(`{ value: ${value}, label: ${jsStr(text)}${o.disabled ? `, disabled: ${o.disabled === 'true' ? 'true' : inner(o.disabled)}` : ''} }`);
      rest = rest.slice(m[0].length).trim();
      continue;
    }
    if ((m = /^<option(\s[^>]*)?>\{([^{}]+)\}<\/option>/.exec(rest))) {
      const o = Object.fromEntries(attrsOf(m[1] ?? '') ?? []);
      const label = m[2].trim();
      const value = o.value !== undefined ? inner(o.value) : label;
      if (value === "''") empty = label;
      else rows.push(`{ value: ${value}, label: ${label} }`);
      rest = rest.slice(m[0].length).trim();
      continue;
    }
    if (rest.startsWith('{')) {
      const e = braceEnd(rest, 0);
      const expr = rest.slice(1, e).trim();
      const mm = /^([\s\S]+?)\.map\(\(?\s*(\w+)(?:\s*,\s*\w+)?\s*\)?\s*=>\s*\(?\s*<option((?:\s+[A-Za-z-]+=(?:"[^"]*"|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}))*)\s*>([\s\S]*?)<\/option>\s*\)?\s*\)$/.exec(expr);
      if (!mm) return { skip: 'option list it cannot read' };
      const [, list, it, oattrs, text] = mm;
      const o = Object.fromEntries(attrsOf(oattrs) ?? []);
      const t = text.trim();
      const label = /^\{[^{}]+\}$/.test(t) ? t.slice(1, -1).trim() : /^[^{}<]+$/.test(t) ? jsStr(t) : `\`${t.replace(/\{/g, '${')}\``;
      const value = o.value !== undefined ? inner(o.value) : o.key !== undefined ? inner(o.key) : label;
      const extra = [o.disabled ? `disabled: ${inner(o.disabled)}` : '', o.title ? `title: ${inner(o.title)}` : ''].filter(Boolean).join(', ');
      const str = (x) => (/^['`]/.test(x) || /^String\(/.test(x) ? x : `String(${x})`);
      const l0 = list.trim();
      const l = l0.endsWith('?') ? `${l0.slice(0, -1)}?` : l0;
      rows.push(`...${l.includes('?.') ? `(${l} ?? [])` : l}.map((${it}) => ({ value: ${str(value)}, label: ${str(label)}${extra ? `, ${extra}` : ''} }))`);
      rest = rest.slice(e + 1).trim();
      continue;
    }
    return { skip: 'option rows it cannot read' };
  }
  if (!rows.length) return { skip: 'no options' };
  const lab = a['aria-label'] ? a['aria-label'] : (() => {
    // the wrapping <label>'s own text right before the select
    const inLabel = before.lastIndexOf('<label') > before.lastIndexOf('</label');
    const t = inLabel ? before.slice(before.lastIndexOf('>') + 1).trim() : '';
    if (t && /^[^<>{}]+$/.test(t)) return `"${t.replace(/"/g, '&quot;')}"`;
    const v = inner(a.value).replace(/^String\(|\)$/g, '').split(/[.\s?()]/).filter((w) => /^[A-Za-z]\w*$/.test(w)).pop() ?? 'Choose';
    return `"${v.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())}"`;
  })();
  const cls = a.className ? (a.className.startsWith('"') ? a.className.replace(/\bfx-input\b\s*/, '').replace(/\s*"$/, '"') : a.className) : '';
  const parts = [
    `label=${lab}`,
    `value=${a.value}`,
    `onChange={(${param}) => ${body.trim()}}`,
    ...(cls && cls !== '""' ? [`className=${cls}`] : []),
    ...['disabled', 'title', 'style', 'key'].filter((k) => a[k]).map((k) => `${k}=${a[k]}`),
    ...(empty ? [`empty={${empty}}`] : []),
    rows.length === 1 && rows[0].startsWith('...') ? `options={${rows[0].slice(3)}}` : `options={[${rows.join(', ')}]}`,
  ];
  return { out: `<Select ${parts.join(' ')} />` };
}

export function migrate(src) {
  let out = '';
  let i = 0;
  const done = [];
  const skipped = [];
  const re = /<select\b/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    // the opening tag ends at the first '>' outside braces / strings
    let k = start + 7;
    let depth = 0;
    for (; k < src.length; k++) {
      const ch = src[k];
      if (ch === '{') { const e = braceEnd(src, k); k = e; continue; }
      if (ch === '"') { k = src.indexOf('"', k + 1); continue; }
      if (ch === '>' && depth === 0) break;
    }
    const close = src.indexOf('</select>', k);
    if (close < 0) continue;
    const line = src.slice(0, start).split('\n').length;
    const r = convertOne(src.slice(start + 7, k), src.slice(k + 1, close), src.slice(Math.max(0, start - 200), start));
    if (r.skip) { skipped.push({ line, why: r.skip }); continue; }
    out += src.slice(i, start) + r.out;
    i = close + '</select>'.length;
    re.lastIndex = i;
    done.push(line);
  }
  out += src.slice(i);
  if (done.length && !/\bSelect\b[^;]*from '[^']*axf\/react'/.test(out)) {
    const imp = /import \{([^}]*)\} from '((?:@console\/axf|(?:\.\.\/)+(?:src\/)?axf|(?:\.\.\/)+)\/react)';/.exec(out);
    if (imp) out = out.replace(imp[0], `import {${imp[1].replace(/\s*$/, '')}, Select } from '${imp[2]}';`.replace(/\{\s*,/, '{ ').replace(/,\s*,/g, ','));
    else out = `import { Select } from '@console/axf/react';\n` + out;
  }
  return { out, done, skipped };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const report = [];
  for (const p of paths) for (const f of walk(p)) {
    const src = readFileSync(f, 'utf8');
    if (!/<select\b/.test(src)) continue;
    const r = migrate(src);
    report.push({ file: f, converted: r.done.length, skipped: r.skipped });
    if (write && r.done.length) writeFileSync(f, r.out);
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else for (const r of report) console.log(`${r.converted ? '✓' : '·'} ${r.file}: ${r.converted} converted${r.skipped.length ? `, ${r.skipped.length} left (${r.skipped.map((s) => `${s.line}: ${s.why}`).join('; ')})` : ''}`);
  const n = report.reduce((a, r) => a + r.converted, 0);
  const left = report.reduce((a, r) => a + r.skipped.length, 0);
  if (!json) console.log(`${write ? 'converted' : 'would convert'} ${n}, left ${left}`);
}
