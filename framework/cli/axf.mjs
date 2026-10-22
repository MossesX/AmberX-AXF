#!/usr/bin/env node
/**
 * axf — command-line driver for the AmberX AXF build engine.
 *
 *   axf init <dir> [--name "My App"] [--id my-app] [--template react-ts|next-ts|android-compose] [--targets web,desktop,android] [--boilerplate notes] [--libraries browser] [build options]
 *            project manifest: [--repo owner/name] [--repo-exists] [--visibility private] [--description "…"] [--kind app]
 *   axf project validate|init|list|rules|schema …   project manifests (same as node framework/cli/project.mjs)
 *   axf options [dir] [--framework] [build options]   show or change build options on an existing app
 *   axf claude-project [dir] [--where github,vps,device] [--port bake|rebuild|no] …   make any folder a Claude project
 *                               and give it a home (framework/cli/claude-project.mjs; also /claude-project in Claude Code)
 *
 *   build options (framework/schemas/build-options.json; --x = on, --x on|off, --no-x = off; new builds default every option off):
 *     --wrap-groups              every section / group gets a collapse toggle top-right (style-theme wrapGroups)
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
 *   axf library-templates       list library templates (framework/library-templates)
 *   axf new-library <name> --template feature-screens [--ports android,web,python] [--label "…"] [--param k=v] [--features a,b]
 *   axf compile-library <slug> [--ports android,web,python]    type-check / compile each port of a library
 *   axf port-library <slug> --to web|android|python             generate another port of a library from its template
 *   axf remove-library <slug>                                   delete a template-generated library from every port
 *   axf libraries               list installable libraries (framework/android/<module>/library.json) and their parameters
 *   axf install <library> [appDir] [--param key=value …] [--yes]
 *                               add a library to an app: interactive wizard asks for the required parameters,
 *                               then writes manifest + gradle + App.kt + a generated <Name>Setup.kt
 */
import { join, relative } from 'node:path';
import { importUiLibrary, listPortedKits } from './ui-port.mjs';
import { compileLibrary, listLibraryTemplates, newLibrary, portLibrary, removeLibrary } from './library-templates.mjs';
import { installLibrary, installScript, libraryInfo, listLibraries, wizard } from './libraries.mjs';
import { OPTIONS, describeOptions, pickOptions } from './build-options.mjs';
import { FRAMEWORK_DIR, FRAMEWORK_VERSION, appOptions, init, listBoilerplates, listModules, listTemplates, loadAssets, newAsset, newDemoApp, newModule, spec, validateApp, writeSchemas } from './build-engine.mjs';
import { checkProject } from './project.mjs';

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
// A boolean build option swallows the next word only when it is on/off; otherwise that word is a positional arg.
const ONOFF = /^(on|off|true|false|1|0|yes|no|enabled?|disabled?)$/i;
for (const [name, spec] of Object.entries(OPTIONS)) {
  if (spec.type !== 'boolean') continue;
  for (const key of [name, `no-${name}`]) {
    const v = flags[key];
    if (typeof v !== 'string' || (key === name && ONOFF.test(v))) continue;
    if (args.length) { console.error(`\x1b[31m✗ --${key} takes ${key === name ? 'on|off' : 'no value'} (got "${v}")\x1b[0m`); process.exit(1); }
    args.push(v); flags[key] = true; // `axf options --wrap-groups apps/x`: the word was the app dir
  }
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
        // --developer [https://hub]: a developer app (settings + look from axHub's data server; waits for the hub)
        developer: flags.developer,
        // --libraries browser,other  (pre-build configuration; each library's defaults, or --param key=value for all)
        options: pickOptions(flags),
        project: {
          ...(flags.repo ? { owner: String(flags.repo).split('/')[0], repoName: String(flags.repo).split('/')[1] } : {}),
          ...(flags['repo-exists'] ? { repoExists: true } : {}),
          ...(flags.visibility ? { visibility: String(flags.visibility) } : {}),
          ...(flags.description ? { description: String(flags.description) } : {}),
          ...(flags.kind ? { kind: String(flags.kind) } : {}),
        },
        libraries: flags.libraries ? String(flags.libraries).split(',').map((l) => ({ library: l.trim(), params: Object.fromEntries([].concat(flags.param ?? []).map((kv) => { const [k, ...v] = String(kv).split('='); return [k, v.join('=')]; })) })) : [],
        log: (m) => console.log(c.dim(m)),
      });
      console.log(c.ok(`\n✓ ${res.manifest.app.name} (${res.manifest.app.id}) created`));
      console.log(`  project.manifest.json → hub folder /projects/${res.manifest.app.id}`);
      console.log(`  ${res.assets} assets · ${res.bakedFiles} baked framework files`);
      if (res.libraries?.length) console.log(`  libraries: ${res.libraries.map((l) => l.library).join(', ')}`);
      printReport(res.report);
      console.log(`\n  cd ${relative(process.cwd(), res.dir) || '.'} && ${res.next || 'npm install && npm run dev'}\n`);
      break;
    }
    case 'claude-project': {
      const { run } = await import('./claude-project.mjs');
      await run(process.argv.slice(3));
      break;
    }
    case 'project': {
      // Delegates to framework/cli/project.mjs (validate, init, list, rules, schema).
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/project.mjs'), ...process.argv.slice(3)], { stdio: 'inherit' });
      process.exitCode = r.status ?? 1;
      break;
    }
    case 'options': {
      const given = pickOptions(flags);
      const r = appOptions({ dir: args[0] ?? '.', framework: !!flags.framework, options: given, log: (m) => console.log(c.dim(m)) });
      if (Object.keys(given).length) console.log(c.ok(`✓ ${r.changed.length} file(s) updated`));
      for (const o of describeOptions()) {
        const v = r.options[o.flag.slice(2)];
        console.log(`${c.b(o.flag.padEnd(16))} ${v === true ? c.ok('on ') : v === false ? c.dim('off') : c.warn(String(v))}  ${o.label} ${c.dim(`(${o.token}, default ${o.default ? 'on' : 'off'})`)}`);
      }
      break;
    }
    case 'validate': {
      if (flags.framework) {
        const list = [...loadAssets(`${FRAMEWORK_DIR}/assets`), ...loadAssets(`${FRAMEWORK_DIR}/android/assets`)];
        const errors = list.filter((a) => !a.result.ok).map((a) => `${relative(FRAMEWORK_DIR, a.file)}: ${a.result.errors.join('; ')}`);
        // The framework is a project too (the repo root's project.manifest.json).
        const project = checkProject(join(FRAMEWORK_DIR, '..'));
        errors.push(...project.validation.errors.map((e) => `project.manifest.json: ${e.message} [${e.rule}]`));
        const warnings = project.validation.warnings.map((w) => `project.manifest.json: ${w.message} [${w.rule}]`);
        printReport({ ok: !errors.length, errors, warnings, assets: list.length });
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
    case 'library-templates': {
      for (const t of listLibraryTemplates()) console.log(`${c.b(t.id.padEnd(20))} ${c.dim(t.category.padEnd(14))} ${t.name} — ${t.description}`);
      break;
    }
    case 'new-library': {
      if (!args[0]) throw new Error('Usage: axf new-library <name> --template <id> [--ports android,web,python]');
      const params = Object.fromEntries([].concat(flags.param ?? []).map((kv) => { const [k, ...v] = String(kv).split('='); return [k, v.join('=')]; }));
      const r = newLibrary({ name: args[0], label: flags.label, description: flags.description, template: flags.template ?? 'feature-screens', ports: flags.ports ? String(flags.ports).split(',') : ['android', 'web'], features: flags.features ? String(flags.features).split(',') : [], params, log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ ${r.library.name} (${r.slug}): ${Object.keys(r.ports).join(', ')}`));
      break;
    }
    case 'compile-library': {
      if (!args[0]) throw new Error('Usage: axf compile-library <slug> [--ports android,web,python]');
      const r = compileLibrary({ slug: args[0], ports: flags.ports ? String(flags.ports).split(',') : undefined, log: (m) => console.log(c.dim(m)) });
      let failed = false;
      for (const [p, x] of Object.entries(r.results)) { console.log(`${p.padEnd(8)} ${x.status === 'passed' ? c.ok('passed') : x.status === 'failed' ? (failed = true, c.bad('failed')) : c.warn(x.status)}  ${c.dim(x.output.split('\n')[0] ?? '')}`); if (x.status === 'failed') console.log(x.output); }
      if (failed) process.exitCode = 1;
      break;
    }
    case 'port-library': {
      if (!args[0] || !flags.to) throw new Error('Usage: axf port-library <slug> --to web|android|python');
      const r = portLibrary({ slug: args[0], to: flags.to, log: (m) => console.log(c.dim(m)) });
      console.log(c.ok(`✓ ${r.library.name}: ${Object.keys(r.ports).join(', ')}`));
      break;
    }
    case 'remove-library': {
      if (!args[0]) throw new Error('Usage: axf remove-library <slug>');
      removeLibrary({ slug: args[0], log: (m) => console.log(c.dim(m)) }); console.log(c.ok(`✓ removed ${args[0]}`));
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
