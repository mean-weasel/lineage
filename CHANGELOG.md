# Changelog

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
