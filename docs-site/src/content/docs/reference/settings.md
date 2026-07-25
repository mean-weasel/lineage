---
title: Settings reference
description: Understand safe configuration, maturity, credentials, and status for each current integration provider.
---

## Cloud storage

Amazon S3 is **Available**. Bucket and region are safe configuration. Provider
enablement and credential detection do not bypass write confirmation.

## Social scheduling

Buffer is **Preview**. The safe default mode is dry-run. Raw tokens and
organization identifiers are never returned by the settings API.

## Image generation

Codex handoff is **Available** and enabled by default. It needs no external
secret because Lineage creates handoff and import receipts rather than calling
an embedded model service.

## Experience settings

Hover previews are stored as a browser preference. Disabling them leaves
double-click details available.
