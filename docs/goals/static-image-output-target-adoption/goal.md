# Static Image Output Target Adoption

## Objective

Turn the merged static-image output-target contract into a shipped, dogfooded, and operationally natural workflow. Release the feature through the repository's immutable release process, exercise the critical human and agent paths, fix evidence-backed adoption friction, and prove one provider-neutral agent plan-to-generation-to-validated-import loop.

## Original Request

Make a GoalBuddy prep board to knock out the recommended next steps: release the feature, dogfood it, polish discoverability, connect frozen plans to image-generation tooling, and keep broader contracts deferred.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage users and agents creating platform-specific static-image variants
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a released Lineage build completes the approved dogfood scenarios and an agent plan-to-generation-to-validated-import workflow under identity gates, with critical UX friction dispositioned and all release gates green
- Goal oracle: release receipts plus live walkthroughs prove that people and agents can discover, plan, generate, import, reroll, and inspect locked static-image variants without violating the frozen contract
- Likely misfire: producing a version bump, scripted happy path, or provider-specific shortcut without learning from real use or preserving atomic pixel enforcement
- Blind spots considered: version collisions on active main, weak dogfood evidence, release-before-polish creating a second release, provider neutrality, generated-file pixel mismatch, operational profile drift, and tranche creep into video/publishing/transforms
- Existing plan facts: release first; dogfood ambiguous Instagram, multi-source overrides, and locked rerolls; use observed friction to drive polish; connect plans more directly to image generation; defer broader media and publishing contracts

## Goal Oracle

The oracle for this goal is:

`A released Lineage build completes the ambiguous-platform, multi-source override, locked-reroll, and provider-neutral agent generation/import walkthroughs with the same frozen target contract, no unresolved critical friction, and green release verification.`

The PM must keep comparing task receipts to this oracle. A release tag alone, UX mockup, local-only integration, or scripted success without imported-pixel evidence is insufficient. The goal finishes only when a final Judge or PM audit maps every required behavior to receipts and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the post-merge and release baseline, ship the first approved release channel, dogfood the critical workflows, implement only evidence-backed UX improvements, add the smallest provider-neutral agent generation bridge that preserves Lineage's planning/import boundaries, prove the complete workflow live, and publish any required final release delta.

## Non-Negotiable Constraints

- Start execution in a fresh dedicated worktree from freshly fetched GitHub `origin/main`; do not use the primary checkout, which contains unrelated documentation work.
- Obey the repository's five-step channel/profile/database/service identity gate before every operational Lineage walkthrough.
- Stable, preview, and dev must use separate named profiles and isolated databases.
- Release only a reviewed commit already on `main` through a new immutable annotated `v<package.json version>` tag; never move or reuse tags.
- Root package, plugin package, plugin manifest, `lineage.version`, changelog, npm dist-tag, GitHub Release, plugin artifact, and checksum must agree exactly.
- Use synthetic non-private static images and dedicated non-production profiles for dogfood.
- Dogfood must cover:
  - an ambiguous Instagram request that requires an explicit surface choice;
  - multi-source work with independent per-source targets, shared geometry, explicit split, and visible count math;
  - a locked reroll that inherits dimensions and routes geometry changes to a child variation.
- Dogfood findings must record severity, reproduction evidence, expected behavior, and explicit disposition. Critical friction blocks the next release.
- UX changes must be evidence-backed, bounded, and verified; do not redesign the feature from preference alone.
- The agent integration must keep Lineage provider-neutral. Lineage may plan, hand off, validate, and import, but must not call image-generation providers from the server.
- Generated outputs must still pass decoded-byte PNG/JPEG/WebP and exact-pixel validation; no mismatch override, implicit crop, or resize.
- Canvas defaults remain explicit and human-managed; agent and CLI access remains read-only.
- Existing unlocked jobs and protocol compatibility remain intact.
- Video contracts, automated safe-zone/composition validation, automatic transforms, platform publishing/scheduling, live platform synchronization, and destination-performance analytics remain deferred.
- Do not commit private media, credentials, campaign data, presigned URLs, customer content, or local SQLite databases.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after the first release, dogfood note, UX patch, or local agent demo while later required slices remain. If a release or external action becomes unsafe because main, versions, tags, credentials, or CI changed, record the exact blocker and continue every safe local slice that still advances the oracle.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, preserve it in the blocked receipt and stop once. Do not repeatedly request approval.

## Slice Sizing

Use the largest safe useful vertical slice. Release preparation, live release publication, dogfood, evidence-backed UX remediation, provider-neutral agent integration, integrated proof, and final release publication are separate risk boundaries. Do not split repeated changes into helper-sized tasks.

## Board Health

If the board is stale or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.1/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/static-image-output-target-adoption
```

The PM may repair only GoalBuddy control files unless the active task explicitly authorizes product changes.

## Canonical Board

Machine truth lives at:

`docs/goals/static-image-output-target-adoption/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, receipts, active work, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/static-image-output-target-adoption/goal.md.
```

## PM Loop

1. Read this charter, the GoalBuddy execution contract, and `state.yaml`.
2. Work only on the active task and keep exactly one task active.
3. Require T001 to establish the fresh execution worktree and replace provisional Worker scopes with exact repository-backed files and verification.
4. Treat releases, merges, tags, registry changes, and live-profile operations as phase/risk boundaries with fresh identity checks.
5. Record dogfood as evidence, not opinion, and turn only material findings into bounded work.
6. Keep provider execution outside the Lineage server while preserving one coherent agent workflow.
7. Finish only when T999 maps release, dogfood, implementation, integrated proof, and stable verification back to the oracle.
