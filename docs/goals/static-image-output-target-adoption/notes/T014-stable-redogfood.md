# T014 — Published stable 0.1.28 re-dogfood

## User-facing claim

The two T006 adoption repairs work from the published stable 0.1.28 package:
independent multi-source canvas drafts survive every interaction and an
unrelated parent rerender, and a realistic CLI receipt larger than 65,536 bytes
is complete, parseable, and exactly equal to persisted state.

## Identity gate

The re-dogfood used a fresh production profile with synthetic demo media:

- Channel: `stable`
- Package version: `0.1.28`
- Git SHA: `9df5f2b4d15d1ab3b0203af4fa5bf0af084cb6bf`
- Code fingerprint:
  `f6ca8c085bd6fdabb4b33aa46baca5cef659bdb38675306219ed08df63ce3bb4`
- Profile: `output-target-adoption-028-redogfood`
- Profile fingerprint:
  `fa03a0218b144fe81206f4efe3d79899aca23b1c4a7f25e6cdf95533492d7755`
- Service: `http://lineage.localhost:5200`
- Service instance: `4482fbd2-76a6-49dd-8903-9cd26ca9160f`

Runtime doctor, profile doctor, `db info`, managed status, and `/api/runtime`
agreed before writes and after the persisted plan.

## Canvas draft-retention replay

The synthetic demo workspace selected two sources:

- `local-26f8299645f3` — Selected Product v03
- `local-08f50da17a06` — Before / After v02

The human canvas default was explicitly set to Instagram Story. The branch
planner then received, one interaction at a time:

1. Source one added Facebook Story while retaining Instagram Story.
2. Facebook Story was marked `Create separate variants`.
3. Source-one default variants changed to 2.
4. Source-one advanced Facebook Story count changed to 1 while Instagram Story
   remained 2.
5. Source two removed Instagram Story.
6. Source-two default variants changed to 2.
7. Source two added custom geometry `1200x1500`.
8. Prompt changed to `Create independent story and custom variants`.
9. The background canvas search state changed while the sheet remained open,
   forcing an unrelated parent rerender.

After every interaction, direct element inspection confirmed all prior values
remained unchanged. After the forced parent rerender the complete draft still
contained:

- Source one: Instagram Story checked, Facebook Story checked, Facebook split
  checked, default count 2, Instagram count 2, Facebook count 1.
- Source two: Instagram Story unchecked, default count 2, custom
  `1200x1500`.
- The full generation prompt.

Screenshots:

- [Source-one destinations and split retained](T014-source-one-retained.jpg)
- [Per-group and second-source counts retained](T014-counts-retained.jpg)
- [Second-source custom geometry retained](T014-source-two-retained.jpg)
- [Resolved exact preview](T014-preview.jpg)
- [Published stable planned canvas](T014-planned-canvas.jpg)

## Persisted canonical plan

The stable canvas persisted job `gen-ms3n0j7v-864cb2fe` as `planned` with
exactly five outputs in three groups:

1. `local-08f50da17a06`, `1200x1500`, consolidated, two outputs, no
   destination.
2. `local-26f8299645f3`, `1080x1920`, explicit split, one output,
   Facebook Story.
3. `local-26f8299645f3`, `1080x1920`, consolidated, two outputs,
   Instagram Story.

The persisted target map exactly retained the two independent source mappings,
counts, explicit split, surface versions, and custom geometry. Canvas badges
showed locked `1200x1500` and locked `1080x1920` after submission.

## Large CLI JSON replay

`lineage-stable generate image inspect --json` for the same job emitted
**87,786 bytes**, exceeding the old 65,536-byte truncation boundary.

- `jq` parsed the complete response.
- The response reported the same job ID, expected output count 5, and group
  count 3.
- Canonical sorted `.job` JSON from the CLI and the persisted API job had the
  same SHA-256:
  `35b2d5aa9c5038af9078efa8bea0bef94550e22449be4c66409a1555e1372bf8`.

## Adversarial proof

Top realistic failure modes:

1. **A later branch edit resets an earlier source draft.** Values were inspected
   after every destination, split, count, custom-size, and prompt interaction;
   all remained intact.
2. **The fix only survives local state until the parent rerenders.** Changing
   background canvas search state forced the sheet's parent to rerender while it
   remained open; the complete two-source draft was unchanged afterward.
3. **Preview looks correct but persistence or CLI output drifts.** The persisted
   target map and three group semantics matched the preview exactly, while the
   87,786-byte CLI object parsed and hashed identically to the persisted job.

No product or release change was required. This closes the explicit T005
released-and-re-dogfooded gate.
