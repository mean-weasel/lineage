---
title: Image generation
description: Use the Codex handoff workflow to generate outside Lineage and import outputs with durable receipts.
capability: image-generation
maturity: Available
currentProviders:
  - Codex handoff
providerIds:
  - codex-handoff
liveBehavior: handoff
---

## What this does

Image generation creates a structured Codex handoff from the active Lineage
selection. It records a generation job, expected outputs, parent mappings, and
import receipts.

## How it works

Lineage does not embed a model service or call a live provider API. Codex
generates files outside the server, then Lineage imports a verified output
manifest with checksums and explicit write confirmation.

## Step-by-step workflow

1. Select the intended parent assets.
2. Plan the handoff and inspect its guardrails.
3. Generate the requested outputs in Codex.
4. Build the output manifest and verify parent mappings.
5. Import the files with confirmation.
6. Inspect the durable plan and import receipts.

## Limitations and safety behavior

Live generation and external services are disabled inside the Lineage server.
Outputs must stay under the approved scratch root until import.
