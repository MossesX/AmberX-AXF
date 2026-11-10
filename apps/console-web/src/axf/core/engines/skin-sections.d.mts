import type { TypeSpecs, StyleTargets } from './skin-coverage.mjs';

export const SKIN_SECTIONS_CONTRACT: 'skin-sections@1';
export const SKIN_PACKAGE_FRAME: 'skin-package@1';
export const CHROME_SET_TYPE: 'chrome-set';
export const STYLE_PARTS_TYPE: 'style-parts';

export type SkinSectionId = 'colors' | 'design' | 'layout' | 'behavior' | 'typography' | 'density' | 'sizing' | 'icons' | 'controls' | 'chrome' | 'parts';
export interface SkinSectionSpec { id: SkinSectionId; label: string; type: string; icon: string; required: boolean; what: string }
export const SKIN_SECTIONS: readonly SkinSectionSpec[];
export const SKIN_SECTION_IDS: readonly SkinSectionId[];
export const REQUIRED_SECTIONS: readonly SkinSectionId[];

/** Section → asset id. */
export type SkinSections = Partial<Record<SkinSectionId, string>>;
/** app-look@1 `skin.sections`: a section swapped for another asset, or left out (null). */
export type SectionOverrides = Partial<Record<SkinSectionId, string | null>>;

export interface ChromeSetData { slots: Record<string, string>; hidden?: Record<string, boolean>; spacing?: string; settings?: Record<string, unknown> }
export interface StylePartsData { parts: Record<string, Record<string, unknown>> }

/** The resolved form of a skin this module reads and writes (skin.ts's SkinData, structurally). */
export interface ResolvedSkinLike {
  layoutTheme: string; colorTheme: string; styleTheme: string; assets: Record<string, string>;
  iconPack?: string; parts?: Record<string, Record<string, unknown>>; sections?: SkinSections;
  preview?: { caption?: string; image?: string }; extras?: { spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> };
}
export type SectionResolver = (type: string, id: string) => unknown;

export function skinSection(id: string): SkinSectionSpec | null;
export function sectionOfType(type: string): SkinSectionId | '';
export function sectionType(id: string): string;
export function isSectionId(id: unknown): id is SkinSectionId;
export function chromeSlotTypes(allTypes: readonly string[], members?: readonly string[]): string[];

export function normalizeChromeSet(raw: unknown, members?: readonly string[]): ChromeSetData;
export function chromeSetErrors(raw: unknown, members?: readonly string[]): string[];
export function normalizeStyleParts(raw: unknown): StylePartsData;
export function stylePartsErrors(raw: unknown, types: TypeSpecs, targets: StyleTargets): string[];

export function normalizeSections(raw: unknown): SkinSections;
export function sectionsErrors(raw: unknown): string[];
export function sectionsOf(skin: unknown): SkinSections;
export function inlineSectionsOf(skin: unknown, members?: readonly string[]): { chrome?: ChromeSetData; parts?: StylePartsData };

export function stripSection<T extends ResolvedSkinLike>(skin: T, sec: string, members?: readonly string[]): T;
export function setSection<T extends ResolvedSkinLike>(skin: T, sec: string, id: string, resolve?: SectionResolver | null, members?: readonly string[]): T;
export function resolveSections(sections: SkinSections, resolve?: SectionResolver | null, members?: readonly string[]): ResolvedSkinLike;
export function applySectionOverrides<T extends ResolvedSkinLike>(skin: T, overrides: SectionOverrides | null | undefined, resolve?: SectionResolver | null, members?: readonly string[]): T;
export function normalizeSectionOverrides(raw: unknown): SectionOverrides;

export interface SkinMix {
  sections: SkinSections;
  /** section → the skin it came from ('own' = the app's own look). */
  sources: Partial<Record<SkinSectionId, string>>;
  mixed: boolean;
  from: string[];
  /** the incoming skin's sections that were left out */
  left: SkinSectionId[];
  overrides: SectionOverrides;
}
export function mixSkins(current: { skin: string; sections: SkinSections } | null, incoming: { skin: string; sections: SkinSections }, include?: readonly string[] | null): SkinMix;

export interface SkinManifestMeta { id?: string; name?: string; version?: string; description?: string; author?: string; tags?: string[] }
export interface SkinAssetEnvelope { $axf: 'asset@1'; type: 'skin'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: { sections: SkinSections; preview?: { caption?: string; image?: string } } }
export function skinManifest(meta: SkinManifestMeta, sections: SkinSections, preview?: { caption?: string; image?: string } | null): SkinAssetEnvelope;
export function slug(name: unknown): string;
export function missingSections(sections: SkinSections, has: (type: string, id: string) => boolean): string[];

export interface AssetEnvelopeLike { $axf: string; type: string; id: string; name?: string; description?: string; tags?: string[]; data: unknown; __source?: string }
export interface SkinPackage { $axf: 'skin-package@1'; exportedAt: string; skin: AssetEnvelopeLike; sections: AssetEnvelopeLike[]; missing: string[] }
export function exportSkinPackage(skinAsset: AssetEnvelopeLike, assetOf: (type: string, id: string) => AssetEnvelopeLike | null | undefined): SkinPackage;
export function importSkinPackage(raw: unknown): { ok: boolean; errors: string[]; skin?: AssetEnvelopeLike; sections: AssetEnvelopeLike[]; notIncluded?: SkinSectionId[] };

export interface SliceEntry { section: SkinSectionId; type: string; id: string; name: string; description: string; tags: string[]; source: string; usedBy: string[]; preview: SlicePreview }
export interface SlicePreview { swatches?: string[]; scheme?: string; facts?: string[] }
export function sliceCatalog(lists: (type: string) => readonly AssetEnvelopeLike[] | undefined, skins?: readonly { id: string; data: unknown }[]): SliceEntry[];
export function slicePreview(sec: string, data: unknown): SlicePreview;

export function skinThumbnail(colors: unknown, layout: unknown, opts?: { name?: string; radius?: string }): string;
export function thumbnailDataUri(svg: string): string;
