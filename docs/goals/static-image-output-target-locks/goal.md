# Static Image Output Target Locks

## Objective

Implement the approved static-image output-target contract as one durable two-way bridge across agents, the CLI, and the canvas. A selected target must freeze exact pixel dimensions; all surfaces must read the same persisted intent; and import must atomically reject any output that does not decode to the locked dimensions.

## Original Request

Plan implementation using GoalBuddy prep as atomic, verifiable tasks with sharp, measurable acceptance criteria.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage users creating and importing static-image variants through agents, CLI, and canvas
- Authority: `approved`
- Proof type: `demo`
- Completion proof: focused contract tests, full repository gates, and an identity-gated checkout walkthrough prove the same persisted lock across agent/CLI/canvas plus atomic rejection of invalid output
- Goal oracle: create equivalent locked jobs through CLI/agent and canvas, observe identical resolved target mappings, import valid assets successfully, and prove dimension/type/corruption failures leave zero partial state
- Likely misfire: shipping platform labels or UI controls while leaving the hard pixel contract, per-source mapping, immutable snapshots, or atomic import unenforced
- Blind spots considered: incorrect grouping, validation bypass/partial writes, mutable frozen intent, legacy unlocked compatibility, shared-dimension surfaces, mixed locked/unlocked source mappings, and operational identity drift
- Existing plan facts: the approved design is `docs/superpowers/specs/2026-07-27-static-image-output-target-locks-design.md` on branch `codex/output-target-lock-design`

## Goal Oracle

The oracle for this goal is:

`A live checkout walkthrough and receipt-backed tests prove that agent, CLI, and canvas create the same locked static-image jobs and atomically reject every dimension mismatch.`

The PM must keep comparing task receipts to this oracle. Planning, protocol types, UI-only behavior, a passing happy path, or a clean-looking board are not enough. The goal finishes only when a final Judge maps every required behavior to evidence and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the approved design against the current checkout, then implement the largest safe backend, CLI/protocol, import-integrity, and canvas vertical slices in dependency order. Complete with focused tests, full public gates, an identity-gated live walkthrough, and a final adversarial audit.

## Non-Negotiable Constraints

- Static images only in v1.
- A selected output target is a hard exact-pixel contract; no mismatch override, automatic crop, or resize.
- Pixel dimensions are the only enforceable v1 publishing contract; safe zones remain guidance.
- Platform-only ambiguity must ask the user to choose a surface.
- Geometry profiles and delivery surfaces are separate; multiple surfaces may share one geometry.
- Identical dimensions consolidate by default; an explicit split creates separate same-sized creative variants.
- Target-aware multi-source jobs require explicit per-source mapping. A source may be locked or explicitly unlocked, but not both.
- Canvas defaults are explicit, canvas-scoped, and human-managed. Agents and CLI may read but never mutate them.
- Rerolls inherit their lock and cannot change it. Different geometry creates a child variation.
- Custom dimensions are allowed from 16 through 16,384 pixels per side with at most 100,000,000 decoded pixels.
- Hard validation accepts PNG, JPEG, and WebP only. SVG, GIF, video, corrupt, renamed, and tampered media must fail closed.
- Every import batch is fully prevalidated before any file indexing or database write.
- Registry and output-spec/version snapshots are immutable for existing jobs.
- Existing unlocked jobs, manifests, and count behavior remain compatible.
- Target-aware contracts use the approved new versions: `generation-receipts-v3`, `lineage.generation_handoff.v3`, `lineage.generation_output_manifest.v2`, `lineage.generation_target_map.v1`, `lineage.output_spec.v1`, and `lineage.output_target_registry.v1`.
- Do not add provider calls, Buffer publishing, social publishing, non-static generation, safe-zone machine validation, agent mutation of canvas defaults, ambiguous platform inference, or mismatch overrides.
- Preserve user changes and obey the repository channel/profile/database identity gate before any operational app walkthrough.
- Perform every implementation and verification task in the dedicated `/Users/neonwatty/Desktop/lineage/.worktrees/static-image-output-target-locks` worktree on branch `codex/static-image-output-target-locks`, created directly from the freshly fetched GitHub `origin/main` commit `eef358ba16f60619f6ba8104d3bed14ab8d58257`. The clean implementation baseline is that commit plus three documentation-only commits containing the approved spec and GoalBuddy control files; no product implementation differs from `origin/main`.
- Do not commit private media, credentials, private campaign data, presigned URLs, customer content, or local SQLite databases.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, contract declarations, or one passing vertical slice while another required bridge surface or invariant remains.

If execution uncovers a repository conflict, failed proof, or ambiguous boundary, record a receipt, create the smallest safe follow-up task, and continue all non-destructive local work that still advances the oracle.

## Slice Sizing

Each Worker owns one coherent reversible vertical slice with non-overlapping active write scope, exact allowed files supplied by the initial Judge, focused verification, and explicit stop conditions. Repeated same-shape work belongs in one package. UI and protocol shells without enforced behavior do not count as useful slices.

## Board Health

If the board is stale or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/static-image-output-target-locks
```

When the local board is running, compare `state.yaml` with the live board API. Repair only GoalBuddy control files unless an active task explicitly authorizes product-file edits.

## Canonical Board

Machine truth lives at:

`docs/goals/static-image-output-target-locks/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/static-image-output-target-locks/goal.md.
```

## PM Loop

1. Read this charter, the GoalBuddy execution contract, and `state.yaml`.
2. Work only on the active task and keep exactly one task active.
3. Require T001 to prove the active checkout is the dedicated fresh worktree based on GitHub `origin/main`, then replace every provisional Worker `allowed_files` and `verify` list with exact repository-backed values before activating that Worker.
4. Require each Worker to finish its full acceptance set, run focused verification, and return a compact receipt.
5. Review only at the initial plan boundary, the integrated risk boundary, rejected verification, material ambiguity, and final completion.
6. Run the live oracle after implementation and before final audit.
7. Finish only when the final Judge maps receipts and fresh verification to the original outcome and records `full_outcome_complete: true`.
