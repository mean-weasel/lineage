# Lineage

Lineage is a local-first workspace for reviewing creative assets, branching variations, choosing next bases, and handing a clear work packet to humans or agents.

## Package Channels

Lineage is packaged as `@mean-weasel/lineage`. Use the stable npm tag when you want the current public package, and use the `next` tag when you intentionally want a development channel build:

```bash
npm install -g @mean-weasel/lineage
npm install -g @mean-weasel/lineage@next
```

The stable and development channels are intended to coexist conceptually, with `lineage` for stable installs and `lineage-dev` for development installs. The current public package includes the CLI bridge bins for help and version checks:

```bash
lineage --help
lineage --version
lineage-dev --help
lineage-dev --version
```

Full `lineage start` and `lineage-dev start` command implementations are still pending a CLI task. Until those commands are implemented, run Lineage from a source checkout for local development.

## Local Development

```bash
npm ci
npm run dev
npm run ci
```

`npm run dev` starts the local development server from source. `npm run ci` runs the full local verification gate.

## Demo Fixture

Source checkouts and installed packages include a synthetic public demo catalog at `fixtures/demo-project/assets/catalog.json`. When `demo-project/assets/catalog.json` does not exist in the repo root, Lineage uses that fixture so the demo project can load without private storage or customer data.

If you create a real `demo-project/assets/catalog.json`, that root project catalog overrides the packaged fixture. The fixture keeps S3-shaped metadata for realistic catalog structure, but default previews are generated local SVG data URLs and do not call storage.

## Data And Privacy

Lineage stores local workspace state in a SQLite database on your machine. Public fixtures are synthetic and must not contain private names, credentials, presigned URLs, real customer content, private campaign data, or real media. Keep private catalogs and media outside public package fixtures.
