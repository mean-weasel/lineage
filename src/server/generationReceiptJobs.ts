import { defaultProject } from './assetCore';
import { lineageDb, nowIso } from './assetLineageDb';
import { loadGenerationJob } from './generationReceipts';
import type { GenerationJobListResponse } from '../shared/types';

export function listImageGenerationJobs(
  project = defaultProject,
  fields: { assetId?: string; rootAssetId?: string; limit?: number } = {}
): GenerationJobListResponse {
  const clauses = ['job.project_id = ?'];
  const params: string[] = [project];
  if (fields.rootAssetId) {
    clauses.push('job.root_asset_id = ?');
    params.push(fields.rootAssetId);
  }
  if (fields.assetId) {
    clauses.push('(input.asset_id = ? or output.imported_asset_id = ? or output.parent_asset_id = ?)');
    params.push(fields.assetId, fields.assetId, fields.assetId);
  }
  const limit = Math.max(1, Math.min(50, Number.isInteger(fields.limit) ? Number(fields.limit) : 12));
  const database = lineageDb();
  try {
    const rows = database.prepare(`
      select distinct job.id
      from generation_jobs job
        left join generation_job_inputs input on input.job_id = job.id
        left join generation_job_outputs output on output.job_id = job.id
      where ${clauses.join(' and ')}
      order by job.created_at desc, job.id desc
      limit ?
    `).all(...params, limit) as Array<{ id: string }>;
    return { ok: true, command: 'generate image jobs', project, jobs: rows.map(row => loadGenerationJob(database, project, row.id)), fetchedAt: nowIso() };
  } finally {
    database.close();
  }
}
