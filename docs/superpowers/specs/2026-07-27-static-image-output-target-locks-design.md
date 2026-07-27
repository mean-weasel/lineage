# Static Image Output Target Locks

**Date:** 2026-07-27
**Status:** Approved design, pending owner review of the written specification
**Scope:** Provider-neutral static-image target resolution across agents, the
Lineage CLI, and the canvas

## Purpose

Give humans and agents one durable contract for requesting, displaying, and
enforcing exact static-image output dimensions.

A request such as “make Instagram versions” must not remain prompt text.
Lineage resolves it into explicit delivery surfaces and immutable pixel
dimensions, asks for clarification when the request is ambiguous, carries the
resolved targets through generation, and refuses to import mismatched output.

The same stored generation job is visible and actionable from the CLI and the
canvas. Neither side translates the other side's prose.

## Product Decisions

This design incorporates the following approved decisions:

1. V1 supports static images only.
2. A selected target is a hard pixel-dimension contract.
3. “Instagram” without a surface is ambiguous and requires clarification.
4. Geometry profiles are separate from platform delivery surfaces.
5. Multiple delivery surfaces may resolve to the same geometry.
6. Identical dimensions consolidate into one output by default.
7. A user may explicitly split same-sized destinations into separate creative
   variants.
8. Multi-source jobs do not implicitly apply one target set to every source.
9. Canvas defaults are explicit, canvas-scoped, and human-managed.
10. Agents and the CLI may read canvas defaults but cannot mutate them.
11. Each source in a branch operation may override the canvas defaults.
12. Re-rolls inherit a locked specification and cannot change it.
13. Custom dimensions are supported alongside named delivery surfaces.
14. Pixel dimensions are enforced in V1. Safe zones and composition notes are
    guidance only.
15. Target locks remain optional for generic generation so existing unlocked
    workflows continue to work.
16. Every resolved target group has an explicit positive variant count, defaulting
    to one.

## Terminology

### Geometry profile

An immutable, versioned static-image size:

```text
geometry profile = media kind + width + height + stable id + version
```

Examples include `1080×1080`, `1080×1440`, and `1080×1920`. Geometry profiles
are provider-neutral.

### Delivery surface

An immutable, versioned platform destination that resolves to one geometry
profile and carries human/agent guidance:

```text
delivery surface = platform + surface + geometry profile + guidance + source
```

Examples include Instagram Feed square, Instagram Story, LinkedIn vertical
single-image ad, and Pinterest standard Pin.

### Output target

A requested delivery surface or custom geometry assigned to one source asset
for one generation job. A target may inherit its source's default variant count
or declare a target-specific override.

An explicit `unlocked` target represents generic output with no dimension
contract. It exists so one target-aware multi-source job can combine locked
sources with a source intentionally left unspecified.

### Resolved target group

One output required from one source asset. It contains exact dimensions and one
or more intended delivery surfaces. Delivery surfaces with identical dimensions
consolidate into one group unless the user explicitly separates them.

Each group also has a positive `variant_count`. The planner expands the group
into that many output slots while preserving one shared geometry/destination
contract.

### Output specification

The immutable dimension contract attached to a produced lineage child. Every
future attempt on that node must satisfy it.

## Architecture

### Output Target Registry

Lineage ships a read-only, offline registry with two layers:

1. reusable geometry profiles;
2. delivery surfaces that reference those profiles.

Registry records are code/package data, not mutable user database rows.
Published records are immutable. A changed platform recommendation produces a
new record version instead of modifying an old one.

Each delivery-surface record contains:

- stable surface ID and integer version;
- platform and surface labels;
- media kind, fixed to `static_image` in V1;
- referenced geometry profile ID and version;
- optional aliases used for exact resolution;
- non-enforced safe-zone and composition guidance;
- source URL;
- source verification date;
- lifecycle state: `active`, `deprecated`, or `removed`;
- optional replacement surface ID/version.

The registry response uses
`lineage.output_target_registry.v1`.

### Initial Multi-Platform Catalog

The initial catalog is deliberately multi-platform. These are Lineage's
canonical output choices, not claims that every platform accepts only one size.
Where a platform supports a range, Lineage selects one deterministic size inside
that range so a target lock can be exact.

| Delivery surface | Canonical dimensions | Notes |
| --- | ---: | --- |
| Instagram Feed square | 1080×1080 | Current Instagram guidance preserves supported ratios at widths up to 1080 px. |
| Instagram Feed portrait | 1080×1440 | Uses the current 3:4 upper portrait bound, not the older 4:5-only assumption. |
| Instagram Story | 1080×1920 | Lineage canonical full-screen 9:16 static Story size. |
| Facebook Story | 1080×1920 | Shares the full-screen vertical geometry with Instagram Story. |
| LinkedIn single-image landscape | 1200×628 | LinkedIn recommended landscape dimensions. |
| LinkedIn single-image square | 1200×1200 | LinkedIn recommended square dimensions. |
| LinkedIn single-image portrait | 720×900 | LinkedIn recommended 4:5 dimensions. |
| Pinterest standard Pin | 1000×1500 | Pinterest recommended 2:3 dimensions. |
| X standalone image square | 1200×1200 | X recommended square dimensions. |
| X standalone image landscape | 1200×628 | X recommended 1.91:1 dimensions. |
| X standalone image portrait | 1440×1800 | X listed 4:5 dimensions. |
| X standalone image vertical | 1080×1920 | X listed 9:16 dimensions. |
| TikTok standard carousel vertical | 720×1280 | TikTok's listed vertical static carousel dimensions. |
| Google Business Profile photo square | 720×720 | Google's recommended photo resolution. |

The source material was checked on 2026-07-27:

- [Instagram photo resolution](https://www.facebook.com/help/1631821640426723/)
- [Meta Stories format](https://www.facebook.com/business/ads/stories-ad-format)
- [Instagram Story overlay guidance](https://www.facebook.com/help/instagram/192168966243613)
- [LinkedIn single-image specifications](https://business.linkedin.com/advertise/ads/sponsored-content/single-image-ads-specs)
- [Pinterest creative best practices](https://business.pinterest.com/creative-best-practices/)
- [X creative ad specifications](https://business.x.com/en/help/campaign-setup/creative-ad-specifications)
- [TikTok carousel specifications](https://ads.tiktok.com/help/article/specifications-for-carousel-ads?lang=en)
- [Google Business Profile photo guidance](https://support.google.com/business/answer/6123536?hl=en)

Registry tests pin every active surface to an exact geometry and source
verification date. Updating the catalog requires direct inspection of an
official platform source, a new immutable version, changelog coverage, and
regression fixtures proving historical resolution still works.

### Custom Geometry

A custom target contains exact integer width and height without implied platform
compatibility.

V1 accepts dimensions from 16 through 16,384 pixels per side with a maximum
decoded area of 100,000,000 pixels. Values outside either bound fail during
planning.

Custom targets use an identity derived from:

```text
static_image + width + height
```

Two equal custom targets resolve to the same geometry for grouping purposes.

## Persistence and Ownership

### Canvas defaults

Canvas defaults are scoped by:

```text
project_id + root_asset_id
```

They contain an ordered set of delivery-surface references and custom
geometries, plus human provenance and timestamps.

Defaults:

- are edited only through a human canvas operation;
- are never inferred from the last generation job;
- do not change automatically after import;
- are readable through the CLI and agent contract;
- cannot be mutated through a CLI or agent operation;
- do not affect already-planned jobs or existing assets.

The local product treats “human-only” as an interface/provenance boundary, not a
host-security boundary: the mutation route is used by the canvas, is absent from
CLI help and agent handoffs, and records `human` provenance. A future
authenticated production implementation must additionally authorize it as a
human operation.

### Generation target map

Each target-aware job stores a versioned source-to-target map and its canonical
SHA-256 digest.

```json
{
  "schema_version": "lineage.generation_target_map.v1",
  "sources": [
    {
      "asset_id": "asset-a",
      "default_variant_count": 1,
      "targets": [
        {
          "kind": "delivery_surface",
          "surface_id": "instagram.feed_portrait",
          "surface_version": 1,
          "variant_count": 2
        },
        {
          "kind": "delivery_surface",
          "surface_id": "instagram.story",
          "surface_version": 1
        }
      ],
      "separate_surface_ids": []
    }
  ]
}
```

Every selected source appears exactly once. `default_variant_count` defaults to
one and applies to targets without an override. Counts must be positive integers.
Targets are deduplicated within that source after resolution. If same-sized
targets consolidate, they must resolve to the same variant count; conflicting
counts fail with guidance to align the counts or explicitly split the surfaces.

A source's `targets` contains either one `unlocked` target or one or more locked
delivery-surface/custom targets. Mixing `unlocked` and locked targets within the
same source fails. The unlocked target expands to the source's variant count but
does not produce an output specification.

A target-aware multi-source job requires this explicit map; simple repeated CLI
target flags are valid only when exactly one source is selected. Existing
fully-unlocked multi-source planning retains its current
`--per-base-count` behavior. This prevents accidental Cartesian expansion
without breaking legacy generic generation.

### Resolved target groups

Planning resolves the target map into immutable groups. Each group stores:

- job and parent asset identity;
- stable target-group ID;
- exact width and height;
- geometry profile snapshot or custom-geometry snapshot;
- delivery-surface snapshots;
- grouping mode: `consolidated` or `explicit_split`;
- positive variant count;
- target-map digest;
- non-enforced guidance accumulated from its surfaces.

In V1, the default grouping key is:

```text
parent asset + media kind + width + height
```

Safe-zone and composition guidance do not change the grouping key. The
operation sheet makes aggregated guidance visible. A human or agent may split
same-sized surfaces when one creative should not serve every destination.

Each target group expands into ordered output slots from zero through
`variant_count - 1`. Output-slot identity is derived from job, target group, and
variant index. It is stable across manifest completion and retries.

An unlocked target forms one group whose width, height, geometry, destinations,
and output specification are absent. Its slots remain visibly unlocked through
handoff, manifest, canvas status, and import.

### Produced asset output specification

A successful target-aware import creates one immutable output specification for
each produced lineage child. The specification is intrinsic generation
provenance for that deliverable and contains:

- schema version `lineage.output_spec.v1`;
- media kind `static_image`;
- exact width and height;
- geometry profile ID/version or custom geometry;
- delivery-surface snapshots;
- source generation job and target-group identity;
- variant index within the target group;
- grouping mode;
- canonical specification SHA-256;
- creation timestamp.

The output specification attaches to the stable node/deliverable, not an
individual attempt. Attempts reference the specification and must validate
against it.

An asset's original output specification is never expanded merely because that
file is later reused for another destination. Future placement or publishing
intent is a separate concern.

## Agent and CLI Contract

### Registry discovery

Agents discover rather than memorize targets:

```bash
lineage output-targets list --media image --json
lineage output-targets resolve --query "Instagram Feed portrait" --json
lineage output-targets defaults --project <project> --root <root> --json
```

List and resolve are read-only. Defaults is also read-only.

`resolve` returns one of:

- `resolved`: one exact delivery surface and geometry;
- `ambiguous`: candidate surfaces and canonical follow-up queries;
- `not_found`: no candidate and a command to list active surfaces;
- `deprecated`: the requested version plus an explicit replacement.

Generic platform terms such as “Instagram” are ambiguous. Neither the resolver
nor an agent chooses a surface silently.

### Planning one selected source

For exactly one source, repeated flags are a convenient shorthand:

```bash
lineage generate image plan \
  --project <project> \
  --from-lineage-selection \
  --destination instagram.feed_portrait \
  --destination instagram.story \
  --custom-dimensions 1200x1500 \
  --variants-per-target 2 \
  --prompt "Create campaign variations" \
  --json
```

The command supports repeated `--destination` and
`--custom-dimensions` options. `--variants-per-target` is a positive integer and
defaults to one for every resolved group. Same-sized destinations consolidate
by default. An explicit separation option names the surfaces that must receive
distinct groups. Per-group count overrides require `--target-map`.

Target-aware planning rejects the legacy `--count` and `--per-base-count`
options. Those options retain their current meaning only for fully unlocked
legacy jobs.

### Planning multiple selected sources

Multiple selected sources require:

```bash
lineage generate image plan \
  --project <project> \
  --from-lineage-selection \
  --target-map <json-file> \
  --prompt "Create campaign variations" \
  --json
```

Using simple destination/custom-dimension flags with multiple selected sources
fails and directs the caller to `--target-map`.

The map parser:

- requires exact schema keys;
- rejects duplicate or unknown sources;
- rejects sources outside the active selection;
- rejects missing selected sources;
- resolves and freezes every surface version;
- validates custom geometry bounds;
- accepts an explicit unlocked source target but rejects locked/unlocked mixing
  within one source;
- validates variant counts and rejects conflicting counts inside a consolidated
  group;
- canonicalizes ordering before hashing.

### Optional locks

The existing target-free planning command remains valid and creates an unlocked
job. Its response and canvas representation say `Output format unspecified`.

In a target-aware multi-source map, a source may instead declare one explicit
unlocked target. Its output slots use the new job/manifest contract but carry no
dimension specification and skip only the hard dimension comparison at import.
All ordinary path, file, checksum, count, and atomicity validation still applies.

If a user request names a platform or exact dimensions, the agent must resolve
and include them. It may omit locks only for genuinely generic generation.

Canvas defaults are suggestions. An agent uses them only when the user asks to
use the canvas preferences; it reads and materializes them into the job's target
map. It cannot change the defaults.

### Plan response and handoff

A target-aware plan returns:

- target-map schema and digest;
- one resolution record per source;
- target groups and grouping reasons;
- variant counts and ordered output slots;
- exact dimensions;
- accumulated guidance;
- expected output count;
- a versioned output-manifest draft;
- canonical inspect and import commands.

The agent must present or explain this resolution before generation, including
the output count and any consolidated destinations.

New target-aware jobs use:

- adapter `generation-receipts-v3`;
- handoff `lineage.generation_handoff.v3`;
- output manifest `lineage.generation_output_manifest.v2`.

Previously planned adapters remain readable and completable through their
existing contracts.

### Target-aware output manifest

Each V2 manifest output contains:

- output index;
- parent asset ID;
- target-group ID;
- variant index;
- immutable output-specification snapshot and digest;
- file path;
- required one- or two-word edge summary.

The manifest parser compares job-owned target fields with the stored job. A
caller can fill file path and edge summary but cannot alter source, grouping,
destinations, dimensions, or specification identity.

## Canvas Experience

### Preferred targets

The canvas toolbar exposes a **Preferred targets** control. Its compact summary
shows destination and geometry chips.

The editor provides:

- platform and surface search;
- active surfaces grouped by platform;
- geometry beside every surface;
- custom width and height;
- warnings and replacements for deprecated surfaces;
- no automatic “recently used” mutation.

Saving defaults is a confirmed human canvas mutation with authoritative refresh.

### Create variations

The existing Branch action continues to select source nodes. The generation
operation sheet then:

1. lists every selected source separately;
2. prefills each row from canvas defaults;
3. permits independent add/remove overrides per source;
4. allows `No locked output format` explicitly;
5. resolves delivery surfaces into dimension groups;
6. shows consolidated destination chips;
7. provides `Create separate variants` for same-sized surfaces;
8. defaults to one variant per resolved group;
9. provides a source-level `Variants per format` control and advanced
   target-group overrides;
10. shows exact output math before confirmation;
11. creates the durable planned generation job.

Example summary:

```text
Source A
  1080×1440 → Instagram Feed portrait × 2
  1080×1920 → Instagram Story + Facebook Story × 3

Source B
  1200×1200 → LinkedIn square × 1

Total: 6 outputs
```

No hidden default is submitted. The confirmation payload contains the complete
target map shown to the user.

### Two-way job visibility

A canvas-created plan and a CLI-created plan call the same domain operation and
store the same contract.

After canvas planning:

- the canvas shows planned status and the frozen target summary;
- the agent handoff includes exact inspect/import commands and job ID.

After CLI planning:

- the same planned job appears in the canvas;
- source nodes, target groups, grouping mode, and dimensions render identically.

### Produced nodes

Target-aware output nodes display compact geometry and destination badges.
Details shows:

- exact dimensions;
- profile/custom origin;
- intended delivery surfaces;
- non-enforced guidance;
- generation job and target group;
- validation result and actual imported dimensions.

Unlocked nodes display `Output format unspecified`.

### Re-roll

If a node has an output specification:

- the re-roll sheet shows geometry and destinations as read-only;
- prompt and notes remain editable;
- planning inherits the specification automatically;
- import validates every attempt against the inherited dimensions;
- requesting another geometry routes to Create variation.

If a legacy node has no specification, existing unlocked re-roll behavior
continues. The user may explicitly lock it to the measured dimensions of its
current raster attempt. Delivery surfaces may be attached only when they resolve
to those exact dimensions.

## Validation and Atomicity

### Supported locked formats

V1 hard validation supports static PNG, JPEG, and WebP.

SVG does not have one authoritative raster pixel size. GIF may be animated.
Video has additional temporal and codec constraints. Those formats can remain
in existing unlocked workflows but cannot satisfy a V1 static-image lock.

### Byte-based inspection

An isolated image-metadata reader:

- identifies format from file bytes rather than extension;
- returns actual integer width and height;
- rejects corrupt or truncated data;
- enforces custom-dimension safety limits before full decode;
- does not call external services or execute media.

### Import order

For every target-aware output, import performs all of the following before any
persistent write:

1. resolve and contain the scratch path;
2. verify regular-file and uniqueness rules;
3. identify supported image format from bytes;
4. read actual dimensions;
5. compare the manifest target identity with the stored job;
6. compare actual dimensions with the frozen specification;
7. compute checksum, size, and content type;
8. validate the complete output set.

Only after every output passes may indexing and the existing receipt transaction
begin.

A failure in one output leaves no target-aware asset, edge, attempt, output
specification, receipt, job-status, or selection mutation. Existing known
index-before-transaction behavior must be corrected for target-aware imports;
the hard-contract path cannot leave an indexed orphan after a later failure.

### Errors

Dimension mismatch errors identify:

- job ID and output index;
- parent asset and target-group ID;
- intended delivery surfaces;
- expected width and height;
- actual width and height;
- the exact retry action.

The import does not provide an accept-mismatch override. The caller must create
or resize the correct output and retry.

## Compatibility and Migration

- No existing database row is rewritten merely by installing the feature.
- Existing generation jobs, manifests, outputs, and assets remain unlocked.
- Previously planned adapter versions complete through their old inputs.
- Existing CLI commands without target flags retain their behavior.
- New fields are optional on legacy API/JSON responses.
- A new target-aware job always uses the new adapter and manifest versions.
- A produced locked node cannot become unlocked.
- A locked node's dimensions cannot change through re-roll or attempt promotion.
- A different geometry is represented as a new child variation.
- Registry updates never mutate job or asset snapshots.
- Selection packets populate dimensions from output specifications when present
  and retain the existing unavailable-dimensions warning for legacy assets.

## Safety Boundaries

This feature:

- does not call image-generation providers from the Lineage server;
- does not resize, crop, or transform an imported file automatically;
- does not publish, upload, schedule, or invoke Buffer;
- does not treat destination intent as permission to post;
- does not machine-validate safe zones, text placement, visual composition, or
  platform policy;
- does not allow agents to mutate canvas defaults;
- does not infer a surface from an ambiguous platform name;
- does not accept a mismatched import with a warning.

## Verification

### Registry

- Every active surface resolves to an immutable geometry and source.
- Ambiguous platform-only queries return candidates without a default.
- Deprecated versions retain historical resolution and name a replacement.
- Custom geometry bounds and canonical identity are deterministic.
- Registry updates leave historical fixtures unchanged.

### Resolution and grouping

- Identical dimensions consolidate per source.
- Different parents never consolidate together.
- Explicit splits remain separate despite identical dimensions.
- Multi-source shorthand is rejected instead of creating a Cartesian product.
- Target-map ordering does not change its digest.
- Missing, duplicate, unknown, or unselected sources fail before job creation.

### CLI and agent

- List, resolve, and defaults JSON are schema-versioned and sufficient for
  agent discovery.
- Agents cannot mutate canvas defaults through the CLI.
- Ambiguous natural-language requests require clarification.
- One-source flags and multi-source maps produce equivalent normalized jobs
  when their intent is equivalent.
- Plan output explains grouping and exact output count.

### Canvas

- Human defaults persist per canvas and never leak across roots.
- Defaults prefill but do not bypass operation confirmation.
- Per-source overrides produce the exact visible target map.
- Group and split controls update output math correctly.
- Source-level and per-group variant counts expand to the exact visible number
  of output slots.
- Canvas-created and CLI-created jobs render the same frozen contract.
- Locked, unlocked, and deprecated states are accessible and explicit.

### Hard validation

- Correct PNG, JPEG, and WebP dimensions import.
- Extension spoofing, corrupt bytes, SVG, GIF, and video fail locked import.
- Width or height mismatch fails with expected and actual values.
- Manifest target tampering fails against job-owned identity.
- One bad file rolls back the whole multi-output operation.
- Exact retries are idempotent; divergent retries return conflict.
- Re-roll import inherits and enforces the node specification.

### Compatibility

- Existing unlocked plan/import and re-roll tests remain green.
- Legacy manifests remain completable.
- Legacy selection packets preserve their warning behavior.
- Locked selection packets expose dimensions.

### Full gates

Before completion, run:

- focused registry, target-map, generation, manifest, canvas, CLI, selection
  packet, and re-roll tests;
- `npm run check`;
- `npm run lint`;
- `npm run ci`;
- `npm run e2e`;
- `npm run public:readiness`;
- `npm run package:smoke`;
- the required dev runtime/profile/database identity gate before any operational
  walkthrough.

## Adversarial Completion Standard

The user-facing completion claim is:

> A human or agent can create a static-image generation job with explicit
> platform surfaces or custom dimensions; both interfaces see the same resolved
> target mapping; and Lineage atomically rejects any imported output whose
> actual pixels violate its locked specification.

The top three realistic failure modes are:

1. **Incorrect grouping:** same-sized destinations are accidentally duplicated,
   intentionally split variants are collapsed, or targets from different
   sources are combined.
2. **Validation bypass or partial writes:** renamed/corrupt media, edited
   manifests, or one bad file in a batch enters lineage or leaves partial state.
3. **Mutable intent:** canvas defaults, registry upgrades, or re-rolls silently
   change an already-planned or already-produced specification.

Completion requires command, test, browser, database, and receipt evidence
against all three. Planning, UI-only proof, prompt wording, or manifest shape
alone is insufficient.

## Deferred Work

- Video resolution, duration, codec, bitrate, frame-rate, and audio contracts.
- Automated safe-zone and composition validation.
- Automatic crop or resize transformations.
- Live platform-spec synchronization.
- Platform publishing and scheduling.
- Performance feedback by destination.
- Human CLI mutation of canvas defaults.
