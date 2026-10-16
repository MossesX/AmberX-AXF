#!/usr/bin/env node
/**
 * axf — command-line driver for the AmberX AXF build engine.
 *
 *   axf init <dir> [--name "My App"] [--id my-app] [--template react-ts] [--targets web,desktop,android] [--boilerplate notes] [--libraries browser]
 *   axf validate [dir]          validate an app (or the framework's own assets with --framework)
 *   axf list [dir]              list assets by slot
 *   axf new-asset <type> <id> [--from <id>] [--name "Name"] [--dir .]
 *   axf schemas                 regenerate JSON Schemas in framework/schemas/json
 *   axf templates               list app templates (react-ts, android-compose, …)
 *   axf new-module <name> [--label "Name"] [--capabilities a,b] [--depends-on id,id] [--no-compose]
 *                               scaffold framework/android/lib-<name> (Android port)
 *   axf new-demo <library>      create apps/demo-<library>, an Android app showcasing one library
 *   axf modules                 list Android framework modules
 *   axf boilerplates            list boilerplates (framework/boilerplates)
 *   axf dev [dir] [--port 7070] [--framework]   live-reload server: watches assets, pushes changes to devices
 *   axf serve [--port 7080] [--token secret]    HTTP driver for the build engine (the Dev Console / VPS)
 *   axf import-ui --name "Cupertino" --kit cupertino --source git --url https://github.com/x/y [--version 1.0] [--covers BUTTON,CHIP] [--apply apps/my-app]
 *                               port a third-party UI library: clone → refactor to AXF tokens → save as kit-<id> → apply to a project
 *   axf ported-kits             list kits produced by import-ui
 *   axf libraries               list installable libraries (framework/android/<module>/library.json) and their parameters
 *   axf install <library> [appDir] [--param key=value …] [--yes]
 *                               add a library to an app: interactive wizard asks for the required parameters,
 *                               then writes manifest + gradle + App.kt + a generated <Name>Setup.kt
 */
import { relative } from 'node:path';
import { importUiLibrary, listPortedKits } from './ui-port.mjs';
import { installLibrary, installScript, libraryInfo, listLibraries, wizard } from './libraries.mjs';
import { FRAMEWORK_DIR, FRAMEWORK_VERSION, init, listBoilerplates, listModules, listTemplates, loadAssets, newAsset, newDemoApp, newModule, spec, validateApp, writeSchemas } from './build-engine.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    flags[key] = key in flags ? [].concat(flags[key], val) : val;
  } else args.push(rest[i]);
}

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, bad: (s) => `\x1b[31m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };

function printReport(r) {
  for (const e of r.errors) console.log(c.bad(`  ✗ ${e}`));
  for (const w of r.warnings ?? []) console.log(c.warn(`  ! ${w}`));
  console.log(r.ok ? c.ok(`  ✓ valid — ${r.assets} assets`) : c.bad(`  ✗ ${r.errors.length} error(s)`));
}

try {
  switch (cmd) {
    case 'init': {
      if (!args[0]) throw new Error('Usage: axf init <dir> [--name "My App"]');
      console.log(c.b(`AmberX AXF ${FRAMEWORK_VERSION} — initializing ${args[0]}`));
      const res = init({
        dir: args[0],
        name: flags.name ?? 'AXF App',
        id: flags.id,
        template: flags.template ?? 'react-ts',
        targets: flags.targets ? String(flags.targets).split(',') : undefined,
        applicationId: flags['application-id'],
        modules: flags.modules ? String(flags.modules).split(',') : [],
        boilerplate: flags.boilerplate,
        // --libraries browser,other  (pre-build configuration; each library's defaults, or --param key=value for all)
        libraries: flags.libraries ? String(flags.libraries).split(',').map((l) => ({ library: l.trim(), params: Object.fromEntries([].concat(flags.param ?? []).map((kv) => { const [k, ...v] = String(kv).split('='); return [k, v.join('=')]; })) })) : [],
        log: (m) => console.log(c.dim(m)),
      });
      console.log(c.ok(`\n✓ ${res.manifest.app.name} (${res.manifest.app.id}) created`));
      console.log(`  ${res.assets} assets · ${res.bakedFiles} baked framework files`);
      if (res.libraries?.length) console.log(`  libraries: ${res.libraries.map((l) => l.library).join(', ')}`);
      printReport(res.report);
      console.log(`\n  cd ${relative(process.cwd(), res.dir) || '.'} && ${res.next || 'npm install && npm run dev'}\n`);
      break;
    }
    case 'validate': {
      if (flags.framework) {
        const list = [...loadAssets(`${FRAMEWORK_DIR}/assets`), ...loadAssets(`${FRAMEWORK_DIR}/android/assets`)];
        const errors = list.filter((a) => !a.result.ok).map((a) => `${relative(FRAMEWORK_DIR, a.file)}: ${a.result.errors.join('; ')}`);
        printReport({ ok: !errors.length, errors, assets: list.length });
        process.exitCode = errors.length ? 1 : 0;
      } else {
        const r = validateApp(args[0] ?? '.');
        printReport(r);
        process.exitCode = r.ok ? 0 : 1;
      }
      break;
    }
    case 'list': {
      const list = loadAssets(`${args[0] ?? '.'}/src/assets`).filter((a) => a.result.ok);
      for (const type of Object.keys(spec.types)) {
        const items = list.filter((a) => a.raw.type === type);
        console.log(`${c.b(spec.types[type].label.padEnd(22))} ${items.map((a) => a.raw.id).join(', ') || c.dim('(none)')}`);
      }
      break;
    }
    case 'new-asset': {
      const [type, id] = args;
      if (!type || !id) throw new Error('Usage: axf new-asset <type> <id> [--from <id>]');
      const f = newAsset({ dir: flags.dir ?? '.', type, id, from: flags.from, name: flags.name });
      console.log(c.ok(`✓ created ${relative(process.cwd(), f)}`));
      break;
    }
    case 'dev': {
      const { startDevServer } = await import('./dev-server.mjs');
      startDevServer({ dir: args[0] ?? '.', port: Number(flags.port ?? 7070), framework: !!flags.framework });
      await new Promise(() => {});
      break;
    }
    case 'import-ui': {
      if (!flags.name || !flags.source) throw new Error('Usage: axf import-ui --name "Name" --source git|local|maven|npm (--url … | --path … | --coordinate …) [--kit id] [--covers A,B] [--apply appDir]');
      const r = importUiLibrary({ name: flags.name, kitId: flags.kit, version: flags.version, source: { kind: flags.source, url: flags.url, path: flags.path, coordinate: flags.coordinate, ref: flags.ref }, covers: flags.covers ? String(flags.covers).split(',') : undefined, dir: flags.apply, overwrite: !!flags.overwrite, log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ ${flags.name} → framework/android/${r.module} (ui-kit asset "${r.kitId}")${flags.apply ? ` · applied to ${flags.apply}` : ''}`));
      const ref = r.report.steps.find((s) => s.step === 'refactor');
      if (ref) console.log(c.dim(`  refactored ${ref.filesChanged} file(s): ${Object.entries(ref.totals).map(([k, v]) => `${k} ×${v}`).join(', ') || 'no token-mappable code'}${ref.unmapped.length ? `\n  unmapped roles: ${ref.unmapped.join(', ')}` : ''}`));
      break;
    }
    case 'ported-kits': {
      for (const k of listPortedKits()) console.log(`${c.b(k.module.padEnd(22))} ${k.name} ${c.dim(`← ${k.port?.source?.kind} ${k.port?.source?.url ?? k.port?.source?.coordinate ?? k.port?.source?.path ?? ''}`)}`);
      break;
    }
    case 'libraries': {
      for (const l of listLibraries()) {
        console.log(`${c.b(l.module.replace(/^lib-/, '').padEnd(14))} ${c.dim(l.id.padEnd(28))} ${l.name}`);
        for (const p of l.params ?? []) console.log(c.dim(`    ${p.key.padEnd(18)} ${p.type.padEnd(7)} ${p.required ? 'required ' : ''}${p.default !== undefined ? `default ${JSON.stringify(p.default)}` : ''}`));
      }
      break;
    }
    case 'install': {
      if (!args[0]) throw new Error('Usage: axf install <library> [appDir] [--param key=value …] [--yes]');
      const lib = libraryInfo(args[0]);
      const preset = {};
      for (const kv of [].concat(flags.param ?? [])) { const [k, ...v] = String(kv).split('='); preset[k] = v.join('='); }
      const answers = flags.yes || !process.stdin.isTTY ? preset : await wizard(lib, preset);
      const r = installLibrary({ dir: args[1] ?? '.', library: lib.id, params: answers, log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ installed ${lib.name} into ${relative(process.cwd(), r.dir) || '.'} (${r.changed.length} files)`));
      console.log(c.dim(installScript(lib, r.config)));
      break;
    }
    case 'boilerplates': {
      for (const b of listBoilerplates()) console.log(`${c.b(b.id.padEnd(14))} ${c.dim(b.category.padEnd(13))} ${b.name} — ${b.description}`);
      break;
    }
    case 'serve': {
      const { startBuildServer } = await import('./serve.mjs');
      startBuildServer({ port: Number(flags.port ?? 7080), token: flags.token, apps: flags.apps });
      await new Promise(() => {});
      break;
    }
    case 'templates': {
      for (const t of listTemplates()) console.log(`${c.b(t.id.padEnd(18))} ${t.label ?? ''} ${c.dim(`[${(t.targets ?? []).join(', ')}]`)}`);
      break;
    }
    case 'new-module': {
      if (!args[0]) throw new Error('Usage: axf new-module <name> [--label "Name"] [--capabilities a,b]');
      const r = newModule({ name: args[0], label: flags.label, capabilities: flags.capabilities ? String(flags.capabilities).split(',') : [], dependsOn: flags['depends-on'] ? String(flags['depends-on']).split(',') : [], compose: !flags['no-compose'], log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ created ${relative(process.cwd(), r.dir)} (${r.moduleId})`));
      break;
    }
    case 'new-demo': {
      if (!args[0]) throw new Error('Usage: axf new-demo <library> [--name "Name"] [--dir apps/demo-x]');
      const res = newDemoApp({ library: args[0], name: flags.name, dir: flags.dir, log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ ${res.manifest.app.name} created at ${relative(process.cwd(), res.dir)}`));
      printReport(res.report);
      break;
    }
    case 'modules': {
      for (const m of listModules()) console.log(`${c.b(m.name.padEnd(24))} ${c.dim(m.kind.padEnd(10))} ${m.description}`);
      break;
    }
    case 'schemas': {
      const files = writeSchemas();
      console.log(c.ok(`✓ wrote ${files.length} JSON Schemas`));
      break;
    }
    default:
      console.log(`AmberX AXF ${FRAMEWORK_VERSION}\n\nCommands: init, validate, list, new-asset, schemas`);
  }
} catch (e) {
  console.error(c.bad(`✗ ${e.message}`));
  process.exitCode = 1;
}
