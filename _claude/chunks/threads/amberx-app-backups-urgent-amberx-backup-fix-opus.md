<!-- memory-chunk@1 source=_claude/THREADS.md lines=98-98 tokens=206 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX app backups (Urgent `amberx-backup-fix`, Opus; Brett Nov 3, voice): `amberx-app-backup-1` restart-looped since ~Oct 3 because backup.sh had CRLF line endings (Windows upload). Fixed live on the VPS (LF script, CR-stripping entrypoint, 26 h healthcheck), fresh dump verified by a full scratch restore, new systems-check item `amberx-backups` | review (VPS fix live; PR open, the push banner merges it) | `claude/amberx-backup-fix` | opening | Brett: carry `.gitattributes` (`*.sh text eol=lf`) + the compose `backup` changes into the AmberX source repo on Windows, or the next deploy.ts upload reverts the compose. Old dumps archived in /opt/amberx-app/backups-archive. Report `_claude/builds/reports/amberx-backup-fix.md` | 2026-11-03 |
