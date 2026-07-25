---
title: Backup and recovery
description: Create consistent profile-aware database snapshots and recover without reusing live identities.
---

## What this does

Backup protects the local database and approved media while preserving identity
rules. Recovery creates a deliberate target profile rather than silently
pointing new code at an old live database.

## Safe workflow

1. Verify the source runtime and profile.
2. Use `profile clone --source-db <source> --target-profile <target>
   --confirm-write` so SQLite creates a consistent snapshot.
3. Clone assets separately when required.
4. Run the target profile’s full identity gate.
5. Start the target service only after exact readiness.

Do not copy a live SQLite database with a raw filesystem command. A stable
database may be a read-only clone source for a new non-production profile.
