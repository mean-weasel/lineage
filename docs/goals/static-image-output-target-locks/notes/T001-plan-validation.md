# T001 Plan Validation

## Decision

Approved. The implementation must run sequentially in T002, T003, T004, and T005 order because the slices intentionally overlap the generation aggregate, shared contracts, and persistence projections.

## Checkout identity

- Root: `/Users/neonwatty/Desktop/lineage/.worktrees/static-image-output-target-locks`
- Branch: `codex/static-image-output-target-locks`
- Origin: `git@github.com:mean-weasel/lineage.git`
- HEAD at review: `dcfd45aaf5d986a94e6ce6bfa067d32023dfbed4`
- GitHub `origin/main`: `eef358ba16f60619f6ba8104d3bed14ab8d58257`
- Merge base: `eef358ba16f60619f6ba8104d3bed14ab8d58257`
- Product implementation delta from `origin/main`: none
- Initial branch delta: approved specification and GoalBuddy control files only

The charter previously described only one initial spec commit. The actual clean implementation baseline has three documentation-only commits. The charter was corrected before implementation.

## Architecture findings

- `src/server/generationReceipts.ts` is the current plan/import aggregate and the shared operation boundary required for CLI/canvas parity.
- `src/server/assetLineageDb.ts` owns additive SQLite schema creation and compatibility migrations. Existing generation tables do not contain target-map, group, default, or output-spec persistence.
- `src/shared/generationTypes.ts` currently permits receipt and handoff versions 1 and 2. `src/shared/generationOutputManifest.ts` implements manifest v1.
- `src/cli/lineageCli.ts` owns target-free generation planning, inspect/import, and reroll commands.
- Existing import checks uniqueness before persistence but indexes lineage assets before the import transaction. Target-aware import needs transaction-aware indexing.
- Reroll import currently spreads side effects across transactions. T004 must make target-aware side effects atomic.
- Selection-packet types already allow dimensions, but the producer does not populate them.
- Canvas exposes Branch/Reroll intent and read-only proof but has no target defaults, planning sheet, or persisted target-map mutation path.
- No static-image decoder is a direct dependency. T004 may add `sharp` only if Node 22 installability, public readiness, and package smoke remain green.

## Requirement ownership

- T002 owns registry/geometry separation, ambiguity, grouping/split rules, per-source mapping, count resolution, custom bounds, defaults authorization, frozen planning, additive persistence, and legacy compatibility.
- T003 owns agent/CLI discovery and planning, the exact v3/v2/v1 protocol versions, machine-readable errors, legacy CLI compatibility, and persisted parity projections.
- T004 owns decoded PNG/JPEG/WebP validation, unsupported/tampered rejection, complete preflight, atomic import, immutable output specs, selection dimensions, reroll lock inheritance, and geometry-change child variations.
- T005 owns explicit human defaults, per-source branch overrides, target summaries, grouping/split/count controls, agent-created job visibility, lock/status presentation, and read-only reroll dimensions.
- T006 owns integrated review of grouping, atomicity/bypass, and immutable-intent risks.
- T007 owns full gates and the identity-gated live oracle.

## Parallel safety

Parallel Workers are not safe. T002 through T005 form a strict dependency chain and share core contracts. Run one Worker at a time.

## Missing completion evidence

- No product implementation exists yet.
- No focused implementation tests or repository gates have run.
- No decoder/package smoke, browser workflow, or runtime/profile/database identity-gated walkthrough has run.
- The three primary risks—incorrect grouping, validation bypass/partial writes, and mutable frozen intent—remain unproven until implementation and final audit.
