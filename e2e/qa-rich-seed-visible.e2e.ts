import { expect, test } from 'playwright/test';

const project = 'demo-project';
const richWorkspaceTitle = 'Swissifier rich demo';

test('QA seed shows rich PNG previews in the first lineage view', async ({ page, request }) => {
  const media = await request.post('/api/lineage-workspaces/demo/swissifier/media/download', {
    data: { project, confirmWrite: true },
  });
  expect(media.ok()).toBe(true);
  const mediaResult = await media.json() as { result?: { media_status?: { present: number; total: number; missing: string[]; invalid: string[] } } };
  expect(mediaResult.result?.media_status).toMatchObject({ present: 14, total: 14, missing: [], invalid: [] });

  const seeded = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project, confirmWrite: true, activate: true },
  });
  expect(seeded.ok()).toBe(true);
  const seedResult = await seeded.json() as { workspace?: { id: string } };
  const workspaceId = seedResult.workspace?.id;

  try {
    await page.goto('/');
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText(richWorkspaceTitle, { timeout: 20_000 });
    await expect(page.locator('.lineage-seed-identity')).toHaveText('Rich PNG seed active');
    await expect(page.locator('.lineage-demo-menu summary')).toContainText('14/14 PNG images');

    const preview = page.locator('.lineage-canvas-status-preview img');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /rich-demo-drafts.*\.png/);

    const proof = await preview.evaluate((image: HTMLImageElement) => {
      const rect = image.getBoundingClientRect();
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        src: image.getAttribute('src') || '',
      };
    });
    expect(proof.naturalWidth).toBeGreaterThan(900);
    expect(proof.naturalHeight).toBeGreaterThan(900);
    expect(proof.renderedWidth).toBeGreaterThan(180);
    expect(proof.renderedHeight).toBeGreaterThan(100);
    expect(proof.src).not.toContain('.svg');

    const visibleSvgPreviews = await page.locator('.lineage-thumb img[src*=".svg"]:visible').count();
    expect(visibleSvgPreviews).toBe(0);
  } finally {
    if (workspaceId) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(workspaceId)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});
