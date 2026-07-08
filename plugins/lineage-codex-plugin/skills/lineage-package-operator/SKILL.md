---
name: lineage-package-operator
description: Use when an agent needs to install, start, inspect, or continue work through the public @mean-weasel/lineage package.
---

# Lineage Package Operator

Use the public `@mean-weasel/lineage` package for Lineage app and CLI work. Do
not assume a source checkout is available.

## Install And Channels

Use `latest` for stable dogfooding and daily work:

```bash
npm install -g @mean-weasel/lineage@latest
lineage --version
```

Use `next` only when intentionally verifying a release candidate before
promotion:

```bash
npm install -g @mean-weasel/lineage@next
lineage --version
```

If a global install is not appropriate, run the package directly with npm:

```bash
npx @mean-weasel/lineage@latest --version
```

Agent guidance belongs to the plugin channel; the Lineage package owns app and
CLI runtime behavior.

## Agent Handoff Commands

Treat copied handoff commands as executable contracts. If a command copied from
the app fails, file or fix the package issue before promoting a release.

Supported packaged handoff verbs:

```bash
lineage next --project demo-project --root <root-asset-id> --db /absolute/path/to/lineage.sqlite --json
lineage brief --project demo-project --root <root-asset-id> --db /absolute/path/to/lineage.sqlite --json
lineage inspect --project demo-project --asset-id <asset-id> --db /absolute/path/to/lineage.sqlite --json
lineage agent claim --project demo-project --scope lineage_workspace --target demo-project:lineage-workspace:<root-asset-id> --agent-name "Codex thread 123" --ttl 20m --db /absolute/path/to/lineage.sqlite --json
lineage agent heartbeat --claim-token "$LINEAGE_CLAIM_TOKEN" --db /absolute/path/to/lineage.sqlite --json
lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --db /absolute/path/to/lineage.sqlite --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write --json
lineage reroll mark --project demo-project --root <root-asset-id> --target <target-asset-id> --notes "Fix distorted text" --db /absolute/path/to/lineage.sqlite --confirm-write --json
lineage reroll list --project demo-project --root <root-asset-id> --db /absolute/path/to/lineage.sqlite --json
lineage reroll plan --project demo-project --root <root-asset-id> --target <target-asset-id> --prompt "Regenerate with clean readable text" --db /absolute/path/to/lineage.sqlite --json
lineage reroll import --project demo-project --job-id <job-id> --file <.asset-scratch-file> --db /absolute/path/to/lineage.sqlite --confirm-write --json
lineage reroll cancel --project demo-project --root <root-asset-id> --target <target-asset-id> --db /absolute/path/to/lineage.sqlite --confirm-write --json
lineage agent release --claim-token "$LINEAGE_CLAIM_TOKEN" --db /absolute/path/to/lineage.sqlite --json
```

Use `project_channel` claims only for rare, intentional ownership of a whole
project/channel lane. Prefer `lineage_workspace` or `content_post` for normal
handoffs.

The same verbs may be run through npm without a global install:

```bash
npx @mean-weasel/lineage@latest next --project demo-project --root <root-asset-id> --db /absolute/path/to/lineage.sqlite --json
```

Never use stale doubled namespace commands with an unscoped npm package followed
by a second `lineage` word.

## Safe Operating Pattern

1. Verify the installed package with `lineage --version`.
2. Start Lineage with an explicit `--db` when the work must survive handoff.
3. Use `lineage brief --json` to collect the agent prompt and executable
   commands.
4. Use `lineage next --json` and `lineage inspect --json` before generating or
   linking work.
5. Use `lineage agent claim --scope lineage_workspace --json`, export the
   returned raw token as `LINEAGE_CLAIM_TOKEN`, and heartbeat while working.
6. Use `lineage link-child --claim-token "$LINEAGE_CLAIM_TOKEN" --confirm-write
   --json` only to create a new visible child variation, after the child asset
   is indexed and the parent/root is clear. Do not use it for re-rolls.
7. For re-rolls, use `lineage reroll mark --confirm-write --json`, then
   `lineage reroll plan --json`, and import exactly one output with
   `lineage reroll import --confirm-write --json` so the result becomes an
   attempt instead of a visible child edge.
8. Release the claim with `lineage agent release --claim-token
   "$LINEAGE_CLAIM_TOKEN" --json` before handing off or stopping.
9. Run a negative check for unknown child IDs when changing handoff behavior.

## Starting The App From Codex

Prefer a real foreground terminal for human-driven daily use:

```bash
lineage start --host lineage.localhost
```

When starting Lineage from the Codex app or another agent command session, do
not rely on `lineage start &` or `nohup` alone. Tool-owned background processes
may be cleaned up after the command returns. Use the repo Makefile detached
targets when a checkout is available:

```bash
make start-prod-bg
make status-prod
make logs-prod
make stop-prod
```

Those targets prefer a detached `tmux` session when `tmux` is installed, and
fall back to PID/log files otherwise. `make start-prod` remains foreground.
Keep launchd or other OS service managers as explicit, platform-specific paths;
macOS can block LaunchAgents with `EX_CONFIG`/`Operation not permitted` until
the user approves or repairs the service.

## Boundaries

- The package does not publish to social platforms.
- The package does not install Codex plugins.
- The plugin does not own Lineage release promotion.
- `latest` is stable. `next` is for release-candidate verification.
- Do not claim unsupported app-displayed commands are packaged CLI verbs unless
  `lineage --help` and tests prove them.
