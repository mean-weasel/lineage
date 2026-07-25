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

## Stable package upgrades

For an existing production profile, make the stopped interval explicit:

```bash
make stop-prod LINEAGE_PROD_PROFILE=team-production
make upgrade-prod LINEAGE_PROD_PROFILE=team-production
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
```

`upgrade-prod` installs npm `latest`, verifies the new stable runtime, runs
`lineage-stable profile upgrade-runtime --profile <profile> --confirm-write`,
and repeats runtime doctor, profile doctor, and profile-selected `db info`.
It does not stop or restart the service.

The command derives its target from the executing verified stable package. It
requires a production profile already pinned to stable package code and an
available profile writer lease. It preserves profile/database identity,
database and media paths and contents, service origin, migration requirements,
and unknown manifest fields. Preview/dev/unverified code, active writers,
downgrades, same-version identity anomalies, unhealthy data, and unsafe
manifest ownership fail closed.
