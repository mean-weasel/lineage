# Node Next-Output Target Locks

## Objective

Implement, release, and stable-package-verify the approved static-image
next-output target contract. Before an agent generates a variation, Lineage
must resolve exact geometry from the source node's sticky setting or its
human-owned canvas default, persist an immutable job snapshot, and expose that
same intent through the canvas, CLI, and native agent selection contract.

## Original Request

Create a GoalBuddy prep board for the agreed solution: users set geometry
through the agent or Lineage UX, canvas defaults apply to nodes without
overrides, each node can lock the geometry of its next variations, and agents
must read the locked database state before generation.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage users and agents creating static-image variations
- Authority: `approved`
- Proof type: `demo`
- Completion proof: focused and full automated verification plus a live
  canvas/CLI/agent bridge walkthrough, repeated against the released stable
  package from a fresh named production profile
- Goal oracle: every provider-neutral static-image generation consumes a
  persisted exact-pixel job resolved from durable node/default intent, and
  every generated child carries only its own verified geometry forward
- Likely misfire: ship node badges or stored geometry while agents can still
  generate from stale, inferred, conflicting, or non-persisted dimensions
- Blind spots considered: lock conflicts, sticky-setting lifecycle, dynamic
  default inheritance, immutable older jobs, per-child inheritance,
  multi-source independence, shared geometry, concurrency, cancelled jobs,
  compatibility, atomic rollback, and release identity
- Existing plan facts:
  - Approved design:
    `docs/superpowers/specs/2026-07-27-node-next-output-target-locks-design.md`
  - Dedicated worktree:
    `/Users/neonwatty/Desktop/lineage/.worktrees/node-next-output-target-locks`
  - Dedicated branch: `codex/node-next-output-target-locks`
  - Fresh GitHub baseline:
    `origin/main@3881139d7932669565dabe967e2385fa6e67cf62`
  - Pre-board baseline: 84 test files passed, 598 tests passed, 4 intentional
    skips; documentation validation clean

## Goal Oracle

The oracle for this goal is:

`A live canvas/CLI/agent walkthrough proves default inheritance, sticky
per-node multi-target overrides, conflict refusal, stale-resolution rejection,
immutable job snapshots, exact-pixel import, per-child geometry inheritance,
and zero-partial-write failure behavior; the critical read-plan-import path is
then repeated against the released stable package with matching runtime,
profile, database, and service identities.`

The PM must keep comparing task receipts to this oracle. Planning, type
declarations, stored rows, UI badges, one passing test, a checkout-only demo,
or a clean board is not enough. The goal finishes only when a final Judge audit
maps every approved decision and realistic failure mode to direct evidence and
records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete the approved static-image node next-output lock design end to end:

1. validate the committed design against the released implementation and shape
   exact Worker boundaries;
2. add versioned durable node settings, dynamic default resolution,
   compare-and-swap mutation, immutable job materialization, cancellation, and
   atomic child initialization;
3. expose the same resolution through a native versioned selection packet and
   complete CLI/agent operations;
4. add the node-level canvas states and edit/clear/plan interactions without a
   second normalization path;
5. run focused, full, and live checkout verification;
6. prepare and merge a reviewed pull request, publish through the immutable
   tag workflow, and re-dogfood the stable package;
7. complete only through a skeptical final Judge audit.

If any verification or oracle step finds a defect, the PM creates the largest
safe bounded remediation Worker task, verifies it, and resumes this sequence.

## Non-Negotiable Constraints

- Static PNG, JPEG, and WebP only for hard locked imports in this tranche.
- Exact decoded pixels are the enforceable contract. No mismatch override,
  automatic resize, crop, or transform.
- Current asset geometry and future next-output intent remain separate facts.
- A node override may contain multiple targets and remains sticky until
  explicitly replaced or cleared.
- A conflicting agent instruction cannot replace a node lock automatically.
  It must stop and obtain explicit replacement approval.
- Canvas defaults remain human-owned. Agents and CLI may read them but cannot
  mutate them.
- Nodes without overrides inherit the current canvas default dynamically.
- Every job atomically snapshots its resolved target origin, revision/digest,
  exact pixels, surface metadata, groups, and output slots.
- Planned jobs remain immutable when defaults or node settings later change.
- Each generated child inherits only the target represented by its own imported
  output specification.
- Surface labels are descriptive metadata; frozen pixels remain authoritative.
- Equal-sized targets consolidate by default. Creative splits and variation
  counts remain generation-job intent.
- Multi-source requests resolve every source independently and fail completely
  on a missing, stale, or conflicting source.
- Agent planning must fail closed on ambiguous platforms, conflicting locks,
  stale resolution digests, unsafe custom geometry, and incomplete mappings.
- All new CLI JSON must be complete and parseable beyond ordinary pipe-buffer
  sizes.
- Existing assets, jobs, selection packets, target maps, manifests, handoffs,
  defaults, and output specifications remain compatible and readable.
- No provider calls, saved recipes, video locks, safe-zone machine validation,
  publishing, scheduling, or performance analytics.
- Do not commit private media, credentials, private campaign data, real
  presigned URLs, customer content, or local SQLite databases.
- Perform all implementation and verification in the dedicated worktree and
  branch named above. Preserve unrelated work in every other checkout.
- Before every runtime operation, follow the repository's five-step channel
  gate with exactly one launcher and its matching named profile. Stop on any
  code/profile/database/service identity mismatch.
- Use checkout-only `npm run lineage:dev --` for development proof and
  `lineage-stable` with a fresh production profile for released-package proof.
- Release only from a reviewed commit already merged to GitHub `main`, using a
  new immutable annotated tag whose version matches every release lock.

## Verification Gates

Focused Worker gates should include the exact tests selected by T001 plus
`npm run check`. The phase and final gates are:

```bash
npm test
npm run e2e -- e2e/output-target-locks.e2e.ts
npm run ci
npm run public:readiness
npm run package:smoke
npm run runtime:oracle
npm run plugin:smoke
```

The PM must classify pre-existing red repository-health suites separately from
goal-owned failures. The clean baseline recorded before the board means new
failures in the touched target-planning paths are presumed goal-owned until
proven otherwise.

## Required Live Proof

The checkout oracle must:

1. set a human canvas default containing a named surface and exact geometry;
2. show one source node dynamically inheriting that default;
3. give another source an explicit sticky multi-target override;
4. read current geometry and effective next targets through
   `lineage.selection_packet.v3` and the CLI node-target command;
5. prove an ambiguous platform asks for a surface;
6. prove a conflicting agent request cannot replace the node lock;
7. prove a stale target-resolution digest cannot create a job;
8. plan from the current persisted targets and record the canonical digest,
   groups, slots, and expected output count;
9. change defaults and node settings, then prove the existing job remains
   unchanged while future resolution changes;
10. generate and import exact-size static images through the provider-neutral
    scaffold and manifest;
11. prove each resulting child displays and carries only its own geometry;
12. cancel an unimported planned job and prove import is rejected;
13. attempt a wrong-size or tampered import and prove zero partial settings,
    assets, edges, attempts, output specifications, outputs, receipts, or
    status mutations;
14. prove canvas and CLI read the same persisted intent and immutable job.

After release, repeat the critical effective-read, immutable-plan, exact-import,
child-inheritance, and wrong-size rejection path with `lineage-stable` and a
fresh named production profile. Record runtime code root/origin/fingerprint,
channel, profile/environment/fingerprint, database identity, service origin,
package version, tag, GitHub Release assets, and CI conclusions.

## Top Failure Modes

The final audit must address at least:

1. **Stale or conflicting intent reaches generation.** Evidence must show
   compare-and-swap writes, resolution-digest checks, explicit conflict
   refusal, and no provider work before a job is persisted.
2. **Future settings corrupt factual or immutable history.** Evidence must show
   current output specifications stay unchanged, planned jobs retain their
   snapshots, and registry/default/node changes affect only future plans.
3. **Cross-source or child inheritance expands the wrong targets.** Evidence
   must show independent multi-source resolution and that each child receives
   only its own produced geometry and consolidated surface metadata.
4. **Failure leaves partial durable state.** Evidence must show atomic plan and
   import rollback for stale, cancelled, malformed, tampered, unsupported, and
   wrong-dimension cases.
5. **Canvas, CLI, agent, checkout, or released package disagree.** Evidence
   must show canonical digest parity across surfaces and exact runtime/profile/
   database/service identity during both checkout and stable proof.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, contract declarations, one backend
slice, UI completion, checkout-only proof, PR creation, merge, or package
publication while the stable-package oracle remains incomplete.

Do not stop after a single verified Worker package when the broader outcome
still has safe local follow-up work. Advance to the next highest-leverage safe
task unless a phase, risk, rejected-verification, ambiguity, or final-completion
review is due.

If an exact human approval phrase is the only remaining blocker and no safe
local work remains, preserve it in a blocked receipt, set
`waiting_for_user_approval: true`, set the goal blocked, clear `active_task`,
ask once, and stop.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.
Each Worker owns a coherent vertical package. Repeated fields, routes, tests,
or schema helpers belong in the same package when they serve one milestone.
Judge review occurs at plan validation, integrated cross-surface readiness,
release readiness, and final completion—not after every helper.

## Board Health

The PM owns board health. Check it with:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/node-next-output-target-locks
```

If the local board is running, compare `state.yaml` with the live board API.
Repair only GoalBuddy control files unless the active Worker or PM task
explicitly allows product-file edits.

## Canonical Board

Machine truth lives at:

`docs/goals/node-next-output-target-locks/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status,
active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/node-next-output-target-locks/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`.
3. Re-check intake, authority, proof, blind spots, existing-plan facts, and the
   likely misfire.
4. Work only on the active board task.
5. Assign Scout, Judge, Worker, or PM according to the task.
6. Record a compact receipt and update board truth.
7. Advance immediately to the next safe task unless a review boundary is due.
8. Insert a bounded remediation Worker whenever verification or oracle evidence
   rejects the current implementation.
9. Finish only through a final Judge audit that records
   `full_outcome_complete: true`.
