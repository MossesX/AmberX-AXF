#!/usr/bin/env node
/**
 * check-quick-settings — every settings interface draws the pinned Quick settings pane first (quick-settings@1;
 * Brett, Nov 13 2026: "every settings interface has a collapsible pane at the very top, header Quick settings").
 *
 *   node framework/cli/check-quick-settings.mjs [--json]
 *
 * A settings interface is (a) a dialog or view whose title names settings (`title: '… settings …'`, a DialogMap or
 * views entry) or (b) a component called `*SettingsView`. It passes when it renders inside <QuickSettingsFrame>: on
 * the entry itself, or through a component whose own body draws the frame (SettingsView does). A dialog that edits
 * settings but is a tool, not an interface (the level editor), says so on its line: `// quick-settings: exempt (<why>)`.
 * Baked framework copies (apps/<app>/src/axf) are skipped: the framework source is checked once.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['framework/react', 'framework/libs', 'apps'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'android', 'axf']);

function* walk(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx$/.test(n)) yield p;
  }
}

/** Names of components whose own body draws <QuickSettingsFrame>. */
function framedComponents(files) {
  const out = new Set();
  for (const { text } of files) {
    const re = /(?:export\s+)?function\s+([A-Z]\w*)\s*\(/g;
    const starts = [...text.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
    starts.forEach((s, i) => {
      const body = text.slice(s.at, starts[i + 1]?.at ?? text.length);
      if (body.includes('<QuickSettingsFrame')) out.add(s.name);
    });
  }
  return out;
}

export function checkQuickSettings(root = ROOT) {
  const files = [];
  for (const r of ROOTS) for (const p of walk(join(root, r))) files.push({ path: relative(root, p), text: readFileSync(p, 'utf8') });
  const framed = framedComponents(files);
  const problems = [];
  const pending = [];
  let interfaces = 0;
  // an app whose baked framework predates quick-settings@1 can't draw the frame yet: listed, enforced once it is re-baked
  const baked = (path) => { const m = /^apps\/([^/]+)\//.exec(path); return !m || existsSync(join(root, 'apps', m[1], 'src/axf/react/components/QuickSettings.tsx')); };
  const report = (p) => (baked(p.file) ? problems : pending).push(p);
  for (const { path, text } of files) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const entry = /title:\s*'([^']*\b[Ss]ettings\b[^']*)'.*render:\s*\([^)]*\)\s*(?::\s*[^=]+)?=>\s*<(\w+)/.exec(line);
      if (!entry) return;
      interfaces++;
      if (line.includes('quick-settings: exempt')) return;
      if (line.includes('<QuickSettingsFrame') || framed.has(entry[2])) return;
      report({ file: path, line: i + 1, title: entry[1], renders: entry[2] });
    });
    for (const m of text.matchAll(/function\s+(\w*SettingsView)\s*\(/g)) {
      interfaces++;
      if (!framed.has(m[1])) report({ file: path, line: text.slice(0, m.index).split('\n').length, title: m[1], renders: m[1] });
    }
  }
  return { ok: problems.length === 0, interfaces, problems, pending };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checkQuickSettings();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) {
    for (const p of r.pending) console.log(`  pending rebake: ${p.file}:${p.line} "${p.title}" (its app's baked framework has no QuickSettingsFrame yet: node framework/cli/rebake.mjs)`);
    console.log(`✓ quick-settings — ${r.interfaces} settings interface(s), every one draws the Quick settings pane${r.pending.length ? ` (${r.pending.length} pending an app re-bake)` : ''}`);
  }
  else {
    for (const p of r.problems) console.log(`${p.file}:${p.line}  "${p.title}" renders <${p.renders}> without <QuickSettingsFrame scope=…> (quick-settings@1)`);
    console.log(`\n✗ ${r.problems.length} settings interface(s) without the Quick settings pane. Wrap it in <QuickSettingsFrame scope="…">, or mark a tool that is not an interface with // quick-settings: exempt (<why>).`);
  }
  process.exit(r.ok ? 0 : 1);
}
