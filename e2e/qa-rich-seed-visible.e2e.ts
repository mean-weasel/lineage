import { expect, test } from 'playwright/test';

const project = 'demo-project';
const richWorkspaceTitle = 'Swissifier rich demo';

test('QA seed shows truthful progress and rich PNG previews in the first lineage view', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  const actions = page.locator('header.lineage-header .lineage-overflow');
  await actions.locator('summary').click();
  await expect(actions.getByText('Checking media')).toHaveCount(0);
  const download = actions.getByRole('button', { name: 'Download rich images' });
  if (await download.isEnabled()) {
    const downloaded = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/lineage-workspaces/demo/swissifier/media/download');
    await download.click();
    const downloadResponse = await downloaded;
    expect(downloadResponse.ok()).toBe(true);
    await expect(downloadResponse.json()).resolves.toMatchObject({
      result: {
        media_status: { present: 14, total: 14 },
        restored: 14,
      },
    });
  }
  await expect(actions).toContainText('14/14 PNG images');

  await page.evaluate(() => {
    const target = window as unknown as { __lineageStateTranscript: string[] };
    target.__lineageStateTranscript = [];
    const record = () => {
      const state = document.querySelector('[data-lineage-state]');
      const context = document.querySelector('.lineage-toolbar-context');
      target.__lineageStateTranscript.push(`${state?.getAttribute('data-lineage-state') || 'graph'}:${state?.textContent || context?.textContent || ''}`);
    };
    record();
    new MutationObserver(record).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await page.route(/\/api\/lineage\/[^/?]+(?:\?|$)/, async route => {
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  });
  let seedRequests = 0;
  page.on('requestfinished', requestFinished => {
    if (requestFinished.method() === 'POST' && new URL(requestFinished.url()).pathname === '/api/lineage-workspaces/demo/swissifier/seed') seedRequests += 1;
  });
  const seeded = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/lineage-workspaces/demo/swissifier/seed');
  await actions.getByRole('button', { name: 'Load rich image demo' }).click();
  const seedResponse = await seeded;
  expect(seedResponse.ok()).toBe(true);
  const seedResult = await seedResponse.json() as { workspace?: { id: string } };
  const workspaceId = seedResult.workspace?.id;

  try {
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText(richWorkspaceTitle, { timeout: 20_000 });
    await expect(page.locator('.lineage-node')).toHaveCount(14, { timeout: 20_000 });
    await expect(page.locator('.react-flow__edge')).toHaveCount(13);
    await expect(page.locator('.lineage-toolbar-context')).toHaveText('Rich demo ready');
    expect(seedRequests).toBe(1);
    const transcript = await page.evaluate(() => (window as unknown as { __lineageStateTranscript: string[] }).__lineageStateTranscript);
    const operationTranscript = transcript.slice(transcript.findIndex(entry => entry.includes('Creating rich demo workspace')));
    expect(transcript.some(entry => entry.includes('Creating rich demo workspace')), transcript.join('\n')).toBe(true);
    expect(transcript.some(entry => entry.includes('Indexing 14 rich demo images')), transcript.join('\n')).toBe(true);
    expect(operationTranscript.some(entry => entry.includes('No lineage index yet')), operationTranscript.join('\n')).toBe(false);
    expect(consoleErrors).toEqual([]);

    await page.locator('header.lineage-header .lineage-overflow summary').click();
    await expect(page.locator('header.lineage-header .lineage-overflow')).toContainText('QA seed media');
    await expect(page.locator('header.lineage-header .lineage-overflow')).toContainText('14/14 PNG images');
    await page.locator('header.lineage-header .lineage-overflow summary').click();

    const rootNode = page.locator('.lineage-node.root-node');
    await expect(rootNode).toHaveAttribute('title', /^Hover to preview;/);
    const inspector = page.getByTestId('lineage-hover-preview');
    const preview = inspector.locator('.lineage-hover-preview-media img');
    await expect(async () => {
      await page.locator('header.lineage-header .lineage-overflow summary').focus();
      await rootNode.focus();
      await expect(rootNode).toBeFocused();
      await expect(inspector).toBeVisible({ timeout: 1_000 });
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute('src', /rich-demo-drafts.*\.png/);
      const proof = await preview.evaluate((image: HTMLImageElement) => {
        const rect = image.getBoundingClientRect();
        return {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
          objectFit: getComputedStyle(image).objectFit,
          src: image.getAttribute('src') || '',
        };
      });
      expect(proof.naturalWidth).toBeGreaterThan(900);
      expect(proof.naturalHeight).toBeGreaterThan(900);
      expect(proof.renderedWidth).toBeGreaterThan(180);
      expect(proof.renderedHeight).toBeGreaterThan(100);
      expect(proof.objectFit).toBe('contain');
      expect(proof.src).not.toContain('.svg');
    }).toPass({ intervals: [100, 250, 500], timeout: 15_000 });

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
