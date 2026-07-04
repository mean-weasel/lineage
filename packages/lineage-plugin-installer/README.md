# Lineage Plugin Installer

npm-powered installer that installs the Codex Lineage plugin matching a
resolved `@mean-weasel/lineage` version.

The installer verifies the plugin manifest before writing anything:

- plugin `version` equals the resolved Lineage package version
- plugin `lineage.package` equals `@mean-weasel/lineage`
- plugin `lineage.version` equals the resolved Lineage package version
- optional artifact checksums match before install

## Publishing

The package is published manually from GitHub Actions with npm provenance:

```bash
gh workflow run lineage-plugin-installer-publish.yml \
  --repo mean-weasel/lineage \
  -f tag=next \
  -f dry_run=true
```

The publish workflow defaults to dry-run mode. A real publish requires:

- npm trusted publishing for `@mean-weasel/lineage-plugin-installer` to trust
  this repository and the `.github/workflows/lineage-plugin-installer-publish.yml`
  workflow

If the package does not exist yet, npm's current trusted-publishing setup may
require an initial owner-controlled package publish before the trusted publisher
can be added.

## Install Modes

Local plugin directory, useful while developing the plugin:

```bash
lineage-plugin-installer install --version 0.1.2 --plugin ../../plugins/lineage-codex-plugin --dry-run --json
```

Local release-style artifact, useful for testing a GitHub release asset before
uploading it:

```bash
lineage-plugin-installer install --version 0.1.2 \
  --artifact-file ./dist/lineage-codex-plugin-0.1.2.tgz \
  --checksum-file ./dist/lineage-codex-plugin-0.1.2.tgz.sha256 \
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
installs or dry-runs the target plugin directory.
