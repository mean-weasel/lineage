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
