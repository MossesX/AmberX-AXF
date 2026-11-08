<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md tokens=115 -->
## Known gaps / for Brett

- Android written without a compiler beyond the kernel (lib-hub, axf-ui, apps compile in CI only).
- Build Pilot's Android app doesn't exist yet: its android-compose build gets this by `developer` in its manifest.
- The Android console reaches the hub through an in-app sign-in (session cookie) the same way as the AXHub app; a
  device token issued by the hub is a later option (the `HubCredentials` seam takes a bearer already).
