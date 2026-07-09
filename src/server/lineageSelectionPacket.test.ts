import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { fileSha256 } from './localReview';
import { indexLineageAssets, linkLineageAssets, updateSelectedAsset } from './assetLineage';
import { createLineageWorkspace } from './assetLineageWorkspaces';
import { getLineageSelectionPacket, LineageSelectionPacketError } from './lineageSelectionPacket';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-selection-packet');
const dbFile = join(scratchDir, 'lineage-selection-packet.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const root = join(scratchDir, 'demo-linkedin-selection-root.png');
  const child = join(scratchDir, 'demo-linkedin-selection-child.png');
  writeFileSync(root, Buffer.from('selection-packet-root'));
  writeFileSync(child, Buffer.from('selection-packet-child'));
  return {
    child,
    childId: localId(child),
    root,
    rootId: localId(root),
  };
}

function seedSelectedWorkspace() {
  const files = seedFiles();
  process.env.LINEAGE_DB = dbFile;
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, { childAssetId: files.childId, confirmWrite: true, parentAssetId: files.rootId });
  updateSelectedAsset(defaultProject, {
    assetId: files.childId,
    confirmWrite: true,
    notes: 'Use this image in GrowthOps.',
    rootAssetId: files.rootId,
  });
  createLineageWorkspace(defaultProject, {
    activate: true,
    confirmWrite: true,
    notes: 'Packet test workspace',
    rootAssetId: files.rootId,
    title: 'GrowthOps packet workspace',
  });
  return files;
}

describe('lineage selection packet', () => {
  beforeEach(() => {
    process.env.LINEAGE_DB = dbFile;
  });

  it('exports the active workspace selection with stable id and absolute local media path', () => {
    const files = seedSelectedWorkspace();

    const packet = getLineageSelectionPacket(defaultProject, {
      campaign: '2026-07-launch',
      channel: 'linkedin',
      contextNotes: 'Make GrowthOps posts from selected images.',
      labels: ['launch', 'agent-ready'],
    });
    const repeated = getLineageSelectionPacket(defaultProject, {
      campaign: '2026-07-launch',
      channel: 'linkedin',
      contextNotes: 'Make GrowthOps posts from selected images.',
      labels: ['launch', 'agent-ready'],
    });

    expect(packet).toMatchObject({
      kind: 'lineage.selection_packet',
      schema_version: 'lineage.selection_packet.v1',
      project: defaultProject,
      context: {
        campaign: '2026-07-launch',
        channel: 'linkedin',
        labels: ['launch', 'agent-ready'],
        notes: 'Make GrowthOps posts from selected images.',
      },
      selection: {
        asset_ids: [files.childId],
        count: 1,
        root_asset_id: files.rootId,
      },
      workspace: {
        root_asset_id: files.rootId,
        title: 'GrowthOps packet workspace',
      },
    });
    expect(packet.packet_id).toMatch(/^lineage_packet_[a-f0-9]{24}$/);
    expect(repeated.packet_id).toBe(packet.packet_id);
    expect(repeated.created_at).toBeDefined();
    expect(packet.assets).toHaveLength(1);
    expect(packet.assets[0]).toMatchObject({
      asset_id: files.childId,
      local: {
        absolute_path: files.child,
        exists: true,
      },
      media_type: 'image',
      selection_note: 'Use this image in GrowthOps.',
      storage_state: 'local_only',
    });
    expect(packet.assets[0].checksum_sha256).toBe(fileSha256(files.child));
    expect(packet.warnings).toContain('Image dimensions are unavailable for one or more selected assets.');
    expect(packet.errors).toEqual([]);
  });

  it('warns about missing selected local files and fails strict exports', () => {
    const files = seedSelectedWorkspace();
    rmSync(files.child, { force: true });

    const packet = getLineageSelectionPacket(defaultProject, { rootAssetId: files.rootId });

    expect(existsSync(files.child)).toBe(false);
    expect(packet.assets[0]).toMatchObject({
      asset_id: files.childId,
      local: {
        absolute_path: files.child,
        exists: false,
      },
      storage_state: 'local_only',
    });
    expect(packet.warnings.join('\n')).toContain(`Selected asset ${files.childId} has a local path but the file is missing`);
    expect(() => getLineageSelectionPacket(defaultProject, { rootAssetId: files.rootId, strict: true }))
      .toThrow(LineageSelectionPacketError);
  });
});
