import { expect, test } from 'playwright/test';

test('loads the public demo project and app shell', async ({ page, request }) => {
  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);

  const body = await projectsResponse.json() as { projects: Array<{ project: string; asset_count: number }> };
  expect(body.projects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ project: 'demo-project', asset_count: expect.any(Number) }),
    ])
  );

  await page.goto('/');
  await expect(page.getByText('Lineage').first()).toBeVisible();
});

test('loads the demo lineage from first-run lineage controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('header.lineage-header').getByText('No workspace selected')).toBeVisible();
  const loadDemo = page.locator('header.lineage-header').getByRole('button', { name: 'Load demo lineage' }).first();
  await expect(loadDemo).toBeEnabled();
  await loadDemo.click();

  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
  await expect(page.getByTestId('lineage-inspecting-title')).toHaveText('Initial Demo Concept', { timeout: 20_000 });
  await expect(page.getByText('No workspace selected')).not.toBeVisible();
});

test('creates a lineage workspace from a catalog asset through the modal', async ({ page }) => {
  await page.goto('/');

  await page.locator('header.lineage-header .lineage-primary-controls > button.primary-button').click();
  await expect(page.getByRole('form', { name: 'New lineage' })).toBeVisible();
  await page.getByPlaceholder('Search by title, id, campaign, channel...').fill('meta short-form');
  await page.getByRole('button', { name: /Meta short-form demo post static/ }).click();
  await page.getByLabel('Name').fill('Catalog e2e lineage');
  await page.getByRole('button', { name: 'Create lineage' }).click();

  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Catalog e2e lineage');
  await expect(page.getByText('Unknown indexed asset')).not.toBeVisible();
});
