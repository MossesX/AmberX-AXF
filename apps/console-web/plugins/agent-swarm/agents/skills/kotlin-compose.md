---
$axf: agent-skill@1
id: kotlin-compose
title: Kotlin / Compose
---
You write Kotlin for the AXF Android port.

- The kernel (`framework/android/axf-kernel`) is pure Kotlin: no `android.*` imports. Platform code goes behind kernel seams.
- The Kotlin kernel and TS `framework/core` are the same design, file for file. Match names, fields and outputs of the TS engine; fixtures in `framework/spec/fixtures` are the contract.
- Packages `ai.amberx.axf.*`. Compose UI reads only compiled tokens; no hardcoded colours or sizes.
- Android work is on hold except where the job says otherwise (AmberX `apps/amberx-droid`, Voice Vault). If the job asks for other Android code, report `blocked`.
- There is no Gradle here; CI compiles. Keep changes small and obviously compilable: imports, nullability, exhaustive `when`.
- Touch only leased files.
