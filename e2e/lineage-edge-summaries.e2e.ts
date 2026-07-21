import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from 'playwright/test';

const project = 'demo-project';
const rootId = 'local-5748fb8ba6df';
const posterId = 'local-befe299c503d';
const drillId = 'local-2e102785131f';
const legacyId = 'local-27050bc5c393';
const posterEdgeId = `${project}:${rootId}:derived_from:${posterId}`;
const drillEdgeId = `${project}:${rootId}:derived_from:${drillId}`;
const legacyEdgeId = `${project}:${rootId}:derived_from:${legacyId}`;
const posterEdgeName = 'swissifier linkedin root v1 to swissifier vertical poster v1: Poster focus';
const drillEdgeName = 'swissifier linkedin root v1 to swissifier vertical drill v1: Drill focus';
const legacyEdgeName = 'swissifier linkedin root v1 to swissifier vertical before after v1';
const restColors = {
  backgroundFill: 'rgb(251, 253, 255)',
  backgroundOpacity: '0.88',
  backgroundStroke: 'rgb(212, 221, 227)',
  textFill: 'rgb(88, 107, 118)',
};
const interactionColors = {
  backgroundFill: 'rgb(255, 255, 255)',
  backgroundOpacity: '0.98',
  backgroundStroke: 'rgb(113, 138, 151)',
  textFill: 'rgb(24, 49, 60)',
};

test('shows and safely edits accessible edge summaries in every direction', async ({ page, request }) => {
  const seed = await request.post('/api/lineage-workspaces/demo/swissifier/seed', {
    data: { project, confirmWrite: true },
  });
  expect(seed.ok()).toBe(true);
  const seeded = await seed.json() as { workspace?: { id: string } };
  seedIsolatedEdgeSummaries();

  try {
    await page.goto('/');
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });

    const posterEdge = page.locator('.react-flow__edge').filter({ has: page.locator('.react-flow__edge-text', { hasText: 'Poster focus' }) });
    const drillEdge = page.locator('.react-flow__edge').filter({ has: page.locator('.react-flow__edge-text', { hasText: 'Drill focus' }) });
    const legacyEdge = page.locator(`.react-flow__edge[aria-label="${legacyEdgeName}"]`);
    await expect(posterEdge).toHaveAttribute('aria-label', posterEdgeName);
    await expect(drillEdge).toHaveAttribute('aria-label', drillEdgeName);
    await expect(legacyEdge).toHaveCount(1);
    await expect(legacyEdge.locator('.react-flow__edge-text')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(12);

    for (const direction of ['TB', 'RL', 'BT', 'LR']) {
      await selectDirection(page, direction);
      await expectHorizontalLabel(posterEdge.locator('.react-flow__edge-text'));
    }

    const interactionBackground = await visibleSummaryBackground(page);
    const interactionEdge = interactionBackground.locator('xpath=../..');
    const interactionLabel = interactionEdge.locator('.react-flow__edge-text');
    await expect.poll(() => labelColors(interactionLabel, interactionBackground)).toEqual(restColors);
    await interactionBackground.hover();
    await expect.poll(() => labelColors(interactionLabel, interactionBackground)).toEqual(interactionColors);

    await page.locator('header.lineage-header').hover();
    await interactionBackground.click();
    await expect(interactionEdge).toHaveClass(/selected/);
    await expect.poll(() => labelColors(interactionLabel, interactionBackground)).toEqual(interactionColors);

    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
    await expect(interactionEdge).not.toHaveClass(/selected/);
    await expect.poll(() => labelColors(interactionLabel, interactionBackground)).toEqual(restColors);
    await interactionEdge.focus();
    await expect(interactionEdge).toBeFocused();
    await expect.poll(() => labelColors(interactionLabel, interactionBackground)).toEqual(interactionColors);

    const legacyEdgeById = edgeById(page, legacyEdgeId);
    await legacyEdgeById.focus();
    await legacyEdgeById.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit edge label' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Edge label' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Edge label' }).fill('  Legacy\n label  ');
    await submitEdgeSummary(page, 'Save label', 200);
    await expect(legacyEdgeById).toHaveAttribute('aria-label', `${legacyEdgeName}: Legacy label`);
    expect(readEdgeSummary(legacyEdgeId)).toMatchObject({
      summary: 'Legacy label',
      summary_created_by: 'human',
      summary_updated_by: 'human',
    });

    await page.reload();
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    await expect(edgeById(page, legacyEdgeId)).toHaveAttribute('aria-label', `${legacyEdgeName}: Legacy label`);

    await openEdgeSummaryWithDoubleClick(page, posterEdgeId);
    await expect(page.getByText('Agent-generated', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Edge label' }).fill('Human edit');
    await submitEdgeSummary(page, 'Save label', 200);
    await expect(edgeById(page, posterEdgeId)).toHaveAttribute('aria-label', 'swissifier linkedin root v1 to swissifier vertical poster v1: Human edit');
    expect(readEdgeSummary(posterEdgeId)).toMatchObject({
      summary: 'Human edit',
      summary_created_by: 'agent',
      summary_updated_by: 'human',
    });

    const drillEdgeById = edgeById(page, drillEdgeId);
    await drillEdgeById.focus();
    await drillEdgeById.press(' ');
    await page.getByRole('textbox', { name: 'Edge label' }).fill('one two three');
    await expect(page.getByText('Edge summary must contain at most 2 words')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save label' })).toBeDisabled();
    expect(readEdgeSummary(drillEdgeId).summary).toBe('Drill focus');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(drillEdgeById).toBeFocused();

    await drillEdgeById.press('Enter');
    updateEdgeSummaryDirectly(drillEdgeId, 'Concurrent edit', '2026-07-20T12:30:00.000Z');
    await page.getByRole('textbox', { name: 'Edge label' }).fill('My edit');
    await submitEdgeSummary(page, 'Save label', 409);
    await expect(page.getByRole('alert')).toContainText('changed elsewhere');
    await expect(page.getByRole('textbox', { name: 'Edge label' })).toHaveValue('Concurrent edit');
    expect(readEdgeSummary(drillEdgeId).summary).toBe('Concurrent edit');
    await page.getByRole('textbox', { name: 'Edge label' }).fill('My edit');
    await submitEdgeSummary(page, 'Save label', 200);
    expect(readEdgeSummary(drillEdgeId)).toMatchObject({ summary: 'My edit', summary_updated_by: 'human' });

    await edgeById(page, posterEdgeId).focus();
    await edgeById(page, posterEdgeId).press('Enter');
    await expect(page.getByText('Agent-generated · Human-edited')).toBeVisible();
    await submitEdgeSummary(page, 'Clear label', 200);
    await expect(edgeById(page, posterEdgeId).locator('.react-flow__edge-text')).toHaveCount(0);
    expect(readEdgeSummary(posterEdgeId)).toMatchObject({
      summary: null,
      summary_created_by: 'agent',
      summary_updated_by: 'human',
    });

    await page.reload();
    await expect(page.locator('header.lineage-header .lineage-workspace-trigger strong')).toHaveText('Swissifier rich demo', { timeout: 20_000 });
    await expect(edgeById(page, posterEdgeId).locator('.react-flow__edge-text')).toHaveCount(0);
    await expect(edgeById(page, drillEdgeId)).toHaveAttribute('aria-label', 'swissifier linkedin root v1 to swissifier vertical drill v1: My edit');
    await expect(edgeById(page, legacyEdgeId)).toHaveAttribute('aria-label', `${legacyEdgeName}: Legacy label`);

    await openLineageActions(page);
    const hideLabels = page.getByRole('button', { name: 'Hide edge labels' });
    await expect(hideLabels).toHaveAttribute('aria-pressed', 'true');
    await hideLabels.click();
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(0);
    await expect(edgeById(page, drillEdgeId)).toHaveAttribute('aria-label', 'swissifier linkedin root v1 to swissifier vertical drill v1: My edit');

    await openLineageActions(page);
    const showLabels = page.getByRole('button', { name: 'Show edge labels' });
    await expect(showLabels).toHaveAttribute('aria-pressed', 'false');
    await showLabels.click();
    await expect(page.locator('.react-flow__edge-text')).toHaveCount(12);

    const rootNode = page.locator('.react-flow__node').filter({ hasText: 'swissifier linkedin root v1' });
    await rootNode.click();
    await expect(page.locator('.lineage-canvas')).toHaveClass(/focus-active/);
    await expect(page.getByTestId('lineage-canvas-status')).toHaveCount(0);
  } finally {
    if (seeded.workspace?.id) {
      await request.post(`/api/lineage-workspaces/${encodeURIComponent(seeded.workspace.id)}/archive`, {
        data: { project, confirmWrite: true },
      });
    }
  }
});

function edgeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__edge[data-id="${id}"]`);
}

async function openEdgeSummaryWithDoubleClick(page: Page, edgeId: string) {
  const dialog = page.getByRole('dialog', { name: 'Edit edge label' });
  const target = edgeById(page, edgeId).locator('.react-flow__edge-textbg');
  await expect(target).toBeVisible();
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await target.dblclick();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ intervals: [100, 250, 500], timeout: 5_000 });
}

async function submitEdgeSummary(page: Page, buttonName: 'Save label' | 'Clear label', status: number) {
  const response = page.waitForResponse(candidate => (
    candidate.request().method() === 'POST'
    && new URL(candidate.url()).pathname.includes('/api/lineage/edges/')
    && new URL(candidate.url()).pathname.endsWith('/summary')
  ));
  await page.getByRole('button', { name: buttonName }).click();
  expect((await response).status()).toBe(status);
}

function readEdgeSummary(edgeId: string): { summary: string | null; summary_created_by: string | null; summary_updated_by: string | null; summary_updated_at: string | null } {
  const database = edgeSummaryDatabase();
  try {
    const row = database.prepare(`
      select summary, summary_created_by, summary_updated_by, summary_updated_at
      from asset_edges where id = ?
    `).get(edgeId);
    if (!row) throw new Error(`Missing isolated edge ${edgeId}`);
    return row as { summary: string | null; summary_created_by: string | null; summary_updated_by: string | null; summary_updated_at: string | null };
  } finally {
    database.close();
  }
}

function updateEdgeSummaryDirectly(edgeId: string, summary: string, updatedAt: string) {
  const database = edgeSummaryDatabase();
  try {
    database.prepare(`
      update asset_edges
      set summary = ?, summary_updated_by = 'human', summary_updated_at = ?
      where id = ?
    `).run(summary, updatedAt, edgeId);
  } finally {
    database.close();
  }
}

function seedIsolatedEdgeSummaries() {
  const database = edgeSummaryDatabase();
  try {
    const edges = database.prepare(`
      select id, parent_asset_id, child_asset_id
      from asset_edges
      where project_id = ?
      order by parent_asset_id, child_asset_id
    `).all(project) as Array<{ child_asset_id: string; id: string; parent_asset_id: string }>;
    let generatedIndex = 0;
    for (const edge of edges) {
      if (edge.parent_asset_id === rootId && edge.child_asset_id === legacyId) {
        database.prepare(`
          update asset_edges
          set summary = null, summary_created_by = null, summary_updated_by = null, summary_updated_at = null
          where id = ?
        `).run(edge.id);
        continue;
      }
      const summary = edge.parent_asset_id === rootId && edge.child_asset_id === posterId
        ? 'Poster focus'
        : edge.parent_asset_id === rootId && edge.child_asset_id === drillId
          ? 'Drill focus'
          : `Change ${++generatedIndex}`;
      database.prepare(`
        update asset_edges
        set summary = ?, summary_created_by = 'agent', summary_updated_by = 'agent', summary_updated_at = ?
        where id = ?
      `).run(summary, '2026-07-20T12:00:00.000Z', edge.id);
    }
  } finally {
    database.close();
  }
}

function edgeSummaryDatabase(): DatabaseSync {
  const databasePath = process.env.LINEAGE_E2E_DB;
  if (!databasePath) throw new Error('LINEAGE_E2E_DB is required for the isolated edge-summary fixture');
  const database = new DatabaseSync(databasePath);
  database.exec('pragma busy_timeout = 5000');
  return database;
}

async function selectDirection(page: Page, direction: string) {
  await openLineageActions(page);
  const directionSelect = page.getByLabel('Lineage graph direction');
  const layoutSaved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/lineage/layout');
  const lineageRefreshed = page.waitForResponse(response => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/lineage/${rootId}`
  ));
  await directionSelect.selectOption(direction);
  await layoutSaved;
  await lineageRefreshed;
  await expect(directionSelect).toHaveValue(direction);
  await expect(page.locator('.lineage-canvas')).toHaveClass(/focus-active/);
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.lineage-canvas')).not.toHaveClass(/focus-active/);
}

async function openLineageActions(page: Page) {
  const actions = page.locator('header.lineage-header .lineage-overflow');
  if (await actions.getAttribute('open') === null) await actions.locator('summary').click();
}

async function expectHorizontalLabel(label: Locator) {
  await expect(label).toBeVisible();
  const geometry = await label.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { height: box.height, width: box.width, writingMode: getComputedStyle(element).writingMode };
  });
  expect(geometry.width).toBeGreaterThan(geometry.height * 2);
  expect(geometry.writingMode).toBe('horizontal-tb');
}

async function visibleSummaryBackground(page: Page): Promise<Locator> {
  const backgrounds = page.locator('.react-flow__edge-textbg');
  const visibleIndices = await backgrounds.evaluateAll(elements => {
    const viewport = document.querySelector('[data-testid="rf__wrapper"]')?.getBoundingClientRect();
    if (!viewport) return [];
    return elements.flatMap((element, index) => {
      const box = element.getBoundingClientRect();
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const inside = box.width > 0 && box.height > 0
        && centerX >= viewport.left && centerX <= viewport.right
        && centerY >= viewport.top && centerY <= viewport.bottom;
      return inside && document.elementFromPoint(centerX, centerY) === element ? [index] : [];
    });
  });
  expect(visibleIndices.length).toBeGreaterThanOrEqual(1);
  return backgrounds.nth(visibleIndices[0]);
}

async function labelColors(label: Locator, background: Locator) {
  return {
    backgroundFill: await background.evaluate(element => getComputedStyle(element).fill),
    backgroundOpacity: await background.evaluate(element => getComputedStyle(element).fillOpacity),
    backgroundStroke: await background.evaluate(element => getComputedStyle(element).stroke),
    textFill: await label.evaluate(element => getComputedStyle(element).fill),
  };
}
