---
name: lineage-package-operator
description: Operate stable, preview, or checkout-dev Lineage safely from Codex. Use for installing a Lineage channel, selecting or diagnosing a named profile, starting or checking a managed service, reading lineage state, or performing claim-scoped mutations without crossing code, database, or service identities.
---

# Operate Lineage

Treat code channel, named profile, database identity, and service identity as one
contract. Never infer them from a window title, PID, port, PATH, or old command.

## Choose one channel

- Stable daily use: `lineage-stable` from the isolated npm `latest` runtime.
- Preview candidate: `lineage-preview` from the isolated npm `next` runtime.
- Development: `npm run lineage:dev --` from the intended checkout/worktree.

Do not globally install `latest` and `next` into one prefix. Do not use `npx`, a
PATH-resolved `lineage-dev`, or checkout code for production operations.

Fresh-profile bootstrap exception: when the intended named profile does not
exist yet, run runtime doctor first, run the atomic `profile init --profile
<profile> --confirm-write --json`, and then immediately run runtime doctor,
profile doctor, and `db info --profile <profile> --json`. Do not run another
operational command or write until that post-init gate passes.

## Prove identity before work

Set the intended profile selector, then run the matching launcher:

```bash
lineage-stable runtime doctor --json
lineage-stable profile doctor --profile "$LINEAGE_PROD_PROFILE" --json
lineage-stable db info --profile "$LINEAGE_PROD_PROFILE" --json
```

Require all three results to agree on verified code origin/fingerprint, channel,
profile ID/environment/fingerprint, database path/identity, and service origin.
Stop on any failed doctor, unbound profile, wrong database, or unexpected code
root. Legacy-unbound access is diagnostic/read-only and never authorizes writes.
In offline `db info`, require `process.role` to be `command` and expect no
`service` object; that PID is only the one-shot CLI. A live managed status must
instead match its profile-scoped receipt to `/api/runtime`, where
`process.role` is `service` and `service.mode` is `managed`. Never treat either
field alone as health proof.

For preview, substitute `lineage-preview` and `$LINEAGE_PREVIEW_PROFILE`. For
dev, substitute `npm run lineage:dev --` and `$LINEAGE_DEV_PROFILE`.

## Repin intentional checkout changes

A normal checkout edit changes the verified dev fingerprint. Stop the managed
dev service before repinning; an active service owns the profile writer lease
and must make repin fail. From the exact intended checkout, run:

```bash
npm run lineage:dev -- profile repin-runtime \
  --profile "$LINEAGE_DEV_PROFILE" \
  --checkout-root "$PWD" \
  --confirm-write \
  --json
```

Or use `make repin-dev LINEAGE_DEV_PROFILE="$LINEAGE_DEV_PROFILE"`, which runs
runtime doctor, the confirmed repin, profile doctor, and profile-selected
database info in order. Repin is only for an owner-only development manifest
already marked `dev`/`checkout` and a verified checkout whose canonical root
matches `--checkout-root`. It changes only `expected_runtime`; never use or
adapt it for stable, preview, package code, a wrong checkout root, or a running
service. Stop on any refusal instead of editing the manifest by hand.

## Upgrade a stopped stable production profile

Stable package installation does not implicitly change an existing production
profile's runtime pin. Keep stop, upgrade/gate, and restart explicit:

```bash
make stop-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make upgrade-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make start-prod-bg LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make status-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
```

`make upgrade-prod` installs npm `latest`, runs
`lineage-stable runtime doctor --json`, confirms
`lineage-stable profile upgrade-runtime --profile "$LINEAGE_PROD_PROFILE" --confirm-write --json`,
then repeats runtime doctor, profile doctor, and `db info --profile`. It does
not stop or restart the service.

The executing verified stable package is the only target authority. Never pass
or invent a fingerprint, version, receipt, or code root. An active service,
preview/dev/unverified code, a downgrade, a same-version identity anomaly, or
an unhealthy profile must fail closed. After the gate, start with the matching
stable packaged service manager and require healthy managed status.

## Start and inspect services

From a checkout, use the profile-scoped managed targets:

```bash
make start-prod-bg LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make status-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make logs-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
make stop-prod LINEAGE_PROD_PROFILE="$LINEAGE_PROD_PROFILE"
```

Use the equivalent preview/dev target and variable for those channels. Managed
start opens a browser only after exact runtime readiness. Treat nonzero status
as unsafe even if a PID, tmux session, launchd registration, or port exists.
Stable and preview Make targets must resolve `lineage-stable-service` or
`lineage-preview-service` from the matching attested runtime. Stop if either
published channel falls back to `node scripts/managed-service.mjs`; that
checkout controller is dev-only.

Use foreground packaged start only with an explicit profile:

```bash
lineage-stable start --profile "$LINEAGE_PROD_PROFILE" --open
```

Never recreate `start-local-prod` or an unprofiled background service.

## Read and mutate through profiles

Pass `--profile` on every operational command. Examples:

```bash
lineage-stable next --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable brief --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable inspect --profile "$LINEAGE_PROD_PROFILE" --project demo-project --asset-id <asset-id> --json
lineage-stable agent claim --profile "$LINEAGE_PROD_PROFILE" --project demo-project --scope lineage_workspace --target <workspace-id> --agent-name "Codex task" --ttl 20m --json
lineage-stable agent heartbeat --profile "$LINEAGE_PROD_PROFILE" --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage-stable link-child --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --child <child-id> --summary "Cleaner type" --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage-stable output-targets list --profile "$LINEAGE_PROD_PROFILE" --media image --json
lineage-stable output-targets resolve --profile "$LINEAGE_PROD_PROFILE" --query "Instagram Feed portrait" --json
lineage-stable output-targets defaults --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --json
lineage-stable selection packet --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --schema v3 --json
lineage-stable output-targets node get --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --json
lineage-stable output-targets node set --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --destination instagram.story --confirm-write --json
lineage-stable output-targets node replace --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --expected-revision <revision> --destination instagram.feed_portrait --confirm-write --json
lineage-stable output-targets node clear --profile "$LINEAGE_PROD_PROFILE" --project demo-project --root <root-id> --node <node-id> --expected-revision <revision> --confirm-write --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create two variations" --from-lineage-selection --count 2 --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create locked variants" --from-lineage-selection --destination instagram.feed_portrait --destination instagram.story --variants-per-target 2 --json
lineage-stable generate image plan --profile "$LINEAGE_PROD_PROFILE" --project demo-project --prompt "Create persisted node variants" --from-lineage-selection --from-node-targets --expected-target-resolution-digest <selection-v3-digest> --variants-per-target 2 --json
lineage-stable generate image cancel --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --confirm-write --json
lineage-stable generate image scaffold --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --format png --confirm-write --json
lineage-stable generate image import --profile "$LINEAGE_PROD_PROFILE" --project demo-project --job-id <job-id> --manifest .asset-scratch/generation/<job-id>/generation-output-manifest.json --confirm-write --json
lineage-stable agent release --profile "$LINEAGE_PROD_PROFILE" --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

Export the returned raw token as `LINEAGE_CLAIM_TOKEN`. Heartbeat while working,
pass the token to claim-scoped writes, and release it before handoff. Use
`link-child` only for a visible child variation, and supply a one- or two-word
`--summary` describing the change from parent to child. Use `reroll mark`, `reroll
plan`, and `reroll import` for a new attempt on the same node.

For a node-target-driven generation, use this exact agent sequence:

1. Read `selection packet --schema v3` and inspect every selected asset's
   separate `current_geometry` and `next_output_targets`. The packet's
   `selected_source_resolution_digest_sha256` covers every selected source.
2. If a requested platform is ambiguous, run `output-targets resolve` and ask
   the user to choose a surface. Never choose one yourself.
3. If a node is unresolved, use `output-targets node set` only after explicit
   target intent. If an existing sticky lock conflicts with the request, stop:
   only the distinct `node replace --expected-revision` operation may change it,
   and only after explicit user approval. Never mutate canvas defaults.
4. Persist `generate image plan --from-node-targets
   --expected-target-resolution-digest <packet-digest>` before invoking any
   provider. Variation count is job-time intent.
5. Run `generate image scaffold --job-id <job-id> [--format
   png|jpeg|webp] --confirm-write --profile <profile> --project <project>
   --json`.
6. Read each returned output index, absolute path, width, height, target group,
   variant, and digest. The scaffold creates only
   `.asset-scratch/generation/<job-id>/generation-output-manifest.json`; require
   every reported image destination to remain absent.
7. Invoke image generation outside Lineage for each slot at exactly its stored
   width and height. Do not infer a surface, substitute provider-native
   geometry, resize, or crop.
8. Copy each generated file to its returned absolute path only after
   `test ! -e "$OUTPUT_ABSOLUTE_PATH"`. Stop on any collision.
9. Edit only each empty `edge_summary` to a distinct one- or two-word
   description. Scaffolding already changed only `file_path`; do not change
   parent, group, variant, output specification, or digest.
10. Import the job-scoped manifest with the unchanged `generate image import
   --confirm-write` command, then inspect the imported job and actual decoded
   dimensions.

Scaffolding is provider-neutral, deterministic, atomic, scratch-confined, and
no-clobber. It does not create placeholder images. It refuses legacy/unlocked,
re-roll, imported, unsafe-ID, unsupported-format, missing-spec, escaping,
existing, and partial-collision cases. Do not combine manifest input with
legacy `--files` or `--parent-files`. Discover output targets instead of memorizing
platform sizes. A platform-only resolution is a clarification request, never
permission to choose a surface. One-source target flags may use
`--destination`, `--custom-dimensions`, `--separate-destination`, and
`--variants-per-target`; multiple selected sources require `--target-map`.
Target-aware plans reject legacy count flags. `output-targets defaults` is
read-only: agents and CLI workflows must never mutate canvas defaults. Node
settings contain geometry and provenance only; counts remain job-time intent.
Cancel an abandoned planned job explicitly and never generate after cancellation.

Persistent writes require the profile writer lease and any operation-specific
`--confirm-write`. Never replace `--profile` with a direct `--db` write.

## Create non-production test data

Never copy a live SQLite file directly. Define a new preview/development target
profile, pin it to the verified target code, and use:

```bash
lineage-preview profile clone --source-db /path/to/source.sqlite --target-profile "$LINEAGE_PREVIEW_PROFILE" --confirm-write --json
```

Clone must target a nonexistent non-production database and produce a new
profile identity and receipt. Bind a legacy database in place only as an
intentional migration with `profile bind --profile <profile> --confirm-write`.

When that legacy database references media in a checkout, keep the database and
source checkout read-only and stage only its referenced files into the target
profile's nonexistent asset root:

```bash
lineage-stable profile clone-assets --source-asset-root /path/to/legacy/checkout --target-profile "$LINEAGE_PROD_PROFILE" --confirm-write --json
```

Require a no-clobber receipt, matching file hashes, owner-only permissions, and
an explicitly reviewed missing-reference count before binding or service
cutover. Never copy the whole checkout scratch tree or reuse it as production's
asset root.

## Handoff proof

Before claiming completion, rerun runtime doctor, profile doctor, database info,
and managed status when a service is involved. Report the exact channel,
profile, code fingerprint, database path/fingerprint, and any nonzero check.
