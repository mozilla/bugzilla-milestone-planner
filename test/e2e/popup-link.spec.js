/**
 * Test that popup links are clickable
 */
import { test, expect } from '@playwright/test';

test.describe('Popup Link', () => {
  test('clicking Bugzilla link should open in new tab', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForSelector('#loaded-phase', { timeout: 60000 });

    // Disable auto-switch to optimal schedule by intercepting the function
    await page.evaluate(() => {
      // Override the switch function to prevent auto-switch
      if (window.planner) {
        window.planner.switchToOptimalSchedule = () => {
          console.log('[Test] Blocked auto-switch to optimal');
        };
      }
    });

    // Wait for chart to stabilize
    await page.waitForTimeout(500);

    // Find a task bar and hover to show popup
    const bar = page.locator('.bar-wrapper').first();
    await bar.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await bar.hover();

    // Wait for popup to appear
    await page.waitForTimeout(500);

    const popup = page.locator('.popup-wrapper');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Move mouse to popup to keep it visible
    await popup.hover();

    // Find the link
    const link = popup.locator('a').first();
    const linkExists = await link.count() > 0;

    if (linkExists) {
      const href = await link.getAttribute('href');
      expect(href).toContain('bugzilla.mozilla.org');

      // Capture console logs
      const logs = [];
      page.on('console', msg => logs.push(msg.text()));

      // Click the link with actual mouse click
      try {
        const [newPage] = await Promise.all([
          context.waitForEvent('page', { timeout: 5000 }),
          link.click({ force: true })
        ]);
        expect(newPage.url()).toContain('bugzilla.mozilla.org');
        await newPage.close();
      } catch (e) {
        console.log('Console logs during click:', logs);
        throw e;
      }
    } else {
      throw new Error('No link found in popup');
    }
  });

  test('popup should stay visible when hovering over link', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loaded-phase', { timeout: 60000 });

    // Hover on bar to show popup
    const bar = page.locator('.bar-wrapper').first();
    await bar.hover();

    // Wait for popup
    const popup = page.locator('.popup-wrapper');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Move to popup
    await popup.hover();

    // Popup should still be visible
    await expect(popup).toBeVisible();

    // Move to link
    const link = popup.locator('.popup-link');
    await link.hover();

    // Popup should still be visible
    await expect(popup).toBeVisible();
  });
});
