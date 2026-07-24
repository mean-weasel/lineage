# Lineage Documentation Hub Design

**Status:** Approved

**Date:** 2026-07-24

**Scope:** Public documentation hub, landing-page entry points, and documentation freshness controls

## Summary

Lineage will add a public documentation hub for evaluators, new users, active
operators, and integration users. The hub will be authored in plain Markdown,
built with Astro Starlight, and deployed under `/lineage/docs/` alongside the
existing React/Vite landing page.

The documentation will explain both visible workflows and the product semantics
that are easy to misunderstand. Initial priority topics include projects,
workspaces, assets, branches, re-rolls, attempt history, current attempts,
next-variation selections, agent handoffs, and the temporary agent-claim
lifecycle.

Integration documentation will lead with generic capabilities and name the
providers Lineage currently supports. It will use explicit maturity labels so
the public site does not present preview or planned behavior as generally
available.

Documentation freshness will become an explicit pull-request and release
responsibility. A release must not publish until its documentation impact has
been reviewed, even when the review concludes that no documentation changes are
necessary. A post-release issue will provide a second check against the
published package and deployed site.

## Goals

- Give prospective users a clear explanation of what Lineage does.
- Help first-time users install Lineage and understand its core mental model.
- Document the end-to-end creative workflows exposed by the application.
- Explain agent coordination without implying that the Agents view is a live
  list of Codex sessions.
- Describe generic integration capabilities while listing current providers and
  maturity honestly.
- Keep documentation changes reviewable as ordinary repository Markdown.
- Make stale, incomplete, or unsafe documentation fail CI and release checks.
- Deploy the hub with the existing GitHub Pages site without replacing or
  rewriting the current landing page.

## Non-goals

- Rewriting the existing landing page in Astro.
- Using MDX for the initial documentation hub.
- Building an in-application help center in this tranche.
- Generating all prose from source code or schemas.
- Publishing private project examples, customer content, credentials, local
  database contents, or real presigned URLs.
- Advertising live scheduling or other provider behavior that is intentionally
  disabled.
- Replacing the README as the package and source-installation reference.

## Audiences and Entry Paths

The documentation homepage will provide four clear entry paths:

1. **Evaluate Lineage** — understand the product, collaboration model, and
   supported capabilities.
2. **Get started** — install Lineage, create a named profile, start the service,
   and create or load a first workspace.
3. **Use Lineage** — learn the visual concepts and creative workflows.
4. **Operate and integrate** — configure providers, understand local data,
   diagnose runtime identity, and use the CLI safely.

The landing-page navigation will add a primary **Documentation** link. Relevant
landing-page feature cards may link directly to the corresponding concept pages
instead of forcing every visitor through the hub homepage.

## Information Architecture

```text
Documentation
├── Start here
│   ├── What is Lineage?
│   ├── Installation and first run
│   ├── Create your first workspace
│   └── Load the example projects
├── Core concepts
│   ├── Projects, workspaces, and assets
│   ├── Branches versus re-rolls
│   ├── Attempts and the current version
│   ├── Selections and next variations
│   └── Agent claims and handoffs
├── Workflows
│   ├── Create and grow a lineage
│   ├── Generate and import variations
│   ├── Review and approve assets
│   ├── Restore an earlier attempt
│   ├── Back up approved assets
│   ├── Work with content batches
│   └── Continue work in a new agent session
├── Integrations
│   ├── Integration overview and maturity
│   ├── Cloud storage
│   ├── Social scheduling
│   └── Image generation
├── Operating Lineage
│   ├── Local-first data and privacy
│   ├── Stable, preview, and development channels
│   ├── Profiles and database identity
│   ├── Backup and recovery
│   └── Troubleshooting
└── Reference
    ├── Interface guide
    ├── Settings reference
    ├── CLI commands
    ├── Terminology
    └── Release notes
```

The hierarchy is workflow-first. The interface guide may describe the Lineage,
Review, Assets, Agents, Settings, Ledger, Content Batches, and Backup Queue
views, but those application tabs will not determine the primary information
architecture.

## Page Conventions

Concept and workflow pages will use a consistent plain-language sequence:

1. What this does
2. When to use it
3. How it works
4. Step-by-step workflow
5. What happens behind the scenes
6. Common misunderstandings
7. Limitations and safety behavior
8. Related documentation

Pages may omit a section only when it genuinely does not apply. Headings should
remain predictable enough that readers can scan between related workflows.

Every page will include ordinary Markdown frontmatter with at least a title and
description. Pages that describe a capability will also include a maturity
value. Provider-specific pages or sections will list current providers.

Example:

```yaml
---
title: Social scheduling
description: Prepare reviewed Lineage content for an external scheduler.
capability: Social scheduling
maturity: Preview
currentProviders:
  - Buffer
---
```

Allowed maturity values are:

- **Available** — supported for the documented use in a released package.
- **Preview** — usable within documented limitations but not presented as a
  complete live workflow.
- **Planned** — product direction only; not an instruction to expect current
  functionality.

The initial integration pages must reflect the implementation accurately:

- **Cloud storage** — generic cloud-storage capability; Amazon S3 is the current
  provider. Configuration is explicit, and destructive cloud behavior remains
  safety-gated.
- **Social scheduling** — generic social-scheduling capability; Buffer is the
  current provider. The current workflow prepares and validates dry-run payloads;
  live posting is not advertised as available.
- **Image generation** — generic image-generation capability; Codex handoff is
  the current provider workflow. It creates generation handoffs and durable
  import receipts rather than embedding a model service directly in Lineage.

## Agent Claims Documentation

The agent-claims page is an initial high-priority page because the current
Agents label can be mistaken for session discovery.

The page will show this lifecycle:

```text
Inspect → Claim → Work + heartbeat → Verify → Release
```

It must explain:

- A claim is temporary ownership of a bounded Lineage target.
- A claim is not registration of an entire Codex thread or session.
- Read-only inspection can occur without a claim.
- Agents normally acquire a claim before a bounded mutation, heartbeat while
  working, verify the result, and release the claim after handoff.
- Active claims appear under the Agents view's Open filter.
- Released claims appear under Closed or All.
- Abandoned claims become stale and eventually expire.
- Claim tokens authorize matching work and are not displayed by the read-only
  Agents view.

## Technical Architecture

The landing page remains in its current React/Vite implementation:

```text
src/web/landing/
```

The documentation hub will be a separate Starlight application:

```text
docs-site/
├── astro.config.mjs
├── docs-review.json
├── public/
└── src/
    └── content/
        └── docs/
            ├── index.md
            ├── start-here/
            ├── concepts/
            ├── workflows/
            ├── integrations/
            ├── operations/
            └── reference/
```

The initial hub will use Markdown only. Starlight will render the Markdown into
static HTML and provide routing, sidebar navigation, search, table of contents,
responsive behavior, accessible code blocks, and not-found handling. The design
does not require MDX or custom interactive documentation components.

The GitHub Pages artifact will expose:

```text
/lineage/       existing landing page
/lineage/docs/  documentation hub
```

The Pages build will:

1. Build the existing React/Vite landing page.
2. Build Starlight with the GitHub Pages repository base path.
3. Merge the documentation output under `docs/`.
4. Refuse collisions or missing expected entry points.
5. Validate the combined artifact before deployment.

The landing and documentation builds remain independently testable. A
documentation-only change should not need to run application browser suites that
cannot be affected, while aggregate CI and release checks still validate the
combined public artifact.

## Provider and Maturity Consistency

Provider and maturity claims will remain readable in Markdown. Implementation
will extract stable, public-safe adapter metadata into
`src/shared/adapterCatalog.ts`. The application Settings definitions and the
documentation validator will both consume this catalog.

The catalog will contain capability IDs, provider IDs, public labels, and
documentation maturity. It will not contain credentials, secret references,
project configuration, or provider execution logic. The documentation validator
will compare Markdown frontmatter with these stable identifiers.

The check must fail when:

- A documented current provider has no corresponding supported adapter.
- An application adapter is omitted from the integration overview.
- A maturity value is outside the allowed vocabulary.
- A page describes live behavior that the provider implementation explicitly
  rejects.

The validation should compare stable identifiers rather than prose. Human copy
can evolve without turning every wording change into a schema change.

## Documentation Freshness Contract

### Pull requests

The repository will add a pull-request template requiring one explicit
documentation-impact declaration:

- Documentation updated
- Documentation reviewed and already accurate
- No user-facing documentation impact, with a short reason

This is a review aid, not sufficient release evidence on its own.

### Release review receipt

A central `docs-site/docs-review.json` receipt will record the documentation
review for the exact package version. A central receipt avoids meaningless
edits to every page on every release.

Example:

```json
{
  "reviewedFor": "0.1.23",
  "result": "updated",
  "areas": [
    "concepts",
    "workflows",
    "integrations",
    "operations",
    "reference"
  ]
}
```

The result vocabulary will distinguish at least `updated` and `no-changes`.
The release gate will require the receipt's `reviewedFor` value to equal the
exact root package version. A review can conclude that no page changes are
required, but the review cannot be implicit.

### Post-release follow-up

After a successful release, automation will open a documentation verification
issue for checks that benefit from the published package and deployed site:

- Verify representative screenshots and examples.
- Confirm capability maturity and provider labels.
- Test landing-page deep links.
- Test the deployed hub on desktop and mobile.
- Record whether follow-up changes are necessary.

This issue is a secondary safety net. It does not replace the pre-release review.

## Validation and CI

A `docs:check` command will provide the documentation-specific gate. It will
cover:

- Markdown frontmatter schema validation
- Navigation completeness
- Internal-link and anchor validation
- Allowed capability-maturity values
- Provider consistency with application support
- Release-review receipt validation when an exact release version is required
- Public-readiness scanning for private or unsafe content
- A successful static documentation build

Landing and combined-site checks will additionally cover:

- The landing page exposes its Documentation link.
- The documentation hub exists at the expected Pages subpath.
- Neither build overwrites the other's files.
- Representative pages render and navigate correctly.
- Search can find a known concept such as agent claims.
- Sidebar and content navigation remain usable at mobile widths.
- Unknown documentation routes produce the expected not-found behavior.

The existing public-readiness boundary will expand to include documentation
Markdown and public media. Only synthetic or intentionally public examples may
be committed.

## Failure Behavior

Documentation failures will fail closed:

- Missing navigation targets fail the documentation build or link check.
- Invalid frontmatter fails schema validation.
- Unknown maturity states fail validation.
- Unsupported-provider claims fail provider consistency checks.
- A stale or missing release-review receipt blocks release preparation.
- Unsafe content detected by public-readiness checks blocks CI and release.
- A missing documentation build prevents replacement of the existing Pages
  artifact.
- Output collisions prevent the combined artifact from being assembled.

No documentation build or validation command may require a production profile,
read a live SQLite database, contact a configured provider, or expose external
credentials.

## Acceptance Criteria

The design is implemented when:

1. The landing page has a tested Documentation entry point.
2. `/lineage/docs/` serves the Starlight hub from the same Pages deployment.
3. The approved information architecture is represented in navigation.
4. Initial high-priority concept and integration pages exist in plain Markdown.
5. Agent claims are documented as temporary bounded ownership, not session
   discovery.
6. Integration pages lead with generic capabilities, list current providers,
   and display accurate maturity.
7. Documentation checks validate frontmatter, navigation, links, providers,
   maturity, public safety, and static output.
8. The exact-version documentation review receipt is required before release.
9. A successful release creates the published-site follow-up issue.
10. Aggregate CI proves both the landing page and documentation hub deploy
    without artifact collisions.

## Rollout

Implementation should proceed in one coherent documentation-platform tranche:

1. Add the Starlight skeleton and Pages artifact merge.
2. Add navigation and the initial Markdown pages.
3. Add landing-page links.
4. Add documentation validation and public-readiness coverage.
5. Add PR and release freshness controls.
6. Add browser proof for the combined site.

The first content tranche should prioritize the concepts most likely to cause
incorrect expectations: agent claims, branching versus re-rolls, attempt
history, selections, provider maturity, and local-first data behavior.
