# Changelog

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
