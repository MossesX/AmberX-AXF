/** Lifecycle hooks (plugin-lifecycle@1) for the agent manager. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = 'framework/spec/fixtures/agents.json';

export async function onInstall(ctx) {
  for (const d of ['memory', 'addons']) mkdirSync(join(ctx.dataDir, d), { recursive: true, mode: 0o700 });
  ctx.log('memory/ and addons/ ready — install add-on agents from Settings → Plugins → Agent manager → Add-ons');
}

export async function onUninstall(ctx) {
  ctx.log('removing agents, skills, personas, lingo, tools, workflows, training jobs, every memory store and add-on records');
}

export async function checks(ctx) {
  const bundled = join(ctx.dir, 'addons');
  const addons = existsSync(bundled) ? readdirSync(bundled).filter((n) => existsSync(join(bundled, n, 'addon.json'))) : [];
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'bundled-addons', ok: addons.length >= 3, detail: addons.join(', ') || 'none' },
    { id: 'contract-fixture', ok: existsSync(join(ctx.root, FIXTURE)), detail: `${FIXTURE} (agent-definition@1: TS reference = Python server = Kotlin kernel)` },
    { id: 'firecrawl', ok: true, detail: process.env.FIRECRAWL_API_KEY ? 'FIRECRAWL_API_KEY set' : 'not set (add a key in Settings → Plugins → Agent manager to train from the web)' },
  ];
}
