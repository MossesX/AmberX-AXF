// Types for client.mjs (the shared control@1 client).
export interface ControlCommand { $axf?: 'control@1'; op: string; target: string; path?: string; value?: unknown; action?: string; input?: Record<string, unknown>; select?: Record<string, unknown>; confirm?: string; by?: string; reason?: string }
export type ControlAnswer = { $axf: 'control@1'; ok: boolean; op?: string; target?: string; path?: string; code?: string; message?: string; confirm?: string; items?: any[]; total?: number; item?: any; value?: unknown; changed?: boolean; removed?: number; note?: string; [k: string]: unknown };
export interface AuditOpts { by?: string; reason?: string }
export declare const CONTROL_PATH: string;
export interface ControlClient {
  root: string;
  send(command: Partial<ControlCommand> & { op: string; target: string }): Promise<ControlAnswer>;
  list(target: string, select?: Record<string, unknown>): Promise<ControlAnswer>;
  get(target: string, path: string): Promise<ControlAnswer>;
  set(target: string, path: string, value: unknown, o?: AuditOpts): Promise<ControlAnswer>;
  reset(target: string, path?: string, o?: AuditOpts): Promise<ControlAnswer>;
  add(target: string, value: Record<string, unknown>, o?: AuditOpts): Promise<ControlAnswer>;
  remove(target: string, path: string, o?: AuditOpts & { confirm?: string }): Promise<ControlAnswer>;
  act(target: string, path: string, action: string, input?: Record<string, unknown>, o?: AuditOpts): Promise<ControlAnswer>;
  registry(): Promise<any>;
  audit(n?: number): Promise<{ ok: boolean; items?: any[] }>;
}
export declare function controlClient(opts?: { base?: string; token?: string; fetch?: typeof fetch; headers?: Record<string, string>; path?: string }): ControlClient;
export declare function controlForms(command: Partial<ControlCommand>, opts?: { base?: string }): { rest: string; mcp: { tool: string; arguments: Record<string, unknown> }; cli: string };
