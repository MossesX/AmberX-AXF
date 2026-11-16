export type SkinAnimationKey = 'swatches' | 'skinSwitch' | 'picker';
export type AnimationPrefKey = SkinAnimationKey | 'speed' | 'intensity';
export interface AnimationMotion { swatches: string; skinSwitch: string; picker: string; animSpeed: number; animIntensity: number }
export interface AnimationPrefs { swatches?: string; skinSwitch?: string; picker?: string; speed?: number; intensity?: number }
export interface AnimationState {
  reduced: boolean;
  speed: number;
  intensity: number;
  animations: { key: SkinAnimationKey; label: string; help: string; value: string; skin: string; own: boolean; on: boolean; options: string[] }[];
  prefs: AnimationPrefs;
}
export const ANIMATION_ENUMS: { swatches: readonly string[]; skinSwitch: readonly string[]; picker: readonly string[] };
export const ANIMATION_RANGES: { animSpeed: readonly [number, number]; animIntensity: readonly [number, number] };
export const ANIMATION_DEFAULTS: AnimationMotion;
export const SKIN_ANIMATIONS: readonly { key: SkinAnimationKey; label: string; attr: string; help: string }[];
export const ANIMATION_PREFS_KEY: 'axf.appearance.animations';
export const ANIMATION_PREF_KEYS: readonly AnimationPrefKey[];
export function normalizeAnimationMotion(motion: unknown): AnimationMotion;
export function normalizeAnimationPrefs(raw: unknown): AnimationPrefs;
export function setAnimationPref(prefs: unknown, key: string, value: unknown): AnimationPrefs | null;
export function applyAnimationPrefs(motion: unknown, prefs: unknown): AnimationMotion;
export function animationStateOf(motion: unknown, prefs: unknown, reduced?: boolean): AnimationState;
