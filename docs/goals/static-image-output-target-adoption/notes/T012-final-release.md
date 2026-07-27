# T012 — Final adoption release

## User-facing claim

Lineage `0.1.28` is merged, published, and independently verified from the
stable npm channel. The released package completes the provider-neutral
plan→scaffold→external generation→atomic import workflow and exposes the exact
locked pixel contract on the production canvas.

## Reviewed merge and immutable release

- Pull request: [#122](https://github.com/mean-weasel/lineage/pull/122)
- Reviewed head: `0e07edc49fe999b2d4697421285519decaa9413d`
- Merge-queue commit on `main`:
  `9df5f2b4d15d1ab3b0203af4fa5bf0af084cb6bf`
- Pull-request checks: 6 successful, 0 failing
- Post-merge checks: 8 successful, 0 failing
- Annotated tag: `v0.1.28`, dereferencing to the exact main merge commit
- Release workflow:
  [30298217262](https://github.com/mean-weasel/lineage/actions/runs/30298217262)
- GitHub Release:
  [Lineage v0.1.28](https://github.com/mean-weasel/lineage/releases/tag/v0.1.28)
- npm: `@mean-weasel/lineage@0.1.28`, with `latest=0.1.28`
- npm integrity:
  `sha512-c7qPKiY6N9Gk8arF9GCqHxCJxsysk0wCWTx0lb6SQid6zT6dEfVS9lmRhkVR1LyV2FUzakyi8tqDuqBasHXAPQ==`
- GitHub assets:
  `lineage-codex-plugin-0.1.28.tgz` and its `.sha256`

The tag-triggered workflow passed immutable tag/version-lock checks, built and
attached plugin assets before npm publication, verified the published installer
against the tagged plugin, published exact `0.1.28`, verified npm/GitHub parity,
and opened the post-release documentation verification issue.

## Published stable-runtime replay

The replay used a fresh named production profile and only synthetic demo media:

- Channel: `stable`
- Runtime origin: npm package
- Runtime version: `0.1.28`
- Git SHA: `9df5f2b4d15d1ab3b0203af4fa5bf0af084cb6bf`
- Code fingerprint:
  `f6ca8c085bd6fdabb4b33aa46baca5cef659bdb38675306219ed08df63ce3bb4`
- Profile: `output-target-adoption-028-final`
- Profile fingerprint:
  `e19e90af2ab574f0956d0faa7ef7fbb6bc595fcec475a24124f1bdb9f92869dd`
- Service: `http://lineage.localhost:5199`
- Service instance: `8e1dd9ee-1746-4047-b481-a3e6d81a181e`

Runtime doctor, profile doctor, `db info`, managed service status, and
`/api/runtime` agreed before writes and after import.

Stable job `gen-ms3mj5ov-a4e8323e` froze a custom static-image contract at
`1024x1536`, emitted the deterministic scaffold, and imported the externally
generated PNG as `local-25d0fa2d7d93`. Decoded bytes were exactly `1024x1536`;
the checksum was
`25d0fa2d7d9388088d857c11fa2e212d055d63b45ce85ee19f8b7c213dea1ce6`,
and persisted output-spec digest was
`3757dd2b92d601d14ccbc724903e38f3ec7ea0f5bd5556c5bc73faf0880ea54c`.
The resulting graph contained 11 nodes and 10 edges.

[Stable 0.1.28 generation proof](T012-stable-release-proof.jpg) shows the real
generated image, `plan: ok · import: ok`, `imported and verified`, and
`Locked 1024 × 1536 px` in the production canvas.

## Adversarial proof

Top realistic failure modes:

1. **The release tag points at something other than reviewed main.** Remote tag
   dereference equals merge-queue commit `9df5f2b`; the reviewed PR head is its
   second parent, and all post-merge checks are green.
2. **Package, plugin, or release channels disagree.** Root, lock, plugin,
   manifest, compatibility, docs review, changelog, npm `latest`, GitHub tag,
   release assets, and stable runtime all report `0.1.28`; the release workflow's
   installer and parity gates passed.
3. **Checkout-only success masks a broken published bridge.** A freshly resolved
   npm stable package, fresh production profile, and identity-matched managed
   service performed the real frozen-plan scaffold and exact decoded-pixel
   import, with independent CLI and canvas proof.

The release remains provider-neutral and static-image-only. Canvas defaults are
still user-controlled; video, transforms, safe-zone validation, publishing, and
scheduling remain outside this tranche.
