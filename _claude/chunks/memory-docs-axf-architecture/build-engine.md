<!-- memory-chunk@1 source=_claude/memory/docs/axf-architecture.md tokens=228 -->
## Build engine

```bash
node framework/cli/axf.mjs init apps/my-app --template android-compose --boilerplate notes --name "My Notes"
node framework/cli/axf.mjs validate apps/my-app      # structure + assets per the template's template.json
node framework/cli/axf.mjs new-module media --label "Media" --capabilities android.media
node framework/cli/axf.mjs new-demo media            # apps/demo-media showcasing one library
node framework/cli/axf.mjs templates | boilerplates | modules
node framework/cli/axf.mjs dev apps/console          # live-reload assets to devices (HMR for everything that is JSON)
node framework/cli/axf.mjs serve --token secret      # HTTP driver used by the Dev Console (run on the VPS)
node framework/cli/tracker.mjs                       # regenerate tracker.json
npx -y tsx framework/spec/gen-fixtures.mts           # regenerate conformance fixtures from the reference engines
```
