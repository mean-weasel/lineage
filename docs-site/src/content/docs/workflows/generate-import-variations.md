---
title: Generate and import variations
description: Create a provider handoff, generate outside Lineage, and import verified outputs with durable receipts.
---

## What this does

Lineage plans generation from the active selection and records a durable job.
The current provider workflow is a Codex handoff; Lineage does not call a live
image service itself.

## Step-by-step workflow

1. Select one or more parent assets.
2. Inspect the selection packet and parent order.
3. Plan generation with a prompt and an output count per parent.
4. Complete the handoff in Codex and write outputs under the approved scratch
   root.
5. Prepare an output manifest with checksums and parent mappings.
6. Import with explicit write confirmation.
7. Verify the new children or attempts and their receipts.

## Safety behavior

Dry-run the plan when the selection or output count is uncertain. Never import
files from an untrusted path, and never guess a multi-parent mapping.

See [Image generation](../integrations/image-generation).
