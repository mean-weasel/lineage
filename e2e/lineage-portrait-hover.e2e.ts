import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('toggles and remembers hover previews for portrait cards', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };

  try {
    await page.goto('/?project=demo-project&lineageCanvas=compact');
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    const actions = page.locator('header.lineage-header .lineage-overflow');
    await actions.locator('summary').click();
    await page.getByLabel('Canvas card style').selectOption('portrait');
    const rootNode = page.locator('.lineage-node.root-node');
    await expect(rootNode).toHaveClass(/lineage-node-portrait/);
    await expect.poll(() => graphFitsInsideCanvas(page), { timeout: 10_000 }).toBe(true);
    await expect(rootNode.locator('.lineage-node-overview-markers .review')).toBeVisible();
    await actions.locator('summary').click();
    await rootNode.hover();
    const preview = page.getByTestId('lineage-hover-preview');
    await expect(preview).toBeVisible();

    await actions.locator('summary').click();
    const hoverPreviews = page.getByLabel('Canvas hover previews');
    await expect(hoverPreviews).toHaveValue('enabled');
    await hoverPreviews.selectOption('disabled');
    await expect(preview).toHaveCount(0);
    await actions.locator('summary').click();
    await rootNode.hover();
    await expect(preview).toHaveCount(0);

    await page.reload();
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    await actions.locator('summary').click();
    await expect(page.getByLabel('Canvas card style')).toHaveValue('portrait');
    await expect(page.getByLabel('Canvas hover previews')).toHaveValue('disabled');
    await page.getByLabel('Canvas hover previews').selectOption('enabled');
    await actions.locator('summary').click();
    await page.locator('.lineage-node.root-node').hover();
    await expect(preview).toBeVisible();

    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new Error('storage denied'); };
    });
    await actions.locator('summary').click();
    await page.getByLabel('Canvas edge weight').selectOption('bold');
    await expect(page.getByRole('status')).toContainText('Edge weight changed for this session');
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});

async function graphFitsInsideCanvas(page: import('playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.lineage-canvas')?.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
    if (!canvas || nodes.length !== 14) return false;
    const tolerance = 1;
    return Math.min(...nodes.map(node => node.left)) >= canvas.left - tolerance
      && Math.max(...nodes.map(node => node.right)) <= canvas.right + tolerance
      && Math.min(...nodes.map(node => node.top)) >= canvas.top - tolerance
      && Math.max(...nodes.map(node => node.bottom)) <= canvas.bottom + tolerance;
  });
}
