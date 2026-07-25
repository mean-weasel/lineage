---
title: Installation and first run
description: Install a verified stable runtime, create a named profile, and start Lineage with matching code and data identity.
---

## What this does

The first-run sequence installs the stable channel, verifies its code origin,
creates a named profile, and confirms which database and media root the service
will use.

## Step-by-step workflow

```bash
npm install -g @mean-weasel/lineage@latest
lineage-channel install stable
lineage-stable runtime doctor --json
lineage-stable profile init --profile team-production --confirm-write --json
lineage-stable runtime doctor --json
lineage-stable profile doctor --profile team-production --json
lineage-stable db info --profile team-production --json
lineage-stable start --profile team-production
```

Stop if the runtime channel, code origin or fingerprint, profile environment,
database identity, or service origin disagree.

## Limitations and safety behavior

Persistent writes require a named profile. Direct database paths are intended
for diagnostic, read-only use; they are not a substitute for profile identity.
Stable, preview, and development code must use separate profiles and databases.

Continue with [Create your first workspace](first-workspace).
