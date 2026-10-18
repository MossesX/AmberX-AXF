# projects/

Project manifests (`project.manifest.json`, project-manifest@1) for Brett's projects whose repos aren't in this
checkout, or don't exist yet. Each folder name is the manifest's `name` = the project's folder on the hub
(`/projects/<name>`). They sync with their hub folders like any project (claude-sync finds every manifest in this repo). When a
project's repo is next opened, move its manifest (and `_claude/`, if any) into that repo's root and delete the
folder here, so one place owns it.

| Folder | Project | Repo |
| --- | --- | --- |
| `pilotx/` | PilotX | MossesX/pilotX |
| `shipx/` | ShipX | MossesX/ShipX (reserved, not created) |
| `activex/` | ActiveX | MossesX/ActiveX |

axHub's manifest lives in its own repo (MossesX/axHub).
