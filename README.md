# Lineage

Lineage is a local-first workspace for reviewing creative assets, branching variations, choosing next bases, and handing a clear work packet to humans or agents.

## Package Channels

Lineage is packaged as `@mean-weasel/lineage`, but stable and preview must not
be installed into the same global npm prefix. A global `npm install -g ...@next`
would replace the files and bins used by `latest`.

Use the stable package only as a bootstrap for the channel installer, then
resolve `latest` and `next` into separate content-addressed roots:

```bash
npm install -g @mean-weasel/lineage@latest
lineage-channel install stable
lineage-channel install preview
```

By default the installer writes immutable version/integrity roots beneath
`~/Library/Application Support/Lineage/runtimes`, plus channel-qualified
launchers under `~/.local/bin`. Every launcher is pinned to an absolute
package root and install receipt; it does not select code from `PATH` at runtime.

The three exact channel meanings are:

- `stable` is npm `latest`, launched as `lineage-stable` from its receipt-bound root.
- `preview` is npm `next`, launched as `lineage-preview` from a different root.
- `dev` is the current Git checkout/worktree, launched from source with
  `npm run lineage:dev -- <command>`.

Verify code identity before inspecting data or starting a service:

```bash
lineage-stable runtime doctor --json
lineage-preview runtime doctor --json
npm run lineage:dev -- runtime doctor --json
```

`runtime doctor` fails unless channel, canonical package/checkout root, exact
version, embedded Git/build fingerprint, install receipt, and installed package
tree agree. `runtime info` prints the same identity without requiring it to pass
and is intended for repair diagnostics.

A published package still carries a `lineage-dev` migration stub so old global
links fail with checkout guidance. It never runs package code as dev.

Start each foreground runtime explicitly:

```bash
lineage-stable start --profile team-production
lineage-preview start --profile team-preview
npm run lineage:dev -- start --profile team-development
```

Stable defaults to `lineage.localhost:5197`, dev to
`lineage-dev.localhost:5198`, and preview to
`lineage-preview.localhost:5199`. Override those defaults with `--port`,
`--host`, `--db`, or `LINEAGE_HOME`:

```bash
lineage-stable start --profile team-production --port 6123
```

`--db` selects the SQLite state file. `--asset-root` (or
`LINEAGE_ASSET_ROOT`) independently selects the external repository root that
contains `<project>/assets/catalog.json` and `.asset-scratch` media. Keep these
arguments explicit when Lineage is installed as a dependency of another repo;
the installed package directory remains responsible only for bundled code,
web assets, and public demo fixtures.

## Runtime Channels and SQLite

Lineage treats attested code identity and local SQLite data identity as separate,
simultaneously required concerns:

- `stable` is the isolated npm `latest` install and daily-use channel.
- `preview` is the isolated npm `next` candidate.
- `dev` is the current Git checkout/worktree and may be dirty.

Each channel must use its own code root, runtime directory, and SQLite database.
Do not point preview or dev code at the stable database. Use the profile clone
command when a realistic preview/dev dataset is needed; it reads the source
through SQLite's online backup API and gives the target a fresh non-production
identity. Direct `--db` and `LINEAGE_DB` selection is diagnostic/read-only
unless a matching named profile has been selected and its writer lease is held.

For repeatable or multi-session work, prefer a named profile over those legacy
path defaults. A profile is an immutable identity contract for one Lineage
service and its data:

```json
{
  "schema_version": "lineage.profile.v1",
  "profile_id": "team-production",
  "environment": "production",
  "expected_runtime": {
    "channel": "stable",
    "code_origin": "package",
    "code_fingerprint": "<64-character fingerprint from runtime doctor>"
  },
  "database_path": "./lineage.sqlite",
  "asset_root": "./media",
  "service_origin": "http://lineage.localhost:5197"
}
```

Named profiles live at `$LINEAGE_PROFILE_ROOT/<profile-id>/profile.json` by
default, or can be selected with an explicit manifest path. Relative database
and asset paths resolve from the manifest directory. Inspect a profile without
creating or migrating anything:

```bash
lineage-stable profile doctor --profile team-production --json
lineage-stable start --profile team-production
```

`LINEAGE_PROFILE` is equivalent to `--profile`. Profile commands reject direct
`--db` and `--asset-root` overrides, and a dev or preview runtime refuses to
open a production profile. Doctor also requires the existing SQLite database
to have one matching `lineage_profile_identity` binding, including the profile
manifest fingerprint. Binding is an explicit migration operation:

```bash
lineage-stable profile bind --profile team-production --confirm-write --json
```

The profile must pin the exact verified code origin and fingerprint before it
can be bound or used for writes. `profile bind` may add a fingerprint to a
matching legacy identity, but refuses a conflicting identity. An unprofiled
CLI or service is `legacy-unbound` and read-only; mutating CLI commands and HTTP
methods fail with a profile-required error instead of creating a database.

Checkout fingerprints intentionally change as tracked or untracked source
changes. To repin an existing development profile, first stop its managed
service, then run the guarded checkout-only workflow:

```bash
make repin-dev LINEAGE_DEV_PROFILE=team-development
```

The underlying explicit command is:

```bash
npm run lineage:dev -- profile repin-runtime \
  --profile team-development --checkout-root "$PWD" --confirm-write --json
```

Repin accepts only a verified dev checkout whose canonical root equals
`--checkout-root`, an owner-only development manifest already pinned to
dev/checkout, and an available profile writer lease. It atomically replaces
only `expected_runtime`; profile/database identity, paths, environment,
service origin, and migrations stay unchanged. Production, preview, package,
wrong-root, unsafe-manifest, unconfirmed, and active-service cases fail closed.
The command may prepare a new structurally valid development manifest before
its database and asset root are cloned.

To create a realistic preview or development database without copying a live
SQLite file directly, define a new non-production target profile whose database
does not exist, then run:

```bash
lineage-preview profile clone --source-db /path/to/source.sqlite \
  --target-profile team-preview --confirm-write --json
npm run lineage:dev -- profile clone --source-db /path/to/source.sqlite \
  --target-profile team-development --confirm-write --json
```

Clone refuses production targets, existing target files, source/target path
reuse, unverified code, and missing confirmation. It writes a local receipt
under the target profile directory after SQLite integrity and identity checks.

When migrating a legacy installation whose production media still lives under
a development checkout, stage only database-referenced local files into the
new profile's nonexistent, dedicated asset root before binding or starting it:

```bash
lineage-stable profile clone-assets --source-asset-root /path/to/legacy/checkout \
  --target-profile team-production --confirm-write --json
```

Asset clone holds the target profile's writer lease, refuses reused or nested
roots and escaping references, reserves the target without clobbering, verifies
every copied file by SHA-256, uses owner-only permissions, and writes a compact
receipt. Missing legacy references are counted rather than silently replaced;
unreferenced checkout scratch files are not copied. Inspect that count before
binding the database. The source database and asset tree remain read-only.

A named profile has one cross-process writer lease at
`<profile-directory>/writer.lock`. The managed service holds that lease for its
lifetime, so a second service or one-shot CLI writer is refused while it is
running. A CLI data command may hold the same lease only while the service is
offline. Lineage verifies lease ownership before opening a named-profile
database for writes and configures SQLite with WAL journaling and a five-second
busy timeout. If an owner was killed, the next writer may reclaim the lock only
after the recorded PID is no longer alive; malformed or mismatched lock metadata
is left in place for manual inspection. `profile doctor` never acquires or
modifies the lease. The lease records both the immutable profile ID and manifest
fingerprint; legacy-unbound access never acquires a writer lease.

Check the active runtime before making changes:

```bash
lineage-stable db info --profile team-production --json
lineage-preview db info --profile team-preview --json
npm run lineage:dev -- db info --profile team-development --json
```

Managed services are profile-scoped. Their receipts record the launcher PID
and start token, unique service instance, code root/fingerprint, profile and
database fingerprints, origin, and log path. Start waits for `/api/runtime` to
match every field before reporting success or opening a browser. Status exits
nonzero for a stale PID, unreachable service, current-code drift, wrong port,
or any code/profile/database/instance mismatch:

```bash
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
make start-preview-bg LINEAGE_PREVIEW_PROFILE=team-preview
make start-dev-bg LINEAGE_DEV_PROFILE=team-development
```

Use the matching `status-*`, `logs-*`, and `stop-*` target with the same profile
variable. Stable and preview targets execute the service controller from that
channel's attested, content-addressed package root; only dev executes the
checkout controller. Stop signals only the process identity recorded for that profile.
Checkout-backed `start-local-prod` and registration-only launchd/tmux status
paths are intentionally not supported.

The app shows a persistent environment/profile badge, and Settings includes the
profile binding, code origin/root/fingerprint, channel, version, embedded Git
revision, schema markers, and SQLite path.

## Agent Claims

Mutating agent writes use target-scoped claim tokens. Read-only inspection stays
available without a claim, but confirmed writes such as lineage `link-child` and
claimed content post attach/phase actions require a matching token when a target
is already claimed.

Create a claim and copy the raw token at creation time:

```bash
lineage agent claim --project demo-project --scope lineage_workspace --target demo-project:lineage-workspace:<root-asset-id> --target-title "TikTok hook lineage" --agent-name "Codex thread 123" --ttl 20m --json
export LINEAGE_CLAIM_TOKEN='claim_abc.secret_xyz'
```

Agents can inspect the current lineage graph without a claim:

```bash
lineage agent graph --project demo-project --root <root-asset-id> --json
```

Agents can also export the current active workspace selection as a durable JSON
packet for downstream tools such as GrowthOps:

```bash
lineage selection packet --project demo-project --channel linkedin --campaign 2026-07-launch \
  --db /absolute/path/to/lineage.sqlite --asset-root /absolute/path/to/asset-repo \
  --out ./lineage-selection-packet.json --json
```

The packet is schema-versioned as `lineage.selection_packet.v1` and includes the
workspace/root binding, selected asset IDs, local media paths when known, S3 key
metadata when known, context labels/notes, warnings, and a stable `packet_id`.
Lineage only exports the packet. GrowthOps or another downstream tool remains
responsible for importing it, creating posts, checking media readiness, preparing
public URLs, scheduling, and recording placement receipts.

Version 1 remains the default for compatibility. Opt in to the current-attempt-
bound contract with `--schema v2`:

```bash
lineage selection packet --project demo-project --schema v2 \
  --out ./lineage-selection-packet-v2.json --json
```

The `lineage.selection_packet.v2` packet requires a verifiable current attempt
and lowercase SHA-256 checksum for every selected asset. Its full
`identity_sha256` and derived `packet_id` bind only the canonical semantic
selection: project/product, workspace/root, context, ordered selected assets and
their current attempts, and stable diagnostics. Timestamps, local paths, storage
details, source metadata, generation job IDs, and human-readable warning/error
text stay in the envelope but do not change v2 identity.

Keep the claim fresh and pass it to mutating commands:

```bash
lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --summary "Cleaner type" --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage agent release --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

`lineage link-child` creates a new visible descendant in the lineage graph. Do
not use it for re-rolls. The coordinating agent must supply `--summary` with a
one- or two-word description of the change from parent to child.

For re-roll work, mark the target, have the agent plan/import one replacement
attempt, and cancel only when the request should be abandoned:

```bash
lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --confirm-write --json
lineage reroll list --project demo-project --root <root-asset-id> --json
lineage reroll plan --project demo-project --root <root-asset-id> --target <target-asset-id> --prompt "Regenerate with clean readable text" --json
lineage reroll import --project demo-project --job-id <job-id> --file <.asset-scratch-file> --confirm-write --json
lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --confirm-write --json
```

`lineage reroll import` updates the target node's current attempt and should
not add a visible child edge.

Lineage task queue commands expose the same work as explicit tasks that agents
can inspect, claim, start, comment on, and cancel:

```bash
lineage tasks list --project demo-project --root <root-asset-id> --json
lineage tasks inspect --project demo-project --task <task-id> --json
lineage tasks claim --project demo-project --task <task-id> --agent-name "Task worker" --json
lineage tasks start --project demo-project --task <task-id> --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage tasks comment --project demo-project --task <task-id> --message "Blocked on source art review." --json
lineage tasks cancel --project demo-project --task <task-id> --confirm-write --override --json
lineage tasks instructions --project demo-project --task <task-id> --instructions "Preserve palette; replace unreadable text." --json
lineage tasks override --project demo-project --task <task-id> --reason "Human is reassigning the work." --instructions "Use the updated brief." --json
```

The app-created claim-aware handoff packet includes the same token export,
heartbeat, inspect, and write commands. Raw claim tokens are not shown in the
read-only Agents view.

Use `project_channel` only for rare work that intentionally owns an entire
project/channel lane. Prefer `lineage_workspace` or `content_post` claims for
normal target-scoped agent work:

```bash
lineage agent claim --project demo-project --scope project_channel --target demo-project:channel:tiktok --channel tiktok --agent-name "Channel owner" --ttl 20m --json
```

## Codex Plugin

The versioned Codex plugin lives in `plugins/lineage-codex-plugin`. Install the
plugin that matches the resolved `@mean-weasel/lineage` package version with:

```bash
npx @mean-weasel/lineage-plugin-installer install --channel latest
```

The installer verifies the plugin artifact checksum and rejects plugin manifests
whose version or `lineage.version` does not exactly match the resolved Lineage
package version. It then creates a dedicated marketplace under the active
`CODEX_HOME`, registers that marketplace with supported `codex plugin`
commands, installs the plugin, and verifies that Codex reports the exact version
as installed and enabled. Use `--target-dir <path>` for a files-only install or
`--dry-run` for a non-mutating activation plan. The plugin artifact and installer
package are released from this public repository.

Every Lineage release preflights the current operator skill, packs and checksums
the exact matching plugin, installs that artifact into a temporary Codex plugin
root, and attaches both files to the versioned GitHub release before npm publish
or dist-tag mutation is allowed. Release status reports the local version lock
and GitHub assets. The installed skill requires isolated channel launchers,
named profiles, managed service identity status, and profile-only writes.

The checkout also exposes `.agents/plugins/marketplace.json`, which points only
at the checkout plugin and marks it installed by default for new development
tasks. That repo marketplace is separate from the installer-managed marketplace
under `CODEX_HOME`; restart Codex and use a brand-new task when validating either
activation path.

## Local Development

```bash
npm ci
npm run dev
npm run ci
npm run runtime:oracle
```

`npm run dev` starts the local development server from source. `npm run ci` runs the full local verification gate.
`npm run runtime:oracle` creates three temporary code roots, profiles,
databases, ports, and managed services, proves their identities are distinct
while all are live, attacks every cross-channel and stale-identity boundary,
and then cleans up.

## Command Shortcuts

The root `Makefile` provides memorable wrappers for common setup, startup, and
verification commands. Run `make` or `make help` to list the available targets.

```bash
make install-prod
make install-plugin-prod
make start-prod LINEAGE_PROD_PROFILE=team-production
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
make check
make smoke
```

The Makefile is only a convenience layer. npm scripts, the packaged CLIs, and
GitHub release workflows remain the source of truth for build, test, and release
behavior.

## Release Checks

Use `next` for candidate builds and `latest` for the stable public channel. Check the current local, npm, and workflow state with:

```bash
npm run release:status
```

For local release validation:

```bash
npm run release:dry-run -- --tag next
npm run release:claim-smoke -- --package @mean-weasel/lineage@next
npm run release:next
npm run release:dry-run -- --tag latest
npm run release:latest
```

The release script verifies package metadata, changelog version coverage, public-readiness scans, install smoke, browser smoke, audit, package contents, and the version-locked Codex plugin before publishing. The GitHub plugin artifact and checksum must exist before npm publish or dist-tag mutation. Promotion also installs the candidate package and runs a claim lifecycle smoke that creates a target claim, proves missing-token writes fail, proves matching-token writes succeed, verifies read surfaces do not expose the raw token, and proves release invalidates the token. GitHub Actions runs CI on pull requests and `main`; publishing is manual through the Release workflow.

Use the Release workflow operations this way:

- `publish-next`: publish the current package version to npm with the `next` dist-tag using trusted publishing and provenance.
- `promote-latest`: move the already-published `next` version to `latest` after dogfooding. This uses the repository `NPM_TOKEN` secret and refuses to promote unless npm's `next` tag points at the local package version.
- `publish-latest`: publish the current package version directly to `latest` using trusted publishing and provenance, reserved for cases where the version should skip the `next` channel.

The normal cadence is: bump version and changelog, merge to `main`, run `publish-next`, install or run `@mean-weasel/lineage@next`, dogfood it, then run `promote-latest`. After promotion, both npm tags point to the same version until the next development version is published to `next`.

## Demo Fixture

Source checkouts and installed packages include a synthetic public demo catalog at `fixtures/demo-project/assets/catalog.json`. When `demo-project/assets/catalog.json` does not exist in the repo root, Lineage uses that fixture so the demo project can load without private storage or customer data.

If you create a real `demo-project/assets/catalog.json`, that root project catalog overrides the packaged fixture. The fixture keeps S3-shaped metadata for realistic catalog structure, but default previews are generated local SVG data URLs and do not call storage.

Lineage also includes a lightweight Swissifier rich-demo manifest at `fixtures/demo-project/lineage/swissifier-rich-demo.json`. The manifest stores only synthetic metadata, checksums, graph edges, layout positions, and selected next-variation bases. It does not include local SQLite state.

The package intentionally includes three public-safe synthetic Swissifier re-roll PNG fixtures in `fixtures/demo-project/lineage/swissifier-rerolls/`. They are the only generated PNG media committed with the rich demo, and each file is pinned in the manifest by filename, SHA-256, size, content type, prompt, and demo generation job id so public-readiness and package-smoke checks can prove the fixture is hermetic.

To hydrate the Swissifier demo with real images, use the Demo seed menu's Swissifier `Download media` control. Lineage downloads `swissifier-rich-demo-v1.tar.gz` from the [v0.1.2 GitHub release](https://github.com/mean-weasel/lineage/releases/tag/v0.1.2), verifies the archive checksum, safely unpacks the PNGs into local scratch storage, and then verifies each PNG checksum before loading the rich demo.

Future rich-demo media packs should follow the same split unless a small synthetic media exception is explicitly documented and manifest-pinned like the packaged re-roll PNGs: commit lightweight manifest changes, attach generated media archives to the GitHub release for the app version that first references them, then pin the public release URL, archive size, and SHA-256 in the manifest. If a later app release reuses an unchanged media pack, keep the manifest pointed at the original release asset instead of duplicating the archive.

For manual verification or offline restore, the expected archive checksum is:

```sh
shasum -a 256 swissifier-rich-demo-v1.tar.gz
```

`24edc5307d0932ddc8a151c6a8c1001a08c45075e3ae198082038c44519be0de`

The previous manual path remains available: unpack the media pack yourself, set `LINEAGE_SWISSIFIER_MEDIA_DIR` to that folder, then use the Demo seed menu to restore media and load Swissifier.

## Data And Privacy

Lineage stores local workspace state in a SQLite database on your machine. Public fixtures are synthetic and must not contain private names, credentials, presigned URLs, real customer content, private campaign data, or real media. Keep private catalogs and media outside public package fixtures.
