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

Static-image handoffs may also freeze exact output targets. Named platform
surfaces and custom dimensions resolve into immutable groups and output slots
that the CLI, agent, and canvas all read from the same stored job.

## How it works

Lineage does not embed a model service or call a live provider API. Codex
generates files outside the server, then Lineage imports a verified output
manifest with checksums and explicit write confirmation.

Agents discover targets through the versioned offline registry rather than
memorizing platform sizes:

```bash
lineage output-targets list --media image --json
lineage output-targets resolve --query "Instagram" --json
lineage output-targets resolve --query "Instagram Story" --json
```

A platform-only query returns candidate surfaces instead of choosing one. Once
the user selects a surface, the generation plan stores its exact dimensions and
versioned guidance. Same-sized destinations consolidate unless explicitly
split.

## Step-by-step workflow

1. Select the intended parent assets.
2. Resolve explicit surfaces or choose bounded custom dimensions.
3. For one source, plan with repeated destination/custom-dimension flags. For
   multiple sources, provide an explicit per-source target map.
4. Inspect the exact dimensions, grouping, variant counts, and output total.
5. Generate the requested outputs outside the Lineage server.
6. Complete the output manifest without altering frozen target fields.
7. Import the files with confirmation.
8. Inspect the durable plan, output specifications, actual dimensions, and
   import receipts in either the CLI or canvas.

## Limitations and safety behavior

Live generation and external services are disabled inside the Lineage server.
Outputs must stay under the approved scratch root until import.

Locked import supports PNG, JPEG, and WebP. Lineage reads media type and
dimensions from file bytes and atomically rejects unsupported, corrupt,
tampered, or wrong-size output. It does not automatically crop or resize.
Safe-zone and composition notes are guidance rather than machine-enforced
publishing rules.

Canvas preferred targets remain human-managed. Agent and CLI access is
read-only, and a locked re-roll cannot change geometry.
