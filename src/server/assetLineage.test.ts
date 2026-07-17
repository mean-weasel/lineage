import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageTestProfile } from '../test/lineageTestProfile';
import { defaultProject, repoRoot } from './assetCore';
import { lineageDb } from './assetLineageDb';
import { fileSha256 } from './localReview';
import {
  getLineageSnapshot,
  getLineageNextAsset,
  getLineageChildren,
  getLineageAttempts,
  indexLineageAssets,
  linkLineageAssets,
  clearLineageRerollRequest,
  listLineageRerollRequests,
  markLineageRerollRequest,
  promoteLineageAttempt,
  recordLineageRerollAttempt,
  updateAssetReview,
  updateLineageLayout,
  updateSelectedAsset,
} from './assetLineage';
import { getLineageBrief, linkSelectedLineageChild } from './assetLineageHandoff';
import { claimLineageTask, listLineageTasks } from './assetLineageTasks';
import { createAgentClaim } from './agentClaims';
import { createLineageWorkspace, lineageWorkspaceId } from './assetLineageWorkspaces';

const require = createRequire(import.meta.url);
const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage');
const dbFile = join(scratchDir, 'asset-lineage.sqlite');
function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  mkdirSync(scratchDir, { recursive: true });
  const parent = join(scratchDir, 'demo-linkedin-lineage-parent.png');
  const child = join(scratchDir, 'demo-linkedin-lineage-child.png');
  const variation = join(scratchDir, 'demo-linkedin-lineage-variation.png');
  const alternate = join(scratchDir, 'demo-linkedin-lineage-alternate.png');
  writeFileSync(parent, Buffer.from('lineage-parent'));
  writeFileSync(child, Buffer.from('lineage-child'));
  writeFileSync(variation, Buffer.from('lineage-variation'));
  writeFileSync(alternate, Buffer.from('lineage-alternate'));
  return {
    alternate, alternateId: localId(alternate),
    child, childId: localId(child),
    parent, parentId: localId(parent),
    variation, variationId: localId(variation),
  };
}

function countRows(table: string, where = ''): number {
  const database = lineageDb();
  try {
    const row = database.prepare(`select count(*) count from ${table} ${where}`).get() as { count: number };
    return Number(row.count);
  } finally {
    database.close();
  }
}

function seedRerollAttempts() {
  const files = seedFiles();
  indexLineageAssets(defaultProject);
  recordLineageRerollAttempt(defaultProject, {
    rootAssetId: files.parentId,
    nodeAssetId: files.parentId,
    assetId: files.variationId,
    prompt: 'Try a cleaner second version.',
    generationJobId: 'job-v2',
    filePath: '.asset-scratch/vitest-lineage/demo-linkedin-lineage-variation.png',
    checksumSha256: fileSha256(files.variation),
    confirmWrite: true,
  });
  recordLineageRerollAttempt(defaultProject, {
    rootAssetId: files.parentId,
    nodeAssetId: files.parentId,
    assetId: files.alternateId,
    prompt: 'Try a cleaner third version.',
    generationJobId: 'job-v3',
    filePath: '.asset-scratch/vitest-lineage/demo-linkedin-lineage-alternate.png',
    checksumSha256: fileSha256(files.alternate),
    confirmWrite: true,
  });
  return files;
}

describe('asset lineage index', () => {
  beforeEach(() => {
    rmSync(scratchDir, { force: true, recursive: true });
    useLineageTestProfile(dbFile);
  });

  it('indexes local assets, links lineage, and computes latest leaves', () => {
    const files = seedFiles();
    const summary = indexLineageAssets(defaultProject);

    expect(summary.local).toBeGreaterThanOrEqual(2);
    expect(summary.database).toBe(dbFile);

    const dryRun = linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: false,
      parentAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true, ok: true });

    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);

    expect(snapshot.root_asset_id).toBe(files.parentId);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.latest).toEqual([files.childId]);
    expect(snapshot.selected).toEqual([files.childId]);
    expect(snapshot.nodes.find(node => node.asset_id === files.childId)).toMatchObject({
      is_latest: true,
      user_selected: true,
    });
  });

  it('requires a matching active claim for direct confirmed lineage links on a claimed workspace', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    const claim = createAgentClaim({
      agentName: 'Direct lineage link agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.parentId),
    });
    const wrongClaim = createAgentClaim({
      agentName: 'Wrong lineage link agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.variationId),
    });

    expect(() => linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    })).toThrow('Mutating agent write requires a matching claim token.');
    expect(() => linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      claimToken: wrongClaim.claim_token,
      confirmWrite: true,
      parentAssetId: files.parentId,
    })).toThrow('Claim does not cover lineage_workspace');

    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).edges).toHaveLength(1);
  });

  it('guards direct lineage links against an explicitly rooted child workspace claim', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    createLineageWorkspace(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.childId,
      title: 'Child lineage workspace',
    });
    const claim = createAgentClaim({
      agentName: 'Child workspace lineage link agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.childId),
    });

    expect(() => linkLineageAssets(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: true,
      parentAssetId: files.childId,
    })).toThrow('Mutating agent write requires a matching claim token.');

    linkLineageAssets(defaultProject, {
      childAssetId: files.variationId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      parentAssetId: files.childId,
    });

    expect(getLineageSnapshot(defaultProject, files.childId).edges.map(edge => edge.child_asset_id)).toContain(files.variationId);
  });

  it('allows direct lineage links without a token when the workspace is unclaimed', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).edges).toHaveLength(1);
  });

  it('persists review state for indexed assets', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateAssetReview(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      notes: 'Not the cleanest branch.',
      reviewState: 'rejected',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.review_state).toBe('rejected');
  });

  it('requires a matching claim for confirmed layout writes on a claimed workspace', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    const claim = createAgentClaim({
      agentName: 'Lineage layout agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.parentId),
    });

    const dryRun = updateLineageLayout(defaultProject, {
      confirmWrite: false,
      positions: [{ assetId: files.childId, x: 10, y: 20 }],
      rootAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true });
    expect(() => updateLineageLayout(defaultProject, {
      confirmWrite: true,
      positions: [{ assetId: files.childId, x: 10, y: 20 }],
      rootAssetId: files.parentId,
    })).toThrow('Mutating agent write requires a matching claim token.');

    updateLineageLayout(defaultProject, {
      claimToken: claim.claim_token,
      confirmWrite: true,
      positions: [{ assetId: files.childId, x: 10, y: 20 }],
      rootAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.find(node => node.asset_id === files.childId)?.position).toEqual({ x: 10, y: 20 });
  });

  it('allows a project-channel claim to write claimed lineage workspace layout', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    const claim = createAgentClaim({
      agentName: 'Lineage project channel agent',
      project: defaultProject,
      scopeType: 'project_channel',
      targetId: `${defaultProject}:all-lineage`,
    });

    updateLineageLayout(defaultProject, {
      claimToken: claim.claim_token,
      confirmWrite: true,
      positions: [{ assetId: files.childId, x: 24, y: 42 }],
      rootAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.find(node => node.asset_id === files.childId)?.position).toEqual({ x: 24, y: 42 });
  });

  it('keeps project-channel lineage claims constrained to the asset channel', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    const tiktokClaim = createAgentClaim({
      agentName: 'TikTok lineage project channel agent',
      channel: 'tiktok',
      project: defaultProject,
      scopeType: 'project_channel',
      targetId: `${defaultProject}:channel:tiktok`,
    });
    const linkedinClaim = createAgentClaim({
      agentName: 'LinkedIn lineage project channel agent',
      channel: 'linkedin',
      project: defaultProject,
      scopeType: 'project_channel',
      targetId: `${defaultProject}:channel:linkedin`,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.find(node => node.asset_id === files.parentId)?.channel).toBe('linkedin');
    expect(() => updateLineageLayout(defaultProject, {
      claimToken: tiktokClaim.claim_token,
      confirmWrite: true,
      positions: [{ assetId: files.parentId, x: 10, y: 20 }],
      rootAssetId: files.parentId,
    })).toThrow('Claim channel tiktok does not match linkedin.');

    updateLineageLayout(defaultProject, {
      claimToken: linkedinClaim.claim_token,
      confirmWrite: true,
      positions: [{ assetId: files.parentId, x: 24, y: 42 }],
      rootAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).nodes.find(node => node.asset_id === files.parentId)?.position).toEqual({ x: 24, y: 42 });
  });

  it('persists needs-revision review state for indexed local assets', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateAssetReview(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      notes: 'Composition is useful, but the CTA needs another pass.',
      reviewState: 'needs_revision',
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)).toMatchObject({
      review_notes: 'Composition is useful, but the CTA needs another pass.',
      review_state: 'needs_revision',
    });
  });

  it('marks multiple lineage nodes for re-roll and keeps requests separate from next variation selection', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const first = markLineageRerollRequest(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      notes: 'Fix garbled headline',
      requestedBy: 'human',
      confirmWrite: true,
    });
    const second = markLineageRerollRequest(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.childId,
      notes: 'Remove extra shapes',
      requestedBy: 'human',
      confirmWrite: true,
    });

    expect(first.request.status).toBe('pending');
    expect(second.request.status).toBe('pending');
    expect(listLineageRerollRequests(defaultProject, files.parentId).requests.map(request => request.node_asset_id).sort()).toEqual([files.childId, files.parentId].sort());
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.review_state).toBe('needs_revision');
    expect(snapshot.nodes.find(node => node.asset_id === files.childId)?.reroll_request?.notes).toBe('Remove extra shapes');
    expect(snapshot.selected).toEqual([]);
  });

  it('rejects listing re-roll requests from a non-canonical child root', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    markLineageRerollRequest(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.childId,
      notes: 'Fix child artifact',
      requestedBy: 'human',
      confirmWrite: true,
    });

    expect(() => listLineageRerollRequests(defaultProject, files.childId)).toThrow(`Asset ${files.childId} is not a lineage root`);
  });

  it('cancels a re-roll request without clearing needs-revision review state', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    markLineageRerollRequest(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      requestedBy: 'human',
      confirmWrite: true,
    });

    const cancelled = clearLineageRerollRequest(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      confirmWrite: true,
    });

    expect(cancelled.request.status).toBe('cancelled');
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.review_state).toBe('needs_revision');
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.reroll_request).toBeUndefined();
    expect(listLineageRerollRequests(defaultProject, files.parentId).requests).toEqual([]);
  });

  it('hydrates implicit attempt one for existing nodes without attempt rows', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    const root = snapshot.nodes.find(node => node.asset_id === files.parentId);
    expect(root?.attempt_count).toBe(1);
    expect(root?.current_attempt).toMatchObject({
      attempt_index: 1,
      asset_id: files.parentId,
      is_current: true,
      source: 'initial',
    });
    expect(getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts[0]).toMatchObject({
      asset_id: files.parentId,
      attempt_index: 1,
      is_current: true,
    });
  });

  it('promotes a previous physical attempt as current without creating a child edge', () => {
    const files = seedRerollAttempts();
    const beforeEdges = countRows('asset_edges');
    const attempts = getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts;
    const v2 = attempts.find(attempt => attempt.attempt_index === 2);
    expect(v2).toBeTruthy();

    const promoted = promoteLineageAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      attemptId: v2!.id,
      confirmWrite: true,
    });

    expect(promoted.attempt).toMatchObject({ attempt_index: 2, is_current: true });
    expect(promoted.attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([2]);
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.current_attempt).toMatchObject({
      attempt_index: 2,
      asset_id: files.variationId,
    });
    expect(decodeURIComponent(snapshot.nodes.find(node => node.asset_id === files.parentId)?.preview_url || '')).toContain('demo-linkedin-lineage-variation.png');
    expect(countRows('asset_edges')).toBe(beforeEdges);
  });

  it('promotes the implicit original attempt back to current', () => {
    const files = seedRerollAttempts();
    const implicit = getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts.find(attempt => attempt.source === 'initial');
    expect(implicit).toBeTruthy();

    const promoted = promoteLineageAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      attemptId: implicit!.id,
      confirmWrite: true,
    });

    expect(promoted.attempt).toMatchObject({ attempt_index: 1, is_current: true, source: 'initial' });
    expect(promoted.attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([1]);
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.current_attempt).toMatchObject({
      attempt_index: 1,
      asset_id: files.parentId,
      source: 'initial',
    });
    expect(decodeURIComponent(snapshot.nodes.find(node => node.asset_id === files.parentId)?.preview_url || '')).toContain('demo-linkedin-lineage-parent.png');
  });

  it('treats implicit v1 as current when physical attempts have no current row', () => {
    const files = seedRerollAttempts();
    const database = lineageDb();
    try {
      database.prepare('update asset_attempts set is_current = 0 where project_id = ? and node_asset_id = ?').run(defaultProject, files.parentId);
    } finally {
      database.close();
    }

    const attempts = getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts;

    expect(attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([1]);
    expect(attempts.find(attempt => attempt.attempt_index === 1)).toMatchObject({
      asset_id: files.parentId,
      is_current: true,
      source: 'initial',
    });
  });

  it('dry-runs attempt promotion without mutating current state', () => {
    const files = seedRerollAttempts();
    const v2 = getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts.find(attempt => attempt.attempt_index === 2)!;

    const promoted = promoteLineageAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      attemptId: v2.id,
      confirmWrite: false,
    });

    expect(promoted.dryRun).toBe(true);
    expect(promoted.attempt).toMatchObject({ attempt_index: 2, is_current: true });
    expect(getLineageAttempts(defaultProject, files.parentId, files.parentId).attempts.filter(attempt => attempt.is_current).map(attempt => attempt.attempt_index)).toEqual([3]);
  });

  it('rejects promoting an attempt from a different lineage node', () => {
    const files = seedRerollAttempts();
    linkLineageAssets(defaultProject, {
      parentAssetId: files.parentId,
      childAssetId: files.childId,
      confirmWrite: true,
    });
    recordLineageRerollAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.childId,
      assetId: files.alternateId,
      prompt: 'Child-only attempt.',
      generationJobId: 'job-child-v2',
      filePath: '.asset-scratch/vitest-lineage/demo-linkedin-lineage-alternate.png',
      checksumSha256: fileSha256(files.alternate),
      confirmWrite: true,
    });
    const childAttempt = getLineageAttempts(defaultProject, files.parentId, files.childId).attempts.find(attempt => attempt.attempt_index === 2)!;

    expect(() => promoteLineageAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      attemptId: childAttempt.id,
      confirmWrite: true,
    })).toThrow(`Attempt ${childAttempt.id} is not in ${files.parentId}`);
  });

  it('rejects recording a re-roll attempt whose asset is already a visible lineage node', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      parentAssetId: files.parentId,
      childAssetId: files.childId,
      confirmWrite: true,
    });

    expect(() => recordLineageRerollAttempt(defaultProject, {
      rootAssetId: files.parentId,
      nodeAssetId: files.parentId,
      assetId: files.childId,
      prompt: 'Try to reuse an existing child as an attempt.',
      generationJobId: 'job-visible-node',
      filePath: '.asset-scratch/vitest-lineage/demo-linkedin-lineage-child.png',
      checksumSha256: fileSha256(files.child),
      confirmWrite: true,
    })).toThrow(`Attempt asset ${files.childId} is already a visible lineage node in ${files.parentId}`);
  });

  it('returns the next asset to evolve from selected state or latest fallback', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const fallback = getLineageNextAsset(defaultProject, files.parentId);
    expect(fallback.strategy).toBe('single_latest');
    expect(fallback.recommended_action).toBe('evolve_variations');
    expect(fallback.reason).toBe('single_latest_fallback');
    expect(fallback.next_asset?.asset_id).toBe(files.childId);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true });

    const selected = getLineageNextAsset(defaultProject, files.parentId);
    expect(selected.strategy).toBe('selected');
    expect(selected.reason).toBe('user_selected');
    expect(selected.next_asset?.asset_id).toBe(files.parentId);
    expect(selected.warnings).toContain('Selected asset is not a latest leaf; agents should treat this as an intentional branch choice.');

    const branchBrief = getLineageBrief(defaultProject, files.parentId);
    expect(branchBrief.next_asset?.asset_id).toBe(files.parentId);
    expect(branchBrief.warnings).toContain('Selected asset is not a latest leaf; agents should treat this as an intentional branch choice.');
    expect(branchBrief.brief.prompt).toContain(`Create 3-4 variations from asset ${files.parentId}`);
  });

  it('returns direct lineage children for an indexed parent', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    const result = getLineageChildren(defaultProject, files.parentId);

    expect(result.parent_asset_id).toBe(files.parentId);
    expect(result.children.map(child => child.asset_id)).toEqual([files.childId]);
    expect(result.edges).toHaveLength(1);
  });

  it('persists graph layout and next-base rationale for snapshots', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    updateLineageLayout(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.parentId,
      positions: [{ assetId: files.childId, x: 320, y: 180 }],
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Best expression for the next branch.',
      rootAssetId: files.parentId,
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    const child = snapshot.nodes.find(node => node.asset_id === files.childId);

    expect(snapshot.selection).toMatchObject({
      asset_id: files.childId,
      notes: 'Best expression for the next branch.',
    });
    expect(child).toMatchObject({
      position: { x: 320, y: 180 },
      preview_url: expect.stringContaining('/api/assets/local-preview?'),
      selection_note: 'Best expression for the next branch.',
    });
  });

  it('migrates a legacy single selected asset row into ordered multi-selection storage', () => {
    const files = seedFiles();
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(dbFile);
    database.exec(`
      create table projects (
        id text primary key,
        product text not null,
        catalog_path text,
        created_at text not null,
        updated_at text not null
      );
      create table assets (
        id text primary key,
        project_id text not null references projects(id),
        source text not null check (source in ('local', 'catalog')),
        local_path text,
        s3_key text,
        checksum_sha256 text,
        media_type text not null,
        title text not null,
        status text not null,
        channel text,
        campaign text,
        audience text,
        size_bytes integer,
        content_type text,
        created_at text not null,
        updated_at text not null,
        last_seen_at text not null
      );
      create table asset_selections (
        id text primary key,
        project_id text not null references projects(id),
        root_asset_id text not null references assets(id),
        asset_id text not null references assets(id),
        notes text,
        selected_at text not null,
        unique(project_id, root_asset_id)
      );
      insert into projects (id, product, catalog_path, created_at, updated_at)
      values ('${defaultProject}', '${defaultProject}', null, '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z');
      insert into assets (id, project_id, source, local_path, s3_key, checksum_sha256, media_type, title, status, channel, campaign, audience, size_bytes, content_type, created_at, updated_at, last_seen_at)
      values
        ('${files.parentId}', '${defaultProject}', 'local', 'parent.png', null, null, 'image', 'Parent', 'working', 'linkedin', 'campaign', 'audience', 1, 'image/png', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z'),
        ('${files.childId}', '${defaultProject}', 'local', 'child.png', null, null, 'image', 'Child', 'working', 'linkedin', 'campaign', 'audience', 1, 'image/png', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z');
      insert into asset_selections (id, project_id, root_asset_id, asset_id, notes, selected_at)
      values ('legacy-selection', '${defaultProject}', '${files.parentId}', '${files.parentId}', 'Legacy selected row.', '2026-06-29T00:00:00.000Z');
    `);
    database.close();

    const migrated = lineageDb();
    const columns = migrated.prepare('pragma table_info(asset_selections)').all() as Array<{ name: string }>;
    const rows = migrated.prepare('select asset_id, notes, position from asset_selections order by position').all() as Array<{ asset_id: string; notes: string; position: number }>;
    migrated.close();

    expect(columns.map(column => column.name)).toContain('position');
    expect(rows).toEqual([{ asset_id: files.parentId, notes: 'Legacy selected row.', position: 0 }]);

    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'add',
      rootAssetId: files.parentId,
    });

    const after = lineageDb();
    const selections = after.prepare('select asset_id, notes, position from asset_selections order by position').all();
    after.close();
    expect(selections).toMatchObject([
      { asset_id: files.parentId, notes: 'Legacy selected row.', position: 0 },
      { asset_id: files.childId, position: 1 },
    ]);
  });

  it('returns ordered multi-selected next variation bases in the lineage snapshot and next response', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    linkLineageAssets(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });

    updateSelectedAsset(defaultProject, {
      assetIds: [files.childId, files.variationId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });

    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.selected).toEqual([files.childId, files.variationId]);
    expect(snapshot.selections.map(selection => selection.asset_id)).toEqual([files.childId, files.variationId]);
    expect(snapshot.selection?.asset_id).toBe(files.childId);
    expect(new Set(snapshot.nodes.filter(node => node.user_selected).map(node => node.asset_id))).toEqual(new Set([files.childId, files.variationId]));

    const next = getLineageNextAsset(defaultProject, files.parentId);
    expect(next.strategy).toBe('selected');
    expect(next.selection_mode).toBe('multiple');
    expect(next.next_asset?.asset_id).toBe(files.childId);
    expect(next.next_assets.map(asset => asset.asset_id)).toEqual([files.childId, files.variationId]);
  });

  it('creates one pending iterate task when selecting one image', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Use this expression next.',
      rootAssetId: files.parentId,
    });

    const tasks = listLineageTasks(defaultProject, files.parentId).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      instructions: 'Use this expression next.',
      status: 'pending',
      target_asset_id: files.childId,
      task_type: 'iterate',
    });
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    const child = snapshot.nodes.find(node => node.asset_id === files.childId);
    expect(snapshot.tasks?.map(task => task.id)).toEqual([tasks[0].id]);
    expect(child?.lineage_tasks?.iterate).toMatchObject({ id: tasks[0].id });
  });

  it('creates one pending iterate task per selected image', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });

    const tasks = listLineageTasks(defaultProject, files.parentId).tasks;
    expect(tasks.map(task => [task.task_type, task.target_asset_id]).sort()).toEqual([
      ['iterate', files.childId],
      ['iterate', files.parentId],
    ].sort());
  });

  it('updates iterate task instructions without duplicating the open task', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'First selection note.',
      rootAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Updated selection note.',
      rootAssetId: files.parentId,
    });

    const tasks = listLineageTasks(defaultProject, files.parentId).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      instructions: 'Updated selection note.',
      target_asset_id: files.childId,
      task_type: 'iterate',
    });
  });

  it('cancels pending iterate tasks when selected assets are removed', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'remove',
      rootAssetId: files.parentId,
    });

    expect(listLineageTasks(defaultProject, files.parentId).tasks.map(task => task.target_asset_id)).toEqual([files.parentId]);
    expect(listLineageTasks(defaultProject, files.parentId, ['cancelled']).tasks.map(task => task.target_asset_id)).toEqual([files.childId]);

    updateSelectedAsset(defaultProject, {
      clear: true,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    expect(listLineageTasks(defaultProject, files.parentId).tasks).toEqual([]);
  });

  it('clears legacy selection while preserving claimed iterate tasks', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId],
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });
    const tasks = listLineageTasks(defaultProject, files.parentId).tasks;
    const parentTask = tasks.find(task => task.target_asset_id === files.parentId)!;
    const childTask = tasks.find(task => task.target_asset_id === files.childId)!;
    claimLineageTask(defaultProject, { agentName: 'Iterate worker', taskId: parentTask.id });
    claimLineageTask(defaultProject, { agentName: 'Iterate worker', taskId: childTask.id });

    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'remove',
      rootAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([files.parentId]);
    expect(listLineageTasks(defaultProject, files.parentId).tasks.map(task => [task.target_asset_id, task.status]).sort()).toEqual([
      [files.childId, 'claimed'],
      [files.parentId, 'claimed'],
    ].sort());

    updateSelectedAsset(defaultProject, {
      clear: true,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([]);
    expect(listLineageTasks(defaultProject, files.parentId).tasks.map(task => [task.target_asset_id, task.status]).sort()).toEqual([
      [files.childId, 'claimed'],
      [files.parentId, 'claimed'],
    ].sort());
  });

  it('creates a task-backed re-roll request and exposes task fields in snapshots and lists', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    const marked = markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.parentId,
      notes: 'Regenerate with readable text.',
      requestedBy: 'human',
      rootAssetId: files.parentId,
    });

    expect(marked.task).toBeDefined();
    const task = marked.task!;
    expect(marked.task_id).toBe(task.id);
    expect(task).toMatchObject({
      instructions: 'Regenerate with readable text.',
      status: 'pending',
      target_asset_id: files.parentId,
      task_type: 'reroll',
    });
    const snapshot = getLineageSnapshot(defaultProject, files.parentId);
    expect(snapshot.nodes.find(node => node.asset_id === files.parentId)?.lineage_tasks?.reroll).toMatchObject({ id: marked.task_id });
    const requests = listLineageRerollRequests(defaultProject, files.parentId).requests;
    expect(requests[0]).toMatchObject({ node_asset_id: files.parentId, task_id: marked.task_id });
    expect(requests[0].task).toMatchObject({ id: marked.task_id, task_type: 'reroll' });
  });

  it('cancels the pending reroll task when clearing a re-roll request', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    const marked = markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.parentId,
      requestedBy: 'human',
      rootAssetId: files.parentId,
    });

    clearLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.parentId,
      rootAssetId: files.parentId,
    });

    expect(listLineageTasks(defaultProject, files.parentId).tasks).toEqual([]);
    expect(listLineageTasks(defaultProject, files.parentId, ['cancelled']).tasks.map(task => task.id)).toEqual([marked.task_id]);
  });

  it('clears legacy reroll requests while preserving claimed reroll tasks', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    const marked = markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.parentId,
      requestedBy: 'human',
      rootAssetId: files.parentId,
    });
    claimLineageTask(defaultProject, {
      agentName: 'Reroll worker',
      taskId: marked.task_id!,
    });

    const cleared = clearLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.parentId,
      rootAssetId: files.parentId,
    });

    expect(cleared.request.status).toBe('cancelled');
    expect(listLineageRerollRequests(defaultProject, files.parentId).requests).toEqual([]);
    expect(listLineageTasks(defaultProject, files.parentId).tasks).toMatchObject([
      { id: marked.task_id, status: 'claimed', task_type: 'reroll' },
    ]);
  });

  it('uses pending iterate tasks as the next assets before legacy selected rows', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    updateSelectedAsset(defaultProject, {
      assetId: files.parentId,
      confirmWrite: true,
      mode: 'replace',
      rootAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      mode: 'add',
      rootAssetId: files.parentId,
    });

    const database = lineageDb();
    try {
      database.prepare(`
        update lineage_tasks set status = 'cancelled', cancelled_at = ?, updated_at = ?
        where project_id = ? and root_asset_id = ? and target_asset_id = ? and task_type = 'iterate'
      `).run(new Date().toISOString(), new Date().toISOString(), defaultProject, files.parentId, files.parentId);
    } finally {
      database.close();
    }

    const next = getLineageNextAsset(defaultProject, files.parentId);

    expect(next.strategy).toBe('selected');
    expect(next.selected).toEqual([files.childId]);
    expect(next.next_assets.map(asset => asset.asset_id)).toEqual([files.childId]);
  });

  it('caps next variation selection at three assets on the server boundary', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    expect(() => updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId, files.variationId, files.alternateId],
      confirmWrite: true,
      maxSelections: 3,
      mode: 'replace',
      rootAssetId: files.parentId,
    })).toThrow('Select at most 3 assets for next variation');
  });

  it('adds, removes, toggles, and clears selected next variation assets independently', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true, mode: 'add', rootAssetId: files.parentId });
    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, mode: 'add', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([files.parentId, files.childId]);

    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true, mode: 'remove', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([files.childId]);

    updateSelectedAsset(defaultProject, { assetId: files.childId, confirmWrite: true, mode: 'toggle', rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([]);

    updateSelectedAsset(defaultProject, { assetIds: [files.parentId, files.childId], confirmWrite: true, mode: 'replace', rootAssetId: files.parentId });
    updateSelectedAsset(defaultProject, { clear: true, confirmWrite: true, rootAssetId: files.parentId });
    expect(getLineageSnapshot(defaultProject, files.parentId).selected).toEqual([]);
  });

  it('creates an agent brief from multiple selected next variation bases', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetIds: [files.parentId, files.childId],
      confirmWrite: true,
      mode: 'replace',
      notes: 'Blend the strongest pieces.',
      rootAssetId: files.parentId,
    });

    const brief = getLineageBrief(defaultProject, files.parentId);
    expect(brief.selection_mode).toBe('multiple');
    expect(brief.next_assets.map(asset => asset.asset_id)).toEqual([files.parentId, files.childId]);
    expect(brief.brief.reference_asset_ids).toEqual([files.parentId, files.childId]);
    expect(brief.brief.prompt).toContain(`Create 3-4 variations using these 2 selected references: ${files.parentId}, ${files.childId}`);
    expect(brief.brief.prompt).toContain('Blend the strongest pieces.');
    expect(brief.handoff.link_child_command).toContain('link-child');
  });

  it('uses the resolved profile manifest instead of a direct database path in generated handoffs', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    updateSelectedAsset(defaultProject, { assetId: files.parentId, confirmWrite: true, rootAssetId: files.parentId });
    const profileManifest = process.env.LINEAGE_PROFILE_MANIFEST!;
    process.env.LINEAGE_CHANNEL = 'dev';

    const handoff = getLineageBrief(defaultProject, files.parentId).handoff;

    for (const command of [handoff.next_command, handoff.inspect_command, handoff.link_child_command]) {
      expect(command).toContain(`--profile '${profileManifest}'`);
      expect(command).toContain(" --import '");
      expect(command).toContain('/node_modules/tsx/dist/loader.mjs');
      expect(command).toContain('/src/cli/lineage-dev.ts');
      expect(command).not.toContain('--db');
    }
    delete process.env.LINEAGE_CHANNEL;
  });

  it('creates an agent brief and links a generated child from the selected base', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Use the cleanest concept for the next branch.',
      rootAssetId: files.parentId,
    });

    const brief = getLineageBrief(defaultProject, files.parentId);
    expect(brief.next_asset?.asset_id).toBe(files.childId);
    expect(brief.brief.prompt).toContain('Use the cleanest concept');
    expect(brief.handoff.link_child_command).toContain('link-child');

    const dryRun = linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      confirmWrite: false,
      rootAssetId: files.parentId,
    });
    expect(dryRun).toMatchObject({ dryRun: true, parent_asset_id: files.childId });

    const claim = createAgentClaim({
      agentName: 'Lineage unit test agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.parentId),
    });
    linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      claimToken: claim.claim_token,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    const children = getLineageChildren(defaultProject, files.childId);
    expect(children.children.map(child => child.asset_id)).toEqual([files.variationId]);
  });

  it('validates selected-child handoff links against the selected base workspace root', () => {
    const files = seedFiles();
    indexLineageAssets(defaultProject);
    linkLineageAssets(defaultProject, {
      childAssetId: files.childId,
      confirmWrite: true,
      parentAssetId: files.parentId,
    });
    createLineageWorkspace(defaultProject, {
      confirmWrite: true,
      rootAssetId: files.childId,
      title: 'Selected child workspace',
    });
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Continue inside the child workspace.',
      rootAssetId: files.parentId,
    });
    const parentClaim = createAgentClaim({
      agentName: 'Parent handoff agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.parentId),
    });
    const childClaim = createAgentClaim({
      agentName: 'Child handoff agent',
      project: defaultProject,
      scopeType: 'lineage_workspace',
      targetId: lineageWorkspaceId(defaultProject, files.childId),
    });

    expect(() => linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      claimToken: parentClaim.claim_token,
      confirmWrite: true,
      rootAssetId: files.parentId,
    })).toThrow('Claim does not cover lineage_workspace');

    linkSelectedLineageChild(defaultProject, {
      childAssetId: files.variationId,
      claimToken: childClaim.claim_token,
      confirmWrite: true,
      rootAssetId: files.parentId,
    });

    expect(getLineageChildren(defaultProject, files.childId).children.map(child => child.asset_id)).toEqual([files.variationId]);
  });
});
