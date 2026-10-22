/**
 * Build options — the `--switches` every UI build accepts (CLI, engine-rpc, `axf serve`, console API/UI, console MCP).
 * The registry is framework/schemas/build-options.json; the build engine writes each option as an asset token
 * (e.g. --wrap-groups → style-theme `wrapGroups`). New builds default every option to its registry default (off).
 */
import registry from '../schemas/build-options.json';

export interface BuildOptionSpec {
  label: string;
  description: string;
  type: 'boolean';
  default: boolean;
  token: { assetType: string; field: string };
  since?: string;
}

export const BUILD_OPTIONS = registry.options as unknown as Record<string, BuildOptionSpec>;
export type BuildOptionValues = Record<string, boolean>;

/** Every option at its default, then the given values. */
export function resolveBuildOptions(given: BuildOptionValues = {}): BuildOptionValues {
  const out: BuildOptionValues = {};
  for (const [name, spec] of Object.entries(BUILD_OPTIONS)) out[name] = name in given ? !!given[name] : spec.default;
  return out;
}

/** The CLI switches for a set of values: only the ones that differ from their default, e.g. `--wrap-groups`. */
export function buildOptionFlags(values: BuildOptionValues): string {
  return Object.entries(values)
    .filter(([n, v]) => BUILD_OPTIONS[n] && v !== BUILD_OPTIONS[n].default)
    .map(([n, v]) => (v ? `--${n}` : `--no-${n}`))
    .join(' ');
}
