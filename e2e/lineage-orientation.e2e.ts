import { expect, test, type Locator, type Page } from 'playwright/test';

test('rotates lineage graph layout and handles without stale saved positions', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project: 'demo-project', confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };
  const workspaceId = seeded.workspace?.id;

  try {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Canvas workspace tools' }).locator('.lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });

    const root = lineageNode(page, 'swissifier linkedin root v1');
    const child = lineageNode(page, 'swissifier vertical drill v1');
    await expect(root).toBeVisible();
    await expect(child).toBeVisible();

    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);
    const topToBottomPath = await firstEdgePath(page);
    expect(topToBottomPath).toMatch(/V|Q/);

    await page.getByRole('radio', { name: 'Left to right' }).check();
    await assertRootLeftOfChild(root, child);
    const leftToRightPath = await firstEdgePath(page);
    expect(leftToRightPath).not.toBe(topToBottomPath);

    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);

    await page.getByRole('radio', { name: 'Left to right' }).check();
    await assertRootLeftOfChild(root, child);

    await page.getByRole('radio', { name: 'Portrait cards' }).check();
    await page.getByRole('radio', { name: 'Top to bottom' }).check();
    await assertRootAboveChild(root, child);

    await page.getByRole('radio', { name: 'Compact nodes' }).check();
    await expect(page.getByRole('radio', { name: 'Left to right' })).toBeChecked();
    await assertRootLeftOfChild(root, child);
  } finally {
    if (workspaceId) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(workspaceId)}/archive`, {
        data: { project: 'demo-project', confirmWrite: true },
      });
    }
  }
});

function lineageNode(page: Page, title: string): Locator {
  return page.locator('.react-flow__node').filter({ hasText: title }).first();
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function assertRootLeftOfChild(root: Locator, child: Locator) {
  await expect.poll(async () => {
    const rootBox = await box(root);
    const childBox = await box(child);
    return childBox.x - rootBox.x;
  }).toBeGreaterThan(20);
}

async function assertRootAboveChild(root: Locator, child: Locator) {
  await expect.poll(async () => {
    const rootBox = await box(root);
    const childBox = await box(child);
    return childBox.y - rootBox.y;
  }).toBeGreaterThan(20);
}

async function firstEdgePath(page: Page): Promise<string> {
  await expect(page.locator('.react-flow__edge-path').first()).toBeVisible();
  return await page.locator('.react-flow__edge-path').first().getAttribute('d') || '';
}

async function openCanvasSettings(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}
