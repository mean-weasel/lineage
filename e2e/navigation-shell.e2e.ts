import { expect, test } from 'playwright/test';

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
  const resetAppearance = settings.getByRole('button', { name: 'Reset appearance' });
  const geometry = await settings.evaluate((element, { gearLabel, resetLabel }) => {
    const box = element.getBoundingClientRect();
    const canvas = document.querySelector('.lineage-canvas')?.getBoundingClientRect();
    const gear = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    const reset = Array.from(element.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === resetLabel)
      ?.getBoundingClientRect();
    return {
      bottomGap: canvas ? Math.abs(canvas.bottom - box.bottom) : -1,
      canvasWidth: canvas?.width || 0,
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
      topGap: canvas && gear ? gear.top - canvas.top : -1,
      width: box.width,
    };
  }, { gearLabel: 'Open Canvas settings', resetLabel: 'Reset appearance' });
  await expect(resetAppearance).toBeVisible();
  expect(geometry.bottomGap).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.canvasWidth - geometry.width)).toBeLessThanOrEqual(1);
  expect(geometry.gearOverlapsSheet).toBe(false);
  expect(geometry.gearOverlapsReset).toBe(false);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(16);
  expect(geometry.rightGap).toBeLessThanOrEqual(20);
  expect(geometry.topGap).toBeGreaterThanOrEqual(16);
  expect(geometry.topGap).toBeLessThanOrEqual(20);
});
