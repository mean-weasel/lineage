# Portrait Lineage Canvas Experiments

Date: 2026-07-28
Branch: `codex/portrait-lineage-experiments`
Base: `origin/main` at `96899b0`

## User-Facing Claim

Lineage should let a user see and compare the complete social image represented by each canvas node while preserving a truthful, navigable view of creative ancestry.

The first experiment should prove whether an image-first portrait graph, semantic zoom, and collapsible branches can satisfy that claim within React Flow. A more radical column browser should be explored only if the graph cannot balance image fidelity with lineage comprehension.

## Why This Needs An Experiment

The current canvas node is a compact metadata card. Its graph contract fixes nodes at `212 × 164`, while the visible media area is only `58px` high and uses `object-fit: cover`. That makes graph density good but prevents portrait social images from being understood on the canvas without opening a hover preview or detail view.

The rich demo also contains portrait images at `1024 × 1536`, so this is not only a hypothetical future format mismatch. Increasing every node's height without changing zoom, layout, and branch visibility would make the graph too large. The experiment therefore needs to test a system, not merely a taller thumbnail.

## Product Hypothesis

A portrait lineage graph will work if:

- The complete image is the dominant surface of each node.
- Card dimensions stay consistent even when source aspect ratios differ.
- Metadata progressively disappears as the user zooms out.
- Branches can be collapsed without hiding important state or falsifying shared ancestry.
- Expand and collapse preserve the user's spatial anchor.
- The user can temporarily focus on one branch without losing the whole-tree overview.

React Flow is expected to remain the viewport and interaction engine. The experiment should treat the layout and node presentation as replaceable layers rather than replacing the canvas library prematurely.

## Approved Experiment Order

### Experiment A: Portrait Graph

Build the smallest image-first variant of the existing React Flow canvas.

Card anatomy:

- Fixed outer width in the `200–224px` range.
- Fixed portrait media frame using a `2:3` default ratio.
- `object-fit: contain` so the complete image is always visible.
- Neutral matte behind media that does not match the frame ratio.
- One compact footer containing title, attempt count, and at most two high-value states.
- Selection, latest, review, and active-work state expressed primarily through frame treatment and small corner markers instead of a large badge cloud.
- Existing Branch, Re-roll, and Details actions exposed from a selected-node toolbar or footer action rather than requiring the existing hover preview.

The prototype should use a fixed card size first. User-resizable nodes are explicitly deferred because variable dimensions would confound the initial comparison and make layout quality harder to judge.

Layout:

- Make left-to-right the primary portrait experiment direction.
- Lay generations out in columns, with siblings stacked vertically.
- Feed the actual experiment card dimensions into Dagre.
- Ignore persisted manual node positions in the lab mode so the auto-layout can be evaluated honestly.
- Preserve the existing production behavior outside the experiment entry point.

Semantic zoom:

- Near: complete image, title, concise state, and actions.
- Medium: complete image, short title, and essential state markers.
- Far: complete image plus selection/latest/task outlines and collapsed counts.

Exact thresholds should be tuned from screenshots rather than treated as product constants. Start near `0.72` and `0.45`, then adjust based on legibility at the target viewport sizes.

### Experiment B: Collapsed Branches And Focus

Add branch controls only after the base portrait layout is visually credible.

Expanded branch affordance:

- Place the control on or beside the outgoing lineage rail.
- Show the direct child count.
- Use explicit accessible language such as `Collapse 3 children`.

Collapsed branch affordance:

- Keep the branch parent visible.
- Show total hidden descendants, not only direct children.
- Summarize important hidden state: latest leaves, selected next variations, pending work, errors, or review-needed nodes.
- Use a small stacked-card or thumbnail-slat treatment so the hidden content still reads as visual work.
- Use explicit accessible language such as `Expand 8 descendants, including 1 selected asset`.

Visibility must be reachability-aware. If a descendant remains reachable through another visible parent, it should remain visible. Hidden counts must describe nodes actually removed from the visible projection.

Expand/collapse motion:

- Record the triggering parent's screen position before relayout.
- Recalculate visible nodes and positions.
- Compensate the viewport so the triggering parent remains visually anchored.
- Animate affected nodes and edges within the existing reduced-motion contract.
- Do not silently persist experiment auto-layout positions as authored manual positions.

Focus branch mode:

- Keep the selected node, its ancestors, and its immediate children prominent.
- Dim or temporarily hide unrelated branches.
- Preserve a clear `Return to overview` path.
- Do not resize the selected graph node during the first pass; use focus styling and viewport fitting so layout remains stable.

### Experiment C: Column Browser Comparison

Build this only when one of the following is true:

- Experiment A cannot show a useful 14-node overview without making images unrecognizable.
- Experiment B still makes common branch-navigation tasks disorienting.
- Review sessions show that users overwhelmingly work one path at a time and do not use the whole-tree view.

The comparison can be a read-only renderer over the same snapshot:

- Ancestors or parents in the left column.
- Active image in the center column.
- Children in the right column.
- Siblings available in the relevant column.
- Horizontal navigation advances the active path.
- Multiple-parent relationships remain explicitly labeled.

This renderer does not need React Flow. Its purpose is to determine whether an implicit-collapse navigation model materially outperforms the portrait graph, not to recreate all current canvas behaviors.

## Experiment Containment

The work should remain isolated on this branch and must not alter persistent lineage data.

Preferred containment:

- Reuse the existing rich demo snapshot and media.
- Select experiment modes through a local query parameter or clearly labeled lab-only control.
- Keep the existing canvas as the default renderer.
- Do not add or migrate database fields.
- Do not change API response contracts unless a missing derived value cannot be computed from the existing snapshot.
- Do not persist collapse, focus, semantic-zoom, or lab-mode state during the experiment.
- Do not commit generated screenshots if they contain private media, campaign data, customer content, credentials, or real presigned URLs.

## Important Interaction Decisions

### Image Sizing

Use a consistent frame rather than native-height cards. Portrait, square, and landscape assets must all show the complete image inside that frame. The experiment should include at least `9:16`, `2:3`, `4:5`, `1:1`, and `16:9` fixtures to expose letterboxing and legibility tradeoffs.

### Metadata Hierarchy

The canvas should answer these questions without opening a modal:

1. What does this image look like?
2. Is it selected, latest, under active work, or in need of review?
3. How is it related to the adjacent images?

Storage state, full asset id, prompt, detailed task state, and forensic metadata remain available in detail surfaces. They should not compete with the artwork in every expanded node.

### Attempts

A stable lineage node continues to show only its current attempt. Attempt count remains compact in the footer. The portrait experiment must not turn re-roll attempts into lineage children or otherwise change the established attempt-stack model.

### Edge Summaries

Edge summaries remain available near zoom. At far zoom they may be suppressed so labels do not overwhelm the images and lineage rails. Collapsing a branch must not concatenate all hidden edge summaries into an unreadable aggregate label.

### Keyboard And Screen Reader Behavior

- Every expand/collapse control is a real button with `aria-expanded`.
- Hidden nodes are removed from the keyboard traversal projection.
- Collapsed summaries announce important hidden states.
- Focus mode moves focus predictably and restores it on exit.
- Existing Branch, Re-roll, Details, replay, and edge-edit access remains reachable.
- Reduced-motion users receive an immediate anchored relayout without animation.

## Evaluation Tasks

Use the same tasks against the current canvas and each experiment:

1. Identify the complete composition of a portrait asset without opening a modal.
2. Trace the active asset back to its root.
3. Compare three sibling variations and choose one for the next variation.
4. Find every latest leaf.
5. Find pending re-roll or branch work.
6. Collapse a completed branch, inspect another branch, and restore the original branch.
7. Determine whether a collapsed branch contains selected or active work.
8. Open attempt history for a stacked node and return to the same canvas context.
9. Run or scrub lineage replay and understand which portrait node entered.

Target viewports:

- `1440 × 900` desktop.
- `1280 × 720` compact desktop.
- A narrow responsive viewport matching the existing e2e mobile convention.

Target datasets:

- The 14-node Swissifier rich demo.
- A small 3-generation branching fixture for interaction precision.
- A synthetic larger graph for render and pan/zoom stress.
- A graph containing a shared descendant with two parents.
- A graph with selected, latest, review-needed, and pending-work descendants inside a collapsed branch.

## Evidence To Capture

For each experiment:

- Baseline and experiment screenshots at fit view, medium zoom, and near zoom.
- A short interaction recording or screenshot sequence for expand/collapse.
- Node and edge bounds before and after expansion to prove anchor stability.
- Accessibility inspection for collapse controls, hidden traversal, and focus restoration.
- A performance trace for pan, zoom, and collapse on the synthetic larger graph.
- Direct inspection that complete images are visible for every aspect-ratio fixture.
- A written result against every evaluation task: pass, partial, or fail.

Screenshots and recordings are evaluation artifacts. Store only fixtures safe for the public repository, or keep private evidence outside Git.

## Decision Gates

Choose the portrait graph as the product direction when:

- Users can understand complete portrait compositions directly on the canvas.
- The 14-node rich demo remains navigable at fit view through semantic zoom.
- Selection, latest, review, and active-work states remain identifiable at every zoom tier.
- Expand/collapse preserves spatial context and truthfully summarizes hidden work.
- Existing lineage, attempts, replay, and action semantics remain intact.

Add focus branch mode when the portrait overview succeeds but active-path review remains visually noisy.

Advance the column browser when the portrait graph fails common navigation tasks even after semantic zoom and branch collapse, or when the graph requires such a low default zoom that the images cease to be useful.

Do not select a direction from a single polished screenshot. The decision requires interaction evidence against the same fixtures and tasks.

## Anticipated Implementation Touchpoints

Experiment A is expected to stay near:

- `src/web/components/LineageAssetNode.tsx`
- `src/web/components/LineageCanvas.tsx`
- `src/web/components/LineageView.tsx`
- `src/web/components/LineageView.css`
- `src/web/components/lineageGraph.ts`

Experiment B may justify isolated projection and layout helpers rather than adding more responsibility to `LineageView`:

- A visibility projection helper for collapsed and focused graphs.
- A semantic-zoom state helper or hook.
- A viewport-anchor helper for relayout.

Experiment C should be a separate read-only renderer rather than conditionally restructuring `LineageCanvas`.

Tests should be colocated with helpers and components, with browser coverage added under `e2e/` for the interaction proof.

## Non-Goals

- Replacing React Flow before the React Flow experiment is evaluated.
- Redesigning the global app shell, side panel, detail modal, or attempt-history modal.
- Changing backend lineage, review, selection, task, or attempt contracts.
- Adding image generation, image editing, or provider controls inside canvas nodes.
- Persisting user-selected node sizes.
- Making the experiment production-default.
- Shipping every experiment instead of selecting and refining one direction.

## Adversarial Proof Standard

User-facing claim to prove:

The canvas shows complete social images as first-class lineage entities without making ancestry, important state, or navigation less trustworthy.

Top three realistic failure modes:

1. Portrait cards make the graph so large that users lose the useful whole-tree overview and spend their time panning a wall of images.
2. Collapse logic hides shared descendants or important selected, latest, review, or task state, causing the visible graph to misrepresent the lineage.
3. Auto-layout during expand, collapse, or focus moves the user's target unexpectedly or conflicts with persisted manual positions, destroying spatial memory.

Required evidence before choosing a product direction:

- Side-by-side task results and screenshots for the current canvas and experiment.
- Automated projection tests covering shared descendants and important hidden state.
- Browser proof that the triggering node stays anchored during expand/collapse.
- Responsive and reduced-motion proof.
- Direct inspection that no private media, credentials, customer data, presigned URLs, or SQLite databases are staged.

For a later production implementation, prefer `npm run ci`, `npm run public:readiness`, targeted component/helper tests, and `npm run e2e` in proportion to the selected design's scope.

## Proposed Work Packages

1. Capture current-canvas baseline evidence using the approved public rich demo.
2. Add a contained portrait-card lab mode with fixed card dimensions and complete-image rendering.
3. Add semantic zoom tiers and compare the target viewports.
4. Add reachability-aware collapsed-branch projection with tests.
5. Add anchored relayout and reduced-motion behavior.
6. Add focus branch mode only if the portrait overview needs a review aid.
7. Run the evaluation tasks and record the decision receipt.
8. Build the column-browser comparison only if a decision gate calls for it.
9. Remove rejected experiment code or convert the chosen direction into a separate production implementation plan.

## Decision Receipt — 2026-07-28

The portrait graph passed the first interaction review and is promoted from a query-only lab into the first user-selectable canvas visualization option.

- Keep the existing compact nodes as the safe default and as a persistent user choice.
- Offer portrait cards as an equal, persistent choice, while retaining the shareable `lineageCanvas=portrait` URL override.
- Treat edge weight as an independent appearance choice with fine, standard, and bold settings.
- Let the existing persisted hover-preview preference apply to both compact and portrait cards, and expose it alongside the other Canvas appearance controls.
- Group card style, direction, edge weight, and edge labels in one `Canvas appearance` component. It lives in the current Actions menu for this pass and is intentionally portable to a future side rail.
- Keep portrait layout changes session-local so experimenting with portrait direction or tidy does not overwrite saved compact-node positions.
- Defer global top-navigation and toolbar relocation. That deserves a separate shell-level design pass after the canvas controls prove which options need to remain permanently visible.

Live proof used the isolated public Swissifier rich-demo workspace with 14 nodes and 13 edges. Both card modes rendered all 14 nodes, all 14 portrait images loaded, the compact and portrait dimensions were 212×164 and 224×400 respectively, and standard/bold computed edge widths changed from 2/3px to 4/5px including focused edges. Card style and edge weight survived a reload without browser errors.
