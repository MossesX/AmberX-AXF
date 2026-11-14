# Console look becomes default axHub skin

Build `console-look-becomes-default-axhub-skin`, branch `claude/console-look-becomes-default-axhub-skin`.

Brett (2026-11-14 22:19): "Keep the design, all the style, the way the console looks right now, and make it the default axHub look, and then make all the apps inherit it right now"

## Baseline
- Baseline commit: `a2c2995d1f4dc372ed1ce268655668d3df89e591` (origin/main, 2026-11-14 22:42 UTC).
- Wait gate (s1): passed. All 8 skin PRs are in origin/main:
  - #647 skins-plugin-merge-main-and-land, #648 skin-config-panel-merge-main-and-land, #590 every-skin-ships-light-dark-colour-theme, #618 console-skin-axhub-only: landed stacked, inside #641 (branch tips are ancestors of main).
  - #641 skin-axhub-override-switch-greyed-out (`2bb2c6a7d`), #652 skin-animations-swatches-skin-switch (`aee42bbe8`), #657 token-registry-skin-editor-live-sandbox (`c0d479286`), #654 own-token-sets-for-grids-and-tab-groups (`647b79e58`).
  - `land-all-skin-builds` is still `running`, but only on s23-s25 (redeploy, deploy log and phone note, wrap-up). The code this build depends on is merged; the live console may not be redeployed yet, so the pixel baseline is built from the baseline commit, not taken from the live server.
