import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject, repoRoot } from './assetCore';
import { indexLineageAssets, linkLineageAssets, markLineageRerollRequest, updateSelectedAsset } from './assetLineage';
import { backfillLineageTasks, lineageDb } from './assetLineageDb';
import { inspectAgentClaim, listAgentClaims } from './agentClaims';
import {
  addLineageTaskComment,
  cancelLineageTask,
  claimLineageTask,
  getLineageTask,
  listLineageTasks,
  resolveLineageTask,
  startLineageTask,
  taskIdFor,
  updateLineageTaskInstructions,
  upsertLineageTask,
} from './assetLineageTasks';
import { fileSha256 } from './localReview';

const scratchDir = join(repoRoot, '.asset-scratch', 'vitest-lineage-tasks');
const dbFile = join(scratchDir, 'asset-lineage-tasks.sqlite');

function localId(file: string): string {
  return `local-${fileSha256(file).slice(0, 12)}`;
}

function seedFiles() {
  rmSync(scratchDir, { force: true, recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const root = join(scratchDir, 'task-root.png');
  const child = join(scratchDir, 'task-child.png');
  const alternate = join(scratchDir, 'task-alternate.png');
  writeFileSync(root, Buffer.from('lineage-task-root'));
  writeFileSync(child, Buffer.from('lineage-task-child'));
  writeFileSync(alternate, Buffer.from('lineage-task-alternate'));
  return {
    alternateId: localId(alternate),
    childId: localId(child),
    rootId: localId(root),
  };
}

function seedLineage() {
  const files = seedFiles();
  indexLineageAssets(defaultProject);
  linkLineageAssets(defaultProject, {
    childAssetId: files.childId,
    confirmWrite: true,
    parentAssetId: files.rootId,
  });
  return files;
}

function taskEventTypes(taskId: string): string[] {
  return getLineageTask(defaultProject, taskId).events.map(event => event.event_type);
}

describe('asset lineage tasks', () => {
  beforeEach(() => {
    process.env.LINEAGE_DB = dbFile;
  });

  it('upserts one open iterate task per target and records created then instructions_updated', () => {
    const files = seedLineage();

    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try brighter composition.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const updated = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try brighter composition with more whitespace.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    expect(created.task.id).toBe(taskIdFor(defaultProject, files.rootId, files.childId, 'iterate'));
    expect(created.ok).toBe(true);
    expect(updated.ok).toBe(true);
    expect(updated.task.instructions).toBe('Try brighter composition with more whitespace.');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(1);
    expect(taskEventTypes(updated.task.id)).toEqual(['created', 'instructions_updated']);
  });

  it('claim and start lock instruction edits but allow comments without persisting raw claim tokens', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Explore a tighter crop.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    const claimToken = claimed.claim_token;

    expect(claimed.task).toMatchObject({ status: 'claimed', claimed_by_claim_id: claimed.claim.id });
    expect(() => updateLineageTaskInstructions(defaultProject, {
      instructions: 'This edit should be rejected.',
      taskId: created.task.id,
    })).toThrow('pending');

    const commented = addLineageTaskComment(defaultProject, {
      actor: 'human',
      message: 'Keep the original palette.',
      taskId: created.task.id,
    });
    expect(commented.task.instructions).toBe('Explore a tighter crop.');
    expect(commented.events.map(event => event.event_type)).toContain('comment_added');

    const started = startLineageTask(defaultProject, {
      claimToken,
      taskId: created.task.id,
    });

    expect(started.task).toMatchObject({ status: 'in_progress', claimed_by_claim_id: claimed.claim.id });
    expect(() => updateLineageTaskInstructions(defaultProject, {
      instructions: 'This edit should also be rejected.',
      taskId: created.task.id,
    })).toThrow('pending');
    expect(JSON.stringify(started)).not.toContain(claimToken);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed', 'comment_added', 'started']);
  });

  it('does not create a second claim or event when claiming an already claimed task', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'First task worker',
      taskId: created.task.id,
    });

    expect(() => claimLineageTask(defaultProject, {
      agentName: 'Second task worker',
      taskId: created.task.id,
    })).toThrow('Only pending lineage tasks can be claimed.');

    const activeTaskClaims = listAgentClaims(defaultProject).claims.filter(claim =>
      claim.scope_type === 'lineage_task' && claim.target_id === created.task.id && claim.status === 'active'
    );
    expect(activeTaskClaims.map(claim => claim.id)).toEqual([claimed.claim.id]);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed']);
  });

  it('rejects upsert instruction edits for claimed and in-progress tasks', () => {
    const files = seedLineage();
    const claimedTask = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Keep the main branch focused.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Claimed task worker',
      taskId: claimedTask.task.id,
    });

    const inProgressTask = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Explore the alternate branch.',
      rootAssetId: files.rootId,
      targetAssetId: files.alternateId,
      taskType: 'iterate',
    });
    const claimedInProgress = claimLineageTask(defaultProject, {
      agentName: 'Started task worker',
      taskId: inProgressTask.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimedInProgress.claim_token,
      taskId: inProgressTask.task.id,
    });

    expect(() => upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Do not accept this claimed edit.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    })).toThrow('pending');
    expect(() => upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Do not accept this in-progress edit.',
      rootAssetId: files.rootId,
      targetAssetId: files.alternateId,
      taskType: 'iterate',
    })).toThrow('pending');

    expect(getLineageTask(defaultProject, claimedTask.task.id).task.instructions).toBe('Keep the main branch focused.');
    expect(getLineageTask(defaultProject, inProgressTask.task.id).task.instructions).toBe('Explore the alternate branch.');
  });

  it('rejects bogus claim tokens when starting and leaves the task claimed', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Only the real claim holder may start.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });

    expect(() => startLineageTask(defaultProject, {
      claimToken: 'claim_fake.invalid',
      taskId: created.task.id,
    })).toThrow('Unknown or invalid claim token');

    const inspected = getLineageTask(defaultProject, created.task.id);
    expect(inspected.task.status).toBe('claimed');
    expect(inspected.events.map(event => event.event_type)).toEqual(['created', 'claimed']);
  });

  it('records claim write permission only after a successful task start', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Start exactly once.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });

    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });
    expect(() => startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    })).toThrow('Only claimed lineage tasks can be started.');

    const claimEvents = inspectAgentClaim(claimed.claim.id, defaultProject).events;
    expect(claimEvents.filter(event => event.event_type === 'write_allowed')).toHaveLength(1);
  });

  it('cancels pending tasks with dry-run support and hides them from the default list', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });

    const dryRun = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: false,
      taskId: created.task.id,
    });
    expect(dryRun).toMatchObject({ dryRun: true, ok: true });
    expect(listLineageTasks(defaultProject, files.rootId).tasks.map(task => task.id)).toContain(created.task.id);

    const cancelled = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      taskId: created.task.id,
    });

    expect(cancelled.ok).toBe(true);
    expect(cancelled.task.status).toBe('cancelled');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(0);
    expect(listLineageTasks(defaultProject, files.rootId, ['cancelled']).tasks.map(task => task.id)).toEqual([created.task.id]);
  });

  it('requires override to cancel active tasks', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'iterate',
    });
    const claimed = claimLineageTask(defaultProject, {
      agentName: 'Task worker',
      taskId: created.task.id,
    });
    startLineageTask(defaultProject, {
      claimToken: claimed.claim_token,
      taskId: created.task.id,
    });

    expect(() => cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      taskId: created.task.id,
    })).toThrow('override=true');
    expect(getLineageTask(defaultProject, created.task.id).task.status).toBe('in_progress');

    const cancelled = cancelLineageTask(defaultProject, {
      actor: 'human',
      confirmWrite: true,
      override: true,
      taskId: created.task.id,
    });

    expect(cancelled.task.status).toBe('cancelled');
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toHaveLength(0);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'claimed', 'started', 'cancelled']);
  });

  it('resolves a pending task with generation and asset outputs', () => {
    const files = seedLineage();
    const created = upsertLineageTask(defaultProject, {
      createdBy: 'human',
      instructions: 'Try a readable reroll.',
      rootAssetId: files.rootId,
      targetAssetId: files.childId,
      taskType: 'reroll',
    });

    const resolved = resolveLineageTask(defaultProject, {
      actor: 'agent',
      confirmWrite: true,
      resolvedAssetId: files.alternateId,
      resolvedGenerationJobId: 'job-resolve-task',
      taskId: created.task.id,
    });

    expect(resolved.task).toMatchObject({
      id: created.task.id,
      resolved_asset_id: files.alternateId,
      resolved_generation_job_id: 'job-resolve-task',
      status: 'resolved',
    });
    expect(listLineageTasks(defaultProject, files.rootId).tasks).toEqual([]);
    expect(listLineageTasks(defaultProject, files.rootId, ['resolved']).tasks.map(task => task.id)).toEqual([created.task.id]);
    expect(taskEventTypes(created.task.id)).toEqual(['created', 'resolved']);
  });

  it('uses a stable task id format', () => {
    expect(taskIdFor('demo', 'root-1', 'target-9', 'reroll')).toBe('demo:root-1:lineage-task:reroll:target-9');
  });

  it('backfills current selections and pending reroll requests idempotently', () => {
    const files = seedLineage();
    updateSelectedAsset(defaultProject, {
      assetId: files.childId,
      confirmWrite: true,
      notes: 'Legacy selection note.',
      rootAssetId: files.rootId,
    });
    markLineageRerollRequest(defaultProject, {
      confirmWrite: true,
      nodeAssetId: files.childId,
      notes: 'Legacy reroll note.',
      requestedBy: 'agent',
      rootAssetId: files.rootId,
    });

    const database = lineageDb();
    try {
      database.prepare("delete from lineage_schema_migrations where key = 'lineage_tasks_backfilled_v1'").run();
      backfillLineageTasks(database);
      backfillLineageTasks(database);
      expect(database.prepare("select key from lineage_schema_migrations where key = 'lineage_tasks_backfilled_v1'").get()).toMatchObject({
        key: 'lineage_tasks_backfilled_v1',
      });
    } finally {
      database.close();
    }
    const first = listLineageTasks(defaultProject, files.rootId).tasks;
    const reopened = lineageDb();
    reopened.close();
    const second = listLineageTasks(defaultProject, files.rootId).tasks;

    expect(first.map(task => [task.task_type, task.instructions, task.created_by]).sort()).toEqual([
      ['iterate', 'Legacy selection note.', 'human'],
      ['reroll', 'Legacy reroll note.', 'agent'],
    ]);
    expect(second.map(task => task.id).sort()).toEqual(first.map(task => task.id).sort());
    expect(second).toHaveLength(2);
  });
});
