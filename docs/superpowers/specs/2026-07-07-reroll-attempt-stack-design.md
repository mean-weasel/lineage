# Re-roll Attempt Stack Design

## User-Facing Claim

Lineage should let users mark one or more existing images for re-roll, hand those targets to an agent as repair work, and store each regenerated result as attempt history for the same lineage node instead of adding it as a visible child in the tree.

## Goals

- Keep the lineage tree readable by preserving one visible node per conceptual image slot.
- Let users mark multiple nodes for re-roll at once.
- Store every re-roll prompt, generated file, receipt, and attempt in inspectable history.
- Make the newest imported re-roll attempt the current thumbnail automatically.
- Keep graph ancestry separate from repair history.
- Support the existing agent/CLI handoff workflow where the user describes the re-roll prompt in the IDE.

## Non-Goals

- Do not call image provider APIs from the Lineage server or CLI.
- Do not represent re-rolls as visible child nodes in the main graph.
- Do not add side-by-side visual diffing in the first version.
- Do not automatically approve imported re-roll attempts.
- Do not implement older-attempt restore in the first version unless it becomes necessary during implementation.

## Core Model

A lineage graph node represents a stable creative slot. That node has one current attempt, which drives the thumbnail and preview shown on the canvas, plus zero or more prior attempts preserved in history.

Lineage edges remain visible creative ancestry. They attach to stable nodes, not to individual attempts. Generation metadata may still record which attempt was current when a child was created so the system can answer later forensic questions such as whether a downstream child came from a flawed or corrected source image.

Re-roll requests are separate from the existing "next variation" selection. Marking a node for re-roll creates or updates a pending request for that node and changes its review state to `needs_revision`. Importing a re-roll output creates a new attempt, promotes it to current, closes the request, and resets the node review state to `unreviewed`.

## UX

The canvas continues to show one node per conceptual image. If a node has more than one attempt, it shows a compact stack indicator with the attempt count while displaying the newest/current attempt as the thumbnail.

Node actions should include:

- `Mark for re-roll`
- `Clear re-roll request`
- Existing next-variation actions
- Existing review actions
- Existing detail and remove actions

Re-roll visual state must be distinct from next-variation selection. A user should be able to tell at a glance whether a node is selected for branching, marked for repair, or both.

The side panel should include a small re-roll queue area showing pending targets for the active lineage workspace. The handoff panel should expose copyable commands and language that tells the agent to process each pending target as a separate re-roll job.

Double-clicking a stacked node should open an Attempt History view rather than only the generic asset detail modal. The history view should show newest attempts first with:

- Large preview for the selected attempt
- Scrollable attempt list or filmstrip
- Prompt and request notes when available
- Generation job id and receipt metadata
- Imported file path or storage state
- Created/imported time
- Current attempt indicator

The regular detail view remains available from an explicit action.

## Data Model

Add first-class attempt and re-roll request storage instead of overloading `asset_edges`.

`asset_attempts` should store one row per file/version associated with a stable lineage node:

- `id`
- `project_id`
- `node_asset_id`
- `asset_id`
- `attempt_index`
- `source` such as `initial`, `generated_child`, or `reroll`
- `prompt`
- `generation_job_id`
- `file_path`
- `checksum_sha256`
- `created_at`
- `promoted_at`
- `is_current`

`asset_reroll_requests` should store pending and resolved repair intent:

- `id`
- `project_id`
- `root_asset_id`
- `node_asset_id`
- `status` as `pending`, `resolved`, or `cancelled`
- `requested_by`
- `notes`
- `created_at`
- `resolved_at`

There should be at most one open re-roll request per project/root/node. Clearing a request marks it `cancelled` and does not automatically restore the review state; the user can explicitly change review state if needed.

Existing data should remain compatible. Snapshot building should treat any node without attempt rows as having an implicit attempt `1` based on the node asset itself. Implementation may later backfill physical attempt rows, but first-version behavior should not require a migration before old trees render correctly.

## Server/API

Lineage snapshots should include enough attempt and re-roll state for the canvas:

- `current_attempt`
- `attempt_count`
- `reroll_request`
- optional compact attempt preview fields

New API operations:

- Mark a node for re-roll.
- Clear a node's pending re-roll request.
- List pending re-roll requests for a lineage workspace.
- List attempts for a node, newest first.

Re-roll import must not create an `asset_edges` row. It should index the generated file, create a new attempt for the target node, promote it as current, close the pending request, and update review state to `unreviewed`.

## CLI And Agent Flow

Add a `reroll` command family:

```bash
lineage reroll list --project <project> --root <root> --json
lineage reroll plan --project <project> --target <asset-id> --prompt "<prompt>" --json
lineage reroll import --project <project> --job-id <job-id> --file <scratch-file> --confirm-write --json
```

The agent flow is:

1. User marks one or more nodes for re-roll in the app.
2. User returns to the agent IDE and describes what should change.
3. Agent runs `lineage reroll list` to inspect pending targets.
4. Agent selects one target and runs `lineage reroll plan` with a target-specific prompt.
5. Agent generates one replacement file under `.asset-scratch`.
6. Agent runs `lineage reroll import`.
7. Import promotes the new attempt, closes that request, resets review to `unreviewed`, and leaves graph edges unchanged.
8. Agent repeats for remaining pending targets.

Each target gets a separate job so prompts, imports, retries, and receipts remain unambiguous.

The re-roll handoff packet should include:

- Root asset id
- Target node asset id and title
- Current attempt file path or storage key
- Previous prompt when known
- Request notes
- Existing child count
- Import command
- A warning that the output must be imported as a re-roll attempt, not linked as a lineage child

## State Transitions

Mark for re-roll:

- Create or update pending request.
- Set review state to `needs_revision`.

Clear re-roll request:

- Mark the pending request `cancelled`.
- Leave review state unchanged.

Import successful re-roll:

- Create indexed local asset for the imported file if needed.
- Create new attempt row.
- Make new attempt current.
- Close request.
- Set review state to `unreviewed`.
- Do not create a visible child edge.

## Testing

Server tests should cover:

- Marking re-roll sets `needs_revision`.
- Clearing re-roll leaves review state unchanged.
- Multiple nodes can be marked in the same lineage.
- Re-roll import creates one new attempt and promotes it.
- Re-roll import closes the request and resets review to `unreviewed`.
- Re-roll import does not create `asset_edges`.
- Existing nodes without attempt rows still appear in snapshots.

Generation receipt tests should cover:

- `lineage_reroll` jobs require one target.
- Re-roll import accepts exactly one file.
- Wrong job status, duplicate file, missing scratch file, and out-of-scratch files fail clearly.

CLI tests should cover:

- `reroll list`
- `reroll plan`
- `reroll import`
- Stable JSON output and useful human-readable output.

Frontend tests should cover:

- Context menu mark/clear actions.
- Re-roll badge rendering.
- Re-roll queue rendering.
- Stack count rendering.
- Double-clicking a stacked node opens attempt history.
- Attempt history orders newest first.

## Proof Standard

Before implementation is declared complete, state the user-facing claim, the top three realistic failure modes, and evidence gathered. For meaningful implementation work, prefer:

- `npm run ci`
- `npm run public:readiness` if package boundaries, fixtures, or public data checks are touched
- Targeted Vitest tests for changed server, CLI, and frontend modules
- Browser/e2e proof if the canvas or attempt history workflow changes substantially

## Top Failure Modes To Guard Against

1. Re-roll imports accidentally create visible child edges, polluting the lineage tree.
2. The UI conflates re-roll targets with next-variation selections, causing agents to branch when they should repair.
3. Attempt promotion or review transitions are incomplete, leaving the newest file hidden or leaving a completed request stuck in `needs_revision`.
