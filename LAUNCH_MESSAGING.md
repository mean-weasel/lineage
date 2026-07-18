# Lineage Launch Messaging

- Status: Approved messaging foundation
- Last updated: 2026-07-18
- Purpose: Canonical source of truth for the landing page, launch campaign, screenshots, and product demos.

Asset production plan: `LAUNCH_ASSET_PLAN.md`

## Locked Hero Messaging

### Punchline

> **The UX where humans and agents shape visual work together.**

### One-line product summary

> **Lineage is the shared visual workspace where humans and agents create, review, and evolve creative assets together.**

These two lines are the messaging anchor. Supporting copy should clarify and prove them rather than introduce a competing product definition.

## The Core Problem

> **Chat is the right UX for directing agent-driven creative work. But it isn’t built to hold the state of that work. Lineage pairs a visual workspace for humans with a CLI for agents, giving both a shared record of every asset, iteration, and decision—during the session and after it ends.**

The problem begins inside the session. References such as “the second image” or “the third logo above” become fragile as variations accumulate, leaving humans and agents without a reliable shared understanding of which asset is which, what changed, or where the work should continue. When the session ends, that ambiguity becomes a continuity problem too.

## The Lineage Story

Lineage moves creative state out of the session and into a durable visual workspace. Assets and iterations can be organized, connected, inspected, and revisited by both humans and agents.

Humans work visually: exploring the lineage graph, selecting assets, choosing where to branch, and deciding what should evolve next. Agents work through the Lineage plugin and CLI: reading the relevant context, creating new iterations, and recording the resulting assets and relationships.

Context travels in both directions. Lineage preserves the exact creative state agents need and organizes that same state for human understanding and direction.

## The Two-Way Collaboration Loop

1. An agent creates or evolves a visual asset during a working session.
2. The agent uses Lineage's plugin and CLI tools to record the asset, its context, and its relationship to the existing work.
3. The result becomes part of a durable, navigable lineage graph instead of remaining trapped in the session.
4. A human explores the graph, compares the work, selects a node, and chooses what should be rerolled, branched, or evolved next.
5. That selection and intent return to the agent as precise context for the next session action.
6. The next result flows back into Lineage, continuing the shared history.

This loop is the central product demonstration: the agent writes the work into Lineage, and the human shapes what happens next.

### For agents: never lose the state behind the work

Every asset, path, prompt, iteration, and relationship stays available so the work can continue accurately.

### For humans: keep your creative history organized

Review and compare the history, then use selections and annotations to direct the next iteration.

The interface between them is one creative state: assets and context flow in from agent work, while human selections and annotations flow back as direction.

## Product Pillars

### Creative state that survives the session

Preserve the assets, relationships, and decisions behind the work instead of leaving them buried in a conversation.

### One creative state for humans and agents.

Lineage preserves every asset, path, prompt, relationship, and decision in a shared record—precise enough for agents to retrieve through the CLI and organized visually for humans to review and direct.

### Two-way human-agent collaboration

Agent outputs flow into the canvas, while human selections and decisions flow back into the agent session.

### Visible creative evolution

See what exists, understand how it evolved, and choose where the work should go next.

## Compact Explanations

### Primary explanation

> Lineage turns session-bound creative work into durable, visual state shared by humans and agents. Agents can record and retrieve asset lineage through the CLI, while humans can explore, select, and evolve the same work through a visual canvas.

### Memorable mechanism

> **The agent writes the work into Lineage. The human shapes what happens next.**

### Session-state message

> **Chat directs the work. Lineage holds its state.**

### Shared-context message

> **One creative state for humans and agents.**

## Category and Differentiation

Lineage is an interaction and state layer for human-agent creative work.

It is not primarily an image generator or a node-based generation pipeline. Generation tools focus on constructing or executing the process that produces an image. Lineage focuses on the shared creative state around that process: the assets, their relationships, the history of the work, the human's selections, and the context an agent needs to continue.

The visual graph is therefore not merely a diagram of a generation pipeline. It is a collaborative surface where people understand the work and communicate intent back to agents.

Avoid positioning Lineage as only:

- an asset manager;
- a prettier folder browser;
- an image-generation interface;
- a static provenance viewer; or
- a graph for its own sake.

## Landing Page Narrative

The landing page should tell this story in three sections:

1. **The promise:** The UX where humans and agents shape visual work together, demonstrated with a real, public-safe creative project.
2. **The collaboration model:** Chat directs the work, while Lineage preserves one creative state for humans and agents. Assets and context flow in; selections and annotations flow back.
3. **The proof and action:** Trace every iteration, continue from the exact asset, keep attempts and decisions attached, and install Lineage locally.

Detailed category differentiation belongs in supporting launch material rather than interrupting this primary landing-page narrative.

## Campaign Proof Requirements

Every public asset should prove at least one part of the core story. Collectively, the launch campaign should show:

- a visually rich canvas with a believable asset history;
- a human selecting an existing node as the basis for the next iteration;
- that selection becoming usable context for an agent;
- an agent creating or recording a new iteration through Lineage tooling;
- the new work appearing in the correct place in the graph;
- the ability to revisit the history after the originating session has ended; and
- only synthetic, licensed, or otherwise public-safe demo assets and data.

## Messaging Guardrails

- Lead with the human-agent creative relationship, not implementation details.
- Use "state" when explaining the mechanism, but translate it into the benefit: the work and its history survive the session.
- Describe the graph through what it lets a person understand or do.
- Treat the plugin and CLI as the agent's native interface, paired with the canvas as the human's native interface.
- Emphasize two-way communication. Lineage is not only a destination for agent output; human actions in Lineage inform subsequent agent work.
- Keep claims grounded in demonstrable product behavior.
- Do not use private media, customer content, credentials, campaign data, real presigned URLs, or local runtime databases in public examples.

## Working Vocabulary

Prefer:

- shared visual workspace;
- human-agent creative work;
- durable creative state;
- visual lineage;
- create, review, and evolve;
- select, branch, reroll, and continue;
- context travels in both directions; and
- the history behind the work.

Use carefully:

- workflow, when the intended meaning is collaboration rather than a generation pipeline;
- provenance, because it is accurate but less immediately accessible than history or lineage;
- orchestration, because it can obscure the human creative experience; and
- asset management, because it understates the interactive and agent-native aspects of the product.
