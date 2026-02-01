import { test, expect } from '@playwright/test';

test.describe('Milestone Filter', () => {
  test('should filter milestone cards when selecting Foxfooding', async ({ page }) => {
    // Enable console logging
    page.on('console', msg => {
      console.log(`[Browser ${msg.type()}]`, msg.text());
    });

    page.on('pageerror', err => {
      console.error('[Browser Error]', err.message);
    });

    // Go to the app
    await page.goto('http://localhost:8081/index.html');

    // Wait for loaded phase to appear (data fetched)
    console.log('Waiting for app to load...');
    await page.waitForSelector('#loaded-phase', { state: 'visible', timeout: 60000 });
    console.log('App loaded!');

    // Count initial milestone cards
    const initialCards = await page.locator('.milestone-card').count();
    console.log(`Initial milestone cards: ${initialCards}`);

    // Take screenshot before
    await page.screenshot({ path: 'test-results/before-filter.png' });

    // Check current milestone filter value
    const filterValue = await page.locator('#milestone-filter').inputValue();
    console.log(`Current filter value: "${filterValue}"`);

    // Select Foxfooding from dropdown
    console.log('Selecting Foxfooding...');
    await page.selectOption('#milestone-filter', '1980342');

    // Wait a moment for re-render
    await page.waitForTimeout(1000);

    // Count milestone cards after filter
    const afterCards = await page.locator('.milestone-card').count();
    console.log(`Milestone cards after filter: ${afterCards}`);

    // Take screenshot after
    await page.screenshot({ path: 'test-results/after-filter.png' });

    // Get the milestone card content
    const cardContent = await page.locator('.milestone-card').allTextContents();
    console.log('Card contents:', cardContent);

    // Verify only 1 card (Foxfooding)
    expect(afterCards).toBe(1);
    expect(cardContent[0]).toContain('Foxfooding');
  });
});
