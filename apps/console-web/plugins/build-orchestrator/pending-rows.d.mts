/** Types for pending-rows.mjs (pending-rows-view@1): only what the web part imports. */
export declare const SCHEMA: 'pending-rows-view@1';
export declare function actionRoute(spec: string): { method: 'GET' | 'POST'; path: string } | null;
export declare function viewerKey(viewer: string): string;
export declare function isBuildId(id: unknown): boolean;
