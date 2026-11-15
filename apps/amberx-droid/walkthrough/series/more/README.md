# More videos (hero stories and deep dives)

The second batch of the AmberX video series (build `demo-video-series-three-minute-browser`, steps s5 onward). One
file per video; `index.mjs` lists them in order. Same shape as `../scripts.mjs` (chapters → scenes with `say`, `shot`,
`app`, `staged`), plus:

| Field | Where | Meaning |
|---|---|---|
| `kind` | video | `hero` (a story, sells the idea), `deep` (one feature in depth) or `real` (no staging at all, real data only) |
| `step` | video | the build step that wrote it |
| `camera` | scene | `screen` (default: a screen recording) or `story` (dramatized b-roll: a person, a street, a bedroom). Story scenes never show a product screen, so they need no Preview label. |
| `staged` | scene | a product screen that isn't built yet, shown as a mock with a visible **Preview** label. The narration of any video with staged scenes says "preview" out loud. `real` videos may not have any. |
| `short` | video | the 60-second cut: its own scenes (re-narrated, not just trimmed), 50 to 70 seconds. Same staging rules. |
| `extra` | video | an optional extra cut (for example the uncut banter of the overnight video). Not checked for length. |
| `facts` | video | the real numbers and names the script leans on, with where they come from, so a reviewer can recheck them. |

Check everything (both batches):

```bash
node apps/amberx-droid/walkthrough/series/check.mjs --table
```

Rules the scripts keep:

- Real where it exists: the android-compose template, the 23 libraries in `framework/catalog/libraries.json`, the six
  skins in `framework/assets/skin`, Plan Studio, the build orchestrator, Crew, UI Review, axHub approvals.
- Not built yet means staged, labelled Preview on screen and said out loud: the library matrix, voice-to-app assembly,
  location, maps, camera and chart libraries, the finished hero apps themselves.
- People in stories who aren't given a name or pronoun in the brief stay neutral.
- Location and recording are always opt-in, with the consent prompt on screen.
