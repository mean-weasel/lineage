# Lineage Canvas Social Marks Design

**Date:** 2026-07-24
**Status:** Approved for implementation planning

## Purpose

Let a human or agent mark and unmark assets in a specific Lineage canvas as candidates for future social work. The marked set must be visible in the canvas and queryable by agents with enough local asset detail to begin discussing or preparing social scheduling.

This first slice is intentionally a marker and handoff feature. It does not create content posts, call Buffer, upload media, schedule posts, or collect social performance metrics.

## User Experience

Each lineage node exposes a **Social** quick action beside the existing Branch and Re-roll actions.

- Pressing the Social button toggles the node's active social mark.
- Pressing `S` while that node's hover or focus preview is active performs the same toggle.
- A marked node shows a persistent selected state and Social badge after refresh.
- The shortcut does not fire while the user is typing in an input, textarea, select, or editable element, or while a modal owns keyboard focus.
- The context menu and other node action surfaces may expose the same Social toggle when they already expose equivalent Branch and Re-roll actions.
- Marking and unmarking are server-authoritative. The UI shows a pending state, blocks duplicate submissions, and refreshes from the returned canvas snapshot.

There is no maximum number of Social-marked nodes in a canvas.

## Scope and Identity

A Social mark is canvas-local, matching the scope of Branch selections and Re-roll requests.

Its identity is:

```text
project_id + root_asset_id + asset_id
```

The same asset may therefore be Social-marked in one lineage canvas and unmarked in another. An agent listing Social marks for a canvas receives only marks associated with that canvas root.

The server must verify that:

1. the project exists;
2. the root identifies a canonical lineage canvas in the project; and
3. the target asset is a visible node in that canvas.

## Persistence

Add an `asset_social_marks` table with:

| Field | Meaning |
| --- | --- |
| `id` | Deterministic or generated record identifier |
| `project_id` | Project boundary |
| `root_asset_id` | Canvas boundary |
| `asset_id` | Marked lineage node |
| `notes` | Optional human or agent context |
| `marked_by` | Human, agent, or system actor identifier |
| `marked_at` | Most recent activation time |
| `unmarked_by` | Actor that most recently removed the active mark |
| `unmarked_at` | Most recent removal time; null while active |
| `updated_at` | Last mutation time |

The table has a unique constraint on `(project_id, root_asset_id, asset_id)`.

Marking an inactive record reactivates the existing row by replacing `marked_by` and `marked_at` and clearing the unmark fields. Unmarking preserves the row and records `unmarked_by` and `unmarked_at`. This provides a minimal audit trail without introducing a general social-history subsystem.

An active mark is a row whose `unmarked_at` is null.

## Server Contract

Create a focused Social-mark service with independently testable operations:

- list active Social marks for one project and canvas root;
- mark one visible node;
- unmark one visible node.

Confirmed writes require `confirmWrite: true`. A missing confirmation returns a dry-run preview and performs no mutation.

Social writes participate in existing lineage workspace claim enforcement. If the canvas has an active claim, an agent mutation must provide the matching claim token. Read-only listing never requires a claim.

Expose HTTP routes shaped consistently with existing lineage routes:

```text
GET    /api/lineage/:rootAssetId/social-marks
POST   /api/lineage/:rootAssetId/social-marks/:assetId
POST   /api/lineage/:rootAssetId/social-marks/:assetId/unmark
```

Mutation bodies accept the project, explicit write confirmation, optional notes, actor provenance, and optional claim token through the existing claim-token transport.

Lineage snapshots expose active Social state on each `LineageNode`. They do not include inactive audit rows.

## CLI and Agent Contract

Add provider-neutral CLI operations:

```text
lineage social list
lineage social mark
lineage social unmark
```

Every command requires explicit `--project` and `--root` arguments. Mark and unmark additionally require `--asset`; mutations require `--confirm-write`. Existing runtime/profile selection and claim-token rules apply.

Examples:

```bash
lineage social list --project <project> --root <root-asset-id> --json
lineage social mark --project <project> --root <root-asset-id> --asset <asset-id> --confirm-write --json
lineage social unmark --project <project> --root <root-asset-id> --asset <asset-id> --confirm-write --json
```

Agents can satisfy prompts such as:

- “Mark `<asset-id>` for social in this canvas.”
- “Unmark `<asset-id>` for social in this canvas.”
- “Which nodes in this canvas are marked for social?”

Agent mutations resolve exact asset IDs. A title may be used only when it resolves to exactly one visible canvas node; zero or multiple matches return a clarification error rather than guessing.

The list response is schema-versioned and includes:

- project and canvas/workspace identity;
- root asset ID;
- marked asset ID and title;
- media type;
- active mark notes and provenance;
- current attempt identity when available;
- local file path when known;
- current checksum when known;
- source/storage metadata useful for downstream handoff;
- actionable warnings for missing, unreadable, or non-local media;
- canonical follow-up CLI commands.

A missing local path or missing file does not fail the entire list. The affected asset remains in the response with a warning so an agent can discuss it or repair media availability.

The content-agent natural-language resolver recognizes current Social marks as an asset-selection intent without interpreting the mark as permission to post, upload, schedule, or mutate an external platform.

## Safety Boundaries

This feature does not:

- invoke Buffer or any other social provider;
- create or update Lineage content posts;
- upload local media;
- create public or presigned URLs;
- schedule or publish externally;
- store captions, network variants, external post identifiers, posted URLs, or performance metrics;
- turn a Social mark into an agent task automatically.

Local paths may be returned only through authenticated/local Lineage interfaces that already expose local asset details. They must not be written to public fixtures, logs, release artifacts, or committed data.

The word “Social” denotes a candidate marker, not a completed or authorized social action.

## Error Handling

- Unknown project, root, or asset: fail with a scoped not-found error.
- Asset not visible in the requested canvas: fail without mutation.
- Missing `confirmWrite`: return a dry-run response.
- Active claim without matching token: fail using the existing claim-conflict response.
- Already active mark: marking is idempotent and returns the active mark.
- Already inactive mark: unmarking is idempotent and returns the inactive state.
- Missing local path or file during listing: return the marked item plus a warning.
- Concurrent toggles: serialize through SQLite's existing writer discipline and return the authoritative final state.

## Verification

### Persistence and isolation

- Marking creates an active record with actor and timestamp.
- Unmarking retains the audit row and records unmark provenance.
- Re-marking reactivates the same unique record.
- Marks survive application refresh.
- The same asset can have different active states in two canvas roots.
- Listing never leaks marks from another project or root.

### Canvas behavior

- Every eligible node exposes the Social quick action.
- `S` marks and unmarks the focused or hovered node.
- The button and badge reflect server-authoritative state after refresh.
- Pending mutations cannot be submitted twice.
- Keyboard handling does not fire from editable controls or modal interactions.
- Existing `B` Branch and `R` Re-roll behavior remains unchanged.

### Agent and CLI behavior

- List output contains exact canvas identity and all active marks.
- Mark and unmark require confirmation and enforce active workspace claims.
- Exact asset IDs mutate the intended node.
- Ambiguous title lookup fails closed.
- Local path, current attempt, checksum, and source details are returned when available.
- Missing local media produces an item-level warning instead of dropping the mark.
- JSON output contains no credentials, private provider tokens, or generated public URLs.

### Regression and public gates

Run focused server, CLI, intent-resolver, and canvas component tests during development. Before completion, run the repository's meaningful-change gates, including `npm run ci` and `npm run public:readiness`, or document a pre-existing unrelated blocker with equivalent focused proof.

## Deferred Follow-up

Future work may promote Social-marked assets into provider-neutral social work items containing a primary asset, companion assets, per-network copy, scheduling state, provider receipts, posted URLs, and lightweight performance snapshots. That future workflow must be designed separately and must not be implied by this marker.
