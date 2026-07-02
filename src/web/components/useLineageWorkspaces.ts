import { useCallback, useState } from 'react';
import type { GrowthAsset, LineageWorkspace, LineageWorkspaceSnapshot } from '../../shared/types';
import { api } from '../api';
import { lineageWorkspaceRootAssetId } from './lineageWorkspacePickerModel';

export interface DemoSeedMediaStatus {
  fixture_present: number;
  fixture_total: number;
  media_root: string;
  missing: string[];
  ok: boolean;
  present: number;
  total: number;
}

export function useLineageWorkspaces({
  asset,
  onResetLineage,
  onSelectedAsset,
  onToast,
  project,
}: {
  asset?: GrowthAsset;
  onResetLineage: () => void;
  onSelectedAsset: (assetId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  project: string;
}) {
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<LineageWorkspaceSnapshot | null>(null);
  const [demoSeedStatus, setDemoSeedStatus] = useState<DemoSeedMediaStatus | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const visibleWorkspaces = (workspaceSnapshot?.workspaces || []).filter(workspace => workspace.status !== 'archived');
  const activeWorkspace = workspaceSnapshot?.active_workspace || visibleWorkspaces[0] || null;
  const workspaceRootAssetId = lineageWorkspaceRootAssetId(activeWorkspace, workspaceSnapshot?.workspaces.length ? undefined : asset?.asset_id);

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const params = new URLSearchParams({ project });
      setWorkspaceSnapshot(await api<LineageWorkspaceSnapshot>(`/api/lineage-workspaces?${params.toString()}`));
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [onToast, project]);

  const refreshDemoSeedStatus = useCallback(async () => {
    try {
      const params = new URLSearchParams({ project });
      const result = await api<{ status: DemoSeedMediaStatus }>(`/api/lineage-workspaces/demo/media?${params.toString()}`);
      setDemoSeedStatus(result.status);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    }
  }, [onToast, project]);

  async function activateWorkspace(workspaceId: string) {
    if (!workspaceId) return;
    setWorkspaceLoading(true);
    try {
      const result = await api<{ workspace: LineageWorkspace }>(`/api/lineage-workspaces/${encodeURIComponent(workspaceId)}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      onResetLineage();
      await refreshWorkspaces();
      onSelectedAsset(result.workspace.root_asset_id);
      onToast('ok', `Using ${result.workspace.title}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function seedDemoWorkspace() {
    setWorkspaceLoading(true);
    try {
      const result = await api<{ workspace?: LineageWorkspace; root_asset_id: string }>('/api/lineage-workspaces/demo/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      onResetLineage();
      await refreshWorkspaces();
      await refreshDemoSeedStatus();
      onSelectedAsset(result.workspace?.root_asset_id || result.root_asset_id);
      onToast('ok', 'Seeded demo lineage workspace');
      return result;
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function restoreDemoSeedMedia() {
    setWorkspaceLoading(true);
    try {
      const result = await api<{ result: { restored?: number } }>('/api/lineage-workspaces/demo/media/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      await refreshDemoSeedStatus();
      onToast('ok', `Restored ${result.result.restored || 0} demo media file${result.result.restored === 1 ? '' : 's'}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function archiveWorkspace() {
    if (!activeWorkspace) return;
    const confirmed = window.confirm(`Archive ${activeWorkspace.title}? This hides it from the picker and clears its next-variation selection.`);
    if (!confirmed) return;
    setWorkspaceLoading(true);
    try {
      await api(`/api/lineage-workspaces/${encodeURIComponent(activeWorkspace.id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, confirmWrite: true }),
      });
      onResetLineage();
      await refreshWorkspaces();
      await refreshDemoSeedStatus();
      onToast('ok', `Archived ${activeWorkspace.title}`);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceLoading(false);
    }
  }

  function handleWorkspaceCreated(workspace: LineageWorkspace) {
    setWorkspaceSnapshot(current => ({
      project,
      active_workspace: workspace,
      workspaces: [workspace, ...(current?.workspaces || []).filter(item => item.id !== workspace.id)],
      fetchedAt: new Date().toISOString(),
    }));
    onResetLineage();
    onSelectedAsset(workspace.root_asset_id);
    onToast('ok', `Using ${workspace.title}`);
  }

  return {
    activateWorkspace,
    activeWorkspace,
    archiveWorkspace,
    demoSeedStatus,
    handleWorkspaceCreated,
    refreshDemoSeedStatus,
    refreshWorkspaces,
    restoreDemoSeedMedia,
    seedDemoWorkspace,
    visibleWorkspaces,
    workspaceLoading,
    workspaceRootAssetId,
  };
}
