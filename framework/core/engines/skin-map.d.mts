export const SKIN_MAP_CONTRACT: 'skin-map@1';
export const SKIN_MAP_FRAME: 'skin-map@1';
export const APPEARANCE_PROJECT: 'shared';
export const APPEARANCE_PATH: 'settings/appearance.json';
export const HUB_MOUNT: '/projects';
export const SKIN_MAP_ROW_KINDS: readonly string[];
export const SKIN_MAP_CONTROLS: readonly ('asset' | 'dataset' | 'layout' | 'tokens' | 'settings')[];
export const SECTION_TOKEN_SOURCES: Readonly<Record<string, RegExp>>;
export const COMPONENT_ELEMENTS: Readonly<Record<string, string>>;

export interface HubPlace { hub: string; mount: string; dataStore: string | null }
export function dataStoreKey(paths: unknown, root: string, rel: string): string | null;
export function hubPlace(paths: unknown, project: string, path: string): HubPlace;
export function cssReaders(css: string, test: string | RegExp): string[];
export function tokenReaders(sheets: Record<string, string>, prefix: string): { selector: string; file: string }[];
export function tokensBySource(tokens: readonly { id: string; source?: string; sources?: string[] }[], test: string | RegExp): string[];
export function tokenElements(tokens: readonly { id: string; element?: string }[], ids: readonly string[]): string[];

export interface SkinMapRow {
  slot: string; kind: string; type?: string; label?: string; by?: string; via?: string; elements?: string[];
  controls: string[]; tokens: string[]; attributes?: string[]; settings: string[]; components: string[]; selectors?: string[];
  layout?: boolean; why?: string; lives: Record<string, unknown> | null;
}
export interface SkinMapDataset { id: string; app?: string; contract: string; what: string; hub: string | null; mount: string | null; dataStore: string | null; repo: string; baked?: string[]; ids?: string[]; writtenBy?: string[]; readBy?: string[] }
export interface SkinMapLayout { type: string; label: string; ids: string[]; tokens: string[]; repo: string; baked: string[]; pick: Record<string, unknown>; overrides: string | null; engine: string }
export interface SkinMapInputs {
  registry: unknown; customize: unknown; tokens: unknown; componentFamilies: unknown; dataStorePaths: unknown;
  apps: { id: string; dir: string }[]; assets: Record<string, string[]>; sheets: Record<string, string>; generatedAt?: string;
}
export interface SkinMapDocument {
  $axf: 'skin-map@1'; generated: true; readOnly: true; note: string; generatedAt?: string;
  sources: Record<string, unknown>; kinds: string[]; coverageKinds: string[];
  summary: { slots: number; datasets: number; layouts: number; tokens: number; settings: number };
  slots: SkinMapRow[]; datasets: SkinMapDataset[]; layouts: SkinMapLayout[];
}
export function skinMap(inputs: SkinMapInputs): SkinMapDocument;
export function skinMapFind(map: SkinMapDocument | null | undefined, needle: string): SkinMapRow[];
export function skinMapErrors(raw: unknown): string[];
export function skinMapJsonSchema(): Record<string, unknown>;
