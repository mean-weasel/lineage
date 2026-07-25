---
title: Continue work in a new agent session
description: Hand off exact workspace, selection, and task context without keeping an old claim open.
---

## What this does

A handoff lets a new agent session retrieve durable context instead of relying
on copied chat history. Claims remain temporary and are released after the
bounded mutation is verified.

## Step-by-step workflow

1. Finish or pause the current bounded operation.
2. Verify any imported assets, selections, and review state.
3. Release the active claim.
4. Create a handoff packet from the current workspace or selection.
5. Start the new session and inspect the packet before claiming work.
6. Claim only the next bounded mutation target.

The new session appears in Agents only while it holds an open claim. Released
claims remain visible under **Closed** or **All**.

See [Agent claims and handoffs](../concepts/agent-claims-handoffs).
