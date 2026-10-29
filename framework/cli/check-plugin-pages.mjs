#!/usr/bin/env node
/**
 * Plugin page check (DESIGN-LANGUAGE §12, enterprise-branding s35): every plugin page head in the console (and the
 * AmberX app) is held to the design language.
 *
 *   node framework/cli/check-plugin-pages.mjs [--json] [plugin dirs…]   (default: apps/console-web/plugins/*, apps/amberx-droid/src/plugins/*)
 *
 * For every `<header className="fx-pagehead">` in a plugin's web/*.tsx:
 *  - an eyebrow (`fx-eyebrow`) that names a section, never the bare word "Plugin" (the nav says it's a plugin)
 *  - a title (`<h1>`)
 *  - one sentence of description (`<p className="fx-muted">` or a `<p>` after the h1)
 * For every plugin that adds a page (`views:` in web/index.tsx): at least one page head somewhere in web/.
 * Lists never use a spinner (`fx-spinner` / "Loading…" text alone in a list): skeletons or the EmptyState.
 * A plugin may opt a line out with a `design-ok` comment (a page that is deliberately chrome-free, e.g. a terminal).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((a) => !a.startsWith('--'));
const roots = ['apps/console-web/plugins', 'apps/amberx-droid/src/plugins'];
const plugins = dirs.length ? dirs.map((d) => resolve(ROOT, d)) : roots.flatMap((r) => {
  const abs = join(ROOT, r);
  return existsSync(abs) ? readdirSync(abs).filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(abs, n)).isDirectory()).map((n) => join(abs, n)) : [];
});

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'vendor' ? [] : walk(p)) : [p]; }) : []);
const problems = [];
let heads = 0;
for (const dir of plugins) {
  const web = join(dir, 'web');
  const files = walk(web).filter((f) => f.endsWith('.tsx'));
  if (!files.length) continue;
  const rel = relative(ROOT, dir);
  let anyHead = false;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const lineOf = (i) => src.slice(0, i).split('\n').length;
    for (const m of src.matchAll(/<header className="fx-pagehead[^"]*">([\s\S]*?)<\/header>/g)) {
      anyHead = true; heads++;
      const at = `${relative(ROOT, f)}:${lineOf(m.index)}`;
      const body = m[1];
      if (/design-ok/.test(body)) continue;
      const eyebrow = body.match(/className="fx-eyebrow">([^<]*)</);
      if (!eyebrow) problems.push(`${at}  page head has no eyebrow`);
      else if (/^\s*plugin\s*$/i.test(eyebrow[1])) problems.push(`${at}  eyebrow is the bare word "Plugin": name the section (e.g. "Design & branding")`);
      if (!/<h1[\s>]/.test(body)) problems.push(`${at}  page head has no <h1> title`);
      if (!/<p className="fx-muted[^"]*"|<\/h1>\s*<p[\s>]/.test(body)) problems.push(`${at}  page head has no one-sentence description`);
    }
    for (const m of src.matchAll(/fx-spinner/g)) if (!/design-ok/.test(src.split('\n')[lineOf(m.index) - 1] ?? '')) problems.push(`${relative(ROOT, f)}:${lineOf(m.index)}  spinner: lists load with skeletons (DESIGN-LANGUAGE §11)`);
  }
  const index = join(web, 'index.tsx');
  const idx = existsSync(index) ? readFileSync(index, 'utf8') : '';
  if (/\bviews:\s*\{\s*['"[A-Za-z]/.test(idx) && !anyHead && !/design-ok: no page head/.test(idx)) problems.push(`${rel}  adds a page but no page head (fx-pagehead) anywhere in web/`);
}

if (json) console.log(JSON.stringify({ plugins: plugins.length, heads, problems }, null, 2));
else if (problems.length) { for (const p of problems) console.log(`✗ ${p}`); console.log(`\n✗ ${problems.length} page problem(s) in ${plugins.length} plugin(s) (DESIGN-LANGUAGE §12)`); }
else console.log(`✓ plugin pages — ${heads} page head(s) in ${plugins.length} plugin(s) follow the design language`);
process.exit(problems.length ? 1 : 0);
