<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=56-75 tokens=418 -->
## Guards kept or tightened

- **Markdown:** both old copies built React elements only and never injected HTML. The shared renderer keeps that,
  keeps the fuller copy's `safeHref` (only `http(s):` / `mailto:` become links; anything else is plain text) and
  `rel="noopener noreferrer"` + `target="_blank"`. The systems-check copy had no links at all; it now gets links, but
  only through the same guard (tightened, not loosened: a `javascript:` target renders as text). Compose version applies
  the same `safeHref` before `LinkAnnotation.Url`.
- **Switch:** the plugin-switches lock logic (its own row greyed and never switchable, read-only when the API is
  down, busy lock while a change is in flight, confirm when a running plugin needs the one being turned off) is
  unchanged — only the drawing moved. Theme-manager's `assets.swap` gate on the Show/Hide toggle unchanged.
- **Library params:** where the three copies disagreed, the strictest wins and is now pinned by fixture:
  - the CLI accepted `y` as true, the web wizard did not (`true|yes|on|1`), Build Pilot used JS truthiness: now
    `true|yes|y|on|1` everywhere (the CLI's set, the superset);
  - Build Pilot's ParamField showed "Required" only for text params and ignored `min`/`max`/`choices`: the shared
    field validates every type like the CLI does;
  - Build Pilot's number field turned `''` into `undefined` but non-numbers into `NaN`: now "Must be a number".
- Theme rules: all new CSS is tokens-only under the strict profile (`check-theme.mjs`: 206 files, 0 problems);
  `theme-swap.mjs` on the built console: 565 elements, 0 colours that never changed, transparency follows the
  style theme.
