import { describe, it, expect, vi, beforeAll } from 'vitest';

beforeAll(() => {
  Object.defineProperty(globalThis, 'document', {
    value: { addEventListener: vi.fn() },
    configurable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 4 },
    configurable: true
  });
});

vi.mock('../../js/bugzilla-api.js', () => ({
  BugzillaAPI: class {
    clearCache() {}
    setProgressCallback() {}
    setBugDiscoveredCallback() {}
  }
}));

vi.mock('../../js/dependency-graph.js', () => ({
  DependencyGraph: class {}
}));

vi.mock('../../js/scheduler.js', () => ({
  Scheduler: class {}
}));

vi.mock('../../js/gantt-renderer.js', () => ({
  GanttRenderer: class {
    constructor() {}
    render() {}
    isPopupActive() { return false; }
  }
}));

vi.mock('../../js/ui-controller.js', () => ({
  UIController: class {
    constructor() {
      this.showGanttEmpty = vi.fn();
      this.hideGanttEmpty = vi.fn();
      this.renderMilestoneCards = vi.fn();
      this.renderStats = vi.fn();
      this.renderEstimatedTable = vi.fn();
      this.renderRisksTable = vi.fn();
      this.renderMilestoneMismatchesTable = vi.fn();
      this.renderUntriagedTable = vi.fn();
      this.renderErrorsMarkdown = vi.fn();
      this.updateOptimizationStatus = vi.fn();
    }
    init() {}
    showLoading() {}
  }
}));

// Helper to build a minimal task object
function makeTask(id, product, component) {
  return {
    bug: { id, product, component },
    startDate: new Date('2026-03-01'),
    endDate: new Date('2026-03-10'),
    engineer: { id: 'eng1' },
    effort: { days: 7 },
    completed: false,
    milestone: null
  };
}

// Helper to build a minimal risk object
function makeRisk(id, product, component, milestone = { bugId: 99, name: 'M1' }) {
  return {
    task: makeTask(id, product, component),
    milestone,
    type: 'freeze',
    message: ''
  };
}

describe('filterScheduleByComponent', () => {
  it('returns all tasks when no component filter is set', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = '';

    const schedule = [
      makeTask(1, 'Firefox Enterprise', 'Client'),
      makeTask(2, 'Core', 'Security'),
    ];

    expect(app.filterScheduleByComponent(schedule)).toEqual(schedule);
  });

  it('returns only tasks matching the selected Firefox Enterprise component', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Client';

    const client = makeTask(1, 'Firefox Enterprise', 'Client');
    const other = makeTask(2, 'Firefox Enterprise', 'Console');

    expect(app.filterScheduleByComponent([client, other])).toEqual([client]);
  });

  it('returns tasks from all Firefox Enterprise components when "Client" is selected', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Client';

    const tasks = [
      makeTask(1, 'Firefox Enterprise', 'Client'),
      makeTask(2, 'Firefox Enterprise', 'Client'),
      makeTask(3, 'Firefox Enterprise', 'Console'),
    ];

    const result = app.filterScheduleByComponent(tasks);
    expect(result).toHaveLength(2);
    expect(result.every(t => t.bug.component === 'Client')).toBe(true);
  });

  it('returns only non-Firefox-Enterprise tasks when "Other" is selected', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Other';

    const feTask = makeTask(1, 'Firefox Enterprise', 'Client');
    const coreTask = makeTask(2, 'Core', 'Security');
    const firefoxTask = makeTask(3, 'Firefox', 'General');

    const result = app.filterScheduleByComponent([feTask, coreTask, firefoxTask]);
    expect(result).toHaveLength(2);
    expect(result).toContain(coreTask);
    expect(result).toContain(firefoxTask);
  });

  it('returns empty array when no tasks match the selected component', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Console';

    const tasks = [makeTask(1, 'Firefox Enterprise', 'Client')];
    expect(app.filterScheduleByComponent(tasks)).toEqual([]);
  });

  it('returns empty array when "Other" is selected but all tasks are Firefox Enterprise', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Other';

    const tasks = [
      makeTask(1, 'Firefox Enterprise', 'Client'),
      makeTask(2, 'Firefox Enterprise', 'Console'),
    ];
    expect(app.filterScheduleByComponent(tasks)).toEqual([]);
  });

  it('handles null/undefined schedule gracefully', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Client';

    expect(app.filterScheduleByComponent(null)).toBeNull();
    expect(app.filterScheduleByComponent(undefined)).toBeUndefined();
  });
});

describe('filterRisksByComponent', () => {
  it('returns all risks when no component filter is set', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = '';

    const risks = [
      makeRisk(1, 'Firefox Enterprise', 'Client'),
      makeRisk(2, 'Core', 'Security'),
    ];
    expect(app.filterRisksByComponent(risks)).toEqual(risks);
  });

  it('returns only risks matching the selected component', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Client';

    const clientRisk = makeRisk(1, 'Firefox Enterprise', 'Client');
    const consoleRisk = makeRisk(2, 'Firefox Enterprise', 'Console');

    expect(app.filterRisksByComponent([clientRisk, consoleRisk])).toEqual([clientRisk]);
  });

  it('returns only non-Firefox-Enterprise risks when "Other" is selected', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.componentFilter = 'Other';

    const feRisk = makeRisk(1, 'Firefox Enterprise', 'Client');
    const coreRisk = makeRisk(2, 'Core', 'Security');

    const result = app.filterRisksByComponent([feRisk, coreRisk]);
    expect(result).toEqual([coreRisk]);
  });
});

describe('component filter empty-state warning', () => {
  it('shows warning when component filter yields an empty schedule', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.milestones = [];
    app.componentFilter = 'Console';
    app.milestoneFilter = '';

    // Schedule has only Client tasks — Console filter will yield nothing
    app.greedySchedule = [makeTask(1, 'Firefox Enterprise', 'Client')];
    app.fullScheduleErrors = { milestoneMismatches: [], untriaged: [] };
    app.fullScheduleRisks = [];
    app.sortedBugs = [];
    app.graph = { getDependencies: () => [] };
    app.engineers = [];
    app.scheduler = { getStats: () => ({}) };
    app.gantt.render = vi.fn();

    app.rerenderWithMilestoneFilter();

    expect(app.ui.showGanttEmpty).toHaveBeenCalledWith(
      expect.stringContaining('filtered')
    );
  });

  it('hides warning when filtered schedule is non-empty', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.milestones = [];
    app.componentFilter = 'Client';
    app.milestoneFilter = '';

    app.greedySchedule = [makeTask(1, 'Firefox Enterprise', 'Client')];
    app.fullScheduleErrors = { milestoneMismatches: [], untriaged: [] };
    app.fullScheduleRisks = [];
    app.sortedBugs = [];
    app.graph = { getDependencies: () => [] };
    app.engineers = [];
    app.scheduler = { getStats: () => ({}) };
    app.gantt.render = vi.fn();

    app.rerenderWithMilestoneFilter();

    expect(app.ui.hideGanttEmpty).toHaveBeenCalled();
    expect(app.ui.showGanttEmpty).not.toHaveBeenCalled();
  });

  it('hides warning when no component or milestone filter is active', async () => {
    const { default: App } = await import('../../js/main.js');
    const app = new App();
    app.milestones = [];
    app.componentFilter = '';
    app.milestoneFilter = '';

    app.greedySchedule = [makeTask(1, 'Firefox Enterprise', 'Client')];
    app.fullScheduleErrors = { milestoneMismatches: [], untriaged: [] };
    app.fullScheduleRisks = [];
    app.sortedBugs = [];
    app.graph = { getDependencies: () => [] };
    app.engineers = [];
    app.scheduler = { getStats: () => ({}) };
    app.gantt.render = vi.fn();

    app.rerenderWithMilestoneFilter();

    expect(app.ui.hideGanttEmpty).toHaveBeenCalled();
    expect(app.ui.showGanttEmpty).not.toHaveBeenCalled();
  });
});
