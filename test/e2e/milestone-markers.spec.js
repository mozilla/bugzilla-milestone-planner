import { test, expect } from '@playwright/test';

test.describe('Milestone deadline markers', () => {
  test('should render dashed deadline lines on the Gantt chart', async ({ page }) => {
    await page.goto('/index.html');

    // Wait for the Gantt chart to render
    await page.waitForSelector('#loaded-phase', { state: 'visible', timeout: 60000 });
    await page.waitForSelector('.bar-wrapper', { timeout: 10000 });

    // Give post-render decorations time to run (setTimeout 200ms in render)
    await page.waitForTimeout(500);

    // Check that milestone marker groups were created
    const markerCount = await page.locator('.milestone-marker-group').count();
    expect(markerCount).toBeGreaterThan(0);

    // Each marker group should have a dashed line and a text label
    const lines = await page.locator('.milestone-marker-group line').count();
    const labels = await page.locator('.milestone-marker-group text').count();
    expect(lines).toBe(markerCount);
    expect(labels).toBe(markerCount);

    // Lines should have stroke-dasharray (dashed)
    const dasharray = await page.locator('.milestone-marker-group line').first().getAttribute('stroke-dasharray');
    expect(dasharray).toBeTruthy();

    // There should be both freeze and deadline markers (2 milestones x 2 lines = 4)
    const labelTexts = await page.locator('.milestone-marker-group text').allTextContents();
    const hasFreeze = labelTexts.some(t => t.includes('freeze'));
    const hasDeadline = labelTexts.some(t => !t.includes('freeze'));
    expect(hasFreeze).toBe(true);
    expect(hasDeadline).toBe(true);
  });
});
