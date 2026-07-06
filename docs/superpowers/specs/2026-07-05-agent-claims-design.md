# Agent Claims And Occupancy Design

## Purpose

Lineage needs a first-class way to show and validate which agent is working on which bounded project/channel target. Today, agent handoffs can point at active work, but active workspace, selected target, and current selections are shared project state. Multiple agents can therefore read or mutate stale ambient state unless every write is explicitly scoped.

This design adds target-scoped, channel-aware agent claims. A claim is both a UX occupancy signal and a scoped credential for mutating writes.

## Goals

- Show users which agents are currently working on which project, channel, and target.
- Prevent agents from mutating the wrong lineage workspace, content post, queue lane, or selection set.
- Preserve human control with explicit override, transfer, revoke, and stale-release flows.
- Keep read-only inspection low-friction.
- Make claim validation shared and auditable rather than route-specific.

## Non-Goals

- Prevent a local machine owner from bypassing the app or directly editing SQLite.
- Lock entire projects by default.
- Require claims for read-only inspection.
- Add external social posting automation.
- Store raw claim tokens in SQLite, logs, or visible history.

## Claim Model

Add an `agent_claims` table. Each row represents one agent's authority to work on one bounded target.

Core fields:

```text
id
token_hash
project_id
channel
scope_type
target_id
target_title
agent_id
agent_name
agent_kind
thread_id
status
created_at
heartbeat_at
expires_at
released_at
revoked_at
revoked_by
override_reason
metadata_json
```

Allowed `scope_type` values:

```text
lineage_workspace
content_post
content_queue_lane
selection_set
project_channel
```

Default scope usage:

- `lineage_workspace`: generation, variation, and child-linking work.
- `content_post`: copy, asset attachment, and review movement for one content target.
- `content_queue_lane`: a temporary claim for "next item in this lane" that should narrow to a content post before writes.
- `selection_set`: asset review and selection work.
- `project_channel`: rare broad claim for work that intentionally owns a whole channel lane.

Stored claim status values:

```text
active
expired
released
revoked
transferred
```

`idle` should be derived from heartbeat age instead of stored unless query complexity later justifies persisting it.

Add an `agent_claim_events` table for audit history:

```text
claim_id
event_type
actor
message
created_at
metadata_json
```

Useful event types include `created`, `heartbeat`, `write_allowed`, `write_denied`, `conflict`, `released`, `revoked`, `transferred`, and `expired`.

## Validation

Every mutating operation should resolve into a normalized write intent:

```text
project_id
channel
scope_type
target_id
write_kind
danger_level
```

All write paths should use a shared helper:

```ts
validateAgentClaimForWrite({
  claimToken,
  project,
  channel,
  scopeType,
  targetId,
  writeKind,
  dangerLevel,
});
```

The helper validates:

1. Claim token exists and hashes to the stored token hash.
2. Claim status is active.
3. Claim has not expired.
4. Project matches.
5. Channel matches when the write is channel-scoped.
6. Scope matches the target, or the claim has a valid broader parent scope.
7. Write kind is allowed for the claim scope.
8. Dangerous writes still have explicit human confirmation.

Validation returns either an allowed result:

```ts
{ ok: true, claim, warnings: [] }
```

or a structured denial:

```ts
{
  ok: false,
  code: "claim_scope_mismatch",
  message: "...",
  conflicts: []
}
```

Routes should not implement bespoke claim checks. They should normalize intent and call the shared helper.

## Enforcement Policy

Use hybrid enforcement:

- Agents must present a matching claim token for mutating CLI/API writes.
- Humans in the app may override, transfer, or revoke claims after explicit confirmation.
- Read-only inspection does not require a claim.
- Dangerous or destructive writes require both a valid claim and existing human confirmation semantics.

Recommended enforcement levels:

```text
observe: read-only, no claim required
claim: claim required before guided work starts
warn: visible conflict or stale-state warning
enforce: matching claim required for mutating writes
danger: claim plus explicit human confirmation
```

Examples:

- Inspect a lineage workspace: allowed without claim.
- Generate or view a brief: allowed without claim, or warning if another agent owns the target.
- Link a generated child to a lineage workspace: requires matching `lineage_workspace` claim.
- Attach an asset to a content post: requires matching `content_post` claim.
- Operate across a channel lane: requires rare `project_channel` claim or a narrowed target claim.
- Archive, delete, or post externally: claim plus explicit confirmation, with external posting remaining outside this design.

## CLI Contract

Add claim lifecycle commands:

```bash
lineage agent claim \
  --project demo-project \
  --scope lineage_workspace \
  --target demo-project:lineage-workspace:abc \
  --channel tiktok \
  --agent-name "Codex thread 123" \
  --ttl 20m \
  --json

lineage agent status --project demo-project --json
lineage agent inspect --claim claim_abc --json
lineage agent heartbeat --claim-token claim_abc.secret_xyz --json
lineage agent release --claim-token claim_abc.secret_xyz --json
lineage agent revoke --claim claim_abc --project demo-project --reason "stale thread" --confirm-write --json
lineage agent transfer --claim claim_abc --to-agent-name "Codex thread 456" --confirm-write --json
```

`agent claim` returns claim metadata plus the raw token exactly once:

```json
{
  "ok": true,
  "claim": {
    "id": "claim_abc",
    "project": "demo-project",
    "channel": "tiktok",
    "scope_type": "lineage_workspace",
    "target_id": "demo-project:lineage-workspace:abc",
    "agent_name": "Codex thread 123",
    "status": "active",
    "heartbeat_at": "...",
    "expires_at": "..."
  },
  "claim_token": "claim_abc.secret_xyz"
}
```

Mutating commands gain:

```bash
--claim-token <claim-id.secret>
```

Example:

```bash
lineage link-child \
  --project demo-project \
  --root root-id \
  --child child-id \
  --claim-token claim_abc.secret_xyz \
  --confirm-write \
  --json
```

The existing CLI should also be reconciled with app-displayed handoff commands so copied commands are executable package contracts.

## API Contract

Add claim endpoints:

```text
GET    /api/agent-claims
POST   /api/agent-claims
GET    /api/agent-claims/:claimId
POST   /api/agent-claims/:claimId/heartbeat
POST   /api/agent-claims/:claimId/release
POST   /api/agent-claims/:claimId/revoke
POST   /api/agent-claims/:claimId/transfer
```

Mutating APIs should accept claim tokens from either a header or request body:

```http
X-Lineage-Claim-Token: claim_abc.secret_xyz
```

```json
{
  "claimToken": "claim_abc.secret_xyz",
  "confirmWrite": true
}
```

The header is cleaner for API clients. Body support is useful for existing handlers and tests.

## Conflict Behavior

When a new claim overlaps an active claim:

- Same exact target: block by default.
- Same project and channel but different specific target: allow unless a broad `project_channel` claim overlaps.
- Broad claim request while specific claims exist: require `--force --reason`.
- Expired claim: allow takeover and record the event.
- Human UI override: allow explicit revoke or transfer and record the event.

CLI conflict responses should be actionable:

```json
{
  "ok": false,
  "error": "target_already_claimed",
  "conflicts": [
    {
      "claim_id": "claim_abc",
      "agent_name": "Codex thread 123",
      "target_title": "TikTok hook lineage",
      "heartbeat_age_seconds": 18,
      "expires_at": "..."
    }
  ],
  "next": "Use --force --reason only if you intend to override, or choose another target."
}
```

## UX

### Inline Occupancy Badges

Show small claim badges wherever claimed targets appear:

- Lineage workspace picker rows.
- Active lineage toolbar.
- Content target panel.
- Content queue item and lane headers.
- Asset selection or review set panel.
- Channel filters or lane headers when a broad channel claim exists.

Example labels:

```text
Codex thread 123 - active 18s ago
Codex thread 123 - stale 12m
```

Visual states:

```text
active: normal emphasis
idle: muted warning
stale: warning
released/revoked: hidden outside history
```

### Agent Context Drawer

Upgrade the current Agent context drawer to show claim state and claim-aware handoffs:

- No claim: "No agent currently working here."
- Active claim: agent name, scope, channel, last heartbeat, and expiry.
- Actions: copy claim-aware handoff, copy read-only inspect command, release stale claim, transfer to new agent.

The drawer should stay compact and operational.

### Conflict Dialog

When a user changes, archives, relinks, attaches, or switches away from a claimed target, show a focused dialog:

```text
Codex thread 123 is working on TikTok hook lineage.

Last seen: 18 seconds ago
Scope: lineage workspace
Target: TikTok hook lineage

[Cancel] [Transfer] [Override]
```

For stale claims, the default action can be:

```text
This claim is stale. Release it and continue?
```

### Agents Page

Add an Agents page or drawer showing active work grouped by project and channel:

```text
Active
Codex thread 123   demo-project / tiktok    Lineage workspace   TikTok hook lineage   last seen 18s
Codex thread 456   demo-project / linkedin  Content post         Launch teaser        last seen 42s

Idle / Stale
Codex thread 789   demo-project / tiktok    Selection set        Hook variants        stale 14m
```

Per-row actions:

```text
Inspect
Copy handoff
Release
Revoke
Transfer
```

Filters:

```text
Project
Channel
Status
Agent
Scope
```

The page should answer one question quickly: who is holding what right now?

### Assign-To-Agent Flow

When the user copies a handoff to an agent, the app should preferably create the claim immediately and include the token in the copied packet. That makes occupancy visible before the agent starts.

Example packet:

```bash
export LINEAGE_CLAIM_TOKEN='claim_abc.secret_xyz'
lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --json
lineage brief --project demo-project --root root-id --claim-token "$LINEAGE_CLAIM_TOKEN" --json
```

Raw tokens should only be visible at creation/copy time and should be redacted from app history and logs.

## Failure Handling

- Missing claim on mutating agent command: reject with "claim required."
- Wrong target, channel, or project: reject with structured mismatch code.
- Expired claim: reject and explain renewal or reclaim options.
- Stale claim conflict: allow human override; CLI requires `--force --reason`.
- UI human action on claimed target: warn, then allow override or transfer.
- Token in logs: redact claim-token-shaped values.
- Old CLI without claim support: read-only remains usable; writes fail with claim/upgrade instructions.

## Testing

Minimum meaningful coverage:

- Claim lifecycle unit tests: create, heartbeat, release, expire, revoke, transfer.
- Conflict tests: exact target conflict, broad channel conflict, stale takeover.
- Validation tests: correct token passes; wrong project, channel, target, or scope fails.
- CLI tests: claim, status, inspect, heartbeat, release JSON contracts.
- Mutating CLI tests: claim enforcement on `link-child` and content target writes.
- API tests: header and body claim token support.
- UX tests: badges render, conflict dialog appears, stale release action works.
- Regression gates: `npm run ci` and `npm run public:readiness` before release-facing changes.

## Rollout

1. Add schema, service helpers, status endpoints, and read-only Agents page.
2. Add claim, inspect, status, heartbeat, and release CLI commands.
3. Add claim-aware handoff copy from the app.
4. Enforce claims on high-risk writes first: lineage `link-child`, content target attach/move, archive/delete.
5. Expand enforcement across remaining mutating routes.
6. Add broad `project_channel` claims after target-level claims are proven usable.

## Open Implementation Notes

- Choose a compact token format and redaction regex before adding logs.
- Decide default TTL, likely 20 minutes, with heartbeat renewal.
- Align app-displayed handoff commands with the packaged CLI before release.
- Keep `project_channel` visually prominent because it can block otherwise unrelated channel work.
