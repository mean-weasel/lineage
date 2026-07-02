import { defaultProject, listProjects, validateProject } from '../assetCore';
import { createBufferPostingAdapter } from './posting/bufferPostingAdapter';

export function getAdapterStatus(project: string, env: NodeJS.ProcessEnv = process.env) {
  const summary = listProjects().find(item => item.project === project) || (project === defaultProject ? validateProject(project) : undefined);
  const buffer = createBufferPostingAdapter({
    env,
    runBuffer: () => ({ stdout: '{}', stderr: '' }),
    writePayload: () => '.asset-scratch/buffer-dry-run.json',
  });
  return {
    project,
    fetchedAt: new Date().toISOString(),
    storage: project === defaultProject
      ? [{
          provider: 'local',
          configured: true,
          can_list: true,
          can_upload: false,
          mode: 'public-fallback-catalog',
          default_bucket: null,
          default_region: null,
        }]
      : [{
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
