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

## Moving stable forward

Installing a newer stable package does not silently retarget an existing
production profile. Stop its managed service, install the new stable package,
run the confirmed stable-only profile upgrade, repeat the complete identity
gate, and then start it again:

```bash
make stop-prod LINEAGE_PROD_PROFILE=team-production
make upgrade-prod LINEAGE_PROD_PROFILE=team-production
make start-prod-bg LINEAGE_PROD_PROFILE=team-production
make status-prod LINEAGE_PROD_PROFILE=team-production
```

`profile upgrade-runtime` accepts no caller-supplied fingerprint, version,
receipt, or code root; the verified executing stable package is the sole target
authority. Preview and development have no equivalent command.
