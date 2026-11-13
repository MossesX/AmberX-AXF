#!/usr/bin/env node
/**
 * Device hot reload, end to end (CI: .github/workflows/dev-reload-android.yml).
 *
 *   node framework/cli/dev-reload-e2e.mjs --package ai.amberx.axf.console [--apk app.apk] [--theme arctic-daylight]
 *        [--port 7070] [--host-url http://10.0.2.2:7070] [--out shots/dev-reload] [--settle 4000]
 *
 *  1. starts `axf dev --framework` in-process (framework/assets, the same files every app bakes);
 *  2. installs the APK (optional) and launches the app with the dev server URL and hot reload on
 *     (`--es axf.devServer <url> --ez axf.hotReload true`: the emulator reaches the runner as 10.0.2.2);
 *  3. screenshots, edits the color theme's `bg` / `surface` tokens on disk, waits for /events to announce the change
 *     and the device to settle, screenshots again, restores the file;
 *  4. compares the two raw frames (adb exec-out screencap, no PNG decoding) and exits 1 when nothing changed.
 *
 * Writes before.raw / after.raw / result.json (+ PNGs when ImageMagick is on the PATH) to --out.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startDevServer } from './dev-server.mjs';
import { FRAMEWORK_DIR } from './build-engine.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const pkg = opt('package');
const port = Number(opt('port', 7070));
const hostUrl = opt('host-url', `http://10.0.2.2:${port}`);
const theme = opt('theme', 'arctic-daylight');
const out = resolve(opt('out', 'shots/dev-reload'));
const settle = Number(opt('settle', 4000));
const adb = (...a) => execFileSync('adb', a, { maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw screencap: 12- or 16-byte header (w, h, format[, colorspace]) then RGBA. */
export function frame(buf) {
  const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  const header = buf.length - w * h * 4;
  return { w, h, px: buf.subarray(header) };
}

/** How many pixels differ between two raw frames (status bar rows skipped: the clock ticks). */
export function pixelDiff(a, b, skipTop = 0) {
  if (a.w !== b.w || a.h !== b.h) return a.w * a.h;
  let n = 0;
  for (let i = skipTop * a.w * 4; i < a.px.length; i += 4) {
    if (a.px[i] !== b.px[i] || a.px[i + 1] !== b.px[i + 1] || a.px[i + 2] !== b.px[i + 2]) n++;
  }
  return n;
}

async function main() {
  if (!pkg) { console.error('usage: dev-reload-e2e.mjs --package <applicationId> [--apk <file>] [--theme <id>]'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  const file = join(FRAMEWORK_DIR, 'assets', 'color-theme', `${theme}.json`);
  if (!existsSync(file)) throw new Error(`no color theme ${theme} (${file})`);
  const original = readFileSync(file, 'utf8');

  const server = startDevServer({ framework: true, port, log: (l) => console.log(`[axf dev] ${l}`) });
  let restored = false;
  const restore = () => { if (!restored) { writeFileSync(file, original); restored = true; } };
  process.on('exit', restore);
  try {
    const apk = opt('apk');
    if (apk) adb('install', '-r', '-g', apk);
    adb('shell', 'am', 'force-stop', pkg);
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', pkg,
      '--es', 'axf.devServer', hostUrl, '--ez', 'axf.hotReload', 'true');
    await sleep(settle * 2);
    const before = adb('exec-out', 'screencap');
    writeFileSync(join(out, 'before.raw'), before);

    const startRev = (await (await fetch(`http://127.0.0.1:${port}/`)).json()).rev;
    const asset = JSON.parse(original);
    const t = asset.data.tokens;
    t.bg = t.bg === '#ff00ff' ? '#00ff00' : '#ff00ff';
    t.surface = t.bg;
    writeFileSync(file, `${JSON.stringify(asset, null, 2)}\n`);
    const ev = await (await fetch(`http://127.0.0.1:${port}/events?since=${startRev}`)).json();
    console.log(`[e2e] /events rev ${ev.rev}: ${ev.changed.map((c) => `${c.action} ${c.type}/${c.id}${c.ok ? '' : ' (invalid)'}`).join(', ')}`);
    await sleep(settle);
    const after = adb('exec-out', 'screencap');
    writeFileSync(join(out, 'after.raw'), after);
    restore();

    const a = frame(before), b = frame(after);
    const diff = pixelDiff(a, b, Math.round(a.h * 0.04));
    const result = { package: pkg, theme, hostUrl, size: `${a.w}x${a.h}`, changedPixels: diff, events: ev.changed, ok: diff > 0 };
    writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    for (const side of ['before', 'after']) {
      spawnSync('convert', ['-size', `${a.w}x${a.h}`, '-depth', '8', `rgba:${join(out, `${side}.raw`)}`, join(out, `${side}.png`)], { stdio: 'ignore' });
    }
    console.log(`[e2e] ${diff} pixel(s) changed after the theme edit → ${result.ok ? 'PASS' : 'FAIL'}`);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    restore();
    server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e.message); process.exit(1); });
