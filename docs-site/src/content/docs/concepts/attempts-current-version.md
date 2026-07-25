---
title: Attempts and the current version
description: Keep multiple executions attached to one asset and control which attempt is currently displayed.
---

## What this does

Every re-roll creates an attempt. The asset keeps one stable identity while its
attempt history records prompts, files, receipts, and timestamps.

## How it works

The **current attempt** is the version shown on the canvas and used by default
for downstream work. Earlier attempts remain available in history. Changing the
current attempt changes the active representation; it does not delete later
attempts or create a branch.

## Restore an earlier result

Open attempt history, compare the available attempts, select the intended
version, and confirm it as current. Then verify the canvas and any downstream
selection before continuing.

See [Restore an earlier attempt](../workflows/restore-earlier-attempt).
