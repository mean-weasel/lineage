---
title: Troubleshooting
description: Diagnose runtime identity, missing claims, provider limits, and public-site build failures.
---

## Agents appears empty

Open claims show only bounded active mutations. Switch to **Closed** or **All**
to see released claim history. Read-only agent inspection may never create a
claim.

## The service will not open

Run runtime doctor, profile doctor, and database info with the same launcher and
profile. A PID or open port is not proof of Lineage identity.

## Buffer will not post live

This is expected. Buffer support is preview and dry-run only.

## Documentation fails to deploy

Run `npm run docs:check`, `npm run build:web`, and
`npm run pages:prepare`. The assembler fails when landing or documentation
output is missing or when an existing web `docs` directory would collide.

## A provider page fails validation

Compare its capability, provider ID, maturity, and live-behavior frontmatter
with `src/shared/adapterCatalog.ts`.
