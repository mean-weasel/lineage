# T006 Integrated Adversarial Review

## Decision

Not ready for live proof. The committed implementation covers the core persistence, CLI, import-integrity, and named-surface canvas path, but explicit approved requirements remain missing. A bounded remediation Worker is required before T007.

## Requirement matrix

### Pass

- Static-image-only hard pixel locks are represented by frozen registry and output-spec snapshots.
- The approved multi-platform catalog, custom numeric bounds, and registry version are implemented.
- Platform-only CLI resolution is ambiguous and returns selectable follow-ups.
- Same-sized surfaces consolidate per source, explicit splits remain separate, and different parents never combine.
- Target-aware multi-source requests require explicit per-source mapping and support explicit unlocked sources.
- Positive variant counts, deterministic canonical ordering/digests, and conflict rejection are implemented.
- Defaults are project/root scoped, explicit, human-provenanced, read-only to CLI/agent, and snapshotted into jobs.
- New target-aware jobs use receipt v3, handoff v3, manifest v2, target-map v1, output-spec v1, and registry v1.
- Legacy unlocked planning, manifests, imports, rerolls, counts, and selection warnings remain covered.
- PNG/JPEG/WebP byte inspection, spoof/corruption/type/dimension rejection, complete preflight, transactional indexing, zero-partial-write rollback, idempotent retry, and divergent conflict are directly tested.
- Locked asset specifications drive selection dimensions and reroll inheritance. Different geometry creates a child-variation plan.
- Canvas named-surface planning uses the same durable backend operation, shows canonical preview output math, and renders receipt-derived lock/import proof.

### Fail — remediation required

1. `canonicalizeGenerationTargetMap` reconstructs known fields but does not reject unknown root, source, or target keys. The approved parser contract requires exact schema keys so malformed or future-looking JSON fails closed.
2. Canvas defaults and branch planning expose delivery surfaces and unlocked state only. They neither create custom width/height targets nor rehydrate stored custom targets, despite custom dimensions being an approved first-class target on both surfaces.
3. The preferred-target editor lacks platform/surface search, grouped platform presentation, and lifecycle/replacement treatment. The branch sheet lacks the explicit source-level `Variants per format` control described by the approved UX, although individual group counts exist.

## Top-three failure-mode assessment

### Incorrect grouping

Strong backend evidence exists in `generationTargetMap.test.ts`, planning tests, CLI normalization tests, component tests, and the browser consolidation workflow. The custom-canvas omission means this evidence does not yet cover custom-plus-surface grouping from the human surface.

### Validation bypass or partial writes

Strong evidence exists in byte-decoder, manifest-tamper, forced-late-failure, retry, and atomic transaction tests. The exact-key parser gap is a remaining fail-closed weakness at the planning boundary, even though target identity is later canonicalized.

### Mutable intent

Strong evidence exists for detached defaults snapshots, immutable stored asset specs, registry/default drift resistance, reroll inheritance, and child variation. Canvas custom defaults cannot yet participate, so cross-surface parity is incomplete rather than mutable.

## Compatibility and protocol assessment

The version transitions are additive and legacy tests remain green. The persisted wrapper around `lineage.output_spec.v1` supplies source job identity, digest, timestamp, actual dimensions, group, and variant data while the manifest snapshot carries the immutable pre-import geometry contract.

## Required remediation

T008 must add exact-key validation, complete custom-dimension canvas support, finish the approved discovery/count controls, and extend focused/browser coverage. T007 remains queued until T008 is done and verified.
