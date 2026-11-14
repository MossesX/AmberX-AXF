// Types for deviceActions.mjs.
export declare const DEVICE_ADDRESS: 'panel:phone-bridge';
export declare const DEVICE_ACTIONS: Array<{ id: string; params: boolean; effect: 'read' | 'write' }>;
export declare function deviceCall(id: string, rawArgs?: unknown[]): { tool: string; args: Record<string, unknown> } | { error: string };
export declare function describeDevice(tool: string, data: Record<string, unknown> | undefined): string;
