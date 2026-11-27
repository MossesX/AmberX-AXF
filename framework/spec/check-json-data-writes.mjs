#!/usr/bin/env node
/**
 * no-json-data@1 (Brett, Nov 18 2026: "I don't want any data stored in JSON period. Everything needs to be a Postgres
 * table."): runtime code may not add a new direct write of a JSON / JSONL data file. Data goes through data-store@1
 * (Node `framework/core/data-files.mjs` readJson/writeJson…, `persist.mjs` readData/writeData, the builds store through
 * `builds-store.mjs`; the console server through `server/data_store.py`), which puts it in axf-data's Postgres tables.
 *
 * A closed list, not a ratchet with slack (Brett, Nov 25 2026: "Postgres is the one store. … No dual writes, no JSON
 * backups."): `framework/spec/json-data-writes.baseline.json` holds the few direct writes that stay, per file, each with
 * the reason it is not data (`kept`: true config, a read-only export, a spool the tables already hold). The check fails
 * when
 *   - a file not in the baseline has a direct write, or a file's count is above its baseline (a new JSON data write);
 *   - a file's count is below its baseline, or a baseline file is gone (the baseline must equal the code: run `--update`
 *     and commit it, so a removed write can never come back inside the old count);
 *   - a baseline file has no `kept` reason, or `total` is not the sum (a hand edit).
 * The baseline never grows: `--update` only lowers counts and drops files; there is no flag that raises one. A write
 * that truly is not data is marked on its line instead (`axf-data: not data (<reason>)`), which a reviewer sees.
 *
 * What counts (runtime code: apps/<app>/server, apps/<app>/plugins/<p>/{server,*.mjs}, framework/cli, framework/core,
 * deploy, services; never tests, specs, fixtures, baked copies, browser code):
 *   JS      a writeFile / writeFileSync / appendFile / appendFileSync / createWriteStream call whose line also has
 *           JSON.stringify or a `.json` / `.jsonl` name
 *   Python  json.dump(…) to a file, or write_text / write / open(…, 'w'|'a') on a line with json.dumps or a .json/.jsonl name
 * Not counted: lines through data-files / data_store / storage / persist (the routed writers), and a line marked
 * `axf-data: not data (<reason>)` on it or the line above (build-time generators, exports of the tables, test helpers,
 * caches of something else's data). A marker without a reason does not count as a marker.
 *
 *   node framework/spec/check-json-data-writes.mjs             check (CI)
 *   node framework/spec/check-json-data-writes.mjs --list      every counted line
 *   node framework/spec/check-json-data-writes.mjs --update    lower the baseline to what the code has now (never raises, never adds a file)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASELINE = join(ROOT, 'framework/spec/json-data-writes.baseline.json');
const args = new Set(process.argv.slice(2));
const NOTE = 'The direct JSON/JSONL writes that stay in runtime code, per file, each with the reason it is not data (kept). Everything else is in Postgres through data-store@1. This list never grows: framework/spec/check-json-data-writes.mjs --update only lowers it.';

export const SCOPE = /^(apps\/[^/]+\/(server|plugins)\/|framework\/(cli|core)\/|deploy\/|services\/)/;
export const SKIP = /(^|\/)(node_modules|dist|build|src\/axf|web|fixtures|__pycache__)\/|(^|\/)(test[^/]*|[^/]*[._-]test[^/]*|check-[^/]*|conftest\.py)$|\.d\.ts$/;
/** The data layer itself (what everything else must write through) and axf-data's own engine: not callers, not counted. */
export const LAYER = new Set(['framework/core/data-files.mjs', 'framework/core/data-store.mjs', 'apps/console-web/server/data_store.py']);
const LAYER_DIR = /^services\/axf-data\//;
const JS = /\.(mjs|cjs|js|ts|mts)$/; const PY = /\.py$/;
const JS_WRITE = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/;
const PY_WRITE = /\bjson\.dump\s*\(|\.write_text\s*\(|\.write\s*\(|\bopen\s*\([^)]*['"][wa]b?\+?['"]/;
const JSONISH = /JSON\.stringify|json\.dumps|\.jsonl?\b/;
const ROUTED = /\b(data_store|dataFiles|data-files|storage|persist|files)\.(write|append|put|update)|\b(writeJsonSync|writeTextSync|appendJsonlSync|writeData|appendData)\s*\(/;
const MARK = /axf-data: not data \(\s*\S[^)]*\)/;
/** Python `.write(` that is not a file: the terminal, an HTTP response, a socket, a child's stdin. */
const NOT_FILE = /\b(stdout|stderr|wfile|sock|socket|ws|websocket|resp|response|stdin|out|self\.request)\.write\s*\(/;

/** Counted lines of one source text: [{ line, text }]. */
export function scan(text, file) {
  const js = JS.test(file); const py = PY.test(file);
  if (!js && !py) return [];
  const lines = text.split('\n'); const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const t = l.trim();
    if (!t || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) continue;
    const write = js ? JS_WRITE.test(l) : PY_WRITE.test(l);
    if (!write) continue;
    const jsonish = py && /\bjson\.dump\s*\(/.test(l) ? true : JSONISH.test(l);
    if (!jsonish || ROUTED.test(l) || (py && NOT_FILE.test(l) && !/\bjson\.dump\s*\(|write_text|open\s*\(/.test(l))) continue;
    if (MARK.test(l) || (i > 0 && MARK.test(lines[i - 1]))) continue;
    out.push({ line: i + 1, text: t.slice(0, 160) });
  }
  return out;
}

export function countAll(root = ROOT) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  const files = {}; const hits = {};
  for (const f of tracked) {
    if (!SCOPE.test(f) || SKIP.test(f) || LAYER.has(f) || LAYER_DIR.test(f) || !(JS.test(f) || PY.test(f))) continue;
    let text; try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    const h = scan(text, f);
    if (h.length) { files[f] = h.length; hits[f] = h; }
  }
  return { files, hits };
}

/** Against a baseline: [{ file, was, now }] for every file whose count went up (or is new). */
export function compare(base, now) {
  return Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => ({ file: f, was: base[f] ?? 0, now: n }));
}

/** Baseline entries the code no longer needs: [{ file, was, now }] for every file whose count went down (or is gone). */
export function stale(base, now) {
  return Object.entries(base).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => ({ file: f, was: n, now: now[f] ?? 0 }));
}

/** What is wrong with the baseline document itself: files without a `kept` reason, reasons without a file, a wrong total. */
export function baselineFaults(doc) {
  const files = doc?.files ?? {}; const kept = doc?.kept ?? {}; const out = [];
  for (const f of Object.keys(files)) if (typeof kept[f] !== 'string' || !kept[f].trim()) out.push(`${f}: no reason in "kept" (why this write is not data)`);
  for (const f of Object.keys(kept)) if (!(f in files)) out.push(`${f}: a "kept" reason for a file that is not in "files"`);
  for (const [f, n] of Object.entries(files)) if (!Number.isInteger(n) || n < 1) out.push(`${f}: count must be a whole number above 0`);
  const sum = Object.values(files).reduce((a, b) => a + (Number.isInteger(b) ? b : 0), 0);
  if (doc && doc.total !== sum) out.push(`total is ${doc.total}, the counts add up to ${sum}`);
  return out;
}

/** The next baseline from the code: counts as they are now, reasons carried over. Null when a count would go up. */
export function lowered(doc, now) {
  const base = doc?.files ?? {};
  if (compare(base, now).length) return null;
  const files = Object.fromEntries(Object.keys(now).sort().map((k) => [k, now[k]]));
  const kept = Object.fromEntries(Object.keys(files).filter((k) => typeof doc?.kept?.[k] === 'string').map((k) => [k, doc.kept[k]]));
  return { $axf: 'json-data-writes-baseline@2', note: NOTE, total: Object.values(files).reduce((a, b) => a + b, 0), files, kept };
}

const selfTest = () => {
  const yes = [
    ["writeFileSync(f, JSON.stringify(doc));", 'a.mjs'], ["fs.appendFileSync(join(d, 'log.jsonl'), line);", 'a.mjs'],
    ["path.write_text(json.dumps(doc))", 'a.py'], ["json.dump(doc, fh)", 'a.py'], ["with open('x.json', 'w') as fh:", 'a.py'],
  ];
  const no = [
    ["writeJsonSync(p, doc);", 'a.mjs'], ["data_store.write_json(path, doc)", 'a.py'], ["writeFileSync(f, text);", 'a.mjs'],
    ["// writeFileSync(f, JSON.stringify(x))", 'a.mjs'], ["writeFileSync(f, JSON.stringify(x)); // axf-data: not data (build-time generator)", 'a.mjs'],
    ["storage.write_text(p, json.dumps(d))", 'a.py'], ["const s = JSON.stringify(x);", 'a.mjs'],
    ["sys.stdout.write(json.dumps(r) + '\\n')", 'a.py'], ["self.wfile.write(json.dumps(body).encode())", 'a.py'],
  ];
  for (const [l, f] of yes) if (scan(l, f).length !== 1) throw new Error(`self-test: should count: ${l}`);
  for (const [l, f] of no) if (scan(l, f).length !== 0) throw new Error(`self-test: should not count: ${l}`);
  if (scan("writeFileSync(f, JSON.stringify(x)); // axf-data: not data ()", 'a.mjs').length !== 1) throw new Error('self-test: a marker needs a reason');
  if (scan("// axf-data: not data (export of the tables)\nwriteFileSync(f, JSON.stringify(x));", 'a.mjs').length !== 0) throw new Error('self-test: marker on the line above');
  if (!SKIP.test('framework/spec/check-x.mjs') && SCOPE.test('framework/spec/check-x.mjs')) throw new Error('self-test: specs are out of scope');
  if (!SKIP.test('apps/console-web/plugins/x/test.py') || !SKIP.test('apps/console-web/server/test_main.py')) throw new Error('self-test: tests are skipped');
  if (compare({ a: 2 }, { a: 2, b: 1 }).length !== 1 || compare({ a: 2 }, { a: 1 }).length !== 0) throw new Error('self-test: compare');
  if (stale({ a: 2, b: 1 }, { a: 1 }).length !== 2 || stale({ a: 2 }, { a: 2, b: 1 }).length !== 0) throw new Error('self-test: stale');
  const doc = { total: 3, files: { a: 2, b: 1 }, kept: { a: 'config', b: 'export' } };
  if (baselineFaults(doc).length !== 0) throw new Error('self-test: a sound baseline has no faults');
  if (baselineFaults({ ...doc, kept: { a: 'config' } }).length !== 1 || baselineFaults({ ...doc, kept: { ...doc.kept, b: ' ' } }).length !== 1) throw new Error('self-test: every kept file needs a reason');
  if (baselineFaults({ ...doc, total: 9 }).length !== 1 || baselineFaults({ ...doc, kept: { ...doc.kept, c: 'x' } }).length !== 1) throw new Error('self-test: total and stray reasons');
  if (lowered(doc, { a: 2, b: 1, c: 1 }) !== null || lowered(doc, { a: 3 }) !== null) throw new Error('self-test: the baseline never grows');
  const low = lowered(doc, { a: 1 });
  if (low.total !== 1 || low.files.a !== 1 || 'b' in low.files || 'b' in low.kept || low.kept.a !== 'config') throw new Error('self-test: lowering keeps the reasons of what stays');
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  selfTest();
  const { files, hits } = countAll();
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  if (args.has('--list')) { for (const [f, h] of Object.entries(hits)) for (const x of h) console.log(`${f}:${x.line}  ${x.text}`); console.log(`${total} direct JSON write(s) in ${Object.keys(files).length} file(s)`); process.exit(0); }
  let doc = null; try { doc = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* no baseline: nothing is allowed */ }
  const base = doc?.files ?? {};
  if (args.has('--update')) {
    const next = lowered(doc, files);
    if (!next) {
      console.error(`json-data-writes: --update never raises the baseline (${compare(base, files).map((x) => `${x.file} ${x.was} → ${x.now}`).join(', ')}); move the data onto data-store@1 (data-files.mjs / data_store.py)`);
      process.exit(1);
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 1)}\n`); // axf-data: not data (the check's own committed baseline)
    console.log(`json-data-writes: baseline written: ${total} write(s) in ${Object.keys(files).length} file(s)`);
    const faults = baselineFaults(next);
    if (faults.length) { console.error('✗ the baseline still needs:'); for (const x of faults) console.error(`  ${x}`); process.exit(1); }
    process.exit(0);
  }
  const up = compare(base, files); const down = stale(base, files); const faults = baselineFaults(doc ?? { total: 0, files: {} });
  if (up.length) {
    console.error('✗ no-json-data@1: new direct JSON data writes (data goes to Postgres through data-store@1: data-files.mjs / data_store.py):');
    for (const x of up) { console.error(`  ${x.file}: ${x.was} → ${x.now}`); for (const h of hits[x.file] ?? []) console.error(`    :${h.line}  ${h.text}`); }
    console.error('  Not data (a build-time generator, an export of the tables)? Mark the line: // axf-data: not data (<reason>)');
  }
  if (down.length) {
    console.error('✗ no-json-data@1: the baseline is above the code (a removed write could come back unseen). Run `node framework/spec/check-json-data-writes.mjs --update` and commit the baseline:');
    for (const x of down) console.error(`  ${x.file}: ${x.was} → ${x.now}`);
  }
  if (faults.length) {
    console.error('✗ no-json-data@1: framework/spec/json-data-writes.baseline.json:');
    for (const x of faults) console.error(`  ${x}`);
  }
  if (up.length || down.length || faults.length) process.exit(1);
  console.log(`✓ no-json-data@1: ${total} direct JSON write(s) in ${Object.keys(files).length} file(s), all kept with a reason, none new`);
}
