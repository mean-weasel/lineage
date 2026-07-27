import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('canvas retains and persists an independent two-source map with three groups and five outputs', async ({ page, request }) => {
  const seededResponse = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seededResponse.ok()).toBe(true);
  const seeded = await seededResponse.json() as { root_asset_id: string; workspace?: { id: string } };

  try {
    const snapshotResponse = await request.get(`/api/lineage/${seeded.root_asset_id}?project=${project}`);
    expect(snapshotResponse.ok()).toBe(true);
    const snapshot = await snapshotResponse.json() as { nodes: Array<{ asset_id: string }>; selected: string[] };
    const firstSource = snapshot.selected[0] || seeded.root_asset_id;
    const secondSource = snapshot.nodes.find(node => node.asset_id !== firstSource);
    expect(secondSource).toBeTruthy();
    const selectionResponse = await request.post('/api/selection', {
      data: {
        project,
        assetId: secondSource!.asset_id,
        rootAssetId: seeded.root_asset_id,
        mode: 'add',
        confirmWrite: true,
      },
    });
    expect(selectionResponse.ok()).toBe(true);

    await page.goto(`/?project=${project}`);
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });

    await page.locator('.lineage-overflow summary').click();
    await page.getByRole('button', { name: 'Output target defaults' }).click();
    const defaults = page.getByRole('dialog', { name: 'Output target defaults' });
    await expect(defaults).toContainText('agents and CLI can read them but cannot change them');
    await defaults.getByRole('checkbox', { name: /Instagram · Story/ }).check();
    await defaults.getByRole('checkbox', { name: /Facebook · Story/ }).uncheck();
    await defaults.getByRole('button', { name: 'Save human defaults' }).click();
    await expect(defaults).toBeHidden();

    await page.getByRole('button', { name: 'Plan outputs' }).click();
    const sheet = page.getByRole('dialog', { name: 'Plan next branch' });
    const sources = sheet.locator('.lineage-source-targets');
    await expect(sources).toHaveCount(2);
    const sourceOne = sources.nth(0);
    const sourceTwo = sources.nth(1);

    await sourceOne.getByRole('checkbox', { name: /Facebook · Story/ }).check();
    await sourceOne.locator('.lineage-target-row').filter({ hasText: 'Facebook · Story' }).getByLabel('Create separate variants').check();
    await sourceOne.locator('.lineage-source-default-count input').fill('2');
    await sourceOne.locator('.lineage-advanced-counts summary').click();
    await sourceOne.locator('.lineage-advanced-counts input[aria-label$="Story count"]').nth(1).fill('1');

    await sourceTwo.getByRole('checkbox', { name: /Instagram · Story/ }).uncheck();
    await sourceTwo.locator('.lineage-source-default-count input').fill('2');
    await sourceTwo.getByRole('button', { name: 'Add custom size' }).click();
    await sourceTwo.getByLabel(/custom size 1 width/).fill('1200');
    await sourceTwo.getByLabel(/custom size 1 height/).fill('1500');

    await sheet.getByLabel('Generation prompt').fill('Create independent story and custom variants');
    await sheet.getByRole('button', { name: 'Resolve preview' }).click();
    await expect(sheet.getByText(/5 exact outputs/)).toBeVisible();
    await expect(sheet.getByText(/in 3 resolved groups/)).toBeVisible();
    await expect(sheet.getByText('1080 × 1920 px')).toHaveCount(2);
    await expect(sheet.getByText('1200 × 1500 px')).toBeVisible();
    await expect(sheet).toContainText('Instagram Story');
    await expect(sheet).toContainText('Facebook Story');
    await expect(sheet).toContainText('explicit split');
    await expect(sheet).toContainText('No delivery destination');
    await expect(sheet).toContainText('Safe zones are guidance only');

    await sheet.getByRole('button', { name: 'Create planned job' }).click();
    await expect(sheet).toBeHidden();
    const lockedBadges = page.locator('.lineage-badges .output-target.locked');
    await expect(lockedBadges.filter({ hasText: 'locked 1080×1920' })).toHaveCount(1);
    await expect(lockedBadges.filter({ hasText: 'locked 1200×1500' })).toHaveCount(1);

    const jobsResponse = await request.get(`/api/generation/jobs?project=${project}&rootAssetId=${seeded.root_asset_id}&limit=10`);
    expect(jobsResponse.ok()).toBe(true);
    const jobs = await jobsResponse.json() as {
      jobs: Array<{
        expected_output_count: number;
        target_plan?: {
          groups: Array<{
            delivery_surfaces: Array<{ platform: string; surface: string }>;
            grouping_mode: string;
            height: number;
            parent_asset_id: string;
            variant_count: number;
            width: number;
          }>;
          map: { sources: Array<Record<string, unknown>> };
        };
      }>;
    };
    expect(jobs.jobs[0]).toMatchObject({
      expected_output_count: 5,
      target_plan: {
        groups: expect.any(Array),
      },
    });
    const targetPlan = jobs.jobs[0].target_plan!;
    expect(targetPlan.map.sources).toEqual([
      {
        asset_id: firstSource,
        default_variant_count: 2,
        separate_surface_ids: ['facebook.story'],
        targets: [
          { kind: 'delivery_surface', surface_id: 'facebook.story', surface_version: 1, variant_count: 1 },
          { kind: 'delivery_surface', surface_id: 'instagram.story', surface_version: 1 },
        ],
      },
      {
        asset_id: secondSource!.asset_id,
        default_variant_count: 2,
        separate_surface_ids: [],
        targets: [{ kind: 'custom', width: 1200, height: 1500 }],
      },
    ].sort((left, right) => left.asset_id.localeCompare(right.asset_id)));
    const groupSemantics = targetPlan.groups.map(group => ({
      destinations: group.delivery_surfaces.map(surface => `${surface.platform}.${surface.surface}`).sort(),
      grouping_mode: group.grouping_mode,
      height: group.height,
      parent_asset_id: group.parent_asset_id,
      variant_count: group.variant_count,
      width: group.width,
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    expect(groupSemantics).toEqual([
      { destinations: ['Instagram.Story'], grouping_mode: 'consolidated', height: 1920, parent_asset_id: firstSource, variant_count: 2, width: 1080 },
      { destinations: ['Facebook.Story'], grouping_mode: 'explicit_split', height: 1920, parent_asset_id: firstSource, variant_count: 1, width: 1080 },
      { destinations: [], grouping_mode: 'consolidated', height: 1500, parent_asset_id: secondSource!.asset_id, variant_count: 2, width: 1200 },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});
