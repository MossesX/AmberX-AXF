# AXF Console — Android showcase

The first app on the AmberX AXF Android port and its showcase (the real Dev Console is the web app in `apps/console-web`, React/TypeScript + Python API): it tracks what the framework has (tracker), lets you check features (catalog) and bundle them into libraries (library picker → module + demo app), manages modules/packages/ports, and runs the Boilerplate Manager (browse by category, assemble from features, live preview, import third-party boilerplates).

Data comes from the repo at build time (`framework/catalog`, `tracker.json`, `framework/boilerplates` → `assets/axf/console`), edits persist on the device and export as `status.json` / a Claude Code build plan.

Open `apps/console` in Android Studio (framework modules resolve from `../../framework/android` as a composite build) or `./gradlew :app:assembleDebug`.
