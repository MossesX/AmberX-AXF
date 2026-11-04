// Types for inherit.mjs (inherit@1: a value follows its source until its owner overrides it).
export type InheritKind = 'slot' | 'key';
export interface InheritPart { id: string; label: string; detail?: string; slots: string[]; keys: string[] }
export type InheritFlags = Record<string, true>;
export interface InheritValues { slots?: Record<string, unknown>; keys?: Record<string, unknown> }
export interface InheritRow { name: string; kind: InheritKind; part: string; value: unknown; from: 'source' | 'own'; source: unknown; own: unknown; differs: boolean }
export declare const INHERIT_FRAME: 'inherit@1';
export declare function normalizeParts(raw: unknown): InheritPart[];
export declare function partsOf(parts: InheritPart[], kind: InheritKind, name: string): string[];
export declare function normalizeFlags(raw: unknown, parts: InheritPart[]): InheritFlags;
export declare function overriding(flags: InheritFlags, partIds: string[]): boolean;
export declare function inheritValue<T>(source: T | undefined, own: T | undefined, isOverriding: boolean): { value: T | undefined; from: 'source' | 'own'; source: T | undefined; own: T | undefined; differs: boolean };
export declare function resolveInherited(parts: InheritPart[], flags: InheritFlags, source?: InheritValues, own?: InheritValues): { values: { slots: Record<string, unknown>; keys: Record<string, unknown> }; rows: InheritRow[] };
export declare function autoOverride(parts: InheritPart[], flags: InheritFlags, touched: { kind: InheritKind; name: string }[], opts?: { isSource?: boolean }): { flags: InheritFlags; switched: string[] };
export declare function inheritNote(row: Pick<InheritRow, 'from' | 'source'>, sourceLabel?: string, fmt?: (v: unknown) => string): string;
