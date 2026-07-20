import { expect, test, type Locator, type Page } from 'playwright/test';

type WorkspaceListResponse = {
  workspaces?: Array<{ id: string; status?: string }>;
};

async function loadDemoLineage(page: Page, button: Locator) {
  const actionMenu = page.locator('header.lineage-header .lineage-overflow');
  await expect(actionMenu.getByText('Checking media')).toHaveCount(0);
  await expect(button).toBeEnabled();
  let completedSeedRequests = 0;
  const finalLineageResponse = page.waitForResponse(response => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    if (request.method() === 'POST' && path === '/api/lineage-workspaces/demo/seed') {
      if (response.ok()) completedSeedRequests += 1;
      return false;
    }
    return completedSeedRequests >= 2
      && request.method() === 'GET'
      && /^\/api\/lineage\/[^/]+$/.test(path);
  });
  await button.click();
  expect((await finalLineageResponse).ok()).toBe(true);
}

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

test('lets users disable lineage hover previews without disabling details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const hoverPreviewSwitch = page.getByRole('switch', { name: 'Enable lineage hover previews' });
  await expect(hoverPreviewSwitch).toBeChecked();
  await hoverPreviewSwitch.click();
  await expect(hoverPreviewSwitch).not.toBeChecked();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: 'Enable lineage hover previews' })).not.toBeChecked();

  await page.getByRole('button', { name: 'Lineage' }).click();
  await page.locator('header.lineage-header .lineage-overflow summary').click();
  await loadDemoLineage(page, page.locator('header.lineage-header .lineage-overflow').getByRole('button', { name: 'Load demo lineage' }).first());
  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree');
  const rootNode = page.locator('.lineage-node.root-node');
  await expect(rootNode).toBeVisible();
  await rootNode.hover();
  await expect(page.getByTestId('lineage-hover-preview')).toHaveCount(0);

  await rootNode.dblclick();
  await expect(page.getByRole('dialog', { name: 'Initial Demo Concept' })).toBeVisible();
});

test('loads the demo lineage from first-run lineage controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('header.lineage-header').getByText('No workspace selected')).toBeVisible();
  await page.locator('header.lineage-header .lineage-overflow summary').click();
  const loadDemo = page.locator('header.lineage-header .lineage-overflow').getByRole('button', { name: 'Load demo lineage' }).first();
  await loadDemoLineage(page, loadDemo);

  await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
  await expect(page.getByText('No workspace selected')).not.toBeVisible();
  await expect(page.locator('.lineage-scope-bar')).toHaveCount(0);
  await expect(page.locator('.lineage-selection-strip')).toHaveCount(0);
  await expect(page.getByText('ROOT SCOPE')).toHaveCount(0);
  await expect(page.getByText('USE FOR NEXT VARIATION')).toHaveCount(0);

  const rootNode = page.locator('.lineage-node.root-node');
  await expect(rootNode).toHaveAttribute('data-lineage-root', 'true');
  expect(await rootNode.evaluate(node => node.closest('.react-flow__node')?.getAttribute('tabindex') ?? null)).toBeNull();
  await expect(page.getByTestId('lineage-canvas-status')).toHaveCount(0);
  await page.waitForTimeout(500); // Allow the intentional first-load viewport fit to finish before preview arbitration.
  await rootNode.hover();
  const hoverPreview = page.getByTestId('lineage-hover-preview');
  await expect(hoverPreview).toBeVisible();
  await expect(hoverPreview.locator('img')).toBeVisible();
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  const branchAction = hoverPreview.getByRole('button', { name: /Branch/ });
  await expect(branchAction).toBeVisible();
  const rerollAction = hoverPreview.getByRole('button', { name: /Re-roll/ });
  await expect(rerollAction).toBeVisible();
  await expect(hoverPreview.getByRole('button', { name: /Details/ })).toBeVisible();
  await branchAction.hover();
  await expect(hoverPreview).toBeVisible();
  await branchAction.click();
  await expect(branchAction).toHaveAttribute('aria-pressed', 'true');
  await branchAction.click();
  await expect(branchAction).toHaveAttribute('aria-pressed', 'false');
  await rerollAction.click();
  await expect(rerollAction).toHaveAttribute('aria-pressed', 'true');
  await rerollAction.click();
  await expect(rerollAction).toHaveAttribute('aria-pressed', 'false');

  const firstCandidate = page.locator('.lineage-node:not(.root-node)').first();
  const anotherNodeTitle = await firstCandidate.locator('strong').textContent();
  expect(anotherNodeTitle).toBeTruthy();
  const anotherNode = page.locator('.lineage-node:not(.root-node)').filter({ hasText: anotherNodeTitle! }).first();
  await page.mouse.move(0, 0);
  await anotherNode.focus();
  await expect(hoverPreview).toHaveCount(1);
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await page.mouse.move(0, 0);
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await rootNode.evaluate(node => node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  await rootNode.evaluate(node => node.dispatchEvent(new MouseEvent('mouseout', {
    bubbles: true,
    relatedTarget: document.body,
  })));
  await expect(hoverPreview).toContainText(anotherNodeTitle!);
  await anotherNode.press('Enter');
  await expect(hoverPreview).toHaveCount(0);
  const keyboardDialog = page.getByRole('dialog').first();
  await expect(keyboardDialog).toBeVisible();
  await keyboardDialog.getByRole('button', { name: 'Close' }).click();

  await rootNode.focus();
  await rootNode.press('d');
  const shortcutDetailDialog = page.getByRole('dialog', { name: 'Initial Demo Concept' });
  await expect(shortcutDetailDialog).toBeVisible();
  await shortcutDetailDialog.getByTitle('Close detail').click();

  await rootNode.hover();
  await expect(hoverPreview).toBeVisible();
  await rootNode.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(hoverPreview).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await rootNode.dblclick();
  const detailDialog = page.getByRole('dialog', { name: 'Initial Demo Concept' });
  await expect(detailDialog).toBeVisible();
  await expect(hoverPreview).toHaveCount(0);
  await detailDialog.getByTitle('Close detail').click();

  await rootNode.focus();
  await page.mouse.move(0, 0);
  await expect(hoverPreview).toContainText('Initial Demo Concept');
  await page.getByLabel('Lineage graph direction').evaluate((select: HTMLSelectElement) => {
    select.value = 'TB';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(hoverPreview).toHaveCount(0);

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
