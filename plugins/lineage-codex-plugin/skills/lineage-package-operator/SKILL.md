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
lineage link-child --project demo-project --root <root-asset-id> --child <child-asset-id> --db /absolute/path/to/lineage.sqlite --confirm-write --json
```

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
5. Use `lineage link-child --confirm-write --json` only after the child asset is
   indexed and the parent/root is clear.
6. Run a negative check for unknown child IDs when changing handoff behavior.

## Boundaries

- The package does not publish to social platforms.
- The package does not install Codex plugins.
- The plugin does not own Lineage release promotion.
- `latest` is stable. `next` is for release-candidate verification.
- Do not claim unsupported app-displayed commands are packaged CLI verbs unless
  `lineage --help` and tests prove them.
