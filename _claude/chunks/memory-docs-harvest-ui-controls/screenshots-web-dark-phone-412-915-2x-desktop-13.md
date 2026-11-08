<!-- memory-chunk@1 source=_claude/memory/docs/harvest/ui-controls.md lines=88-111 tokens=642 -->
### Screenshots (web, dark, phone 412×915 @2x + desktop 1366×860)

Before = clean checkout of `6406c87`; after = this branch. Files in `ui-controls/shots/{before,after}/`.

| Screen | Before | After |
| --- | --- | --- |
| Plugin switches (desktop) | ![](ui-controls/shots/before/plugin-switches-desktop.png) | ![](ui-controls/shots/after/plugin-switches-desktop.png) |
| Plugin switches (phone) | ![](ui-controls/shots/before/plugin-switches-phone.png) | ![](ui-controls/shots/after/plugin-switches-phone.png) |
| Theme manager (desktop) | ![](ui-controls/shots/before/theme-manager-desktop.png) | ![](ui-controls/shots/after/theme-manager-desktop.png) |
| Theme manager (phone) | ![](ui-controls/shots/before/theme-manager-phone.png) | ![](ui-controls/shots/after/theme-manager-phone.png) |
| Install wizard (desktop) | ![](ui-controls/shots/before/install-wizard-desktop.png) | ![](ui-controls/shots/after/install-wizard-desktop.png) |
| Install wizard (phone) | ![](ui-controls/shots/before/install-wizard-phone.png) | ![](ui-controls/shots/after/install-wizard-phone.png) |
| Components → Controls (desktop) | ![](ui-controls/shots/before/components-controls-desktop.png) | ![](ui-controls/shots/after/components-controls-desktop.png) |
| Components → Inputs (desktop) | ![](ui-controls/shots/before/components-inputs-desktop.png) | ![](ui-controls/shots/after/components-inputs-desktop.png) |
| Components → Inputs (phone) | ![](ui-controls/shots/before/components-inputs-phone.png) | ![](ui-controls/shots/after/components-inputs-phone.png) |
| Components → Containers (desktop) | ![](ui-controls/shots/before/components-containers-desktop.png) | ![](ui-controls/shots/after/components-containers-desktop.png) |
| Components → Data & media (desktop) | ![](ui-controls/shots/before/components-data-desktop.png) | ![](ui-controls/shots/after/components-data-desktop.png) |
| Settings → Appearance (phone) | ![](ui-controls/shots/before/settings-appearance-phone.png) | ![](ui-controls/shots/after/settings-appearance-phone.png) |
| Settings → Appearance (desktop) | ![](ui-controls/shots/before/settings-appearance-desktop.png) | ![](ui-controls/shots/after/settings-appearance-desktop.png) |
| Boilerplates (desktop) | ![](ui-controls/shots/before/boilerplates-desktop.png) | ![](ui-controls/shots/after/boilerplates-desktop.png) |

Android (console Components gallery, Element explorer, Install wizard) is captured by CI when the branch is pushed
(`rebuild-shots.yml`); the Kotlin was written without a compiler, so the first CI run is also its compile check.
