#!/usr/bin/env node
// rebuild-android-shots — files Android before/after screenshots into a rebuild's folder (rebuild log rule).
//
//   node framework/cli/rebuild-android-shots.mjs <captured dir> <rebuild dir> [--base sha] [--head sha] [--run url]
//
// <captured dir> holds <side>/<project>/{*.png,result.json} (boilerplate-capture.py output, side = before|after).
// Copies the PNGs to <rebuild dir>/shots/android/<side>/<project>/ and writes <rebuild dir>/android.md: one table
// per app, screen | before | after, with ✓ when the capture verified it reached that screen. Prints a summary.
// Only plain file names are copied (no paths from result.json are trusted). Called by rebuild-shots.yml.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const argv = process.argv.slice(2);
const [capDir, outDir] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : ''; };
if (!capDir || !outDir) { console.error('usage: rebuild-android-shots <captured> <rebuild dir> [--base] [--head] [--run]'); process.exit(2); }
const cap = resolve(capDir), out = resolve(outDir);
const SAFE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SIDES = ['before', 'after'];
const ls = (d) => { try { return readdirSync(d).filter((n) => SAFE.test(n)); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

const projects = new Set();
for (const side of SIDES) for (const p of ls(join(cap, side))) if (isDir(join(cap, side, p))) projects.add(p);
const shotsRoot = join(out, 'shots', 'android');
const results = {};
const blocked = new Set();
for (const side of SIDES) {
  for (const p of projects) {
    const src = join(cap, side, p);
    if (!isDir(src)) continue;
    const dst = join(shotsRoot, side, p);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    // An empty capture means the app blocks screenshots (FLAG_SECURE): don't file a broken image, note it instead.
    for (const f of ls(src)) if (/\.png$/i.test(f)) { if (statSync(join(src, f)).size > 0) copyFileSync(join(src, f), join(dst, f)); else blocked.add(`${side}/${p}`); }
    let r = { shots: [] };
    try { r = JSON.parse(readFileSync(join(src, 'result.json'), 'utf8')); } catch { /* no result */ }
    results[`${side}/${p}`] = new Map((r.shots ?? []).filter((s) => SAFE.test(String(s.file ?? ''))).map((s) => [String(s.screen), s]));
  }
}

const rel = (p) => relative(out, p).split('\\').join('/');
const lines = [
  '# Android screenshots — before / after',
  '',
  `Captured automatically by \`.github/workflows/rebuild-shots.yml\` on an API 34 emulator (Pixel 6, demo-mode status bar).`,
  `Before = \`${opt('base').slice(0, 12) || '?'}\`, after = \`${opt('head').slice(0, 12) || '?'}\`${opt('run') ? ` — [run](${opt('run')})` : ''}. ✓ = the capture reached that screen through the app's own nav; ? = it didn't (e.g. an app lock in front).`,
  '',
];
const summary = [];
for (const p of [...projects].sort()) {
  const b = results[`before/${p}`] ?? new Map(), a = results[`after/${p}`] ?? new Map();
  const screens = [...new Set([...b.keys(), ...a.keys()])];
  lines.push(`## ${p}`, '');
  if (blocked.has(`before/${p}`) || blocked.has(`after/${p}`)) lines.push('This app sets FLAG_SECURE (screens can\'t be captured, by design), so its captures came back empty.', '');
  lines.push('| Screen | Before | After |', '|---|---|---|');
  let changed = 0;
  for (const s of screens) {
    const cell = (side, m) => {
      const x = m.get(s);
      if (!x) return '—';
      const f = join(shotsRoot, side, p, x.file);
      if (existsSync(f)) return `${x.verified ? '✓' : '?'} <img src="${rel(f)}" width="220">`;
      return blocked.has(`${side}/${p}`) ? '🔒 blocks screenshots' : '—';
    };
    const label = (a.get(s) ?? b.get(s))?.label ?? s;
    lines.push(`| ${label} | ${cell('before', b)} | ${cell('after', a)} |`);
    if (!b.get(s) || !a.get(s)) changed++;
  }
  lines.push('');
  summary.push(`- ${p}: ${screens.length} screens (${b.size} before, ${a.size} after${changed ? `, ${changed} only on one side` : ''})`);
}
if (!projects.size) lines.push('_No Android captures came back (no affected app built, or every capture failed — see the run)._', '');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'android.md'), lines.join('\n'));
console.log(['### Android rebuild screenshots', ...summary].join('\n'));
