import { expect, test } from 'playwright/test';

const project = 'demo-project';

test('collapses lineage branches in both card modes while preserving nested choices', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };

  try {
    await page.goto('/?project=demo-project&lineageCanvas=portrait');
    await expect(page.getByRole('region', { name: 'Canvas workspace tools' }).locator('.lineage-workspace-trigger strong'))
      .toHaveText('Demo: Content iteration tree', { timeout: 20_000 });
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    await expect(page.locator('.react-flow__edge')).toHaveCount(9);

    const rootFlowNode = page.locator('.react-flow__node:has(.lineage-node.root-node)');
    const rootBeforeCollapse = await requiredBox(rootFlowNode);
    await page.getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    assertSameAnchor(rootBeforeCollapse, await requiredBox(rootFlowNode));
    await page.getByRole('button', { name: 'Expand 9 hidden descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    assertSameAnchor(rootBeforeCollapse, await requiredBox(rootFlowNode));

    const hookToggle = page.getByRole('button', { name: 'Collapse 3 descendants of Hook A v01' });
    await expect(hookToggle).toHaveAttribute('aria-expanded', 'true');
    await hookToggle.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' }))
      .toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'Collapse 6 descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await page.getByRole('button', { name: 'Expand 6 hidden descendants of Initial Demo Concept' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' })).toBeVisible();

    await page.getByRole('button', { name: 'Expand 3 hidden descendants of Hook A v01' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(10);
    await expect(page.locator('.react-flow__edge')).toHaveCount(9);

    await openCanvasSettings(page);
    await page.getByRole('radio', { name: 'Compact nodes' }).check();
    await expect(page.locator('.lineage-node.root-node')).toHaveClass(/lineage-node-compact/);
    await expect(page.locator('.react-flow__node:has(.lineage-node.root-node)').getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' }))
      .toHaveClass(/lineage-branch-toggle-right/);
    await page.getByRole('button', { name: 'Close Canvas settings' }).click();

    await page.getByRole('button', { name: 'Replay growth' }).click();
    await expect(page.getByRole('button', { name: 'Collapse 9 descendants of Initial Demo Concept' })).toBeDisabled();
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});

async function openCanvasSettings(page: import('playwright/test').Page) {
  const panel = page.getByRole('complementary', { name: 'Canvas settings' });
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'Open Canvas settings' }).click();
  await expect(panel).toBeVisible();
}

async function requiredBox(locator: import('playwright/test').Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function assertSameAnchor(expected: { x: number; y: number }, actual: { x: number; y: number }) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
}
