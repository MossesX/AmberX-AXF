/**
 * The console's skin hub (build console-look-becomes-default-axhub-skin): moves that reach every app's look go through
 * the theme manager's routes, so "Make this the default look" backs up every app, sets the hub default skin and moves
 * every app onto it, and "save this look as a skin" captures the console's look on the hub. Same routes as REST / MCP
 * (plugin-commands) and `skins.mjs`.
 */
import type { AxfRuntime } from '../axf/core';
import { authHeaders } from '../axf/libs/apiclient';
import { consoleTokens } from '../api';

const BASE = '/api/plugins/theme-manager/skins'; // axf-plugin:theme-manager

async function post(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeaders(consoleTokens, { headers: { 'content-type': 'application/json' } }), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String((j as { detail?: unknown }).detail ?? `HTTP ${r.status}`));
  return j;
}

/** Install the skin hub on the runtime. Returns a remover. */
export function installSkinHub(rt: AxfRuntime): () => void {
  rt.setSkinHub({
    setDefault: (skin) => post('/default-skin', { skin, adopt: true, confirm: true }),
    snapshot: (app, id, name) => post('/snapshot', { from: app, as: id, ...(name ? { name } : {}) }),
  });
  return () => rt.setSkinHub(null);
}
