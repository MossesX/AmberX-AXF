#!/usr/bin/env node
/**
 * AmberX → Phone Connect migration (phone-connect@1, PHONE-CONNECT.md → Migration). Three moves, each one idempotent:
 *   aliases   writes the alias table (amberx.open_url → phone.open_url, amberx.recorder_* → phone.recorder_*) with its
 *             deprecation note to <data>/aliases.json, and lists the console files that still call the old names
 *   data      copies the output-recorder plugin's data folder into <data>/recorder/, verifies every byte, then leaves a
 *             MOVED-TO pointer in the old folder (the old folder itself goes with the output-recorder plugin's uninstall)
 *   device    turns the axHub `amberx` device record (its hello: deviceId, name, app, capabilities, state, lastSeenAt)
 *             into a phone-device@1 (same id, migratedFrom set, still paired) in <data>/devices.json
 *
 * Dry run by default: prints the plan and writes nothing. `--apply` does it.
 *   node apps/console-web/plugins/phone-connect/migrate.mjs [--apply] [--root <dir>] [--device <record.json>] [--owner <name>] [--json]
 * The device record comes from --device, else <old data>/device.json, else <data>/amberx-device.json; with none the step
 * says what to export from axHub and where to put it. Exits 0 on a clean plan, 2 when a verify failed.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../../../../framework/core/phone-connect.mjs';

export const FOLDER = 'phone-connect';
export const OLD_FOLDER = 'output-recorder'; // the migration source's old data folder name, kept after that plugin is gone (axf-not-plugin:output-recorder)
export const DATA_DIR = `.axf-console/plugins/${FOLDER}`;
export const OLD_DATA_DIR = `.axf-console/plugins/${OLD_FOLDER}`;
export const ALIASES_FRAME = 'phone-connect-aliases@1';
export const DEVICES_FRAME = 'phone-devices@1';
export const POINTER = 'MOVED-TO';
/** Console files that call the old hub tool names today; the plugin phase switches them to phone.* (the table only reports). */
const CALLERS = [
  'apps/console-web/plugins/console-commands/server/wake.py', 'apps/console-web/plugins/console-commands/server/__init__.py',
  'apps/console-web/plugins/output-recorder/web/core.ts', // scanned only while it exists (axf-not-plugin:output-recorder)
  'apps/console-web/plugins/approvals-banner/web/index.tsx', 'apps/console-web/plugins/approvals-banner/web/overlay.ts',
  'apps/console-web/plugins/claude-badge/server/__init__.py', 'apps/console-web/plugins/claude-session/server/recording.py',
];
const OLD_NAME = /amberx\.(open_url|recorder_start|recorder_stop|recorder_status)/g;

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every file under `dir` (relative paths), skipping the pointer. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir)) {
    if (n === POINTER) continue;
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base)); else out.push(relative(base, p));
  }
  return out.sort();
}
const sameBytes = (a, b) => existsSync(a) && existsSync(b) && statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));

/** The alias table document. */
export function aliasesDoc(now, callers = []) {
  return {
    $axf: ALIASES_FRAME, at: now, note: 'The amberx.* hub tool names are deprecated. They resolve to the phone.* names for one release after Phone Connect ships and every answer carries `deprecated`; after that release they answer not_found. The console, MCP, CLI and voice all use the phone.* names.',
    aliases: P.aliasTable(), callers,
  };
}

/** Which console files still use the old names (read only). */
export function scanCallers(root) {
  const out = [];
  for (const f of CALLERS) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    const names = new Set(); for (const m of readFileSync(p, 'utf8').matchAll(OLD_NAME)) names.add(m[0]);
    if (names.size) out.push({ file: f, uses: [...names].sort(), to: [...names].sort().map((n) => P.ALIASES[n]) });
  }
  return out;
}

/** The AmberX device record, from the first place that has one. */
export function findDeviceRecord(root, deviceFile) {
  const places = [deviceFile && resolve(root, deviceFile), join(root, OLD_DATA_DIR, 'device.json'), join(root, DATA_DIR, 'amberx-device.json')].filter(Boolean);
  for (const p of places) { const doc = readJson(p, null); if (isObj(doc) && doc.deviceId) return { file: relative(root, p), record: doc }; }
  return { file: '', record: null, lookedIn: places.map((p) => relative(root, p)) };
}

/** The devices document after merging `device` in (by deviceId; the migrated record wins). */
export function mergeDevice(existing, device) {
  const doc = isObj(existing) && Array.isArray(existing.devices) ? existing : { $axf: DEVICES_FRAME, devices: [] };
  const devices = doc.devices.filter((d) => isObj(d) && d.deviceId !== device.deviceId);
  devices.push(device);
  return { $axf: DEVICES_FRAME, at: device.updatedAt, devices };
}

/**
 * The plan: one row per move with what would happen. Nothing is written. `rows[].status` is `do` (will change something),
 * `done` (already as it should be), `skip` (nothing to move) or `fail` (a verify failed; apply stops before it).
 */
export function plan({ root, deviceFile = '', owner = '', now = new Date().toISOString() }) {
  const data = join(root, DATA_DIR); const old = join(root, OLD_DATA_DIR);
  const rows = []; const writes = [];

  // aliases
  const callers = scanCallers(root);
  const aliasFile = join(data, 'aliases.json'); const haveAliases = readJson(aliasFile, null);
  const aliasesNow = aliasesDoc(now, callers);
  const aliasesSame = isObj(haveAliases) && JSON.stringify(haveAliases.aliases) === JSON.stringify(aliasesNow.aliases) && JSON.stringify(haveAliases.callers) === JSON.stringify(callers);
  rows.push({ step: 'aliases', status: aliasesSame ? 'done' : 'do', from: 'amberx.open_url, amberx.recorder_start / stop / status', to: relative(root, aliasFile), detail: callers.length ? `${callers.length} console file(s) still call the old names: ${callers.map((c) => c.file.split('/').slice(-2).join('/')).join(', ')}` : 'no console file calls the old names' });
  if (!aliasesSame) writes.push({ kind: 'json', file: aliasFile, value: aliasesNow });

  // data folder
  const files = walk(old); const target = join(data, 'recorder'); const pointer = join(old, POINTER);
  if (!existsSync(old)) rows.push({ step: 'data', status: 'skip', from: OLD_DATA_DIR, to: `${DATA_DIR}/recorder`, detail: 'the output-recorder data folder does not exist here' });
  else if (!files.length) rows.push({ step: 'data', status: existsSync(pointer) ? 'done' : 'do', from: OLD_DATA_DIR, to: `${DATA_DIR}/recorder`, detail: 'the folder is empty; only the pointer is left' });
  else {
    const copied = files.filter((f) => sameBytes(join(old, f), join(target, f)));
    const allThere = copied.length === files.length && existsSync(pointer);
    rows.push({ step: 'data', status: allThere ? 'done' : 'do', from: OLD_DATA_DIR, to: `${DATA_DIR}/recorder`, detail: `${files.length} file(s), ${copied.length} already copied: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ', …' : ''}` });
  }
  if (existsSync(old) && !(files.length && files.every((f) => sameBytes(join(old, f), join(target, f))) && existsSync(pointer))) writes.push({ kind: 'copy', from: old, to: target, files, pointer });

  // device
  const found = findDeviceRecord(root, deviceFile);
  const devicesFile = join(data, 'devices.json');
  if (!found.record) rows.push({ step: 'device', status: 'skip', from: 'axHub amberx device record', to: relative(root, devicesFile), detail: `no record found (looked in ${found.lookedIn.join(', ')}); export the amberx service's hello from axHub to ${DATA_DIR}/amberx-device.json and run again` });
  else {
    const device = P.deviceFromAmberx(found.record, { at: now, owner });
    const errs = P.deviceErrors(device);
    const have = readJson(devicesFile, null); const already = isObj(have) && Array.isArray(have.devices) && have.devices.some((d) => isObj(d) && d.deviceId === device.deviceId && d.app === P.APP && isObj(d.migratedFrom));
    if (errs.length) rows.push({ step: 'device', status: 'fail', from: found.file, to: relative(root, devicesFile), detail: `the record does not make a valid phone-device@1: ${errs.join('; ')}` });
    else {
      rows.push({ step: 'device', status: already ? 'done' : 'do', from: found.file, to: relative(root, devicesFile), detail: `${device.deviceId} (${device.name || 'unnamed'}) → ${device.state}${device.owner ? `, owner ${device.owner}` : ', no owner: pass --owner'}; ${P.presence(device, now)}` });
      if (!already) writes.push({ kind: 'json', file: devicesFile, value: mergeDevice(have, device) });
    }
  }
  return { $axf: 'phone-connect-migration@1', at: now, root, dataDir: DATA_DIR, oldDataDir: OLD_DATA_DIR, rows, writes, ok: rows.every((r) => r.status !== 'fail') };
}

/** Does the plan's writes; copies are verified byte for byte before the pointer is left. Returns the plan with `applied`. */
export function apply(p) {
  if (!p.ok) return { ...p, applied: [], error: 'a verify failed; nothing was written' };
  const applied = [];
  for (const w of p.writes) {
    if (w.kind === 'json') { writeJson(w.file, w.value); applied.push(relative(p.root, w.file)); continue; }
    mkdirSync(w.to, { recursive: true });
    for (const f of w.files) { mkdirSync(dirname(join(w.to, f)), { recursive: true }); cpSync(join(w.from, f), join(w.to, f)); if (!sameBytes(join(w.from, f), join(w.to, f))) return { ...p, applied, error: `${f} did not copy whole; the old folder is untouched` }; }
    writeFileSync(w.pointer, `Moved to ${relative(p.root, w.to)} by phone-connect/migrate.mjs on ${p.at}. This folder goes with the output-recorder plugin's uninstall.\n`);
    applied.push(`${relative(p.root, w.to)} (${w.files.length} file(s)) + ${relative(p.root, w.pointer)}`);
  }
  return { ...p, applied };
}

/** The report in plain lines. */
export function report(p) {
  const head = p.applied ? `phone-connect migration: applied at ${p.root}` : `phone-connect migration: dry run at ${p.root} (add --apply to do it)`;
  const lines = [head, ...p.rows.map((r) => `  ${r.status.padEnd(4)} ${r.step.padEnd(7)} ${r.from} → ${r.to}\n       ${r.detail}`)];
  if (p.applied) lines.push(p.applied.length ? `  wrote: ${p.applied.join('; ')}` : '  nothing to write');
  if (p.error) lines.push(`  error: ${p.error}`);
  return lines.join('\n');
}

const argv = process.argv.slice(2);
const arg = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(arg('--root', process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../..')));
  let p = plan({ root, deviceFile: arg('--device'), owner: arg('--owner') });
  if (argv.includes('--apply')) p = apply(p);
  console.log(argv.includes('--json') ? JSON.stringify(p, null, 1) : report(p));
  process.exit(p.ok && !p.error ? 0 : 2);
}
