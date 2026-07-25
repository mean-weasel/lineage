---
title: Stable, preview, and development channels
description: Keep released, prerelease, and checkout code in separate verified runtime roots.
---

## Channel model

- **Stable** resolves npm `latest` into an isolated receipt-bound code root and
  runs through `lineage-stable`.
- **Preview** resolves npm `next` into a different receipt-bound code root and
  runs through `lineage-preview`.
- **Development** runs only from a Git checkout or worktree through
  `npm run lineage:dev --`.

## Safety behavior

Do not install stable and preview into the same npm prefix. Do not use
PATH-resolved `lineage-dev` as proof that checkout code is running. Every
operational command should begin with runtime doctor and use a profile whose
expected runtime matches that channel.

Preview and development code must not write to the stable database.
