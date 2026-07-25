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

## Agent commands

Use `agent claim`, `heartbeat`, and `release` around a bounded mutation. Claim
tokens are sensitive authorization material and should not be pasted into
documentation or logs.

Run `<launcher> --help` for the exact commands supported by the installed
version.
