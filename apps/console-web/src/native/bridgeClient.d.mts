// Types for bridgeClient.mjs (window.axfNative, native-bridge@1; apps/console-droid/BRIDGE.md).
export declare const BRIDGE_VERSION: 'native-bridge@1';
export declare const BRIDGE_HOST: 'axfBridgeHost';
export declare const BRIDGE_EVENT: 'axf-native';
export declare const READY_EVENT: 'axf-native-ready';
export declare const CALL_TIMEOUT_MS: number;
export declare const TOOLS: string[];
export declare const EVENTS: string[];
export declare const ERROR_CODES: string[];
export declare const LEGACY_METHODS: string[];

export interface BridgeError extends Error { code: string; permissions?: string[] }
export type BridgeListener = (data: Record<string, unknown>, event: string) => void;

export interface AxfNativeBridge {
  version: 'native-bridge@1';
  available: true;
  tools: string[];
  events: string[];
  /** Runs one native tool (any alias); rejects with a BridgeError. */
  call(tool: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Listens for a native event ('*' for all); returns the unsubscriber. */
  on(event: string, fn: BridgeListener): () => void;
  dispose(): void;
  pendingCount(): number;
}

export declare function toolOf(raw: unknown): string | null;
export declare function argsFor(raw: unknown, args: unknown): Record<string, unknown>;
export declare function bridgeError(code: string, message?: string, permissions?: string[]): BridgeError;
export declare function bridgeAvailable(win: unknown): boolean;
export declare function createBridge(win: unknown, opts?: { timeoutMs?: number }): AxfNativeBridge;
export declare function mergeBridge(bridge: AxfNativeBridge, prev: unknown): AxfNativeBridge;
export declare function installBridge(win: unknown, opts?: { timeoutMs?: number }): () => void;
export declare function nativeTool(win: unknown, name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare const PERMISSION_WAIT_MS: number;
export declare function requestPermission(win: unknown, permission: 'mic' | 'notifications' | 'overlay' | string, opts?: { waitMs?: number }): Promise<boolean>;
export declare function callWithPermissions(win: unknown, name: string, args?: Record<string, unknown>, opts?: { waitMs?: number }): Promise<Record<string, unknown>>;
