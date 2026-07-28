import { expect, test } from 'playwright/test';

test('keeps Canvas full-height and restores focus when its shared panel closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?project=demo-project&lineageCanvas=portrait');

  await expect(page.locator('header.lineage-header')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Canvas workspace tools' })).toBeVisible();
  await expect(page.locator('.lineage-workbench')).toBeVisible();
  await expect(page).toHaveURL(/project=demo-project/);
  await expect(page).toHaveURL(/lineageCanvas=portrait/);

  const gear = page.getByRole('button', { name: 'Open Canvas settings' });
  await gear.click();
  await expect(page.getByRole('complementary', { name: 'Canvas settings' })).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');

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
  const resetAppearance = settings.getByRole('button', { name: 'Reset appearance' });
  const geometry = await settings.evaluate((element, { gearLabel, resetLabel }) => {
    const box = element.getBoundingClientRect();
    const canvas = document.querySelector('.lineage-workbench')?.getBoundingClientRect();
    const gear = document.querySelector(`[aria-label="${gearLabel}"]`)?.getBoundingClientRect();
    const reset = Array.from(element.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === resetLabel)
      ?.getBoundingClientRect();
    return {
      bottomGap: canvas ? Math.abs(canvas.bottom - box.bottom) : -1,
      canvasWidth: canvas?.width || 0,
      gearOverlapsReset: Boolean(gear && reset
        && gear.left < reset.right
        && gear.right > reset.left
        && gear.top < reset.bottom
        && gear.bottom > reset.top),
      width: box.width,
    };
  }, { gearLabel: 'Open Canvas settings', resetLabel: 'Reset appearance' });
  await expect(resetAppearance).toBeVisible();
  expect(geometry.bottomGap).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.canvasWidth - geometry.width)).toBeLessThanOrEqual(1);
  expect(geometry.gearOverlapsReset).toBe(false);
});
