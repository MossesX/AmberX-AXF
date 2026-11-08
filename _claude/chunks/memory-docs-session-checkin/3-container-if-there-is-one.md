<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md tokens=132 -->
### 3. Container (if there is one)
- **Show:** what the session runs inside. One of:
  - the cloud container, which is temporary and reclaimed when idle
  - a Docker container: its name, read from `/proc/1/cgroup` or `/.dockerenv`
  - the bare VPS host
- **Expected by location:**
  - VPS terminal → the host, **not** inside the `axf-console` container, unless he says so
  - cloud → a temporary container. Remind him that only pushed work and archived data survive it.
- **On a mismatch:** say so before doing anything else.
