# Lineage Launch Recording Runbook

- Status: Draft execution script
- Version: 0.1
- Last updated: 2026-07-18
- Messaging source: `LAUNCH_MESSAGING.md`
- Asset inventory: `LAUNCH_ASSET_PLAN.md`

## Purpose

This runbook gives an agent and human operator a repeatable script for recording the Swissifier demo in Lineage and Codex.

The recordings must prove both directions of the product interaction:

1. A human action in the Lineage canvas becomes precise context for an agent in Codex.
2. Agent work in Codex becomes durable, visible state in the Lineage canvas.

The primary demonstration is:

> Select the work in Lineage, confirm that Codex understands the selected context, request a specific re-roll, record it as a new attempt, and return to Lineage to inspect the result and its history.

## Important Product Distinction

Lineage has two related but distinct workflows. Do not blur them in narration or execution.

### Next variation

**Use for next variation** selects an asset as the base for new work. A resulting variation should become a visible child in the graph.

### Re-roll

**Mark for re-roll** requests a replacement attempt on the same logical node. A resulting re-roll should appear in that node's attempt history and must not create a visible child edge.

Record these as separate micro-clips. They may be joined in a larger walkthrough, but the labels and outcomes must remain clear.

## Roles

- **Agent:** Verifies runtime identity, prepares deterministic data, reads Lineage state, plans and imports the result, verifies the final state, and records evidence.
- **Human operator:** Performs visible interactions inside the Codex app. Computer Use cannot directly control the Codex app itself.
- **Browser automation:** Prepares and performs deterministic Lineage canvas interactions where natural-looking pointer motion is not required.
- **Capture operator:** Starts and stops the recording utility, watches for private information, and records retake notes.
- **Reviewer:** Approves only clips that prove the intended claim and pass privacy and runtime checks.

One person may fill several roles, but the agent must stop at any step assigned to the human operator rather than pretending it controlled Codex.

## Canonical Swissifier Targets

Project:

`demo-project`

Root asset:

`local-5748fb8ba6df` — Swissifier campaign root

Recommended next-variation target:

`local-6d06bdbd9f56` — mint diagonal drill direction

Recommended re-roll target:

`local-27050bc5c393` — vertical before/after direction with existing attempt history

These identifiers come from the checksum-pinned synthetic Swissifier fixture. Confirm them against the seeded snapshot before every recording; stop if they no longer identify the expected artwork.

## Proposed Re-roll Prompt

Use this as the initial rehearsal prompt:

> Re-roll this Swissifier before-and-after poster as a polished editorial product ad. Preserve the cream, red, black, and cheese-yellow Swiss design language; keep the machine and before/after transformation immediately readable; retain the phrase “make any cheese swiss”; remove stray or garbled copy; and use crisp geometric spacing. Record the result as a new attempt on the same Lineage node, not as a child variation.

The prompt may be shortened for the visible Codex take after the full version has produced a satisfactory deterministic result.

## Required Variables

Before running operational commands, record these values in the shot receipt:

```text
CHANNEL=stable | preview | dev
LAUNCHER=lineage-stable | lineage-preview | npm run lineage:dev --
PROFILE=<matching named profile>
PROFILE_ENVIRONMENT=<production|preview|development>
SERVICE_ORIGIN=<verified URL>
PROJECT=demo-project
ROOT_ASSET_ID=local-5748fb8ba6df
NEXT_TARGET_ID=local-6d06bdbd9f56
REROLL_TARGET_ID=local-27050bc5c393
WORKSPACE_ID=<seeded Swissifier workspace ID>
```

Do not infer any value from a port, process, browser title, PATH lookup, or previous recording session.

## Stop Conditions

Stop before recording or mutation if any of the following is true:

- physical checkout, code root, channel, or fingerprint is not the intended one;
- the named profile does not match the selected channel;
- runtime doctor, profile doctor, or database info fails;
- database identity, profile fingerprint, environment, or service origin disagrees;
- the browser is connected to an unidentified or stale service;
- Swissifier media is incomplete or fails checksum verification;
- the expected root or target asset is missing or shows different artwork;
- private content, local database paths, credentials, tokens, unrelated tasks, or sensitive filesystem details would be visible;
- another agent holds a conflicting claim or writer lease;
- the planned output is outside `.asset-scratch`;
- a re-roll would be imported as a child; or
- a next variation would overwrite the current attempt of its parent node.

## Phase 0 — Off-Camera Environment Gate

Choose exactly one channel. For public launch footage, prefer the stable package if all demonstrated behavior is released. Use preview only for an intentional release candidate. Use dev only when the required behavior exists solely in the current checkout.

Set the matching named profile and run the gate with the same launcher:

```bash
<launcher> runtime doctor --json
<launcher> profile doctor --profile "<profile>" --json
<launcher> db info --profile "<profile>" --json
```

Require agreement on:

- verified code origin, root, and fingerprint;
- channel;
- profile ID, environment, and fingerprint;
- database path and identity;
- asset root;
- service origin; and
- unique managed service instance, when a service is running.

Start or verify only the matching managed service lifecycle. Do not record until managed status and `/api/runtime` agree with the gate.

Record the identity values in a private shot receipt, not in the public video.

## Phase 1 — Prepare the Swissifier Capture State

Perform these steps off camera:

1. Download or restore the checksum-pinned Swissifier media pack through the supported demo flow.
2. Seed a fresh launch-specific Swissifier workspace derived from the public fixture.
3. Keep the QA fixture unchanged; apply presentation-only titles or layout through a capture seed or preparation layer.
4. Activate the Swissifier workspace.
5. Confirm all 14 base PNG images are present and valid.
6. Confirm the root and target IDs match the expected artwork.
7. Clear stale next-variation selections that are not part of the shot.
8. Clear stale pending re-roll requests created by an earlier take.
9. Restore the target node to the agreed starting attempt.
10. Fit the graph to the intended opening composition.

Verify read state with the selected launcher and profile:

```bash
<launcher> next --profile "<profile>" --project demo-project --root local-5748fb8ba6df --json
<launcher> inspect --profile "<profile>" --project demo-project --asset-id local-6d06bdbd9f56 --json
<launcher> inspect --profile "<profile>" --project demo-project --asset-id local-27050bc5c393 --json
<launcher> reroll list --profile "<profile>" --project demo-project --root local-5748fb8ba6df --json
```

The first take should start with no unexpected pending re-roll and only the selection state required by that shot.

## Phase 2 — Prepare a Clean Codex Task

Create or designate one public-safe Codex task for the recording.

Before capture:

- hide unrelated tasks and terminal history;
- use a concise task title such as `Swissifier demo — Lineage re-roll`;
- ensure no credentials, claim tokens, private paths, or unrelated repository data are visible;
- keep the visible prompt area large enough for social crops;
- prepare exact prompts in a private scratch note for accurate typing;
- rehearse the plugin response and expected timing; and
- collapse or summarize verbose JSON and terminal output.

If a claim token is needed, acquire and export it off camera. Never display the raw token in the recording.

## Recording A — Human Selection Reaches Codex

- Shot ID: `CLIP-03-04-selection-to-codex`
- Target length: 8–14 seconds
- Claim: A human canvas decision becomes precise agent context.

### Starting state

- Swissifier canvas is open and fitted.
- `local-6d06bdbd9f56` is visible but not selected for next variation.
- The Codex task is clean and ready.
- No capture-sensitive data is visible.

### Visible actions

1. **Human or browser automation:** Click the mint diagonal drill node.
2. **Human or browser automation:** Choose **Use for next variation**.
3. Hold long enough to show the `next variation` badge and the updated side panel.
4. Transition to the Codex task.
5. **Human operator:** Enter:

   > Check the current Lineage workspace and tell me which asset I selected for the next variation. Do not generate anything yet.

6. **Agent:** Read the current Lineage selection with the verified launcher and profile. Use `next`, then `inspect` if needed.
7. **Agent visible response:** Keep the response concise and human-readable:

   > I found the mint diagonal Swissifier drill direction selected for the next variation. I’ll use that exact asset and its lineage context as the base. I haven’t generated anything yet.

### End state

- Codex visibly names the correct selected asset.
- No generation or mutation has occurred after the human selection.
- The viewer can understand that the canvas selection crossed into the agent session.

### Acceptance checks

- Correct asset title or unmistakable description appears in Codex.
- The response says no generation has occurred.
- No raw IDs need to dominate the visible response.
- The Lineage badge and Codex response refer to the same asset.

## Recording B — Mark a Node for Re-roll

- Shot ID: `CLIP-REROLL-01-human-request`
- Target length: 4–7 seconds
- Claim: A human can request repair work on a specific existing node.

### Starting state

- `local-27050bc5c393` is visible.
- It has no pending re-roll request from an earlier take.
- Its attempt stack is visible or can be shown immediately afterward.

### Visible actions

1. Click or open the vertical before/after node.
2. Open its node action menu.
3. Choose **Mark for re-roll**.
4. Hold long enough to show the `re-roll` badge or re-roll queue entry.

### End state

- The node is visibly marked for re-roll.
- The request is for the same node, not a new branch.

### Acceptance checks

- The UI visibly distinguishes `re-roll` from `next variation`.
- No child node appears.
- The re-roll queue contains the intended target.

## Recording C — Codex Recognizes the Re-roll Queue

- Shot ID: `CLIP-REROLL-02-recognition`
- Target length: 7–12 seconds
- Claim: The agent can read the repair request created in the human UX.

### Visible actions

1. Transition from Lineage to the prepared Codex task.
2. **Human operator:** Enter:

   > Check Lineage for pending re-roll work. Tell me which asset is queued and wait for my instructions.

3. **Agent:** Run the equivalent verified command:

```bash
<launcher> reroll list --profile "<profile>" --project demo-project --root local-5748fb8ba6df --json
```

4. Inspect the target if its visual description is needed.
5. **Agent visible response:** Use concise copy:

   > I found the Swissifier vertical before/after poster queued for re-roll. I’ll treat the result as a new attempt on that same node, not as a child variation. I’m waiting for your prompt.

### Acceptance checks

- The correct target is named.
- The response explicitly says `same node` or `new attempt`.
- The response explicitly says it will not create a child variation.
- The agent waits instead of generating prematurely.

## Recording D — Prompt and Plan the Re-roll

- Shot ID: `CLIP-REROLL-03-prompt`
- Target length: 7–12 seconds of visible interaction
- Claim: A human can direct how the selected visual asset should be repaired.

### Visible action

**Human operator:** Enter the proposed re-roll prompt, or this shortened on-camera version:

> Re-roll it as a polished editorial product ad. Keep the cream, red, black, and cheese-yellow Swiss language; make the machine and before/after transformation immediately readable; retain “make any cheese swiss”; remove stray text; and record it as a new attempt on the same node.

### Agent action

The agent must:

1. Keep the verified profile selected.
2. Use the exact pending target from `reroll list`.
3. Plan one output with `reroll plan`.
4. Use Codex image generation outside Lineage server code.
5. Write the generated file under `.asset-scratch`.
6. Import exactly one output with `reroll import --confirm-write`.
7. Never use `link-child` for this output.

Equivalent command shape:

```bash
<launcher> reroll plan \
  --profile "<profile>" \
  --project demo-project \
  --root local-5748fb8ba6df \
  --target local-27050bc5c393 \
  --prompt "<approved prompt>" \
  --claim-token "$LINEAGE_CLAIM_TOKEN" \
  --json

<launcher> reroll import \
  --profile "<profile>" \
  --project demo-project \
  --job-id "<planned job ID>" \
  --file "<generated .asset-scratch PNG>" \
  --claim-token "$LINEAGE_CLAIM_TOKEN" \
  --confirm-write \
  --json
```

Use the exact command contract returned by `reroll plan` when it differs from the illustrative shape above.

### Visible Codex response

After verified import, use:

> The re-roll is recorded as a new attempt on the Swissifier before/after node. The previous attempts remain available, and no child node was created.

Do not claim success until the import output and Lineage readback confirm it.

## Recording E — Result Returns to Lineage

- Shot ID: `CLIP-REROLL-04-result`
- Target length: 5–9 seconds
- Claim: Agent work becomes durable, reviewable visual state for the human.

### Visible actions

1. Return to the Lineage canvas.
2. Refresh through the supported UI action or browser reload established during rehearsal.
3. Show the target node displaying the new current attempt.
4. Open **Attempt history**.
5. Show the new attempt alongside at least one earlier attempt.
6. Move between the current and previous attempts once.

### Acceptance checks

- The attempt count increases by exactly one.
- The new attempt is current.
- Earlier attempts remain available.
- The re-roll request is resolved.
- No visible child edge was added.
- The prompt and generation receipt are associated with the imported attempt in readback evidence.

## Combined Two-Way Re-roll Sequence

Target length: 25–40 seconds.

Recommended edit:

1. Click the before/after node and mark it for re-roll.
2. Show the re-roll badge.
3. Cut to Codex.
4. Ask Codex to inspect pending re-roll work.
5. Show Codex naming the correct asset and waiting.
6. Enter the concise re-roll prompt.
7. Compress generation time with a clean cut or brief progress transition.
8. Show Codex confirming the imported attempt.
9. Cut back to Lineage.
10. Open the attempt stack and compare the new result with the previous version.

Suggested on-screen captions:

1. **Choose what needs another pass.**
2. **Codex receives the exact target.**
3. **Describe the change you want.**
4. **The new attempt returns with its history intact.**

## Generation Strategy for Repeatable Takes

Do not depend on live generation latency during every recorded take.

Use this progression:

1. Rehearse the full prompt with Codex image generation.
2. Review the output for visual quality and public safety.
3. Save the approved output under a deterministic `.asset-scratch` path.
4. Reset the demo database and workspace to the starting state.
5. During the final take, perform the real `reroll plan` and real `reroll import` using the pre-approved output.
6. If the final public claim implies live generation, retain at least one uncut proof take for internal evidence and edit the public clip only for pacing.

This preserves real Lineage behavior while making retakes predictable.

## Browser Automation Contract

Create a capture-specific Playwright script only after the manual shot sequence is approved.

The script should:

- use the verified service origin supplied by the named capture profile;
- assert the Swissifier workspace title and media status;
- locate nodes by stable asset ID or accessible label, not screen coordinates;
- assert the starting selection and re-roll states;
- perform one UI action at a time;
- wait for the visible badge, toast, or queue entry after each mutation;
- capture a screenshot at every shot boundary;
- avoid cleanup until evidence has been saved; and
- reset through supported Lineage commands or a fresh capture profile, never by copying or deleting a live SQLite database.

Computer Use may operate supported browser or recording applications, but must re-read accessibility state after each interaction. It must not attempt to control the Codex app.

## Capture Checklist

Before each take:

- [ ] Correct channel and named profile selected
- [ ] Runtime doctor PASS
- [ ] Profile doctor PASS
- [ ] Database info matches profile
- [ ] Managed service status PASS
- [ ] Correct Swissifier workspace active
- [ ] 14/14 media present and valid
- [ ] Expected target artwork verified
- [ ] Clean selection and re-roll starting state
- [ ] Clean Codex task visible
- [ ] No secrets, private paths, tokens, or unrelated tasks visible
- [ ] Recorder region and resolution verified
- [ ] Mouse and typing rehearsal completed

After each take:

- [ ] Intended human action is legible
- [ ] Codex names the correct asset
- [ ] Agent waits when instructed
- [ ] Re-roll prompt is readable
- [ ] Import is confirmed by readback
- [ ] Attempt count increases by exactly one
- [ ] No child edge is created for re-roll
- [ ] Previous attempt remains available
- [ ] No sensitive information appears in any frame
- [ ] Raw master and poster frame saved under the shot ID
- [ ] Retake notes recorded

## Post-Take Readback

Run off camera with the same launcher and profile:

```bash
<launcher> runtime doctor --json
<launcher> profile doctor --profile "<profile>" --json
<launcher> db info --profile "<profile>" --json
<launcher> inspect --profile "<profile>" --project demo-project --asset-id local-27050bc5c393 --json
<launcher> reroll list --profile "<profile>" --project demo-project --root local-5748fb8ba6df --json
```

When a managed service is involved, rerun the matching managed status target. Require the same code, profile, database, origin, and service identity used at the start.

Save a compact private receipt containing:

- shot ID and take number;
- code channel and fingerprint;
- profile and database fingerprints;
- target asset and starting attempt count;
- planned job ID;
- imported file checksum;
- final attempt count and current attempt;
- edge count before and after;
- capture filename; and
- reviewer decision.

Do not include claim tokens, credentials, private filesystem data, or the SQLite database itself.

## Reset Between Takes

The reset must be deterministic and non-destructive to other profiles.

Preferred approach:

1. Stop the capture service for its profile.
2. Recreate a fresh non-production capture profile from an approved source using supported profile clone operations, or reseed an isolated disposable capture database through the supported demo flow.
3. Verify the fresh database identity.
4. Seed and activate Swissifier.
5. Restore the agreed attempt and selection state.
6. Repeat the full identity gate before restarting.

Never copy a live SQLite file with `cp`, Finder, or a raw file API. Never point preview or dev code at the stable database.

## Retake Log

| Shot ID | Take | Result | Retake note | Approved by |
|---|---:|---|---|---|
| CLIP-03-04-selection-to-codex | 1 | pending |  |  |
| CLIP-REROLL-01-human-request | 1 | pending |  |  |
| CLIP-REROLL-02-recognition | 1 | pending |  |  |
| CLIP-REROLL-03-prompt | 1 | pending |  |  |
| CLIP-REROLL-04-result | 1 | pending |  |  |

## Definition of Done

The recording package is ready when:

- the human-to-agent selection clip is understandable without narration;
- the re-roll clip clearly begins with a human-marked target;
- Codex visibly recognizes the correct target before generation;
- the human supplies a specific visual direction;
- the result is imported as one new attempt on the same node;
- the previous attempts remain reviewable;
- no child edge is created by the re-roll;
- runtime and profile identity match before and after;
- privacy review passes frame by frame; and
- the approved clips can be regenerated from the documented starting state.
