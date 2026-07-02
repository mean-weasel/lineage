# Lineage

Lineage is a local-first workspace for reviewing creative assets, branching variations, choosing next bases, and handing a clear work packet to humans or agents.

## Install

```bash
npm install -g @mean-weasel/lineage
lineage start
```

## Development Channel

```bash
npm install -g @mean-weasel/lineage@next
lineage-dev start
```

`lineage` and `lineage-dev` use separate runtime directories, ports, and SQLite databases so a stable install can coexist with development builds.

## Local Development

```bash
npm ci
npm run ci
```

## Data And Privacy

Lineage stores local workspace state in a SQLite database on your machine. Public fixtures are synthetic. Do not commit private media, credentials, presigned URLs, customer content, or private campaign data.
