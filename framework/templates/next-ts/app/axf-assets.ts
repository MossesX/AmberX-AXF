import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Server-side asset loader: every JSON file under src/assets (one folder per asset type) becomes a hot-swappable
 * asset. Runs at build time (static export) or per request; the client runtime receives the array as props.
 * (Vite apps use import.meta.glob for the same thing — Next has no glob import, so this reads the folder.)
 */
export function loadAxfAssets(dir = join(process.cwd(), 'src/assets')): unknown[] {
  const out: unknown[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.json')) out.push(JSON.parse(readFileSync(f, 'utf8'))); } };
  walk(dir);
  return out;
}
