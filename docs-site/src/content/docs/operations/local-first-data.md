---
title: Local-first data and privacy
description: Understand where Lineage stores databases and media and what should never enter public source control.
---

## What this does

Lineage keeps its primary database and media roots on the operator’s machine.
Named profiles make those locations and their environment identity explicit.

## Safety behavior

Never commit:

- SQLite databases or their sidecar files;
- private project or customer media;
- campaign data;
- credentials or secret references;
- real presigned URLs; or
- provider payloads containing private content.

Public examples must be synthetic or intentionally public. Use profile-aware
clone and backup commands rather than copying a live SQLite database with
Finder, `cp`, or a raw file API.

Related: [Profiles and database identity](profiles-database-identity).
