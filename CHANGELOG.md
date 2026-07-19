# Changelog

## 0.1.15

- Add a subtle root marker that makes the starting point of each lineage tree immediately recognizable.
- Add full-asset previews on node hover and keyboard focus while preserving double-click for full details and attempt history.
- Add a browser-local setting to disable hover previews, plus refresh-state safeguards that keep dismissed previews closed during background updates.

## 0.1.14

- Fix isolated channel installs against npm clients that return registry integrity as a flat `dist.integrity` field, while rejecting missing or conflicting identity metadata.
- Run promotion claim verification through an exact receipt-bound registry install, named production profile, external asset root, and managed writer.
- Supersede the `0.1.13` candidate, whose packaged channel installer cannot bootstrap registry installs with the affected npm metadata shape.

## 0.1.13

- Isolate stable, preview, and checkout-only development code into attested channel-specific roots with runtime doctor and tamper detection.
- Require fingerprint-bound named profiles, opened-handle SQLite identity checks, one managed writer, consistent database clones, and referenced-asset-only migration receipts for persistent writes.
- Ship profile-aware managed service lifecycles, a three-runtime adversarial coexistence oracle, and an atomic version-locked Codex plugin release/install path.

## 0.1.12

- Add named runtime profiles that bind environment, SQLite, media root, service origin, and expected runtime identity without allowing silent path drift.
- Enforce a single cross-process writer lease per profile and route profile-bound mutations through the authenticated managed service while keeping inspections read-only.
- Add opt-in `lineage.selection_packet.v2` exports whose stable semantic identity binds ordered selections to their current attempts and checksums for durable GrowthOps handoff receipts.

## 0.1.11

- Add `--asset-root` / `LINEAGE_ASSET_ROOT` so installed Lineage packages can use external project catalogs and local media independently from the SQLite path.
- Show the active asset root in CLI startup, `db info`, and Settings alongside the active SQLite identity.
- Extend the packed-tarball smoke to prove an unrelated npm consumer can start Lineage and export a real external-project selection packet.

## 0.1.10

- Fix `lineage db info` so installed CLI checks use the same stable/dev runtime SQLite defaults as `lineage start`.

## 0.1.9

- Add runtime identity diagnostics in Settings so operators can see the active channel, version, Git SHA when available, SQLite path, and database counts.
- Add `lineage db info` for CLI and agent checks before touching a local Lineage database.
- Document the stable, preview, and dev channel data policy, keeping explicit database overrides available with `--db` and `LINEAGE_DB`.
- Add browser coverage to ensure Settings keeps surfacing the active runtime and SQLite identity.

## 0.1.8

- Add durable selection packet export so agents can hand selected Lineage assets to GrowthOps without scraping UI state or copying local paths.
- Add Agent OS adoption guidance for Lineage agents and operators.
- Improve popover media previews, node actions, and image expansion controls for faster asset inspection.
- Clean up the Lineage shell navigation, toolbar, and side-panel layout for a more focused workspace.

## 0.1.7

- Add a claim-aware lineage task queue for per-image iteration and re-roll work, including task instructions, comments, cancellation, and human override controls.
- Add visible agent/task state in the lineage canvas and side panel so humans can see when a task is pending, locked, or actively claimed.
- Add QA seed guardrails that distinguish basic SVG placeholder media from the Swissifier rich PNG demo seed.
- Add deterministic rich-seed verification and browser coverage to fail when QA is pointed at the wrong seed or invisible placeholder previews.

## 0.1.6

- Add per-image re-roll attempt history with stack inspection, previous-attempt selection, and promotion back to the current/top attempt.
- Add CLI and agent-facing re-roll commands for marking, listing, planning, importing, and cancelling one job per target image.
- Package public-safe Swissifier re-roll PNG fixtures and manifest metadata so the demo canvas shows multi-attempt nodes out of the box.
- Harden project switching, lineage workspace fallback, and backend attempt invariants around re-roll histories.

## 0.1.5

- Add graph orientation controls for lineage views and CLI flows, including browser coverage for orientation behavior.
- Improve agent claim visibility with workspace/content occupancy badges, claim lifecycle controls, and release claim smoke coverage.
- Harden lineage claim enforcement for explicit child workspaces and `project_channel` claims so scoped claims cannot authorize broader writes.
- Make local startup helpers durable with tmux-backed Makefile commands.

## 0.1.4

- Implement target-scoped agent claims for lineage and content-post agent writes, including claim lifecycle CLI/API commands, heartbeat/release/revoke/transfer controls, and token-redacted read APIs.
- Add claim-aware handoff packets, workspace/content occupancy badges, and a read-only Agents view so humans can see active, idle, stale, and closed claims without exposing raw tokens.
- Enforce matching claim tokens for claimed lineage/content mutations and document the `LINEAGE_CLAIM_TOKEN` operator flow, including rare `project_channel` ownership.

## 0.1.3

- Add a managed Swissifier rich-demo media download flow that verifies the release archive and restored PNG checksums before loading the demo.
- Add durable local startup helpers and default Lineage CLI hosts for `lineage.localhost` and `lineage-dev.localhost`.
- Ship the lightweight Swissifier fixture manifest while keeping generated demo media outside git and package contents.

## 0.1.2

- Fix packaged Lineage handoff commands so copied `next`, `inspect`, and `link-child` commands run through the published package.
- Add packaged CLI regression coverage for custom SQLite database handoffs.

## 0.1.1

- Fix first-run demo lineage loading and catalog-root lineage workspace creation.
- Add visible release version/channel metadata in Settings.
- Keep the New lineage modal actions reachable at default viewport heights.

## 0.1.0

- Initial public extraction of Lineage as a local-first creative lineage workspace.
