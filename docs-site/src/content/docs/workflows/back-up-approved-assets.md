---
title: Back up approved assets
description: Queue approved assets for explicit cloud backup without hiding provider configuration or destructive operations.
---

## What this does

The backup workflow prepares reviewed assets for storage outside the local media
root. Amazon S3 is the current cloud provider.

## Step-by-step workflow

1. Approve the assets that should be retained.
2. Confirm the configured bucket, region, and named profile.
3. Inspect the backup queue and generated object keys.
4. Run a non-destructive inspection before any upload.
5. Confirm the intended write operation.
6. Verify the resulting storage metadata and local receipt.

Cloud configuration is explicit. Lineage does not treat a credential’s presence
as permission for a destructive cloud action.

See [Cloud storage](../integrations/cloud-storage).
