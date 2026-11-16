/**
 * Stand-in for the framework's console-control target registry (framework/react/controlTargets.ts) in an app whose baked
 * framework copy predates it. ExpanderPicker registers its `setting:` target through this; here it registers nothing, so
 * the picker works without the console API. `node framework/cli/rebake.mjs apply <app>` replaces this file with the real one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ControlTargetDef = Record<string, any>;
const noop = () => {};
export function useControlTarget(_def: ControlTargetDef | null, _deps: readonly unknown[] = []): (el: Element | null) => void { return noop; }
export const controlSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
