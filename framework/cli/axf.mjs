#!/usr/bin/env node
/**
 * axf — command-line driver for the AmberX AXF build engine.
 *
 *   axf init <dir> [--name "My App"] [--id my-app] [--template react-ts] [--targets web,desktop,android]
 *   axf validate [dir]          validate an app (or the framework's own assets with --framework)
 *   axf list [dir]              list assets by slot
 *   axf new-asset <type> <id> [--from <id>] [--name "Name"] [--dir .]
 *   axf schemas                 regenerate JSON Schemas in framework/schemas/json
 *   axf templates               list app templates (react-ts, android-compose, …)
 *   axf new-module <name> [--label "Name"] [--capabilities a,b] [--depends-on id,id] [--no-compose]
 *                               scaffold framework/android/lib-<name> (Android port)
 *   axf new-demo <library>      create apps/demo-<library>, an Android app showcasing one library
 *   axf modules                 list Android framework modules
 *   axf dev [dir] [--port 7070] [--framework]   live-reload server: watches assets, pushes changes to devices
 */
import { relative } from 'node:path';
import { FRAMEWORK_DIR, FRAMEWORK_VERSION, init, listModules, listTemplates, loadAssets, newAsset, newDemoApp, newModule, spec, validateApp, writeSchemas } from './build-engine.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    flags[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
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
        log: (m) => console.log(c.dim(m)),
      });
      console.log(c.ok(`\n✓ ${res.manifest.app.name} (${res.manifest.app.id}) created`));
      console.log(`  ${res.assets} assets · ${res.bakedFiles} baked framework files`);
      printReport(res.report);
      console.log(`\n  cd ${relative(process.cwd(), res.dir) || '.'} && ${res.next || 'npm install && npm run dev'}\n`);
      break;
    }
    case 'validate': {
      if (flags.framework) {
        const list = loadAssets(`${FRAMEWORK_DIR}/assets`);
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
