---
title: Agent claims and handoffs
description: Learn why active claims are temporary work ownership rather than a list of agent sessions.
---

## What this does

A claim gives one agent temporary ownership of a bounded Lineage target while
it performs a mutation. A handoff packages durable context so another session
can continue later.

## Claim lifecycle

```text
Inspect → Claim → Work + heartbeat → Verify → Release
```

1. **Inspect** may be read-only and does not require a claim.
2. **Claim** reserves a specific project, scope, and target.
3. **Work + heartbeat** keeps the bounded claim active during mutation.
4. **Verify** proves the requested result.
5. **Release** closes the claim after handoff.

## What appears in Agents

The **Open** filter shows active claims. **Closed** and **All** include released
claims. Abandoned claims become stale and eventually expire. Claim tokens
authorize matching work and are never displayed in the read-only Agents view.

## Common misunderstandings

- A claim is not registration of a whole Codex task or chat.
- A session can inspect without appearing in Agents.
- A released claim disappearing from **Open** does not mean its work was lost.
- Multiple sessions can work safely when their bounded targets do not conflict.

For continuation mechanics, see
[Continue work in a new agent session](../workflows/continue-new-agent-session).
