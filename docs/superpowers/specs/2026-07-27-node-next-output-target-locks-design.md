# Node Next-Output Target Locks

**Status:** Approved design

**Date:** 2026-07-27

**Scope:** Static-image generation only

## Summary

Lineage must expose the exact geometry intended for a node's next static-image
variations before an agent begins generation. A human may establish a
lineage-wide canvas default, and either a human or an agent acting on an
explicit user instruction may establish a sticky node-level override. Lineage
resolves those settings into a persisted, immutable generation-job snapshot.
An agent may generate only from that snapshot.

This design does not introduce saved recipes. Geometry configuration and
generation execution remain separate concerns: durable settings answer what
size the next outputs must have, while each generation job answers how many
outputs to create and what prompt to use.

## Problem

The existing output-target implementation already freezes exact pixels on
target-aware generation jobs, persists output specifications on imported
assets, exposes locked asset dimensions in selection packets, inherits locks
for rerolls, and represents geometry changes as child variations.

The remaining gap occurs before a generation job exists:

- a node lookup describes the current asset geometry, not durable intent for
  its next child variations;
- canvas branch choices remain local drafts until the branch plan is submitted;
- an agent cannot reliably distinguish an inherited canvas preference from an
  explicit node-level lock;
- a user cannot configure a node now and trust a later agent run to consume
  that geometry without repeating the instruction.

Consequently, an agent that starts from a bare selected node can see the
existing image dimensions but not necessarily the user's intended geometry for
the next variation.

## Approved Product Decisions

1. Exact decoded pixel dimensions remain the hard V1 contract.
2. A lineage-wide canvas default is human-owned and agent-readable. Agents
   cannot change it.
3. A node may have a sticky next-output target override.
4. A node override may contain multiple targets.
5. Surface identity and frozen geometry are both retained. Surface identity is
   descriptive metadata; pixels are enforceable.
6. An explicit node override is authoritative. A conflicting agent request
   must stop and ask the user whether to replace it.
7. A node override remains until explicitly changed or cleared.
8. Clearing a node override restores dynamic inheritance from the current
   lineage-wide canvas default.
9. A generated child receives a sticky target setting matching its own
   produced geometry, not the parent's complete multi-target set.
10. A generation job snapshots the resolved target setting. Later changes to
    defaults or node overrides do not mutate or invalidate that job.
11. Equal-sized targets consolidate by default. Creative splits are
    generation-job intent rather than durable node geometry.
12. Variation counts are generation-job intent. They are not part of the node
    target setting.
13. Static images remain the only supported locked media in this tranche.

## Considered Approaches

### A. Durable node target setting plus immutable job snapshots

This is the approved approach. It separates factual current-asset geometry,
durable future intent, and immutable execution history. It also gives the
canvas, CLI, and agent one database-backed source of truth.

### B. Generation-job-only persistence

This is close to the existing behavior. It preserves immutable jobs but cannot
represent a node's future geometry before a prompt and job are submitted. It
does not satisfy the desired read-before-generate workflow.

### C. Mutate the node's current output specification

This would make the existing asset appear to have dimensions that belong to a
future child. It breaks factual lineage history and is rejected.

## Domain Model

### Current output specification

`asset_output_specs` remains the immutable description of a produced asset:
its actual decoded dimensions, generation job, output index, target group,
surface snapshots, and specification digest.

The current output specification must never be changed to represent a future
variation.

### Lineage-wide canvas default

The existing human-owned `generation_target_defaults` record remains the
fallback for nodes without an override. The effective-target resolver uses its
target geometry and surface snapshots dynamically.

Existing stored count and split preferences remain readable for compatibility,
but they are not part of the new node next-output setting. A generation action
continues to resolve count and any explicit split independently.

### Node next-output setting

Add a `node_next_output_target_settings` table containing one versioned,
project/root/node-scoped record shaped as:

```json
{
  "schema_version": "lineage.node_next_output_targets.v1",
  "project_id": "demo",
  "root_asset_id": "local-root",
  "node_asset_id": "local-node",
  "revision": 3,
  "targets": [
    {
      "kind": "delivery_surface",
      "surface": {
        "id": "instagram-story",
        "version": 1,
        "platform": "Instagram",
        "name": "Story"
      },
      "geometry": {
        "media_kind": "static_image",
        "width": 1080,
        "height": 1920
      }
    }
  ],
  "provenance": {
    "actor": "human",
    "origin": "canvas"
  },
  "digest_sha256": "<canonical digest>",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>"
}
```

Allowed provenance covers:

- explicit human canvas mutation;
- agent mutation tied to an explicit user request;
- system-derived child initialization from an atomically imported output
  specification.

The record contains no prompt, provider, variant count, source list,
publishing destination, schedule, or safe-zone rule.

### Effective next-output resolution

For each source node, Lineage resolves:

```text
explicit or derived node setting
  -> current lineage-wide canvas default
  -> unresolved
```

The response reports:

- current asset geometry, when known;
- effective next-output targets;
- origin: `node_override`, `derived_child`, `canvas_default`, or `unresolved`;
- node-setting revision when present;
- default revision or digest when inherited;
- canonical effective digest;
- frozen surface labels and exact pixels;
- whether already-planned jobs use a different snapshot.

An unresolved source cannot enter the locked agent-generation path. The agent
must ask the user to choose a surface or exact custom geometry.

## Mutation and Conflict Rules

Canvas-default mutations retain the existing hard rule: only an explicit human
canvas action may write them.

Node settings may be written through the canvas or by an agent only when the
agent has an explicit user instruction containing an unambiguous surface or
exact dimensions. Platform-only ambiguity still requires a surface choice.

Node-setting writes and clears use compare-and-swap semantics:

- the caller supplies the last observed revision or digest;
- a concurrent change fails closed with the current resolution;
- replacement is explicit and audited;
- there is no generic force flag.

If an agent request conflicts with an existing node setting, planning fails
with a structured conflict. The agent presents the existing and requested
targets and asks whether to replace the setting. Only a subsequent explicit
replacement operation may change it.

Human canvas replacement uses an ordinary confirmation interaction but follows
the same revision check.

## Agent and CLI Contract

`lineage.selection_packet.v3` exposes both current asset geometry and effective
next-output intent on every selected asset. It also carries one canonical
`target_resolution_digest_sha256` over the ordered selected-source
resolutions. Legacy packet versions remain readable.

The CLI supports these machine-readable operations:

- `lineage output-targets node get --root <root> --node <asset> --json`;
- `lineage output-targets node set --root <root> --node <asset>
  (--destination <surface>|--custom-dimensions <width>x<height>)...
  --expected-revision <revision-or-none> --confirm-write --json`;
- `lineage output-targets node replace --root <root> --node <asset>
  (--destination <surface>|--custom-dimensions <width>x<height>)...
  --expected-revision <revision> --confirm-write --json`;
- `lineage output-targets node clear --root <root> --node <asset>
  --expected-revision <revision> --confirm-write --json`;
- `lineage generate image plan --prompt <text> --from-lineage-selection
  --from-node-targets --expected-target-resolution-digest <sha256>
  [--variants-per-target <count>] --json`;
- `lineage generate image cancel --job-id <job-id> --confirm-write --json`.

The existing inspect and scaffold operations remain the canonical way to read
the immutable job after planning. Every new operation supports complete
`--json` output and named-profile safety. Canvas endpoints expose the same
read, compare-and-swap mutation, plan, and cancel operations without creating a
second normalization path.

The provider-neutral agent sequence is:

1. Read the selected nodes and effective targets from Lineage.
2. Resolve any ambiguity or explicit-lock conflict with the user.
3. Ask Lineage to atomically materialize a generation job from those targets.
4. Receive the canonical target map, digest, ordered output slots, exact pixels,
   expected count, handoff, and manifest scaffold.
5. Generate files outside the Lineage server.
6. Import through the existing manifest path.

The agent must not call an image provider before step 3 succeeds. Planning
re-resolves the effective settings transactionally. If a setting changed since
the agent read it, planning fails with a structured stale-resolution error and
the agent reads again.

An explicit generation count applies when the job is planned. If no count is
specified, each resolved geometry receives one variant. Count does not become
a sticky node preference.

## Immutable Job Behavior

Every target-aware job continues to own a canonical target map, digest, target
groups, ordered output slots, and immutable output specifications.

The job records the effective setting origin and digest used for each source.
After creation:

- canvas-default changes affect only future jobs;
- node-setting changes affect only future jobs;
- an older planned job remains valid and visibly identifies its older snapshot;
- cancelling a planned job prevents later import but does not rewrite history;
- import always validates against the job snapshot, not current settings.

There is no mismatch override and no automatic resize or crop.

## Child Initialization and Rerolls

On successful target-aware import, child node creation and child
next-output-setting initialization occur in the same atomic transaction.

Each child receives only the target represented by its own output
specification:

- a 1080×1920 child carries 1080×1920 forward;
- a 1080×1350 child carries 1080×1350 forward;
- a consolidated output retains every surface snapshot attached to that
  geometry;
- one child never inherits unrelated sibling geometries from the parent's
  multi-target set.

Reroll behavior remains unchanged:

- a reroll updates the same node and inherits its current immutable output
  specification;
- a reroll cannot change dimensions;
- requesting another geometry creates a child variation and uses the node's
  effective next-output planning path.

## Canvas Experience

Each node exposes a compact next-output status:

- `Next outputs · 1080×1920 · inherited`
- `Next outputs · 1080×1920 + 1080×1350 · node lock`
- `Output geometry required`

The node control allows a human to:

- inspect current geometry separately from future targets;
- choose one or more named surfaces or custom dimensions;
- replace a node lock with confirmation;
- clear a node lock and return to inherited defaults;
- see when planned jobs use an older snapshot;
- cancel an unwanted unimported planned job.

The branch planner opens from the resolved node targets. It may accept prompt,
variant count, and explicit creative splits for that job without modifying the
sticky node setting.

Multi-source planning resolves every source independently. A missing or
conflicting source fails the complete plan; Lineage never silently applies one
source's node override to another source.

## Errors and Fail-Closed Behavior

Machine-readable errors must distinguish at least:

- no effective target;
- ambiguous platform without a surface;
- explicit request conflicts with a node lock;
- stale expected setting revision or digest;
- unsupported or unsafe custom dimensions;
- mixed or incomplete multi-source resolution;
- cancelled generation job;
- manifest or output-spec mismatch;
- decoded-pixel mismatch.

No failing plan or import may leave a partial setting, job aggregate, asset,
edge, attempt, output specification, receipt, or child setting.

## Compatibility and Migration

- Existing assets and jobs remain readable and unchanged.
- Existing locked assets retain their immutable output specifications.
- Legacy assets without node settings resolve through the current canvas
  default or remain unresolved.
- Existing human canvas defaults remain valid.
- Existing target maps, handoffs, manifests, and output specifications remain
  valid.
- New fields are additive on legacy API responses or appear in a new explicit
  schema version.
- Installing the feature does not eagerly copy canvas defaults to every node.
- Derived child settings are created only for future successful target-aware
  imports.

## Scope Boundaries

This tranche does not add:

- saved recipes or named target bundles;
- image-provider calls inside the Lineage server;
- video or animation locks;
- resize, crop, or transform operations;
- machine-enforced safe zones or composition checks;
- publishing, scheduling, or performance analytics;
- platform-only inference;
- agent mutation of lineage-wide canvas defaults;
- prompts or variation counts in node settings.

## Verification Strategy

### Contract and persistence tests

Prove:

- node setting canonicalization, versioning, provenance, revision checks, and
  exact-key validation;
- node override precedence over dynamic defaults;
- clear-to-inherit behavior;
- platform metadata plus frozen geometry persistence;
- explicit conflict and stale-resolution failures;
- independent multi-source resolution;
- default consolidation of equal geometry;
- immutable job snapshots after setting changes;
- idempotent cancellation and cancelled-job import rejection;
- child-setting creation in the import transaction;
- zero partial state for every late failure.

### CLI and agent tests

Prove:

- complete JSON for effective read, set, replace, clear, plan, inspect, and
  cancel;
- platform ambiguity asks for a surface;
- agents cannot change canvas defaults;
- conflicting agent intent cannot replace a node lock without a second explicit
  operation;
- planning from node targets produces the same canonical job as the canvas.

### Canvas tests

Prove:

- inherited, explicit, unresolved, and older-snapshot states render distinctly;
- a node override survives parent rerenders;
- multi-target settings remain independent across selected sources;
- clear returns immediately to the current default;
- prompts, counts, and splits affect only the planned job;
- produced children display and inherit only their own geometry.

### Full bridge oracle

From a fresh worktree based on freshly fetched GitHub `origin/main`:

1. Set a human canvas default with a named surface and exact pixels.
2. Show one node dynamically inheriting that default.
3. Give another node an explicit multi-target override.
4. Read both through the CLI/agent contract.
5. Attempt a conflicting agent instruction and prove it stops for replacement
   approval.
6. Plan a generation job from the stored targets and record its digest.
7. Change the default and node setting, then prove the existing job remains
   unchanged while future resolution changes.
8. Generate and import exact-size static images.
9. Prove each child carries only its own geometry forward.
10. Attempt a wrong-size import and prove zero partial persistent state.
11. Prove the canvas and CLI display the same frozen targets and job state.
12. Merge through review, release through the immutable tag workflow, and
    repeat the critical read-plan-import proof against the released stable
    package and a fresh named production profile.

## Acceptance Claim

The tranche is complete only when the following user-facing claim is true:

> Before any static-image variation is generated, Lineage resolves exact
> next-output geometry from the source node or its human canvas default,
> persists an immutable job snapshot that the agent reads natively, rejects
> conflicting or stale intent, validates imported pixels atomically, and gives
> each resulting child its own durable geometry for future variations.
