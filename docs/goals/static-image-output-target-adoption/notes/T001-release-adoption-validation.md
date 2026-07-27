# T001 Release and Adoption Validation

Task: `T001`
Kind: `judge`
Status: `current`

## Decision

Approved with board amendments. The merged feature is ready for a stable `0.1.27` release candidate, but execution must first move into a fresh dedicated worktree from current GitHub `origin/main`.

## Current authoritative identity

- Repository: `git@github.com:mean-weasel/lineage.git`
- Current GitHub main: `4fe7e34a0c75019d11cc202b82446de9aa07ae30`
- Main subject: `Merge pull request #119 from mean-weasel/codex/static-image-output-target-locks`
- PR #119 head: `8ad9ee9a13e0928499200af08712307ec8b1ee58`
- The feature worktree's product tree is byte-identical to current `origin/main`, but its branch is already merged and is not the execution surface for this goal.
- The primary checkout is on `codex/documentation-hub-design` with unrelated untracked `.superpowers/` state and must remain untouched.
- Fresh execution target:
  - worktree: `/Users/neonwatty/Desktop/lineage/.worktrees/static-image-output-target-adoption`
  - branch: `codex/static-image-output-target-adoption`
  - base: exact `origin/main` commit `4fe7e34a0c75019d11cc202b82446de9aa07ae30`
- Neither the target branch nor path currently exists locally or remotely.

## Release state

- Root Lineage package: `0.1.26`
- Plugin package/manifest/`lineage.version`: `0.1.26`
- Latest immutable annotated tag and GitHub Release: `v0.1.26`
- npm `latest`: `0.1.26`
- npm `next`: `0.1.21-rc.3`
- No open pull requests exist.
- All eight checks attached to merge commit `4fe7e34` completed successfully, including Application, Documentation, Landing, Pages, plugin-installer, and aggregate CI.
- The next stable version is `0.1.27`; the exact prospective tag is `v0.1.27`.
- A prerelease is not required for the already-merged feature because its full local, PR, and post-merge oracle is green. If main or release state changes before publication, revalidate rather than reusing this conclusion.

## Release authority and order

1. T013 creates and verifies the fresh execution worktree and migrates only GoalBuddy control files.
2. T002 prepares `0.1.27` release metadata and public documentation without publishing or tagging.
3. T003 commits/pushes the reviewed release branch, opens and merges the PR only after green checks, then creates the one new immutable annotated `v0.1.27` tag from reviewed main and verifies the release workflow.
4. T004 dogfoods the released stable package through the three required scenarios.
5. T005/T006 disposition and fix only evidence-backed adoption friction.
6. T007-T010 design, implement, and prove the provider-neutral agent generation bridge.
7. T011/T012 prepare and publish a subsequent stable release only if post-`0.1.27` product changes exist.
8. T999 audits the released final behavior and deferred-scope discipline.

The user's existing `/goal` authorization covers the release sequence described by the charter. No additional approval is needed unless the exact target version, tag, main commit, npm/GitHub identity, or release workflow authority no longer matches the recorded receipt.

## Exact T002 Worker package

Objective:

`Prepare the stable 0.1.27 release metadata and public documentation for the merged static-image output-target feature without publishing, tagging, merging, or mutating external release state.`

Allowed files:

- `package.json`
- `package-lock.json`
- `plugins/lineage-codex-plugin/package.json`
- `plugins/lineage-codex-plugin/.codex-plugin/plugin.json`
- `CHANGELOG.md`
- `docs-site/docs-review.json`
- `docs-site/src/content/docs/workflows/generate-import-variations.md`
- `docs-site/src/content/docs/integrations/image-generation.md`
- `docs-site/src/content/docs/reference/cli.md`

Verification:

- `GITHUB_REF_NAME=v0.1.27 node scripts/tag-release-plan.mjs`
- `npm run release:policy:test`
- `npm run docs:check`
- `npm run plugin:smoke`
- `npm run plugin:codex-smoke`
- `npm run public:readiness`
- `npm run package:smoke`
- `npm run ci`
- `git diff --check`

Stop conditions:

- Fresh-worktree root, branch, origin, or base no longer matches T013.
- Current GitHub main is not `4fe7e34a0c75019d11cc202b82446de9aa07ae30`.
- `v0.1.27`, npm `0.1.27`, a `0.1.27` GitHub Release, or a conflicting release PR appears.
- Any root/plugin/manifest/lock/docs-review version cannot be made exactly `0.1.27`.
- The release requires a file outside the exact allowed scope.
- A new user change overlaps an allowed file.
- The same verification failure remains unexplained after two attempts.

## Top risks

1. **Release collision:** another version/tag lands after T001. Re-read main, tags, npm, GitHub Releases, and open PRs before T002 and every T003 write.
2. **Documentation-only gate theater:** merely changing `docs-review.json` would satisfy shape but not user impact. T002 must update the workflow, integration, and CLI pages for the new locked-target behavior.
3. **Post-release delta drift:** dogfood and agent integration occur after `0.1.27`; if they change product files, T011/T012 must publish the final behavior rather than declaring a local-only adoption win.
