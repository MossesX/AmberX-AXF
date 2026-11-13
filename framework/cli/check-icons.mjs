#!/usr/bin/env node
/**
 * Icon conformance check (icon-map@1; build icon-map-icon-packs-every-icon-badge-app, Nov 13 2026): every icon, badge
 * and logo in every app, plugin and the framework chrome is a slot in the icon map, and no icon is hard-coded outside
 * it. CI runs this (.github/workflows/android.yml); `node framework/cli/icon-map.mjs check` is the same.
 *
 *   node framework/cli/check-icons.mjs [--update-baseline] [--json]
 *
 * Fails on:
 *  - a literal icon name (`<Icon name="x">`, `icon: 'x'`, `icon="x"`, `"icon": "x"`) that is neither a framework glyph
 *    or alias (framework/core/engines/glyphs.mjs) nor a role a plugin declares in plugin.json `icons.roles`: it draws
 *    the fallback box; add the glyph, declare the role, or use a known name;
 *  - a raw icon in UI code: an inline `<svg>` in JSX or an emoji / dingbat used as a glyph, beyond the ratchet baseline
 *    framework/spec/icon-map-baseline.json (file → count; it may only shrink; `--update-baseline` rewrites it after a
 *    fix). Put `icon-ok` in a comment on the line to allow a deliberate one (a brand mark drawn as paths, say);
 *  - a plugin.json `icons` block that does not validate.
 */
import { main } from './icon-map.mjs';

process.exit(await main(['check', ...process.argv.slice(2)]));
