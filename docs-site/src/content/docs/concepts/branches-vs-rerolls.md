---
title: Branches versus re-rolls
description: Choose whether a new result should become a visible child or another attempt on the same asset.
---

## What this does

Branches and re-rolls preserve different creative meaning.

| Action | Identity | Visible graph | History |
| --- | --- | --- | --- |
| Branch | Creates a new asset | Adds a child edge | Parent and child remain separate |
| Re-roll | Keeps the same asset | Keeps the same node | Adds a new attempt |

## When to use a branch

Branch when the result represents a different direction, composition, format,
or deliverable that should be compared as its own asset.

## When to use a re-roll

Re-roll when you want another execution of the same intent while preserving the
asset’s role and graph position.

## Step-by-step workflow

1. Inspect the target asset and its attempt history.
2. Choose **Branch** for a new child or **Re-roll** for a same-node attempt.
3. Write the prompt and create the generation handoff.
4. Import results only after verifying their parent mapping.
5. Review the result and keep the most useful attempt current.

Related: [Attempts and the current version](attempts-current-version).
