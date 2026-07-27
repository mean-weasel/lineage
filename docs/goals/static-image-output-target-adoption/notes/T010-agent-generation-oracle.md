# T010 — Integrated agent-generation oracle

## User-facing claim

A Lineage agent can resolve and freeze an explicit static-image pixel contract, emit a provider-neutral generation scaffold, hand the resulting file back through the manifest, import it atomically, and expose the locked output on the canvas. A real generated file with the wrong decoded dimensions is rejected without partial persistent state.

## Identity gate

The oracle ran from the dedicated adoption worktree at commit
`61347d06edd08f113d2668abd440c8836cccad5b` with checkout-only dev code:

- Channel: `dev`
- Launcher: `npm run lineage:dev --`
- Profile: `output-target-agent-oracle-dev-1`
- Environment: `development`
- Service: `http://lineage-dev.localhost:5298`
- Code fingerprint: `221f976e77ac2037f90e34e70efa7d42d225616b9841331d23c54a12a394891d`
- Source fingerprint: `8ad10e74977eb73a7edb3fdf238273cb9c8f1672523aeda99d7dd5e1924f672e`
- Profile fingerprint: `707ad853cee9b31935e7fd4e331c13c1ba196d6ee4c36e61b2590fda6301a970`
- Service instance: `ec2c48e0-a3c1-4cc1-829a-24b5ed2dbcb2`

Runtime doctor, profile doctor, `db info`, and managed service status all agreed
before writes and again after both the successful and rejected imports. The
profile used only the synthetic demo workspace and generated non-private media.

## Successful exact-size flow

The agent selected an explicit custom surface to exercise the pixel contract
without relying on a platform alias. The requested output was `1024x1536`, one
consolidated static PNG, from synthetic source node `local-26f8299645f3`.

1. Lineage planned job `gen-ms3la7dj-eeb5763c`.
2. The persisted target plan digest was
   `383758f95a2107003da8689f1b1e3f8e0158d18172c93c364e0589cdd752db4a`.
3. The persisted output-spec digest was
   `417e17fd88dbb9235ffbc2c6fa8f04fbc860cef5ad4fc1b4b180fc4c8550ba16`.
4. `generate image scaffold` produced the no-clobber manifest at
   `.asset-scratch/generation/gen-ms3la7dj-eeb5763c/generation-output-manifest.json`
   with deterministic `output-000.png`, frozen machine metadata, and an empty
   human-authored edge summary.
5. Codex image generation produced a real PNG whose decoded dimensions were
   exactly `1024x1536`. Lineage itself made no provider call.
6. Only the generated file path and `Portrait branch` edge summary crossed the
   handoff. The file SHA-256 was
   `25d0fa2d7d9388088d857c11fa2e212d055d63b45ce85ee19f8b7c213dea1ce6`.
7. Import succeeded atomically as asset/node `local-25d0fa2d7d93`; the job became
   `imported` with one output, and canvas generation proof showed the verified
   locked `1024x1536` contract.

Evidence:

- [Generated child on canvas](T010-agent-generated-child.png)
- [Generation proof](T010-generation-proof.png)
- [Generation proof detail](T010-generation-proof-detail.png)

## Real generated mismatch

A second frozen job, `gen-ms3lcoq6-6a43035c`, required the same `1024x1536`
contract. Its output-spec digest was
`e8db34320b66a72dd15133d6e0a9879ef41f72f852c7460563638702898719de`.
The provider returned a real square PNG decoded as `1254x1254`; its SHA-256 was
`950d99fc847c0b85a4846c86f5fe6c9071f16e81b20dfef8f80bb124573eae3a`.

Import failed with the exact contract error: required `1024x1536`, decoded
`1254x1254`. After the failure:

- The job remained `planned`.
- It had zero imported outputs and retained only its plan receipt.
- The lineage graph remained at 11 nodes and 10 edges.
- The wrong-size checksum did not appear as an asset node.
- Direct database inspection found zero rows attributable to the rejected
  output in `assets`, `edges`, `generation_job_outputs`, and
  `asset_output_specs`.

## Adversarial proof

Top realistic failure modes and evidence:

1. **The scaffold mutates or weakens the frozen plan.** Focused scaffold tests
   prove frozen-field equality, deterministic PNG/JPEG/WebP paths, no-clobber
   behavior, and machine-readable metadata; this oracle confirmed the persisted
   digests were unchanged across scaffold and import.
2. **Nominal prompt geometry is trusted instead of decoded bytes.** The second
   real generated file was requested outside Lineage, decoded as `1254x1254`,
   and rejected against the frozen `1024x1536` contract.
3. **A failed import leaves orphaned graph or job state.** CLI, graph, and direct
   database inspection all showed zero partial assets, edges, outputs, or output
   specs after the mismatch.

The successful flow also remained visible and inspectable through both CLI and
canvas receipts. This satisfies T010 without expanding Lineage into provider
execution, video, transforms, safe-zone validation, publishing, or scheduling.
