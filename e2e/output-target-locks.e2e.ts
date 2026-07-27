import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('canvas plans the same durable locked job with human defaults, grouping, and exact summary', async ({ page, request }) => {
  const seededResponse = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as { root_asset_id: string; workspace?: { id: string } };

  try {
    await page.goto(`/?project=${project}`);
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });

    await page.locator('.lineage-overflow summary').click();
    await page.getByRole('button', { name: 'Output target defaults' }).click();
    const defaults = page.getByRole('dialog', { name: 'Output target defaults' });
    await expect(defaults).toContainText('agents and CLI can read them but cannot change them');
    await defaults.getByRole('checkbox', { name: /Instagram · Story/ }).check();
    await defaults.getByRole('checkbox', { name: /Facebook · Story/ }).check();
    await defaults.getByRole('button', { name: 'Save human defaults' }).click();
    await expect(defaults).toBeHidden();

    await page.getByRole('button', { name: 'Plan outputs' }).click();
    const sheet = page.getByRole('dialog', { name: 'Plan next branch' });
    await sheet.getByLabel('Generation prompt').fill('Create exact story variants');
    await sheet.getByRole('button', { name: 'Resolve preview' }).click();
    await expect(sheet.getByText(/1 exact output/)).toBeVisible();
    await expect(sheet.getByText(/in 1 resolved group/)).toBeVisible();
    await expect(sheet.getByText('1080 × 1920 px')).toBeVisible();
    await expect(sheet).toContainText('Instagram Story');
    await expect(sheet).toContainText('Facebook Story');
    await expect(sheet).toContainText('Safe zones are guidance only');

    await sheet.getByRole('button', { name: 'Create planned job' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('.lineage-badges .output-target.locked').first()).toContainText('locked 1080×1920');

    const jobsResponse = await request.get(`/api/generation/jobs?project=${project}&rootAssetId=${seeded.root_asset_id}&limit=10`);
    expect(jobsResponse.ok()).toBe(true);
    const jobs = await jobsResponse.json() as { jobs: Array<{ expected_output_count: number; target_plan?: { groups: Array<{ delivery_surfaces: unknown[]; height: number; unlocked: boolean; width: number }> } }> };
    expect(jobs.jobs[0]).toMatchObject({
      expected_output_count: 1,
      target_plan: {
        groups: [{
          width: 1080,
          height: 1920,
          unlocked: false,
          delivery_surfaces: expect.arrayContaining([
            expect.objectContaining({ platform: 'Instagram', surface: 'Story' }),
            expect.objectContaining({ platform: 'Facebook', surface: 'Story' }),
          ]),
        }],
      },
    });
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});
