import { expect, test } from 'playwright/test';

test('offers the Canvas settings hint once without obstructing its gear', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?project=demo-project');

  const gear = page.getByRole('button', { name: 'Open Canvas settings' });
  const hint = page.getByRole('note', { name: 'Canvas settings tip' });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Customize your canvas');
  const separated = await hint.evaluate((element, gearLabel) => {
    const hintBox = element.getBoundingClientRect();
    const gearBox = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    return Boolean(gearBox && hintBox.right <= gearBox.left);
  }, 'Open Canvas settings');
  expect(separated).toBe(true);

  await gear.click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Canvas settings' }).click();
  await page.reload();
  await expect(hint).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem('lineage.preferences.canvas-settings-hint-dismissed'))).toBe('true');
});

test('keeps the collapsed contextual-panel trigger inside the navigation rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?project=demo-project');

  await page.getByRole('button', { name: 'Collapse contextual panel' }).click();
  const expand = page.getByRole('button', { name: 'Expand contextual panel' });
  await expect(expand).toBeVisible();

  await expect.poll(async () => expand.evaluate(element => {
    const buttonBox = element.getBoundingClientRect();
    const railBox = element.closest('.navigation-rail')?.getBoundingClientRect();
    const workspaceBox = document.querySelector('.workspace')?.getBoundingClientRect();
    return Boolean(
      railBox
      && workspaceBox
      && buttonBox.left >= railBox.left
      && buttonBox.right <= railBox.right
      && buttonBox.right <= workspaceBox.left
    );
  })).toBe(true);

  await expand.click();
  await expect(page.getByRole('button', { name: 'Collapse contextual panel' })).toBeVisible();
});

test('keeps Canvas full-height and restores focus when its shared panel closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?project=demo-project&lineageCanvas=portrait');

  await expect(page.locator('header.lineage-header')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Canvas workspace tools' })).toBeVisible();
  await expect(page.locator('.lineage-workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: /Agent context/i })).toHaveCount(0);
  await expect(page).toHaveURL(/project=demo-project/);
  await expect(page).toHaveURL(/lineageCanvas=portrait/);

  const gear = page.getByRole('button', { name: 'Open Canvas settings' });
  const closedGeometry = await page.locator('.lineage-canvas').evaluate((canvas, gearLabel) => {
    const canvasBox = canvas.getBoundingClientRect();
    const gearBox = canvas.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    return {
      rightGap: gearBox ? canvasBox.right - gearBox.right : -1,
      topGap: gearBox ? gearBox.top - canvasBox.top : -1,
    };
  }, 'Open Canvas settings');
  expect(closedGeometry.rightGap).toBeGreaterThanOrEqual(16);
  expect(closedGeometry.rightGap).toBeLessThanOrEqual(20);
  expect(closedGeometry.topGap).toBeGreaterThanOrEqual(16);
  expect(closedGeometry.topGap).toBeLessThanOrEqual(20);

  const minimap = page.locator('.react-flow__minimap');
  if (await minimap.count() === 0) {
    const canvasTools = page.getByRole('region', { name: 'Canvas workspace tools' });
    const loadDemo = canvasTools.getByRole('button', { name: 'Load demo lineage' }).first();
    if (await loadDemo.count() === 0) {
      await canvasTools.getByText('Demo/QA', { exact: true }).click();
    }
    await expect(loadDemo).toBeEnabled();
    const seeded = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/lineage-workspaces/demo/seed');
    await loadDemo.click();
    expect((await seeded).ok()).toBe(true);
    await expect(minimap).toBeVisible({ timeout: 20_000 });
  }

  await gear.click();
  const settings = page.getByRole('complementary', { name: 'Canvas settings' });
  await expect(settings).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(settings.getByRole('radio')).toHaveCount(9);
  await expect(settings.getByRole('switch')).toHaveCount(3);
  await expect(settings.getByRole('radio', { name: 'Portrait cards' })).toBeChecked();
  await settings.getByRole('radio', { name: 'Compact nodes' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(settings.getByRole('radio', { name: 'Portrait cards' })).toBeChecked();
  await expect.poll(async () => settings.evaluate((panel, gearLabel) => {
    const panelBox = panel.getBoundingClientRect();
    const gearBox = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    return Boolean(gearBox && gearBox.right <= panelBox.left);
  }, 'Open Canvas settings')).toBe(true);

  await expect(minimap).toBeVisible();
  const minimapSwitch = settings.getByRole('switch', { name: 'Canvas minimap' });
  await expect(minimapSwitch).toHaveAttribute('aria-checked', 'true');
  await minimapSwitch.click();
  await expect(minimapSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(minimap).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await gear.click();
  await expect(page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('switch', { name: 'Canvas minimap' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('button', { name: 'Reset appearance' }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Canvas settings' }).getByRole('switch', { name: 'Canvas minimap' })).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toHaveCount(0);
  await expect(gear).toBeFocused();

  await gear.click();
  await page.getByRole('button', { name: 'Close Canvas panel' }).click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test('uses a mobile navigation dialog and Canvas bottom sheet with focus return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?project=demo-project');

  const navigationTrigger = page.getByRole('button', { name: 'Open navigation panel' });
  await navigationTrigger.click();
  const navigationDialog = page.getByRole('dialog', { name: 'Contextual navigation panel' });
  const closeNavigation = navigationDialog.getByRole('button', { name: 'Close navigation panel' });
  await expect(navigationDialog).toBeVisible();
  await expect(closeNavigation).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(navigationDialog).not.toBeVisible();
  await expect(navigationTrigger).toBeFocused();

  await navigationTrigger.click();
  await page.getByRole('button', { name: 'Close navigation panel' }).last().click({ position: { x: 380, y: 400 } });
  await expect(navigationDialog).not.toBeVisible();
  await expect(navigationTrigger).toBeFocused();

  const mobileGear = page.getByRole('button', { name: 'Open Canvas settings' });
  await mobileGear.click();
  const settings = page.getByRole('complementary', { name: 'Canvas settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Close Canvas settings' })).toBeFocused();
  await expect(settings).toHaveCSS('animation-name', 'none');
  await expect(settings.locator('.lineage-settings-sheet-handle')).toBeVisible();
  const resetAppearance = settings.getByRole('button', { name: 'Reset appearance' });
  const settingsScroller = settings.locator('.lineage-canvas-settings-groups');
  await settingsScroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(settings.getByRole('button', { name: 'Close Canvas settings' })).toBeVisible();
  await expect(resetAppearance).toBeVisible();
  const geometry = await settings.evaluate((element, { gearLabel }) => {
    const box = element.getBoundingClientRect();
    const canvas = document.querySelector('.lineage-canvas')?.getBoundingClientRect();
    const gear = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    const reset = element.querySelector('.lineage-reset-appearance')?.getBoundingClientRect();
    const header = element.querySelector('.lineage-canvas-settings-head')?.getBoundingClientRect();
    const footer = element.querySelector('.lineage-canvas-settings-footer')?.getBoundingClientRect();
    return {
      bottomGap: Math.abs(window.innerHeight - box.bottom),
      canvasWidth: canvas?.width || 0,
      footerAnchored: Boolean(footer && Math.abs(footer.bottom - box.bottom) <= 1),
      gearOverlapsSheet: Boolean(gear
        && gear.left < box.right
        && gear.right > box.left
        && gear.top < box.bottom
        && gear.bottom > box.top),
      gearOverlapsReset: Boolean(gear && reset
        && gear.left < reset.right
        && gear.right > reset.left
        && gear.top < reset.bottom
        && gear.bottom > reset.top),
      rightGap: canvas && gear ? canvas.right - gear.right : -1,
      headerAnchored: Boolean(header && Math.abs(header.top - box.top) <= 1),
      topGap: canvas && gear ? gear.top - canvas.top : -1,
      width: box.width,
    };
  }, { gearLabel: 'Open Canvas settings' });
  await expect(resetAppearance).toBeVisible();
  expect(geometry.bottomGap).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.canvasWidth - geometry.width)).toBeLessThanOrEqual(1);
  expect(geometry.headerAnchored).toBe(true);
  expect(geometry.footerAnchored).toBe(true);
  expect(geometry.gearOverlapsSheet).toBe(false);
  expect(geometry.gearOverlapsReset).toBe(false);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(16);
  expect(geometry.rightGap).toBeLessThanOrEqual(20);
  expect(geometry.topGap).toBeGreaterThanOrEqual(16);
  expect(geometry.topGap).toBeLessThanOrEqual(20);
});
