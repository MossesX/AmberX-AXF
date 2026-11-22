/** app-menus@1 — types for app-menus-rules.mjs (every app's own locked default nav + app menu). */
export type MenuKind = 'nav' | 'appmenu';
export type MenuType = 'nav-menu' | 'app-menu';
export interface MenuAssetLike { id: string; type?: string; name?: string; description?: string; data?: unknown }
export interface MenuChoice { id: string; name: string; description: string; isDefault: boolean }
export interface MenuPick { id: string | null; defaultId: string | null; locked: boolean; source: 'pick' | 'default' | 'migrated' }
export interface MenuStateRow { kind: MenuKind; type: MenuType; id: string | null; defaultId: string | null; locked: boolean; choices: string[] }
export const APP_MENUS_CONTRACT: 'app-menus@1';
export const APP_MENU_FIELD: 'builtFor';
export const APP_MENU_KINDS: { nav: 'nav-menu'; appmenu: 'app-menu' };
export const APP_MENU_TYPES: MenuType[];
export const APP_MENU_LABELS: Record<MenuKind, string>;
export function menuKindOf(type: string): MenuKind | null;
export function menuTypeOf(kind: string): MenuType | null;
export function menuOwner(app: string): string | null;
export function parseMenuBuiltFor(v: unknown): string | null;
export function menuDefaultId(app: string, kindOrType: string): string | null;
export function parseMenuDefaultId(id: unknown): { app: string; kind: MenuKind; type: MenuType } | null;
export function appOfDefaults(defaults: unknown): string | null;
export function menuBuiltForOf(asset: unknown): string | null;
export function menuAllowed(app: string | null, asset: MenuAssetLike | null | undefined): boolean;
export function menuChoices(app: string, kindOrType: string, assets: readonly MenuAssetLike[]): MenuChoice[];
export function menuPick(current: unknown, app: string, kindOrType: string, assets: readonly MenuAssetLike[]): MenuPick;
export function menuSet(app: string, kindOrType: string, which: string, assets: readonly MenuAssetLike[]): { id: string; error?: undefined } | { error: string; id?: undefined };
export function parseMenuArgs(args: unknown): { kind: MenuKind; type: MenuType; which: string } | null;
export function menuState(app: string, active: unknown, assets: readonly MenuAssetLike[]): MenuStateRow[];
export function auditAppMenus(app: string, opts?: { defaults?: unknown; ownAssets?: readonly MenuAssetLike[]; sharedIds?: readonly string[] }): { app: string; errors: string[] };
