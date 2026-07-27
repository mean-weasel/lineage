---
title: CLI commands
description: Use the Lineage CLI through a verified channel launcher and named profile.
---

## Identity commands

```bash
lineage-stable runtime doctor --json
lineage-stable profile doctor --profile team-production --json
lineage-stable db info --profile team-production --json
```

## Creative workflow commands

Use `inspect`, `next`, and `brief` for read-only context. Use `link-child` for a
new visible branch. Use the `reroll` sequence for another attempt on one asset.
Use `generate image plan`, `inspect`, and `import` for the Codex handoff
workflow.

## Static-image output targets

Discover exact named delivery surfaces instead of memorizing sizes or inferring
a surface from a platform name:

```bash
lineage-stable output-targets list \
  --profile team-production \
  --media image \
  --json

lineage-stable output-targets resolve \
  --profile team-production \
  --query "Instagram" \
  --json

lineage-stable output-targets resolve \
  --profile team-production \
  --query "Instagram Story" \
  --json

lineage-stable output-targets defaults \
  --profile team-production \
  --project <project> \
  --root <root-asset-id> \
  --json
```

Platform-only resolution returns candidate surfaces and never chooses one
silently. Defaults are readable by agents and the CLI but are mutated only by a
confirmed human canvas action.

For exactly one selected source, repeated flags are shorthand:

```bash
lineage-stable generate image plan \
  --profile team-production \
  --project <project> \
  --from-lineage-selection \
  --destination instagram.story \
  --destination facebook.story \
  --custom-dimensions 1200x1500 \
  --variants-per-target 2 \
  --prompt "Create campaign variants" \
  --json
```

Same-sized surfaces consolidate by default. Use `--separate-destination` when
they need separate creative. Target-aware multi-source work requires
`--target-map <file>` so each selected source is explicitly locked or unlocked;
the simple destination flags cannot be applied implicitly to every source.

The planned handoff reports frozen dimensions, destinations, grouping, variant
counts, ordered output slots, and the expected output total. Target-aware jobs
reject legacy count flags. Locked import decodes PNG, JPEG, or WebP dimensions
from bytes and rejects the complete batch before persistent writes when any
output is unsupported, corrupt, tampered, or the wrong size.

## Social marks

Mark an asset when it is ready for social discussion, captioning, or scheduling.
Marks are scoped to one project and lineage canvas; Lineage does not upload,
schedule, or publish the media.

```bash
lineage-stable social list \
  --profile team-production \
  --project <project> \
  --root <root-asset-id> \
  --json

lineage-stable social mark \
  --profile team-production \
  --project <project> \
  --root <root-asset-id> \
  --asset <asset-id-or-exact-title> \
  --confirm-write \
  --json

lineage-stable social unmark \
  --profile team-production \
  --project <project> \
  --root <root-asset-id> \
  --asset <asset-id-or-exact-title> \
  --confirm-write \
  --json
```

The canvas exposes the same state from the asset card, context menu, and `S`
keyboard shortcut. Agent mutations still require any active claim token.

## Agent commands

Use `agent claim`, `heartbeat`, and `release` around a bounded mutation. Claim
tokens are sensitive authorization material and should not be pasted into
documentation or logs.

Run `<launcher> --help` for the exact commands supported by the installed
version.
