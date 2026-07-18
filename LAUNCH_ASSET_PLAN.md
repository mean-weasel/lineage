# Lineage Launch Asset Plan

- Status: Working production plan
- Last updated: 2026-07-18
- Messaging source: `LAUNCH_MESSAGING.md`

Execution script: `LAUNCH_RECORDING_RUNBOOK.md`

## Objective

Create a coherent set of screenshots and short recordings that prove Lineage is the shared UX where humans and agents shape visual work together.

The campaign must show more than a beautiful graph. Its defining proof is the two-way collaboration loop:

> A human selects where to continue. Codex receives the right context. The agent evolves and records the work. The result returns to the lineage graph.

## Production Principles

- Record real Lineage behavior and real repo-local plugin behavior.
- Show Codex as the agent's working interface and Lineage as the human's visual interface.
- Give each visual asset one clear product claim to prove.
- Use one coherent, public-safe demo project across the landing page, social posts, and walkthroughs.
- Prefer deterministic setup and repeatable interactions over improvised demo state.
- Keep raw capture disposable and outside the public package boundary until reviewed.
- Do not expose private media, customer content, campaign data, credentials, tokens, real presigned URLs, unrelated Codex tasks, local database paths, or sensitive local filesystem details.

## Priority Asset Inventory

### Tier 1: Launch essentials

1. **Hero canvas still** — the complete, beautifully filled demo board.
2. **Canonical two-way loop** — a 15–25 second silent sequence joining the key micro-clips.
3. **Narrated walkthrough** — a 45–60 second explanation of the full human-agent loop.
4. **Human/agent split still** — Lineage canvas paired with a real Codex interaction.
5. **Five-slide social carousel** — problem, shared state, human UX, agent UX, two-way result.

### Tier 2: Modular launch media

1. Six to eight 3–6 second feature clips.
2. A selected-node and ancestry still.
3. A branching and attempt-stack still.
4. A before/after graph pair showing an agent-authored iteration arriving.
5. A 10–15 second social teaser.
6. Landing-page loops for the product-pillar sections.

### Tier 3: Extended proof

1. A two- to three-minute product tour.
2. A fresh-session retrieval demonstration.
3. A plugin/CLI close-up for technical audiences.
4. Alternate aspect-ratio exports for individual social platforms.

## Demo Board Brief

Use a fictional product campaign rather than a pure image-generation showcase. The board should demonstrate the evolution of a body of visual work, not resemble a generation pipeline.

### Selected campaign: The Swissifier

Use the checksum-pinned synthetic Swissifier rich-demo media and graph as the campaign foundation. Create a launch-specific capture seed or presentation layer that improves titles, layout, human decisions, and recording start states without modifying the QA fixture relied on by tests.

The launch presentation should be titled **The Swissifier — Launch Campaign**. Its visual story should move from restrained Swiss product layouts into selected cosmic and blacklight explorations, while preserving clear before/after and re-roll paths for the human-agent demonstrations.

The project should include:

- a concise creative brief;
- reference and moodboard assets;
- two or three early visual directions;
- a clearly selected hero direction;
- color, composition, and format explorations;
- reroll attempts and visible branching;
- human selection or review decisions;
- a final hero asset; and
- derivative poster, social, and supporting campaign assets.

The full-canvas composition should read from origin to exploration to selection to final campaign system. It should be visually rich at a glance while remaining understandable when individual nodes are opened.

## Micro-Clip Shot List

### CLIP-01 — Board reveal

- **Action:** Open on a strong detail, then smoothly reveal the complete canvas.
- **Claim:** Visual work has structure and history.
- **Length:** 3–5 seconds.
- **Primary use:** Hero loop, launch teaser, opening of the walkthrough.
- **Automation:** Browser automation is preferred.

### CLIP-02 — Trace an asset

- **Action:** Select a final asset and reveal or follow its ancestors.
- **Claim:** See how the work evolved.
- **Length:** 3–5 seconds.
- **Primary use:** Landing-page lineage/history section.
- **Automation:** Browser automation is preferred.

### CLIP-03 — Choose the next base

- **Action:** Select an earlier node and choose it as the basis for the next iteration.
- **Claim:** The human shapes what happens next.
- **Length:** 3–5 seconds.
- **Primary use:** Beginning of the canonical two-way loop.
- **Automation:** Browser automation can prepare and perform the selection; the final take should preserve natural pointer movement.

### CLIP-04 — Context enters Codex

- **Action:** Show the Codex task receiving the selected asset and lineage context through the plugin.
- **Claim:** A canvas decision becomes precise agent context.
- **Length:** 4–6 seconds.
- **Primary use:** Human/agent transition in the canonical loop.
- **Automation:** Supervised Codex take. Prepare the task and exact plugin action deterministically, then perform the visible Codex interaction manually.

### CLIP-05 — Agent records an iteration

- **Action:** In Codex, the agent creates or attaches the next iteration through Lineage tooling.
- **Claim:** The agent writes the work into Lineage.
- **Length:** 4–6 seconds.
- **Primary use:** Agent-side proof in the canonical loop.
- **Automation:** Supervised Codex take with deterministic CLI/plugin inputs and a known expected result.

### CLIP-06 — Canvas updates

- **Action:** Return to Lineage as the new asset appears in the correct branch.
- **Claim:** Agent work returns to the human's visual workspace.
- **Length:** 3–5 seconds.
- **Primary use:** Resolution of the canonical loop.
- **Automation:** Browser automation is preferred after deterministic state creation.

### CLIP-07 — Compare attempts

- **Action:** Move between attempts or compare closely related versions.
- **Claim:** Iteration remains organized and reviewable.
- **Length:** 3–5 seconds.
- **Primary use:** Feature loop and social clip.
- **Automation:** Browser automation is preferred.

### CLIP-08 — Continue in a new session

- **Action:** In a fresh Codex task, retrieve the selected asset and its relevant history from Lineage.
- **Claim:** Creative state survives the originating session.
- **Length:** 4–6 seconds.
- **Primary use:** Extended proof and technical walkthrough.
- **Automation:** Supervised Codex take with a prepared fresh task.

## Canonical Two-Way Loop

Join CLIP-03 through CLIP-06 into one understandable 15–25 second sequence:

1. A human selects an earlier asset in Lineage.
2. The selection becomes context in Codex.
3. The agent evolves or records the next asset.
4. The new work appears in the correct place in Lineage.

The sequence should remain understandable without narration. Minimal on-screen copy can reinforce the causal flow:

1. **Choose where to continue.**
2. **Bring the right context into Codex.**
3. **Evolve the work with an agent.**
4. **Keep the result and its history in Lineage.**

## Narrated Walkthrough Structure

Target length: 45–60 seconds.

1. Reveal the completed demo board.
2. Select a compelling final asset and trace its history.
3. Return to an earlier point and choose a new direction.
4. Show Codex receiving the exact selected context through the Lineage plugin.
5. Ask for a specific evolution of that asset.
6. Show the agent recording the result and relationship.
7. Return to Lineage and reveal the new branch.
8. Compare the new result with the existing attempts.
9. Close on: **The agent writes the work into Lineage. The human shapes what happens next.**

## Still Image Set

### STILL-01 — Hero canvas

Show the full creative system with enough node detail to feel real. Avoid a zoom level that turns assets into indistinct tiles.

### STILL-02 — Selected lineage

Show one selected asset, its ancestry, and the surrounding alternatives. This should make "how it evolved" immediately legible.

### STILL-03 — Attempts and branches

Show multiple related explorations with a clear chosen direction.

### STILL-04 — Human and agent interfaces

Pair the Lineage canvas with a clean Codex task showing a concise Lineage plugin interaction. The visual should communicate two native interfaces acting on shared state.

### STILL-05 — Before and after

Use matched framing to show the graph immediately before and after an agent-authored iteration is recorded.

## Social Carousel

1. **Creative work should not disappear when the session ends.**
2. **Lineage turns that work into durable, visual state.**
3. **Humans explore, select, and evolve the work on a visual canvas.**
4. **Agents read and write the same lineage through purpose-built tools.**
5. **The agent writes the work into Lineage. The human shapes what happens next.**

## Capture Architecture

Use a hybrid approach. Each layer should do the work it can perform reliably.

### 1. Deterministic state preparation

Use Lineage's CLI, API, fixtures, or purpose-built seed script to create the exact demo board and expected pre-shot state. The current repository already has Playwright, an E2E profile runner, and a rich demo seed that can inform this harness. Public launch assets should use a reviewed, purpose-built public-safe seed rather than assuming a QA fixture is suitable for publication.

Before starting any Lineage runtime, choose exactly one channel and matching named profile, then satisfy the repository's runtime, profile, database, and service identity gate. Never record against an unidentified database or mixed runtime channel.

### 2. Automated Lineage screenshots and motion

Use Playwright for repeatable browser state, viewport, navigation, selections, and screenshots. For motion clips, use either Playwright video recording or deterministic browser actions captured by the selected recording utility.

Benefits:

- repeatable framing and timing;
- exact selectors rather than coordinate guesses;
- consistent demo state across retakes;
- easy regeneration after UI changes; and
- automated assertions that the intended node, asset, or relationship is visible before capture.

### 3. Supervised Codex shots

Computer Use cannot directly operate the Codex app itself. The current Computer Use runtime explicitly refuses control of `com.openai.codex`, so visible Codex interactions cannot be fully self-driven from the same Codex task.

For Codex-visible shots:

- prepare a dedicated, public-safe Codex task;
- keep only the relevant task and interaction visible;
- prewrite the exact short prompt and expected plugin action;
- use deterministic Lineage state and a rehearsed result;
- perform the visible Codex interaction manually while the capture utility records; and
- use automation before and after the Codex interaction to prepare and verify the resulting Lineage state.

This preserves a real Codex workflow without faking the agent interface.

### 4. Capture and encoding utilities

The current machine exposes macOS screen capture, QuickTime Player, and `ffmpeg`. AppShot is not currently detectable as an installed application or CLI, so it should remain an optional capture path until its exact product, installation, and automation interface are confirmed.

Potential responsibilities:

- **QuickTime or another recorder:** supervised full-window or region recordings.
- **Playwright:** browser-only screenshots, deterministic interactions, and optional browser video.
- **Computer Use:** operate supported capture utilities and supported local apps, re-reading accessibility state after each interaction.
- **ffmpeg:** trim, crop, normalize, concatenate, remove idle frames, and export aspect-ratio variants.
- **AppShot:** optional framing or device-presentation layer if its capabilities and installation are confirmed.

## Capture Formats

Capture a high-resolution master before making platform crops.

- Master motion: 2560×1440 or the best practical 16:9 equivalent.
- Master stills: lossless PNG at the capture viewport's native resolution.
- Landing page: 16:9 and responsive crops.
- Social feed: 4:5 and 1:1.
- Short-form video: 9:16 only when the interface remains legible.
- Frame rate: 30 fps is sufficient for UI demonstrations; use 60 fps if smooth canvas movement materially improves the result.
- Raw captures: `.asset-scratch/launch-captures/` or another ignored working directory.
- Approved public exports: choose an explicit tracked destination only after privacy and visual review.

## Repeatable Shot Contract

Every shot should have a small contract containing:

- shot ID and product claim;
- required runtime channel and named profile;
- seed or preparation command;
- starting workspace and selected node;
- viewport and window geometry;
- exact interaction sequence;
- expected visible end state;
- target duration and crop variants;
- privacy checklist;
- output filename; and
- approval status.

Example filename pattern:

`lineage-clip-03-choose-next-base-v01-16x9.mov`

## Iteration Loop

1. **Specify:** Define the claim, start state, interaction, and expected end frame.
2. **Prepare:** Rebuild the public-safe board and verify runtime/profile identity.
3. **Dry run:** Execute the interaction without recording and assert the expected state.
4. **Capture:** Record one clean master take.
5. **Render:** Produce a trimmed clip, poster frame, and contact sheet.
6. **Review:** Judge legibility, pacing, cursor movement, privacy, and whether the claim is obvious without narration.
7. **Annotate:** Record precise retake notes against the shot ID.
8. **Retake:** Reset to the deterministic start state and capture the next version.
9. **Approve:** Promote only reviewed exports into the public asset set.

## Recommended Production Order

1. Approve the Swissifier launch presentation and final canvas composition.
2. Build and verify the public-safe deterministic board.
3. Capture STILL-01 and CLIP-01 to validate that the board is visually strong.
4. Rehearse and capture the canonical CLIP-03 through CLIP-06 loop.
5. Assemble the 15–25 second silent sequence.
6. Capture the remaining modular clips and stills.
7. Record narration and assemble the 45–60 second walkthrough.
8. Export social and landing-page variants.
9. Run a final messaging, privacy, runtime-identity, and visual-quality review.

## Immediate Decisions

Before implementation, decide:

1. The channel and named profile used for public capture.
2. The exact meaning and intended role of AppShot in the toolchain.
3. Which two social aspect ratios are required for launch week.
4. Whether the first walkthrough uses narration, captions, or both.
