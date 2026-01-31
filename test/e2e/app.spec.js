/**
 * End-to-end tests for Enterprise Project Planner
 * Run with: npx playwright test
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080';

test.describe('Enterprise Project Planner', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto(BASE_URL);
  });

  test.describe('Initial Load', () => {
    test('should display the page title', async ({ page }) => {
      await expect(page).toHaveTitle(/Enterprise Project Planner/);
    });

    test('should show the header with application name', async ({ page }) => {
      const header = page.locator('header h1');
      await expect(header).toHaveText('Enterprise Project Planner');
    });

    test('should display loading phase initially', async ({ page }) => {
      // The loading phase should be visible initially
      const loadingPhase = page.locator('#loading-phase');
      await expect(loadingPhase).toBeVisible();
    });

    test('should show progress bar during loading', async ({ page }) => {
      const progressBar = page.locator('#progress-bar');
      await expect(progressBar).toBeVisible();
    });

    test('should display milestone list during loading', async ({ page }) => {
      const milestonesList = page.locator('#milestones-list');
      await expect(milestonesList).toBeVisible();

      // Should have 3 milestone items
      const milestoneItems = milestonesList.locator('.milestone-item');
      await expect(milestoneItems).toHaveCount(3);
    });
  });

  test.describe('After Data Load', () => {
    test('should transition to loaded phase', async ({ page }) => {
      // Wait for the loaded phase to appear (may take time to fetch from Bugzilla)
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });
    });

    test('should hide loading phase after load', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const loadingPhase = page.locator('#loading-phase');
      await expect(loadingPhase).toBeHidden();
    });

    test('should display controls section', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const viewModeSelect = page.locator('#view-mode');
      await expect(viewModeSelect).toBeVisible();

      const milestoneFilter = page.locator('#milestone-filter');
      await expect(milestoneFilter).toBeVisible();

      const refreshBtn = page.locator('#refresh-btn');
      await expect(refreshBtn).toBeVisible();
    });

    test('should display milestone cards', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const milestoneCards = page.locator('.milestone-card');
      await expect(milestoneCards).toHaveCount(3);

      // Check milestone names
      await expect(page.locator('.milestone-card h4').first()).toHaveText('Foxfooding');
    });

    test('should display legend', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const legend = page.locator('#legend');
      await expect(legend).toBeVisible();

      // Should have legend items
      const legendItems = legend.locator('.legend-item');
      await expect(legendItems.first()).toBeVisible();
    });

    test('should display Gantt container', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const ganttContainer = page.locator('#gantt-container');
      await expect(ganttContainer).toBeVisible();
    });

    test('should display stats section', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const statsContainer = page.locator('#stats-container');
      await expect(statsContainer).toBeVisible();

      // Should have stat cards
      const statCards = statsContainer.locator('.stat-card');
      await expect(statCards.first()).toBeVisible();
    });
  });

  test.describe('Controls Interaction', () => {
    test('should change view mode', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const viewModeSelect = page.locator('#view-mode');

      // Change to Day view
      await viewModeSelect.selectOption('Day');
      await expect(viewModeSelect).toHaveValue('Day');

      // Change to Month view
      await viewModeSelect.selectOption('Month');
      await expect(viewModeSelect).toHaveValue('Month');
    });

    test('should filter by milestone', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const milestoneFilter = page.locator('#milestone-filter');

      // Filter by Foxfooding
      await milestoneFilter.selectOption('1980342');
      await expect(milestoneFilter).toHaveValue('1980342');

      // Reset to all
      await milestoneFilter.selectOption('');
      await expect(milestoneFilter).toHaveValue('');
    });

    test('should trigger refresh on button click', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const refreshBtn = page.locator('#refresh-btn');
      await refreshBtn.click();

      // Should show loading phase again
      const loadingPhase = page.locator('#loading-phase');
      await expect(loadingPhase).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Optimization', () => {
    test('should show optimization status', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const optimizationStatus = page.locator('#optimization-status');
      await expect(optimizationStatus).toBeVisible();
    });

    test('should show optimization log', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const optimizationLog = page.locator('#optimization-log');
      await expect(optimizationLog).toBeVisible();
    });

    test('should have schedule type selector', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const scheduleTypeSelect = page.locator('#schedule-type');
      await expect(scheduleTypeSelect).toBeVisible();

      // Greedy should be selected by default
      await expect(scheduleTypeSelect).toHaveValue('greedy');
    });
  });

  test.describe('Tables Section', () => {
    test('should display estimated sizes table', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const estimatedTable = page.locator('#estimated-table');
      await expect(estimatedTable).toBeVisible();
    });

    test('should display skill mismatches table', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const mismatchTable = page.locator('#mismatch-table');
      await expect(mismatchTable).toBeVisible();
    });

    test('should display deadline risks table', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const risksTable = page.locator('#risks-table');
      await expect(risksTable).toBeVisible();
    });
  });

  test.describe('Errors Section', () => {
    test('should display errors markdown section', async ({ page }) => {
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      const errorsMarkdown = page.locator('#errors-markdown');
      await expect(errorsMarkdown).toBeVisible();

      // Should contain ERRORS.md header
      const content = await errorsMarkdown.textContent();
      expect(content).toContain('ERRORS.md');
    });
  });

  test.describe('Console Errors', () => {
    test('should not have critical console errors', async ({ page }) => {
      const consoleErrors = [];

      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(BASE_URL);

      // Wait for load to complete
      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      // Filter out expected errors (like CORS issues in dev)
      const criticalErrors = consoleErrors.filter(error =>
        !error.includes('CORS') &&
        !error.includes('favicon') &&
        !error.includes('net::')
      );

      expect(criticalErrors).toHaveLength(0);
    });
  });

  test.describe('Visual Regression', () => {
    test('should match loading phase screenshot', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });

      // Take screenshot of loading phase
      await expect(page.locator('#loading-phase')).toBeVisible();
      await expect(page).toHaveScreenshot('loading-phase.png', {
        maxDiffPixels: 100
      });
    });

    test('should match loaded phase screenshot', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });

      const loadedPhase = page.locator('#loaded-phase');
      await expect(loadedPhase).toBeVisible({ timeout: 60000 });

      // Wait for Gantt to render
      await page.waitForTimeout(2000);

      await expect(page).toHaveScreenshot('loaded-phase.png', {
        maxDiffPixels: 500 // Allow some variance in dynamic content
      });
    });
  });
});

test.describe('Responsive Design', () => {
  test('should be usable on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE_URL);

    const loadedPhase = page.locator('#loaded-phase');
    await expect(loadedPhase).toBeVisible({ timeout: 60000 });

    // Check that controls are visible
    const controls = page.locator('.controls');
    await expect(controls).toBeVisible();
  });

  test('should be usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);

    const loadedPhase = page.locator('#loaded-phase');
    await expect(loadedPhase).toBeVisible({ timeout: 60000 });

    // Check that header is visible
    const header = page.locator('header h1');
    await expect(header).toBeVisible();
  });
});
