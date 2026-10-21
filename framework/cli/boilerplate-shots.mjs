#!/usr/bin/env node
/**
 * Boilerplate screenshots (boilerplate-shots@1), used by .github/workflows/boilerplate-shots.yml.
 *
 *   node framework/cli/boilerplate-shots.mjs matrix [id,id…|all]   JSON list [{id, name}] for the workflow matrix
 *   node framework/cli/boilerplate-shots.mjs apply <dir>             file captures: <dir>/<id>/result.json + PNGs
 *                                                                    → framework/boilerplates/<id>/screenshots/ and
 *                                                                      boilerplate.json `screenshots`
 * Only verified captures are filed (the screen's label was on screen after tapping it). A boilerplate's old
 * screenshots are replaced only when the new run verified at least one screen, so a broken run never wipes them.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BP_DIR = join(ROOT, 'framework', 'boilerplates');
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX = 5_000_000;

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const boilerplates = () => readdirSync(BP_DIR).filter((d) => ID.test(d) && existsSync(join(BP_DIR, d, 'boilerplate.json'))).sort();

export function matrix(which = 'all') {
  const all = boilerplates();
  const want = !which || which === 'all' ? all : which.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = want.filter((w) => !all.includes(w));
  if (bad.length) throw new Error(`unknown boilerplate(s): ${bad.join(', ')}`);
  return want.map((id) => {
    const b = readJson(join(BP_DIR, id, 'boilerplate.json'));
    return { id, name: String(b.name ?? id).replace(/["\\$`]/g, '').slice(0, 60) || id };
  }).filter((b) => (readJson(join(BP_DIR, b.id, 'boilerplate.json')).screens ?? []).length > 0);
}

export function apply(dir) {
  const report = [];
  for (const id of readdirSync(dir).filter((d) => ID.test(d)).sort()) {
    const resFile = join(dir, id, 'result.json');
    const bpFile = join(BP_DIR, id, 'boilerplate.json');
    if (!existsSync(resFile) || !existsSync(bpFile)) { report.push(`${id}: skipped (no result or unknown boilerplate)`); continue; }
    const res = readJson(resFile);
    const bp = readJson(bpFile);
    const screens = new Map((bp.screens ?? []).map((s) => [s.id, s]));
    const good = (res.shots ?? []).filter((s) => s && s.verified === true && screens.has(s.screen) && s.file === `${s.screen}.png`).filter((s) => {
      const f = join(dir, id, s.file);
      if (!existsSync(f) || !lstatSync(f).isFile() || lstatSync(f).size > MAX) return false;
      return readFileSync(f).subarray(0, 8).equals(PNG);
    });
    if (!good.length) { report.push(`${id}: nothing verified, kept what was there`); continue; }
    const shotDir = join(BP_DIR, id, 'screenshots');
    rmSync(shotDir, { recursive: true, force: true });
    mkdirSync(shotDir, { recursive: true });
    for (const s of good) copyFileSync(join(dir, id, s.file), join(shotDir, s.file));
    bp.screenshots = good.map((s) => ({ screen: s.screen, file: s.file, caption: screens.get(s.screen).label }));
    writeFileSync(bpFile, JSON.stringify(bp, null, 2) + '\n');
    const missed = (res.shots ?? []).filter((s) => !good.includes(s)).map((s) => s.screen);
    report.push(`${id}: ${good.length} screenshot(s)${missed.length ? `, not verified: ${missed.join(', ')}` : ''}`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'matrix') console.log(JSON.stringify(matrix(arg)));
    else if (cmd === 'apply' && arg) console.log(apply(resolve(arg)).join('\n'));
    else { console.error('usage: boilerplate-shots.mjs matrix [ids|all] | apply <dir>'); process.exit(2); }
  } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
}
