# Lineage Codex Plugin

Codex plugin guidance for using the public `@mean-weasel/lineage` package.

This plugin is version-locked to the Lineage package version declared in
`.codex-plugin/plugin.json`. The installer must refuse to install this plugin
when the resolved `@mean-weasel/lineage` version and plugin compatibility
metadata do not match exactly.

Installers should treat the plugin artifact as Codex-specific agent tooling. The
Lineage app package owns app and CLI runtime behavior; it does not install Codex
plugins. The operator skill requires isolated channel launchers, explicit named
profiles for every operation, profile-scoped managed service status, and
SQLite-safe non-production cloning.

For checkout development, the operator skill also supplies the exact
runtime/profile/database identity gate and the confirmed dev-only
`profile repin-runtime` workflow. Repinning never authorizes stable, preview,
or package code and never changes a profile's database-routing identity.
