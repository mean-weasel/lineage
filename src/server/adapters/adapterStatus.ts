import { listProjects } from '../assetCore';
import { createBufferPostingAdapter } from './posting/bufferPostingAdapter';

export function getAdapterStatus(project: string, env: NodeJS.ProcessEnv = process.env) {
  const summary = listProjects().find(item => item.project === project);
  const buffer = createBufferPostingAdapter({
    env,
    runBuffer: () => ({ stdout: '{}', stderr: '' }),
    writePayload: () => '.asset-scratch/buffer-dry-run.json',
  });
  return {
    project,
    fetchedAt: new Date().toISOString(),
    storage: [{
      provider: 's3',
      configured: Boolean(summary?.default_bucket && summary?.default_region),
      can_list: Boolean(summary?.default_bucket && summary?.default_region),
      can_upload: Boolean(summary?.default_bucket && summary?.default_region),
      mode: 'catalog-backed',
      default_bucket: summary?.default_bucket || null,
      default_region: summary?.default_region || null,
    }],
    posting: [buffer.status()],
  };
}
