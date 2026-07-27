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
5. Complete the handoff in Codex and write outputs under the approved scratch
   root.
6. Fill the generated output manifest's file paths and edge summaries without
   changing its frozen source, geometry, destination, or output-spec identity.
7. Import with explicit write confirmation.
8. Verify the produced nodes, actual decoded dimensions, output specifications,
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

See [Image generation](../integrations/image-generation).
