import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('persists exact branch and re-roll prompts on nodes and in the Codex task handoff', async ({ page, request }) => {
  const seededResponse = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as { root_asset_id: string; workspace?: { id: string } };
  if (!seeded.workspace?.id) throw new Error('Demo seed did not return a workspace');

  const before = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
    nodes: Array<{ asset_id: string; title: string; reroll_request?: { status: string } }>;
  };
  await request.post('/api/selection', { data: { project, rootAssetId: seeded.root_asset_id, clear: true, confirmWrite: true } });
  for (const node of before.nodes.filter(item => item.reroll_request?.status === 'pending')) {
    await request.post(`/api/lineage/${seeded.root_asset_id}/rerolls/${node.asset_id}/cancel`, {
      data: { project, confirmWrite: true },
    });
  }

  try {
    await page.goto(`/projects/${project}/workspaces/${encodeURIComponent(seeded.workspace.id)}`);
    await expect(page.locator('.lineage-workspace-title strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });

    const branchPrompt = 'Restyle this as a bold Swiss editorial poster with a tighter red grid.';
    const rootNode = page.locator('.lineage-node.root-node');
    await rootNode.hover();
    await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Branch/ }).click();
    const branchDialog = page.getByRole('dialog', { name: 'Describe the next branch' });
    await expect(branchDialog).toContainText('Saved to Canvas · ready for Codex');
    await branchDialog.getByLabel('What should Codex change?').fill(branchPrompt);
    await branchDialog.getByRole('button', { name: 'Queue branch' }).click();
    await expect(branchDialog).toBeHidden();
    await expect(rootNode.locator('.lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', `Branch prompt: ${branchPrompt}`);

    const rerollPrompt = 'Keep the composition exactly; repair the distorted headline and soften the shadow.';
    const rerollNode = page.locator('.lineage-node:not(.root-node)').first();
    const rerollAssetId = await rerollNode.locator('small').first().textContent();
    expect(rerollAssetId).toBeTruthy();
    await rerollNode.hover();
    await page.getByTestId('lineage-hover-preview').getByRole('button', { name: /Re-roll/ }).click();
    const rerollDialog = page.getByRole('dialog', { name: 'Describe the re-roll' });
    await rerollDialog.getByLabel('What should Codex change?').fill(rerollPrompt);
    await rerollDialog.getByRole('button', { name: 'Queue re-roll' }).click();
    await expect(rerollDialog).toBeHidden();
    await expect(rerollNode.locator('.lineage-node-prompts span.reroll')).toHaveAttribute('title', `Re-roll prompt: ${rerollPrompt}`);

    await page.reload();
    await expect(page.locator('.lineage-node.root-node .lineage-node-prompts span').filter({ hasText: 'Branch' })).toHaveAttribute('title', `Branch prompt: ${branchPrompt}`);
    await expect(page.locator('.lineage-node').filter({ hasText: rerollAssetId! }).locator('.lineage-node-prompts span.reroll')).toHaveAttribute('title', `Re-roll prompt: ${rerollPrompt}`);

    const snapshot = await (await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`)).json() as {
      nodes: Array<{ asset_id: string; branch_prompt?: string; reroll_request?: { prompt?: string } }>;
      tasks: Array<{ instructions?: string; target_asset_id: string; task_type: string }>;
    };
    expect(snapshot.nodes.find(node => node.asset_id === seeded.root_asset_id)?.branch_prompt).toBe(branchPrompt);
    expect(snapshot.nodes.find(node => node.asset_id === rerollAssetId)?.reroll_request?.prompt).toBe(rerollPrompt);
    expect(snapshot.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_asset_id: seeded.root_asset_id, task_type: 'iterate', instructions: branchPrompt }),
      expect.objectContaining({ target_asset_id: rerollAssetId, task_type: 'reroll', instructions: rerollPrompt }),
    ]));

    const brief = await (await request.get(`/api/lineage/${seeded.root_asset_id}/brief?project=${project}`)).json() as {
      brief: { prompt: string; variation_prompts?: Array<{ asset_id: string; prompt: string }> };
    };
    expect(brief.brief.variation_prompts).toContainEqual({ asset_id: seeded.root_asset_id, prompt: branchPrompt });
    expect(brief.brief.prompt).toContain(branchPrompt);
  } finally {
    await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
      data: { project, confirmWrite: true },
    });
  }
});
