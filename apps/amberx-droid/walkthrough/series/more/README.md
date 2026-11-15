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

## The videos

| Step | id | Title | Kind | Length | 60 s cut | Staged scenes |
|---|---|---|---|---|---|---|
| s5 | commute | Talk an Android app into existence on your way to work | hero | 3:09 | 0:53 | 5 |
| s6 | expenses | Say it, spend it, track it: an expense tracker by voice | hero | 3:11 | 0:55 | 5 |
| s8 | boss-texts | The boss texts at 11 PM | hero | 2:59 | 0:54 | 6 |
| s9 | private-chat | Your own private chat server, by lunch | hero | 2:54 | 0:55 | 4 |
| s10 | on-demand | An app whenever you need one | hero | 2:56 | 0:50 | 6 |
| s11 | teen-driver | New driver in the family | hero | 2:48 | 0:53 | 7 |
| s12 | built-with-itself | Built with itself | real | 3:01 |  | 0 |
| s13 | employees | Meet the crew, and train your own expert | deep | 3:07 |  | 0 |
| s14 | architecture | How it all connects | deep | 3:15 |  | 1 |
| s15 | skins-branding | Skins and enterprise branding, in depth | deep | 3:02 |  | 3 |
| s16 | orchestrator | One order through the build orchestrator | deep | 2:53 |  | 0 |
| s17 | console-phone | The console in your pocket | deep | 2:53 |  | 2 |
| s18 | plan-spoken | From a spoken idea to a build plan | deep | 2:47 |  | 0 |
| s18 | voice-console | Run the console by voice | deep | 2:47 |  | 1 |
| s18 | veto-approvals | Approvals and the veto | deep | 2:36 |  | 0 |
| s18 | ui-directory | Every screen, one window away | deep | 2:41 |  | 5 |
| s19 | pov-day | A day with AmberX in your hand | hero | 2:38 | 0:51 | 2 |
| s20 | session-recall | You never lose an idea you said out loud | hero | 2:37 | 0:52 | 4 |
| s21 | live-banners | Live banners, GitHub, and a shell anywhere | deep | 2:41 |  | 0 |
| s21 | nested-notes | Notes inside tasks inside notes | deep | 2:31 |  | 8 |
| s21 | menus-toolbars | Every menu and toolbar, yours to reshape | deep | 2:33 |  | 7 |
| s22 | shipped-features | Shipped Features, and never building it twice | deep | 2:41 |  | 5 |
| s23 | first-five | Your first five minutes | hero | 2:34 | 0:50 | 4 |
| s23 | old-way | The old way vs AmberX | deep | 2:32 | 0:50 | 2 |
| s23 | library-tour | The library tour | deep | 2:41 | 0:50 | 1 |
| s23 | publishing | From built to live | deep | 2:37 | 0:50 | 5 |
| s24 | harvesting | One framework, and code that never gets written twice | deep | 2:40 | 0:52 | 1 |
| s7 | axhub-explainer | axHub: the one true source | deep | 2:42 |  | 4 |

The boss-texts video also has an `extra`: the uncut overnight banter (still clean in words, edgier in jokes).

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
