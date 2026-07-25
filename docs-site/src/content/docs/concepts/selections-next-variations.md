---
title: Selections and next variations
description: Turn human choices into explicit structured inputs for the next creative operation.
---

## What this does

Selections identify the asset or assets that should drive the next variation.
They let an agent retrieve the exact visual context chosen by a human instead
of inferring it from a chat message.

## How it works

Lineage stores selection state with the workspace and can produce a selection
packet containing parent asset identifiers, root context, campaign context, and
notes. Multi-parent generation preserves an explicit output-to-parent mapping.

## Safety behavior

Inspect the current selection before planning generation. Do not import outputs
whose parent mapping is ambiguous. Successful imports can clear selection state
when configured so stale inputs are not reused accidentally.

Related: [Generate and import variations](../workflows/generate-import-variations).
