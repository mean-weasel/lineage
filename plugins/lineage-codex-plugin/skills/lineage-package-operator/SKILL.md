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
lineage-stable agent release --profile "$LINEAGE_PROD_PROFILE" --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

Export the returned raw token as `LINEAGE_CLAIM_TOKEN`. Heartbeat while working,
pass the token to claim-scoped writes, and release it before handoff. Use
`link-child` only for a visible child variation, and supply a one- or two-word
`--summary` describing the change from parent to child. Use `reroll mark`, `reroll
plan`, and `reroll import` for a new attempt on the same node.

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
