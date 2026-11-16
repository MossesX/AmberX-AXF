export declare const SHAPE_LEVELS: readonly ['instance', 'app', 'skin', 'global'];
export type ShapeLevel = 'instance' | 'app' | 'skin' | 'global';
export declare const SHAPE_KEY_GLOBAL: 'global';
export declare const SHAPE_KEY_SKIN: 'skin';
export declare const SHAPE_KEY_APP: 'app';
export declare const SHAPE_SETTING: string;
export declare const SHAPE_SKIN_SETTING: string;
export declare const SHAPE_HISTORY_SETTING: string;
export declare const SHAPE_WIDGET_SETTING_PREFIX: string;
export declare const SHAPE_WIDGET_SETTING_SUFFIX: string;
export declare const SHAPE_HISTORY_MAX: number;
/** One level's pick: the key and the shape asset id picked there ('' = inherit). */
export interface ShapeScopeEntry { key: string; id: string }
/** What is in force: the id (the default kind's id when nothing is picked), the deciding key and level, the chain seen. */
export interface ShapeResolved { id: string; from: string; level: ShapeLevel | 'default'; chain: ShapeScopeEntry[] }
/** One key's last edit: what it was, what it is, when. */
export interface ShapeEdit { previous: string; current: string; at: string }
/** The edit history: key → its last edit. Plain data, saved with the settings. */
export type ShapeHistory = Record<string, ShapeEdit>;
export declare function shapeId(v: unknown): string;
export declare function shapeScopeKey(level: ShapeLevel, widget?: string | null): string;
export declare function shapeScopeLevel(key: string): { level: ShapeLevel; widget?: string } | null;
export declare function shapeScopeChain(place?: { widget?: string | null } | null): string[];
export declare function resolveShape(chain: readonly ShapeScopeEntry[]): ShapeResolved;
export declare function resolveShapeAt(place: { widget?: string | null } | null | undefined, stateOf: (key: string) => unknown): ShapeResolved;
export declare function normalizeShapeHistory(raw: unknown): ShapeHistory;
export declare function recordShapeEdit(history: ShapeHistory, key: string, previous: unknown, current: unknown, at: string): ShapeHistory;
export declare function previousShape(history: ShapeHistory, key: string): string | null;
export declare function restorePreviousShape(history: ShapeHistory, key: string, at: string): { id: string; history: ShapeHistory } | null;
export declare function forgetShapeEdit(history: ShapeHistory, key: string): ShapeHistory;
