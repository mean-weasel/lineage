---
title: Social scheduling
description: Prepare and validate reviewed social posts for Buffer without publishing them live.
capability: social-scheduling
maturity: Preview
currentProviders:
  - Buffer
providerIds:
  - buffer
liveBehavior: disabled
---

## What this does

Social scheduling converts a reviewed Lineage content post into a Buffer-shaped
payload and validates the dry-run command.

## Step-by-step workflow

1. Review the post text, call to action, media, and target.
2. Provide an explicit Buffer channel identifier.
3. Generate the payload under the local scratch directory.
4. Run the Buffer command with `--dry-run`.
5. Inspect the returned payload and command receipt.
6. Record external scheduling or posting state only after it happens elsewhere.

## Limitations and safety behavior

Live Buffer posting is intentionally disabled. Enabling the setting or
detecting credentials does not change that boundary. The adapter throws if a
caller attempts the live-posting path.
