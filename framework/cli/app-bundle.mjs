#!/usr/bin/env node
/**
 * app-bundle@1 — gathers every built app made with the framework into one folder for the app catalog.
 *
 *   node framework/cli/app-bundle.mjs list [--android]          apps (dir, project, name, template) found under apps/
 *   node framework/cli/app-bundle.mjs collect <outDir> [--build N] [--commit SHA] [--run-url URL]
 *        copies each Android app's debug APK to <outDir>/<project>.apk and writes <outDir>/apps.json:
 *        { "$axf": "app-bundle@1", builtAt, build, commit, runUrl,
 *          apps: [{ project, name, appId, platform, version, versionCode, build, file, size, sha256 }] }
 *
 * An app is any folder under apps/ with a valid project.manifest.json and an axf.manifest.json. New apps appear by
 * themselves; nothing here lists them by name. The Dev Console reads the bundle from CI and files it in the hub's
 * app catalog (/projects/_shared/_data/app-catalog).
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = join(ROOT, 'apps');
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

export function listApps({ android = false } = {}) {
  const out = [];
  for (const d of readdirSync(APPS, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const dir = join(APPS, d.name);
    const pm = join(dir, 'project.manifest.json'), am = join(dir, 'axf.manifest.json');
    if (!existsSync(pm) || !existsSync(am)) continue;
    let project, app;
    try { project = readJson(pm); app = readJson(am); } catch { continue; }
    if (!PROJECT_RE.test(project.name ?? '')) continue;
    const template = app.framework?.template ?? '';
    const isAndroid = template.startsWith('android') || (app.targets ?? []).includes('android') && existsSync(join(dir, 'app', 'build.gradle.kts'));
    if (android && !isAndroid) continue;
    out.push({ dir: `apps/${d.name}`, project: project.name, name: app.app?.name ?? project.displayName ?? project.name, template, android: isAndroid });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project));
}

function gradleField(dir, field) {
  const f = join(ROOT, dir, 'app', 'build.gradle.kts');
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(new RegExp(`${field}\\s*=\\s*"([^"]+)"`));
  return m ? m[1] : null;
}

const sha256 = (file) => new Promise((ok, bad) => { const h = createHash('sha256'); createReadStream(file).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', bad); });

export async function collect(outDir, { build = null, commit = null, runUrl = null } = {}) {
  mkdirSync(outDir, { recursive: true });
  const apps = [];
  const missing = [];
  for (const a of listApps({ android: true })) {
    const apkDir = join(ROOT, a.dir, 'app', 'build', 'outputs', 'apk', 'debug');
    const apk = existsSync(apkDir) ? readdirSync(apkDir).find((f) => f.endsWith('.apk')) : null;
    if (!apk) { missing.push(a.dir); continue; }
    const file = `${a.project}.apk`;
    copyFileSync(join(apkDir, apk), join(outDir, file));
    const st = statSync(join(outDir, file));
    apps.push({
      project: a.project, name: a.name, appId: gradleField(a.dir, 'applicationId'), platform: 'android',
      version: gradleField(a.dir, 'versionName') ?? '0.0.0', versionCode: build ?? 1, build, file, size: st.size, sha256: await sha256(join(outDir, file)),
    });
  }
  const bundle = { $axf: 'app-bundle@1', builtAt: new Date().toISOString(), build, commit, runUrl, apps };
  writeFileSync(join(outDir, 'apps.json'), JSON.stringify(bundle, null, 2) + '\n');
  return { bundle, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
  if (cmd === 'list') {
    const apps = listApps({ android: rest.includes('--android') });
    if (rest.includes('--dirs')) console.log(apps.map((a) => a.dir).join('\n'));
    else console.log(JSON.stringify(apps, null, 2));
  } else if (cmd === 'collect' && rest[0] && !rest[0].startsWith('--')) {
    const b = flag('build');
    const { bundle, missing } = await collect(resolve(rest[0]), { build: b ? Number(b) : null, commit: flag('commit'), runUrl: flag('run-url') });
    for (const a of bundle.apps) console.log(`✓ ${a.project} ${a.version}${a.build ? ` (build ${a.build})` : ''} · ${(a.size / 1e6).toFixed(1)} MB`);
    for (const m of missing) console.error(`✗ ${m}: no debug APK (build it first)`);
    if (missing.length) process.exit(1);
  } else {
    console.error('Usage: app-bundle.mjs list [--android] [--dirs] | collect <outDir> [--build N] [--commit SHA] [--run-url URL]');
    process.exit(2);
  }
}
