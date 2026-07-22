# Lineage Plugin Installer

npm-powered installer that installs the Codex Lineage plugin matching a
resolved `@mean-weasel/lineage` version and activates it through Codex's
supported marketplace commands.

The installer verifies the plugin manifest before writing anything:

- plugin `version` equals the resolved Lineage package version
- plugin `lineage.package` equals `@mean-weasel/lineage`
- plugin `lineage.version` equals the resolved Lineage package version
- optional artifact checksums match before install

## Publishing

The package is published manually from GitHub Actions with npm provenance.
Publish a new package version with:

```bash
gh workflow run lineage-plugin-installer-publish.yml \
  --repo mean-weasel/lineage \
  -f tag=next \
  -f dry_run=true
```

Move an existing published version between npm dist-tags with:

```bash
gh workflow run lineage-plugin-installer-promote.yml \
  --repo mean-weasel/lineage \
  -f tag=latest \
  -f dry_run=true
```

The publish workflow defaults to dry-run mode. A real publish requires:

- the repository `NPM_TOKEN` secret for token-backed publishing with provenance
- the `.github/workflows/lineage-plugin-installer-publish.yml` workflow

The promote workflow also defaults to dry-run mode. A real promotion uses the
same `NPM_TOKEN` secret, verifies the requested version is already published,
and refuses to move `latest` unless npm's `next` tag already points at that
version. Omit `version` to promote the installer version from
`packages/lineage-plugin-installer/package.json`.

## Install Modes

Show the installed installer package version:

```bash
lineage-plugin-installer --version
```

Show complete non-mutating help, or verify an activated installation in one
explicit Codex home:

```bash
lineage-plugin-installer --help
lineage-plugin-installer doctor --channel latest --codex-home /tmp/lineage-codex-home --json
```

Local plugin directory, useful while developing the plugin. This dry-run plans
registration in the selected temporary Codex home without mutating it. Set
`LINEAGE_VERSION` to the exact root Lineage/plugin version first:

```bash
lineage-plugin-installer install --version "$LINEAGE_VERSION" --plugin ../../plugins/lineage-codex-plugin \
  --codex-home /tmp/lineage-codex-home --dry-run --json
```

Local release-style artifact, useful for testing a GitHub release asset before
uploading it:

```bash
lineage-plugin-installer install --version "$LINEAGE_VERSION" \
  --artifact-file "./dist/lineage-codex-plugin-${LINEAGE_VERSION}.tgz" \
  --checksum-file "./dist/lineage-codex-plugin-${LINEAGE_VERSION}.tgz.sha256" \
  --dry-run --json
```

Future GitHub release download, once release artifacts exist:

```bash
lineage-plugin-installer install --channel latest --github-repo mean-weasel/lineage --dry-run --json
```

By default, `latest` resolves with:

```bash
npm view @mean-weasel/lineage@latest version --json
```

Then the installer derives:

```text
https://github.com/mean-weasel/lineage/releases/download/v<VERSION>/lineage-codex-plugin-<VERSION>.tgz
https://github.com/mean-weasel/lineage/releases/download/v<VERSION>/lineage-codex-plugin-<VERSION>.tgz.sha256
```

The installer downloads both files, verifies the checksum, extracts the artifact
to a temporary directory, validates `.codex-plugin/plugin.json`, and only then
replaces its dedicated marketplace tree. It registers the marketplace with
`codex plugin marketplace add`, installs with `codex plugin add`, and verifies
the exact plugin is installed and enabled. A failure restores the prior tree and
Codex registration state. An explicit `--target-dir` keeps the earlier files-only
mode for packaging checks and cannot be combined with `--codex-home`;
`--no-activate` also suppresses registration.

Before changing a real Codex profile, run the isolated activation oracle:

```bash
npm run plugin:codex-smoke
```
