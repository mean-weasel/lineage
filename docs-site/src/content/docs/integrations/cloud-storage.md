---
title: Cloud storage
description: Configure the current Amazon S3 provider for explicit inspection and backup of approved assets.
capability: cloud-storage
maturity: Available
currentProviders:
  - Amazon S3
providerIds:
  - s3
liveBehavior: available
---

## What this does

Cloud storage lets Lineage inspect configured object catalogs and back up
approved assets. Amazon S3 is the current provider.

## How it works

The named project supplies a bucket and region. Credentials remain external to
Lineage’s public settings data. The Settings view exposes only safe
configuration and whether optional local credentials were detected.

## Step-by-step workflow

1. Verify the runtime and named profile.
2. Configure the intended bucket and region.
3. Enable the provider explicitly.
4. Inspect catalog state before writing.
5. Back up only reviewed assets with explicit confirmation.
6. Verify object metadata and the local receipt.

## Limitations and safety behavior

Credential detection is not authorization. Destructive cloud behavior remains
safety-gated, and Lineage never stores raw secrets in adapter settings.
