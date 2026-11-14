// Types for plugin-commands.mjs (plugin-commands@1: every plugin's commands and reads, made automatically).
export type PluginCommandEffect = 'read' | 'write' | 'destructive' | 'navigate';
export interface PluginCommandRun {
  route?: { method: string; path: string; params: { name: string; in: 'path' | 'query' }[]; body: boolean };
  action?: string;
  data?: 'list' | 'get';
  info?: boolean;
}
export interface PluginCommand {
  id: string;
  title: string;
  description: string;
  kind: 'read' | 'command';
  effect: PluginCommandEffect;
  readOnly: boolean;
  destructive: boolean;
  confirm: boolean;
  run: PluginCommandRun;
  input: Record<string, unknown>;
  output: string;
  source: 'route' | 'action' | 'declared' | 'auto';
  context?: boolean;
}
export interface PluginSkip { route?: string; action?: string; id?: string; why: string }
export interface PluginCommandEntry {
  folder: string;
  app: string;
  id: string;
  name: string;
  version: string;
  description: string;
  provides: string[];
  needs: string[];
  optional: string[];
  dataDir: string;
  enabled: boolean;
  commands: PluginCommand[];
  skipped: PluginSkip[];
  errors: string[];
  unread: { file: string; line: number; why: string }[];
  noReads: string;
  declared: boolean;
}
export interface PluginCommandRegistry { $axf: 'plugin-commands@1'; plugins: PluginCommandEntry[] }
export interface PluginRoute { method: string; path: string; fn: string; doc: string; params: { name: string; in: 'path' | 'query'; type: string; required: boolean; enum?: string[]; default?: unknown }[]; body: boolean; stream: boolean; status?: number; file: string; line: number }
export interface PluginTool { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }; plugin: string; command: string; kind: 'read' | 'command'; effect: PluginCommandEffect }

export const PLUGIN_COMMANDS_FRAME: 'plugin-commands@1';
export const PLUGIN_COMMAND_METHODS: readonly string[];
export const PLUGIN_COMMAND_RUNS: readonly string[];
export const PLUGIN_COMMAND_EFFECTS: readonly PluginCommandEffect[];
export const PLUGIN_TOOL_MAX: number;
export const PLUGIN_AUTO_READS: readonly string[];
export const PLUGIN_GENERIC_TOOLS: readonly string[];
export function commandSlug(s: unknown): string;
export function scanPythonRoutes(src: string, file?: string): { routes: PluginRoute[]; unread: { file: string; line: number; why: string }[] };
export function scanWebActions(src: string, file?: string): { id: string; label: string; context: boolean; searchable: boolean; file: string; line: number }[];
export function normalizeCommandsBlock(raw: unknown): { block: { $axf: 'plugin-commands@1'; auto: boolean; items: Record<string, unknown>[]; noReads?: string }; errors: string[]; declared: boolean };
export function routeEffect(method: string, path: string): PluginCommandEffect;
export function actionEffect(id: string): PluginCommandEffect;
export function derivePluginCommands(plugin: Record<string, unknown>): Pick<PluginCommandEntry, 'folder' | 'commands' | 'skipped' | 'errors' | 'unread' | 'noReads' | 'declared'>;
export function pluginCommandRegistry(plugins: Record<string, unknown>[]): PluginCommandRegistry;
export function resolvePluginCommand(registry: PluginCommandRegistry, path: string): { plugin: PluginCommandEntry; command: PluginCommand } | null;
export function pluginInputErrors(cmd: PluginCommand, input: unknown): string[];
export function pluginRouteRequest(folder: string, cmd: PluginCommand, input?: Record<string, unknown>): { method: string; path: string; query: Record<string, string>; body: unknown };
export function commandToolName(folder: string, id: string, app?: string): string;
export function pluginControlCommand(folder: string, cmd: PluginCommand, input?: Record<string, unknown>, extra?: Record<string, unknown>): Record<string, unknown>;
export function pluginCommandTools(registry: { plugins: PluginCommandEntry[] }): PluginTool[];
export function pluginCommandRoutes(registry: { plugins: PluginCommandEntry[] }): { plugin: string; command: string; method: string; path: string; query?: string; body?: string }[];
export function pluginCommandCli(registry: { plugins: PluginCommandEntry[] }): { usage: string[]; commands: { plugin: string; command: string; usage: string; help: string }[] };
export function pluginHelp(entry: PluginCommandEntry): string;
export function pluginCommandCoverage(entry: PluginCommandEntry, opts?: { requireBlock?: boolean }): { ok: boolean; errors: string[]; warnings: string[]; reads: number; commands: number };
