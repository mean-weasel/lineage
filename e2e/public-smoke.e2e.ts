import { expect, test } from 'playwright/test';

type WorkspaceListResponse = {
  workspaces?: Array<{ id: string; status?: string }>;
};

test.beforeEach(async ({ request }) => {
  const response = await request.get('/api/lineage-workspaces');
  expect(response.ok()).toBe(true);
  const body = await response.json() as WorkspaceListResponse;
  for (const workspace of body.workspaces || []) {
    if (workspace.status === 'archived') continue;
    const archive = await request.post(`/api/lineage-workspaces/${encodeURIComponent(workspace.id)}/archive`, {
      data: { confirmWrite: true },
    });
    expect(archive.ok()).toBe(true);
  }
});

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

test('shows runtime channel and SQLite identity in settings', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Settings' }).click();

  const release = page.getByLabel('Release information');
  await expect(release).toBeVisible();
  await expect(release.getByText('Version')).toBeVisible();
  await expect(release.getByText('Channel')).toBeVisible();
  await expect(release.getByText('dev', { exact: true })).toBeVisible();
  await expect(release.getByText('Assets', { exact: true })).toBeVisible();
  await expect(release.getByText('SQLite', { exact: true })).toBeVisible();
  await expect(release.getByText(/lineage-e2e-.*\.sqlite/)).toBeVisible();
  await expect(release.getByText(/projects \/ .*workspaces/)).toBeVisible();
});

test('loads the demo lineage from first-run lineage controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('header.lineage-header').getByText('No workspace selected')).toBeVisible();
  await page.locator('header.lineage-header .lineage-overflow summary').click();
  const loadDemo = page.locator('header.lineage-header .lineage-overflow').getByRole('button', { name: 'Load demo lineage' }).first();
  await expect(loadDemo).toBeEnabled();
  const seedResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/lineage-workspaces/demo/seed'
  ));
  await loadDemo.click();
  expect((await seedResponse).ok()).toBe(true);

  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
  await expect(page.getByTestId('lineage-inspecting-title')).toHaveText('Initial Demo Concept', { timeout: 20_000 });
  await expect(page.getByText('No workspace selected')).not.toBeVisible();
  await expect(page.locator('.lineage-scope-bar')).toHaveCount(0);
  await expect(page.locator('.lineage-selection-strip')).toHaveCount(0);
  await expect(page.getByText('ROOT SCOPE')).toHaveCount(0);
  await expect(page.getByText('USE FOR NEXT VARIATION')).toHaveCount(0);

  await page.locator('header.lineage-header .lineage-overflow summary').click();
  await page.getByRole('button', { name: 'Manage selection' }).click();
  await expect(page.locator('#lineage-selection-panel')).toBeVisible();
});

test('creates a lineage workspace from a catalog asset through the modal', async ({ page }) => {
  await page.goto('/');

  await page.locator('header.lineage-header .lineage-primary-controls > button.primary-button').click();
  const modal = page.getByRole('form', { name: 'New lineage' });
  await expect(modal).toBeVisible();
  await page.getByPlaceholder('Search by title, id, campaign, channel...').fill('meta short-form');
  await modal.getByRole('button', { name: /Meta short-form demo post static/ }).click();
  await page.getByLabel('Name').fill('Catalog e2e lineage');
  await page.getByRole('button', { name: 'Create lineage' }).click();

  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Catalog e2e lineage');
  await expect(page.getByText('Unknown indexed asset')).not.toBeVisible();
});
