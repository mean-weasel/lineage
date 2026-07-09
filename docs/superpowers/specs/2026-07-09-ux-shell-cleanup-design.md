# UX Shell Cleanup Design

Date: 2026-07-09
Branch: `codex/ux-shell-cleanup`
Base: `origin/main`

## User-Facing Claim

The app shell should feel calmer for an average Lineage user. The left sidebar should stop presenting secondary shortcuts and bucket diagnostics as primary navigation, and the Lineage canvas header should focus on the active workspace and primary creation/action controls.

## Approved Direction

Use a conservative declutter. Preserve the familiar global topbar for this pass, but remove the most distracting default chrome from the left sidebar and Lineage canvas header.

Approved decisions:

- Optimize for a lineage-first user.
- Left sidebar keeps project selection and essential filters.
- Remove left-sidebar quick sets from the default view.
- Remove bucket health/stat cards from the default sidebar.
- Keep the global topbar in scope, but preserve its current familiar shape for now.
- Use a workspace-led Lineage canvas toolbar with no repeated `Lineage` title in the subheader.
- Hide demo and QA seed media controls by default inside `Actions`.
- Move Next variation status and selection work out of the header and into the side panel.

## Scope

In scope:

- `Sidebar.tsx` and related sidebar styles.
- `LineageToolbar.tsx`, `LineageToolbar.css`, and closely related Lineage header layout styles.
- Focused component tests for visible and hidden controls.
- Browser/e2e screenshot proof for desktop and mobile shell layout.

Out of scope:

- Backend APIs, data models, and lineage mutations.
- Node cards, canvas graph rendering, and edge layout behavior.
- Right-side selection panel redesign.
- Modal flow redesigns.
- A new design system or broad visual restyling.

## App Shell Design

The global topbar remains recognizable. It can still show view navigation, search, refresh, and upload during this conservative pass. The cleanup should avoid forcing users to relearn the whole app chrome while still reducing the persistent noise that triggered this work.

The left sidebar becomes a narrow project and filter surface:

- Brand/project identity remains.
- Project picker remains.
- Source, status, channel, and placement filters remain.
- Mobile disclosure label becomes `Filters`, not `Filters and quick sets`.
- Quick-set buttons are removed from the default sidebar.
- Bucket account, catalog, live, loose, and size stat cards are removed from the default sidebar.

Removed quick-set destinations are still reachable through existing global navigation or the topbar `More` menu. Bucket diagnostics can be revisited later as a settings or diagnostics surface, but should not occupy persistent navigation space for average users.

## Lineage Canvas Header Design

The Lineage view already has global navigation indicating the active view, so the canvas subheader should not repeat `Lineage` as a title. The active workspace becomes the primary anchor.

Default visible header content:

- Workspace picker button/card as the first control.
- Workspace name as the strongest text.
- Node/link count and root id as subdued supporting metadata.
- `New lineage` as the primary visible action.
- `Actions` as the secondary visible action.

The root scope bar may remain as a slim contextual strip below the toolbar. It should be visually quieter than the workspace toolbar and should not compete with the primary action row.

Controls moved into `Actions`:

- Demo/QA seed media controls.
- Load demo lineage actions.
- Graph direction.
- Fit graph.
- Tidy tree.
- Archive current lineage.
- Index local.
- Refresh graph.
- Refresh workspaces.

Next variation status and candidate selection should not remain in the header. Users manage that work from the right-side Lineage side panel.

## Component Boundaries

Keep changes close to existing components:

- `Sidebar` owns sidebar visibility and default contents.
- `FilterSelect` can remain a local helper unless the implementation naturally reveals duplication.
- `LineageToolbar` owns the canvas toolbar and action menu grouping.
- Existing workspace picker behavior remains in `LineageWorkspacePicker`.
- Existing side-panel selection behavior remains in `LineageSidePanel` and `LineageSelectionStrip`.

No new global state or API contract is required.

## Data Flow

No API or data model changes are expected.

`Sidebar` may continue receiving `snapshot`, `totals`, `liveSync`, and related props if removing them would require a wider `App` refactor. The implementation should remove rendering of the bucket diagnostics even if some props remain temporarily unused; any resulting TypeScript or lint failures should be addressed by narrowing props only where it is safe and local.

`LineageToolbar` should continue receiving callbacks for demo, graph, workspace, and refresh actions. The behavioral change is where the controls render, not how actions execute.

## Error Handling

Existing action handlers, disabled states, loading states, and toast behavior should remain intact. Moving controls into `Actions` must not hide unavailable states in a way that makes a broken action look usable.

If an action is unavailable because no snapshot or workspace is active, the menu item should retain the existing disabled behavior.

## Testing And Proof

Implementation proof should use an adversarial standard.

User-facing claim to prove:

The default app shell is less cluttered while preserving access to the existing workflows needed from the sidebar and Lineage toolbar.

Top three realistic failure modes:

- A removed sidebar quick set was the only practical path to an existing workflow.
- Moving Lineage controls into `Actions` drops a disabled/loading state or breaks an action callback.
- Responsive layouts regress, especially mobile sidebar disclosure and narrow Lineage toolbar wrapping.

Evidence to gather before completion:

- Focused component tests for sidebar default contents and Lineage toolbar visible/action-menu controls.
- `npm test` at minimum; prefer `npm run ci` if the implementation risk and time budget allow.
- Browser/e2e or Playwright screenshot proof at desktop and mobile widths for the shell, sidebar, and Lineage header.
- Direct inspection that no private media, credentials, presigned URLs, customer content, or SQLite databases were staged.

## Implementation Notes

Prefer small, local edits:

- Do not introduce a new navigation framework.
- Do not redesign the topbar beyond what is needed to support the conservative declutter.
- Preserve existing accessible labels where controls move into menus.
- Keep typography compact inside tool surfaces; avoid turning the header into a marketing-style hero.
- Avoid nested cards; the sidebar and toolbar should be simple shell surfaces.
