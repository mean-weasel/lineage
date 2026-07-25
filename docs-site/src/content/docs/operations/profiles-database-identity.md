---
title: Profiles and database identity
description: Verify that code origin, environment, database, media root, and service origin describe one runtime.
---

## What this does

A named profile binds Lineage to an environment, database, media root, service
origin, and expected runtime fingerprint.

## Identity gate

For the selected channel and profile:

1. Run `runtime doctor --json`.
2. Run `profile doctor --profile <profile> --json`.
3. Run `db info --profile <profile> --json`.
4. Confirm code root, origin, fingerprint, channel, environment, database
   identity, profile fingerprint, and service origin all agree.
5. Stop on any mismatch.

## Development repinning

After an intentional checkout change, stop the matching development service,
run `make repin-dev LINEAGE_DEV_PROFILE=<profile>`, and repeat the gate.
Repinning never applies to stable or preview package code.
