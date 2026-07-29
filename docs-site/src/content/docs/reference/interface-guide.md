---
title: Interface guide
description: Find the main Lineage views without treating application tabs as the documentation structure.
---

## Main views

- **Canvas** displays the visual lineage graph, current attempts, and workspaces.
- **Review** presents assets that need human judgment.
- **Assets** supports catalog-level inspection.
- **Agents** shows open, released, stale, and revoked claims.
- **Settings** exposes safe provider configuration and runtime information.
- **Ledger** records durable decisions and operations.
- **Content Batches** groups posts, targets, media, and handoffs.
- **Backup Queue** prepares approved assets for external storage.

Use the destination rail on the left to move between these views. The adjacent
contextual panel holds project selection and tools for the current view; collapse
it when you want the Canvas to use the full window. On mobile, the menu button
opens the same destinations and contextual tools as a drawer.

## Lineage canvas appearance

Select the gear in the upper-right corner of the Canvas to open **Canvas
settings**. The settings appear as a right-side panel on desktop and a bottom
sheet on mobile:

- **Cards** switches between compact nodes and portrait cards. Portrait cards
  show the complete image inside a consistent social-friendly frame.
- **Direction** lays out the graph left to right, top to bottom, right to left,
  or bottom to top.
- **Edges** selects fine, standard, or bold lineage connections.
- **Edge labels** shows or hides the one- or two-word variation summaries.
- **Minimap** shows or hides the overview used to navigate larger trees.
- **Hover previews** enables or disables the full-image node preview without
  disabling the node's detail view.

Canvas appearance choices are remembered in the current browser. Use **Fit
graph** to frame the current tree, **Tidy tree** to restore automatic spacing,
or **Reset appearance** to return all Canvas settings to their defaults.

## About Lineage

Select the **L** brand mark in the destination rail, or the Lineage name in the
mobile drawer, to open **About Lineage**. The dialog shows the app version,
release and runtime channels, environment, profile, and revision when verified.
It also links to the repository and documentation.

**Copy diagnostics** copies only this limited identity summary. It does not
include local filesystem paths, the SQLite database path, the asset root, or
the service URL.

Use workflow documentation to decide what to do; use this guide only to locate
the relevant surface.
