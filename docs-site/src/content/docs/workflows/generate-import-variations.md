---
title: Generate and import variations
description: Create a provider handoff, generate outside Lineage, and import verified outputs with durable receipts.
---

## What this does

Lineage plans generation from the active selection and records a durable job.
The current provider workflow is a Codex handoff; Lineage does not call a live
image service itself.

For static images, a plan can remain unlocked or select exact output targets.
A named delivery surface such as Instagram Story resolves to an immutable pixel
size. A platform name such as “Instagram” is ambiguous and must be resolved to
a surface before planning.

## Step-by-step workflow

1. Select one or more parent assets.
2. Discover or resolve named surfaces with `output-targets list` and
   `output-targets resolve`.
3. Choose exact delivery surfaces or custom dimensions for each selected
   source. Multiple sources require a complete target-map file rather than one
   shared implicit platform choice.
4. Inspect the plan's resolved dimensions, consolidated destinations, explicit
   splits, variant counts, and total output slots.
5. Scaffold the persisted target-aware job. Choose `png`, `jpeg`, or `webp`;
   the command creates only the job-scoped manifest and reports exact
   destinations and dimensions.
6. Generate each slot outside Lineage at its reported exact pixels and copy it
   to the reported path without overwriting anything.
7. Fill only each distinct one- or two-word `edge_summary`. The scaffold has
   already filled only `file_path`; leave all frozen fields unchanged.
8. Import the scaffolded manifest with explicit write confirmation.
9. Verify the produced nodes, actual decoded dimensions, output specifications,
   and receipts.

Delivery surfaces with identical dimensions consolidate into one creative by
default. Use an explicit split when the same-sized destinations need different
creative. Every resolved group has a positive variant count, defaulting to one.

## Safety behavior

Target-aware import accepts static PNG, JPEG, and WebP only. Lineage identifies
the format from bytes, compares the decoded dimensions with the frozen output
specification, and prevalidates the whole batch before persistent writes. It
does not crop, resize, or accept a mismatch with a warning.

Canvas preferred targets are explicit human-managed defaults. Agents and the
CLI may read them but cannot mutate them. Re-rolls of locked nodes inherit the
same dimensions; request a child variation for a different geometry.

Dry-run the plan when target grouping or output counts are uncertain. Never
import files from an untrusted path, infer a surface from a platform name, or
guess a multi-parent mapping.

## Exact scaffold-to-import sequence

After persisting and inspecting a locked plan, use this exact bridge:

```bash
lineage-stable generate image scaffold \
  --profile team-production \
  --project <project> \
  --job-id <job-id> \
  --format png \
  --confirm-write \
  --json

# Repeat for every `.outputs[]` item returned above. The external generator must
# emit the item's exact width and height; Lineage does not resize or crop it.
test ! -e "$OUTPUT_ABSOLUTE_PATH" &&
  cp -- "$EXTERNALLY_GENERATED_FILE" "$OUTPUT_ABSOLUTE_PATH"

# Edit generation-output-manifest.json only to add short edge_summary values.
lineage-stable generate image import \
  --profile team-production \
  --project <project> \
  --job-id <job-id> \
  --manifest .asset-scratch/generation/<job-id>/generation-output-manifest.json \
  --confirm-write \
  --json
```

The scaffold is deterministic and no-clobber: it refuses an existing or
partially prepared job directory and never creates image placeholders. Its JSON
returns the manifest path plus each output index, relative and absolute path,
width, height, target group, variant, and output-spec digest. It accepts only a
persisted, still-planned, target-aware v3 selection job. Unlocked and legacy
jobs, re-rolls, remote storage, provider calls, transforms, and publishing are
outside this command.

See [Image generation](../integrations/image-generation).
