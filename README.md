# Lineage

Lineage is a local-first workspace for reviewing creative assets, branching variations, choosing next bases, and handing a clear work packet to humans or agents.

## Package Channels

Lineage is packaged as `@mean-weasel/lineage`. Use `latest` for the stable dogfood or production install, and use `next` when you intentionally want the development or release-candidate channel:

```bash
npm install -g @mean-weasel/lineage@latest
npm install -g @mean-weasel/lineage@next
```

The stable and development channels are intended to coexist conceptually:

- `latest` is the version you should trust for day-to-day dogfooding.
- `next` is the version to test before promotion.
- `lineage` runs with stable runtime defaults.
- `lineage-dev` runs with development runtime defaults.

The package includes both CLI bridge bins for help and version checks:

```bash
lineage --help
lineage --version
lineage-dev --help
lineage-dev --version
```

Both bins can also run the bundled production server:

```bash
lineage start
lineage-dev start
```

By default, `lineage start` listens on `lineage.localhost:5197` and stores SQLite state in a stable Lineage runtime directory. `lineage-dev start` listens on `lineage-dev.localhost:5198` and uses a separate development SQLite file. Override those defaults with `--port`, `--host`, `--db`, or `LINEAGE_HOME`:

```bash
lineage start --port 6123 --db ~/.lineage/lineage.sqlite
```

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

Keep the claim fresh and pass it to mutating commands:

```bash
lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage agent release --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

`lineage link-child` creates a new visible descendant in the lineage graph. Do
not use it for re-rolls.

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
package version. The plugin artifact and installer package are released from
this public repository.

## Local Development

```bash
npm ci
npm run dev
npm run ci
```

`npm run dev` starts the local development server from source. `npm run ci` runs the full local verification gate.

## Command Shortcuts

The root `Makefile` provides memorable wrappers for common setup, startup, and
verification commands. Run `make` or `make help` to list the available targets.

```bash
make install-prod
make install-plugin-prod
make start-prod
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

The release script verifies package metadata, changelog version coverage, public-readiness scans, install smoke, browser smoke, audit, and package contents before publishing. Promotion also installs the candidate package and runs a claim lifecycle smoke that creates a target claim, proves missing-token writes fail, proves matching-token writes succeed, verifies read surfaces do not expose the raw token, and proves release invalidates the token. GitHub Actions runs CI on pull requests and `main`; publishing is manual through the Release workflow.

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
