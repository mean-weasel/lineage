# T007 Live Proof

## User-facing claim

Agents/CLI and canvas can create the same immutable static-image output-target plan. Exact decoded pixels are enforced at import, shared geometry consolidates unless explicitly split, and rejected media leaves no partial output state.

## Fresh repository gates

- `npm run check` — pass.
- `npm run lint` — pass.
- `npm run ci` — pass as one uninterrupted run after remediating three surfaced issues. The green run includes 84 test files (594 passed, 4 skipped), release policy, docs, knip, build, pages, onboarding, runtime isolation/oracle, stable upgrade, 14 Playwright tests, public readiness, package/managed-service smoke, plugin smoke (35 installer tests), and `npm audit` with zero vulnerabilities.
- `npm run e2e` — 14/14 pass as a standalone fresh run.
- `npm run public:readiness` — pass as a standalone fresh run.
- `npm run package:smoke` — package and managed-service smoke pass as a standalone fresh run.
- `npm test -- src/server/staticImageMetadata.test.ts src/server/generationReceipts.test.ts src/server/generationTargetPlanning.test.ts src/server/generationTargetDefaults.test.ts src/shared/generationTargetMap.test.ts --reporter=verbose` — 50/50 pass with named adversarial coverage.

The first CI attempt exposed unused exports and produced T009. The second exposed an ambiguous existing browser locator and produced T010. The third reached the final audit and exposed vulnerable `sharp@0.34.3`, producing T011 and the exact `sharp@0.35.3` pin. The final CI run was fully green; none of these failures was waived.

## Identity gate

- Channel: checkout-only `npm run lineage:dev --`.
- Checkout root: `/Users/neonwatty/Desktop/lineage/.worktrees/static-image-output-target-locks`.
- Git SHA: `462ebe71d25d880cb7f05f4c0841482a9e0ac4b5`.
- Code fingerprint: `f117f16eff1900a65e431ea17891089ee736329922d2ef395d4f684a2d327999`.
- Profile: `output-target-locks-dev`.
- Environment: `development`.
- Profile/database fingerprint: `091cbe7aad5eae5df7042678b70852738e80190a42b2e5e3b69c22728c41cfb4`.
- Service origin: `http://lineage-dev.localhost:5198`.
- Runtime doctor, profile doctor, `db info`, managed-service status, and live `/api/runtime` all agreed before and after the walkthrough.
- A pre-existing dev service for `development-social-marks` caused the first managed start to fail closed on every identity mismatch. It was stopped through the managed lifecycle; this profile was repinned and the full three-part gate was repeated before restart.

## Canvas/CLI parity and live import

- Canvas job: `gen-ms3amiou-6c4bd6e6`.
- CLI/agent job: `gen-ms3amzy6-d0e70494`.
- Both persisted canonical digest `9193936a00d840c058528cbe2f4af2ddaad943ef47a45ae7ae8e3e0138f0da94`.
- Both map source `local-26f8299645f3` to `facebook.story@1` and `instagram.story@1`.
- Both resolve one consolidated group and one slot at exactly `1080x1920`.
- The CLI manifest imported a byte-decoded PNG at exactly `1080x1920` as `local-6af8e6f9bc28`.
- The import receipt records `actual_dimensions: { width: 1080, height: 1920 }`, content type `image/png`, and the frozen output-spec digest.
- The refreshed canvas shows 11 nodes/10 links, renders the portrait, and labels it `locked 1080×1920` for Facebook Story + Instagram Story with imported status.
- Synthetic screenshots (ignored, not committed):
  - `.asset-scratch/T007-canvas-locked-job.png`
  - `.asset-scratch/T007-imported-fit-view.png`
  - `.asset-scratch/T007-imported-detail.png`

## Negative and semantic proof

- Live wrong-dimension job `gen-ms3aqecc-24a4ad5a` rejected decoded `1080x1919` against locked `1080x1920`. Fresh inspection showed `status: planned`, `outputs: 0`, and only the original plan receipt.
- A first import with the output missing from the profile-scoped scratch root also failed closed; the unchanged manifest then succeeded after the synthetic file was placed correctly, proving safe retry from a no-write failure.
- `output-targets resolve --query Instagram` returned structured `ambiguous` status with Feed square, Feed portrait, and Story choices; it did not guess.
- A CLI dry-run with Instagram Story + Facebook Story, explicit Facebook split, and two variants per target resolved two same-sized groups and four slots.
- Named passing tests prove misleading extensions decode from bytes; truncated/corrupt bytes and spoofed SVG/GIF/video fail; PNG/JPEG/WebP exact-size batches import; one-invalid-item batches and late failures leave zero assets/edges/output specs; target maps require exact per-source intent; equal geometry consolidates; explicit splits/counts persist; conflicting counts/mixed lock state fail; defaults are detached snapshots and reject agent/CLI provenance; rerolls inherit locks and different geometry creates a child variation.

## Top three realistic failure modes

1. **Surface parity drift:** canvas and CLI could label the same request differently. Direct evidence: separate live jobs have identical canonical digest, dimensions, surfaces, grouping, and slot count.
2. **Validation bypass or partial state:** renamed/corrupt/unsupported/wrong-size media or a mixed batch could index something before failure. Direct evidence: live wrong-size inspection has zero outputs; named decoder, full-batch preflight, rollback, and database-zero-row tests pass.
3. **Frozen intent mutation:** defaults, rerolls, registry changes, or later UI state could alter an existing lock. Direct evidence: human-only detached-default tests, persisted snapshot/digest checks, idempotent import tests, immutable reroll-lock tests, and child-variation geometry tests pass.

## Remaining work

Only T999 final read-only completion audit remains.
