#!/usr/bin/env node
/**
 * frame — command-line driver for the Frame build engine.
 *
 *   frame init <dir> [--name "My App"] [--id my-app] [--template react-ts] [--targets web,desktop,android]
 *   frame validate [dir]          validate an app (or the framework's own assets with --framework)
 *   frame list [dir]              list assets by slot
 *   frame new-asset <type> <id> [--from <id>] [--name "Name"] [--dir .]
 *   frame schemas                 regenerate JSON Schemas in framework/schemas/json
 */
import { relative } from 'node:path';
import { FRAMEWORK_DIR, FRAMEWORK_VERSION, init, loadAssets, newAsset, spec, validateApp, writeSchemas } from './build-engine.mjs';

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
      if (!args[0]) throw new Error('Usage: frame init <dir> [--name "My App"]');
      console.log(c.b(`Frame ${FRAMEWORK_VERSION} — initializing ${args[0]}`));
      const res = init({
        dir: args[0],
        name: flags.name ?? 'Frame App',
        id: flags.id,
        template: flags.template ?? 'react-ts',
        targets: String(flags.targets ?? 'web').split(','),
        log: (m) => console.log(c.dim(m)),
      });
      console.log(c.ok(`\n✓ ${res.manifest.app.name} (${res.manifest.app.id}) created`));
      console.log(`  ${res.assets} assets · ${res.bakedFiles} baked framework files`);
      printReport(res.report);
      console.log(`\n  cd ${relative(process.cwd(), res.dir) || '.'} && npm install && npm run dev\n`);
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
      if (!type || !id) throw new Error('Usage: frame new-asset <type> <id> [--from <id>]');
      const f = newAsset({ dir: flags.dir ?? '.', type, id, from: flags.from, name: flags.name });
      console.log(c.ok(`✓ created ${relative(process.cwd(), f)}`));
      break;
    }
    case 'schemas': {
      const files = writeSchemas();
      console.log(c.ok(`✓ wrote ${files.length} JSON Schemas`));
      break;
    }
    default:
      console.log(`Frame ${FRAMEWORK_VERSION}\n\nCommands: init, validate, list, new-asset, schemas`);
  }
} catch (e) {
  console.error(c.bad(`✗ ${e.message}`));
  process.exitCode = 1;
}
