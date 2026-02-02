import { test, expect } from '@playwright/test';

// Increase timeout for these tests as they involve waiting for optimal scheduler
test.setTimeout(120000);

test.describe('Schedule Type Switch', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the app and wait for loaded phase
    await page.goto('/');
    await page.waitForSelector('#loaded-phase', { state: 'visible', timeout: 60000 });

    // Wait for Gantt to render
    await page.waitForSelector('.bar-wrapper', { timeout: 30000 });

    // Wait for interactions to be set up (200ms setTimeout in code + buffer)
    await page.waitForTimeout(500);

    // Scroll gantt into view
    await page.evaluate(() => {
      document.querySelector('.gantt-container')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);
  });

  test('should maintain drag-to-scroll after switching to optimal schedule', async ({ page }) => {
    // Verify initial state with greedy schedule
    const cursorBefore = await page.$eval('.gantt-container', el => el.style.cursor);
    expect(cursorBefore).toBe('grab');

    // Test drag works with greedy schedule
    const greedyResult = await testDrag(page);
    expect(greedyResult.success).toBe(true);

    // Wait for optimal schedule to be computed (option becomes enabled)
    // Use longer timeout as the worker needs time to compute
    await page.waitForFunction(() => {
      const opt = document.querySelector('#schedule-type option[value="optimal"]');
      return opt && !opt.disabled;
    }, { timeout: 90000 });

    // Switch to optimal schedule
    await page.selectOption('#schedule-type', 'optimal');
    await page.waitForTimeout(1000);

    // Scroll gantt into view again
    await page.evaluate(() => {
      document.querySelector('.gantt-container')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);

    // Verify cursor is still set
    const cursorAfter = await page.$eval('.gantt-container', el => el.style.cursor);
    expect(cursorAfter).toBe('grab');

    // Test drag works with optimal schedule
    const optimalResult = await testDrag(page);
    expect(optimalResult.success).toBe(true);
  });

  test('should auto-switch to optimal schedule when optimization completes', async ({ page }) => {
    // Initial state should be greedy
    const initialValue = await page.$eval('#schedule-type', el => el.value);
    expect(initialValue).toBe('greedy');

    // Wait for optimization to complete (option becomes enabled AND selected)
    await page.waitForFunction(() => {
      const select = document.querySelector('#schedule-type');
      const opt = select?.querySelector('option[value="optimal"]');
      return opt && !opt.disabled && select.value === 'optimal';
    }, { timeout: 90000 });

    // Dropdown should now show "optimal"
    const finalValue = await page.$eval('#schedule-type', el => el.value);
    expect(finalValue).toBe('optimal');

    // Gantt should have rendered with optimal schedule
    const barCount = await page.evaluate(() =>
      document.querySelectorAll('.bar-wrapper').length
    );
    expect(barCount).toBeGreaterThan(0);
  });

  test('should update milestone cards during optimization', async ({ page }) => {
    // Milestone cards should exist
    const initialCards = await page.evaluate(() =>
      document.querySelectorAll('.milestone-card').length
    );
    expect(initialCards).toBeGreaterThan(0);

    // Wait for at least one optimization improvement (card status may change)
    // Check that cards have status indicators after optimization starts
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('.milestone-card');
      // At least one card should have a status class
      return Array.from(cards).some(card =>
        card.classList.contains('milestone-on-track') ||
        card.classList.contains('milestone-at-risk') ||
        card.classList.contains('milestone-late')
      );
    }, { timeout: 90000 });

    // Cards should still be present and have estimated completions
    const cardsWithEstimates = await page.evaluate(() => {
      const cards = document.querySelectorAll('.milestone-card .estimated strong');
      return Array.from(cards).filter(el => el.textContent !== 'Not scheduled').length;
    });
    expect(cardsWithEstimates).toBeGreaterThan(0);
  });

  test('should have only one gantt-container after schedule switch', async ({ page }) => {
    // Check initial state
    let containerCount = await page.evaluate(() =>
      document.querySelectorAll('.gantt-container').length
    );
    expect(containerCount).toBe(1);

    // Wait for optimal schedule to be available
    await page.waitForFunction(() => {
      const opt = document.querySelector('#schedule-type option[value="optimal"]');
      return opt && !opt.disabled;
    }, { timeout: 90000 });

    // Switch to optimal
    await page.selectOption('#schedule-type', 'optimal');
    await page.waitForTimeout(1000);

    // Should still have only one container (not nested)
    containerCount = await page.evaluate(() =>
      document.querySelectorAll('.gantt-container').length
    );
    expect(containerCount).toBe(1);

    // Container should be scrollable
    const isScrollable = await page.evaluate(() => {
      const gc = document.querySelector('.gantt-container');
      return gc && gc.scrollWidth > gc.clientWidth;
    });
    expect(isScrollable).toBe(true);
  });
});

/**
 * Helper function to test drag-to-scroll functionality
 */
async function testDrag(page) {
  const gc = await page.$('.gantt-container');
  if (!gc) return { success: false, reason: 'no .gantt-container' };

  const bounds = await page.evaluate(() => {
    const gc = document.querySelector('.gantt-container');
    const rect = gc.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

  const initial = await page.$eval('.gantt-container', el => el.scrollLeft);

  // Drag on header area (top 30px where there are no bars)
  const startX = bounds.x + 400;
  const startY = bounds.y + 30;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 200, startY, { steps: 10 });
  await page.mouse.up();

  const final = await page.$eval('.gantt-container', el => el.scrollLeft);

  return {
    success: final !== initial,
    initial,
    final,
    change: final - initial
  };
}
