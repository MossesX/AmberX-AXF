import type { AxfWebLibrary } from '@console/axf/react/library';
import { createMcpLibrary, type McpCallResult, type McpConnected, type McpHost, type McpLogRow, type McpPromptResult, type McpResourceContents, type McpServerInput, type McpServerRecord, type McpSession } from '@console/axf/libs/mcp';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/*
 * MCP client plugin (Fable rebuild, Oct 20 2026): the console's host for the framework's MCP client library
 * (`ai.amberx.axf.mcp`, framework/libs/mcp). The views (MCP servers, browse, call, call log) and the Settings → MCP servers
 * panel come from the library; this file only maps its host contract onto the plugin's server routes, so tokens
 * stay on the console server and the browser never speaks MCP itself (server-only mode: the console never launches
 * local commands). Routes, data file and behaviour are unchanged from the Opus build.
 */

const FOLDER = 'mcp-client';
const ID = 'ai.amberx.axf.console.mcp-client';

// Same messages as before (its 401 points at Home → Console token).
const api = pluginApi(FOLDER, 'The MCP client plugin', { tokenHome: 'Home → Console token' });
const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** What the server's connect route returns (the library's McpConnected, with the Opus field names kept). */
interface ServerConnected { server?: { name?: string; version?: string; title?: string } | null; instructions: string; protocol?: string | null; sessionId?: string | null; capabilities?: Record<string, unknown>; tools: McpConnected['tools']; resources: McpConnected['resources']; resourceTemplates?: McpConnected['resourceTemplates']; prompts: McpConnected['prompts']; resourcesError?: string; promptsError?: string }

function session(server: McpServerRecord): McpSession {
  const sid = server.id;
  return {
    async connect() {
      const c = await post<ServerConnected>(`servers/${sid}/connect`, {});
      return {
        protocolVersion: c.protocol ?? '', sessionId: c.sessionId ?? null, capabilities: c.capabilities ?? {}, serverInfo: c.server ? { name: c.server.name ?? '', version: c.server.version ?? '', ...(c.server.title ? { title: c.server.title } : {}) } : null,
        instructions: c.instructions ?? '', tools: c.tools ?? [], resources: c.resources ?? [], resourceTemplates: c.resourceTemplates ?? [], prompts: c.prompts ?? [],
        ...(c.resourcesError ? { resourcesError: c.resourcesError } : {}), ...(c.promptsError ? { promptsError: c.promptsError } : {}),
      };
    },
    callTool: (tool, args) => post<McpCallResult>(`servers/${sid}/call`, { tool, arguments: args ?? {} }),
    readResource: async (uri) => (await post<{ contents: McpResourceContents[] }>(`servers/${sid}/read`, { uri })).contents,
    getPrompt: (name, args) => post<McpPromptResult>(`servers/${sid}/prompt`, { name, arguments: args ?? {} }),
    close: async () => undefined, // the server opens one session per operation
  };
}

const host: McpHost = {
  registry: {
    label: 'the console server',
    list: async () => (await call<{ items: McpServerRecord[] }>('servers')).items,
    save: async (input: McpServerInput) => {
      const body: Record<string, unknown> = { id: input.id ?? '', name: input.name, url: input.url, description: input.description ?? '', tokenEnv: input.tokenEnv ?? '' };
      if (input.token !== undefined && input.token !== null) body.token = input.token; // absent = keep the stored token
      return (await post<{ server: McpServerRecord }>('servers', body)).server;
    },
    remove: async (id) => { await call(`servers/${id}`, { method: 'DELETE' }); },
    // the server records the outcome of every connect itself
  },
  open: session,
  log: { list: async () => (await call<{ items: McpLogRow[] }>('log')).items },
};

// In the console, MCP use is a developer tool: `dev.tools` is held by the standard user role and by hub admins (`*`),
// and by neither the wall's `user` nor `themes` roles. The server routes still need the console token on every call.
const lib = createMcpLibrary({ host, envAuth: true, navLabel: 'Plugins', permissions: { MANAGE: 'dev.tools', CALL: 'dev.tools', WRITE: 'dev.tools', DESTRUCTIVE: 'dev.tools' } });

export const plugin: AxfWebLibrary = {
  ...lib,
  id: ID, // the plugin's id (plugin.json); the library id stays the module name for its views/settings
  label: 'MCP client',
  version: '0.2.0',
  appMenu,
  settingsTabs: lib.settingsTabs?.map((t) => ({ ...t, parent: 'plugins' })),
  settingsPanels: [
    ...(lib.settingsPanels ?? []),
    { id: 'mcp-client.lifecycle', tab: 'mcp', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
