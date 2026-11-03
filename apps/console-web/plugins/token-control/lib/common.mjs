/** Shared by the runner's parts: where the repo and the plugin's data folder are, the error a part throws, the audit log. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_DIR = resolve(HERE, '..');
export const ROOT = resolve(PLUGIN_DIR, '../../../..');
export const FOLDER = 'token-control';
export const DATA_DIR = process.env.AXF_CONTROL_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);

/** A runner failure with a control@1 wire code (invalid, denied, not_found, validation, not_implemented, unexpected). */
export class ControlError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

/**
 * The salt confirm tokens are made with: AXF_CONTROL_SALT, else a random one kept in the data folder (never in the
 * repo, never sent anywhere). Every transport on this machine shares it, so a token the API answered works from the CLI.
 */
export function confirmSalt() {
  if (process.env.AXF_CONTROL_SALT) return process.env.AXF_CONTROL_SALT;
  const f = join(DATA_DIR, 'salt');
  try { const s = readFileSync(f, 'utf8').trim(); if (s) return s; } catch { /* first run */ }
  const s = randomBytes(24).toString('hex');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}

/** One line per write in the data folder's audit log (who, why, what; never values over 2 KB). */
export function audit(entry) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    appendFileSync(join(DATA_DIR, 'audit.jsonl'), `${line.length > 4000 ? JSON.stringify({ ...entry, value: '[large]', at: new Date().toISOString() }) : line}\n`);
  } catch { /* the audit log never blocks a change */ }
}

export function readAudit(limit = 50) {
  const f = join(DATA_DIR, 'audit.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
