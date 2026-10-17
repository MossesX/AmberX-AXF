---
name: shipx
description: ShipX — Android deploy app Brett is building (Oct 2026) to push his projects from his phone to his Hostinger VPS via a wizard; stack and design decisions
sources: [chat]
aliases: [ShipX, deploy app, deploy wizard app, VPS deploy app]
---
- [stated] Wants an Android app with settings holding his Claude login/API key, Hostinger login, and VPS root IP + password for SSH; a wizard picks a project, lists his repos, and deploys to a subdomain he chooses
- [stated] Hosts on Hostinger and has a VPS there with root SSH access
- [stated] Chose Kotlin + Jetpack Compose (over building on [[amberx-studio]])
- [stated] Projects for the wizard come from both GitHub repos and folders already on the VPS
- [stated] Deploy target: VPS via SSH + Hostinger DNS for the subdomain
- [stated] Wants to be able to switch between using his Claude subscription and an API key
