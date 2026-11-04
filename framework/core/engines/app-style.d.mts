// Types for app-style.mjs (app-style@1: an app's design / colours over axHub's look).
import type { InheritPart } from './inherit.mjs';
export type AppStylePart = 'design' | 'colors';
export interface AppStyleOwn { slots: Record<string, string>; keys: Record<string, unknown> }
export interface AppStyle { $axf: 'app-style@1'; design?: true; colors?: true; own: AppStyleOwn; by?: string; at?: string }
export interface AppStyleChange { slots?: Record<string, string | null>; settings?: Record<string, unknown>; hidden?: Record<string, boolean | null>; spacing?: string; palette?: unknown }
export interface AppStyleHistoryEntry { at: string; by: string; app: string; parts: AppStylePart[]; slots: Record<string, string | null>; keys: Record<string, unknown> }
export interface AppStyleValue { kind: 'slot' | 'key'; name: string; axhub: unknown; own: unknown; from: 'own' | 'axhub'; differs: boolean }
export interface AppStyleView { $axf: 'app-style@1'; app: string; source: boolean; parts: { id: AppStylePart; label: string; detail?: string; overriding: boolean; values: AppStyleValue[] }[]; history: number; by: string; at: string }
export declare const APP_STYLE_FRAME: 'app-style@1';
export declare const APP_STYLE_PREFIX: 'axf.appearance.app.';
export declare const APP_STYLE_HISTORY_KEY: 'axf.appearance.history';
export declare const APP_STYLE_HISTORY_MAX: number;
export declare const APP_STYLE_SETTING_MAX: number;
export declare const APP_STYLE_PACKAGE_OVERRIDES: 'axf.appearance.overrides';
export declare const APP_STYLE_PARTS: InheritPart[];
export declare const APP_STYLE_PART_IDS: AppStylePart[];
export declare const APP_STYLE_APPS: { id: string; label: string }[];
export declare function registerStyleSource(appId: string): void;
export declare function isStyleSource(appId: string): boolean;
export declare function registerStyleApp(id: string, label?: string): void;
export declare function appStyleKey(appId: string): string;
export declare function isAppStyleKey(key: string): boolean;
export declare function appStyleSlotParts(slot: string): AppStylePart[];
export declare function appStyleKeyParts(key: string): AppStylePart[];
export declare function normalizeAppStyle(raw: unknown): AppStyle;
export declare function appStyleOf(doc: { settings?: Record<string, unknown> } | null | undefined, appId: string): AppStyle;
export declare function appStyleFlags(style: unknown): Partial<Record<AppStylePart, true>>;
export declare function heldSlot(style: unknown, slot: string): boolean;
export declare function heldKey(style: unknown, key: string): boolean;
export declare function serializeAppStyle(style: unknown, by?: string, at?: string): AppStyle | null;
export declare function withPartOverride(style: unknown, part: AppStylePart, on: boolean, current?: { slots?: Record<string, string>; keys?: Record<string, unknown> }): AppStyle;
export declare function filterLookChange<C extends AppStyleChange>(change: C, style: unknown, opts?: { isSource?: boolean }): { change: C; style: AppStyle; switched: AppStylePart[]; changed: boolean };
export declare function emptyLookChange(c: AppStyleChange | null | undefined): boolean;
export declare function hubStyleValues(doc: { slots?: Record<string, string>; settings?: Record<string, unknown> } | null | undefined, resolve?: (slot: string) => string | undefined | null): { slots: Record<string, string>; keys: Record<string, unknown> };
export declare function appsFollowing(doc: unknown, parts: string[], apps?: { id: string; label: string }[]): { id: string; label: string }[];
export declare function styleHistory(doc: unknown): AppStyleHistoryEntry[];
export declare function saveToHubChange(doc: unknown, parts: string[], own: { slots?: Record<string, string>; keys?: Record<string, unknown> }, opts?: { appId?: string; by?: string; at?: string }): { change: { slots?: Record<string, string>; settings: Record<string, unknown> }; parts: AppStylePart[] };
export declare function restorePreviousChange(doc: unknown): { change: { slots: Record<string, string | null>; settings: Record<string, unknown> }; entry: AppStyleHistoryEntry } | null;
export declare function appStyleView(doc: unknown, appId: string, hub: { slots?: Record<string, string>; keys?: Record<string, unknown> } | null, current?: { slots?: Record<string, string>; keys?: Record<string, unknown> } | null): AppStyleView;
