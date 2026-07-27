# T004 released-runtime dogfood receipt

Date: 2026-07-27

## Claim under test

Lineage 0.1.27 lets a human or agent resolve an ambiguous static-image destination, plan independent target groups for multiple selected sources, import exact-pixel child variations, and reroll a locked child without changing its node identity or output contract.

The released backend contract passed those scenarios. The released canvas planner did not: branch-level draft edits are reset immediately. Large `--json` generation receipts also truncate at 65,536 bytes.

## Identity gate

- Channel/launcher: `stable` / `lineage-stable`
- Package: `@mean-weasel/lineage@0.1.27`
- Git SHA: `d1c680928e7006cc1a9d51026d494cb1752324a1`
- Code origin: package
- Code fingerprint: `adb642984cc89e6e5a9c3d78b817c62f3da780835b58de58b0ec0f507ebbd18d`
- Profile: `output-target-adoption-027-dogfood`
- Profile fingerprint: `d1d81c6328e4d57d42b165f58b3a8b47dfba3597ea0cfd7ff47b664dd3a83e1a`
- Environment: production
- Service origin: `http://lineage.localhost:5198`
- Database: profile-bound, isolated SQLite database with one synthetic project/workspace
- Service instance: `840133a4-045d-4632-b02d-999cefa8b1d7`

`runtime doctor`, `profile doctor`, `db info`, and `/api/runtime` all agreed before operational writes. An unrelated stable service already owned port 5197; it was left untouched and this dogfood profile was assigned 5198.

## Walkthrough 1: ambiguous Instagram intent

Command:

```sh
lineage-stable output-targets resolve \
  --query Instagram \
  --profile output-target-adoption-027-dogfood \
  --json
```

Observed:

- `status: ambiguous`
- Instagram Feed square — 1080 × 1080
- Instagram Feed portrait — 1080 × 1440
- Instagram Story — 1080 × 1920

This satisfies the hard-contract rule: an ambiguous platform name does not silently choose dimensions and instead asks the user to choose a surface.

## Walkthrough 2: independent multi-source targets

Synthetic sources:

- `local-26f8299645f3` — Selected Product v03
- `local-8c37de3d70a3` — Founder Note v01

The explicit target map requested:

- Selected Product: Instagram Story + Facebook Story, consolidated because both use 1080 × 1920, one output.
- Founder Note: Instagram Story, two outputs.
- Founder Note: X standalone vertical, explicitly split, two outputs.

Dry run and persisted plan both produced:

- Expected output count: 5
- Three groups
- Group 0: 1080 × 1920, Facebook Story + Instagram Story, consolidated, one output
- Group 1: 1080 × 1920, Instagram Story, consolidated, two outputs
- Group 2: 1080 × 1920, X standalone vertical, explicit split, two outputs
- Plan digest: `3c559921d84bf532ef9ed07bd2ddb0c25d8a18d4c0a2882b613eeb72ba6a290d`
- Job: `gen-ms3je09k-d877722d`

Five distinct synthetic PNG files decoded as exactly 1080 × 1920 and imported atomically. The job persisted as `imported` with five output receipts and the lineage grew from 10 to 15 nodes. The canvas decorated every imported child with its locked dimensions and destinations.

Visual evidence:

- [Planner draft reset](./T004-planner-reset.png)
- [Imported locked children](./T004-locked-child-reroll.png)
- [Generation proof panel](./T004-generation-proof.png)

## Walkthrough 3: child variation versus locked reroll

The multi-source import created a visible child:

- Node: `local-fc24e75b30d8`
- Parent: `local-26f8299645f3`
- Original output-spec digest: `deb3c5619973e0ae4ff6f5789cb133b0d3652b7a055c59dfe4512bea51b69b69`
- Lock: 1080 × 1920
- Destinations: Facebook Story + Instagram Story

A reroll request was marked on that child, then planned as job `gen-ms3jiqza-8f846ecb`. The plan inherited:

- `source_mode: lineage_reroll`
- Expected output count: 1
- 1080 × 1920
- Facebook Story + Instagram Story
- Consolidated grouping
- Instruction: import as an attempt, not a child

The replacement file decoded as exactly 1080 × 1920 and imported successfully. Persisted proof:

- Visible lineage node count remained 15.
- Node identity remained `local-fc24e75b30d8`.
- Attempt count changed from 1 to 2.
- Current attempt source is `reroll`.
- Current attempt asset is `local-54412cd12c29`.
- `local-54412cd12c29` is not a visible lineage node.
- The reroll request and reroll task were resolved.
- The canvas shows `v2` and `locked 1080×1920` on the same node.
- Generation proof shows both the original five-output import and the locked one-output reroll as imported and verified.

## Ranked friction

### 1. Critical — canvas branch overrides reset immediately

- Reproduction: open **Plan outputs** with two selected sources; select any destination checkbox, change a count, or set a split. The control briefly focuses and returns to its prior value.
- Expected: each source draft retains independent destinations, split state, and counts until the human closes or submits the planner.
- Evidence: `T004-planner-reset.png`; DOM inspection showed the checkbox remained false after label click, `check()`, DOM click, and Space. No console error occurred.
- Root cause: `LineageView` creates a fresh `selectedNodes` array on every render. `LineageGenerationSheet` has an initialization effect dependent on `sources`; any draft state change rerenders the parent, changes the array identity, reruns initialization, and overwrites the draft from defaults.
- Why tests missed it: the existing browser test preloads canvas defaults and submits them; it does not edit branch-level selections.
- Disposition: must fix before adoption can be called complete. Add a direct interaction regression test covering independent per-source edits, grouping/split, and counts.

### 2. Medium — large CLI JSON receipts are invalid

- Reproduction:

  ```sh
  lineage-stable generate image inspect \
    --job-id gen-ms3je09k-d877722d \
    --project demo-project \
    --profile output-target-adoption-027-dogfood \
    --json | <JSON parser>
  ```

- Observed: exactly 65,536 bytes; parse error `Unterminated string in JSON at position 65536`; the tail ends mid-field.
- Expected: `--json` always emits one complete parseable JSON document regardless of receipt size.
- Evidence: the service API returned the complete persisted job; the CLI stream was exactly 65,536 bytes and invalid.
- Disposition: fix the managed launcher/output transport or provide a bounded summary mode while keeping `--json` complete. Add a regression fixture above 64 KiB.

### 3. Low, expected safety behavior — identical synthetic outputs collide by content identity

- Reproduction: provide byte-identical files for output slots carrying different immutable output specifications.
- Observed: import fails closed with `Asset ... already has a different immutable output specification` and the job remains planned.
- Expected: a content-addressed asset must not acquire conflicting immutable output specs.
- Evidence: retrying with distinct files imported all five outputs successfully.
- Disposition: no product change required. Improve fixture guidance only if this recurs in onboarding.

## Adversarial proof

Top realistic failure modes and evidence:

1. The canvas appears configurable but silently discards branch overrides — reproduced and ranked critical.
2. Grouping, splits, or variant counts are persisted incorrectly — dry run, persisted target plan, five imported outputs, and canvas generation proof agree.
3. A locked reroll creates a new visible child or changes geometry — node count stayed 15, the original node became `v2`, the replacement asset did not become a node, and the reroll plan/import both verified 1080 × 1920.

## T004 disposition

Dogfood is complete. The released hard contract works through CLI and persisted receipts, but adoption is blocked on the canvas draft-reset defect. The JSON truncation defect is also concrete and bounded for follow-up judgment.
