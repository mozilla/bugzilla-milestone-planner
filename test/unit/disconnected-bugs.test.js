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
  },
  MILESTONES: [
    { name: 'Foxfooding', bugId: 100, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
    { name: 'Customer Pilot', bugId: 200, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
    { name: 'MVP', bugId: 300, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
  ]
}));

vi.mock('../../js/ui-controller.js', () => ({
  UIController: class {
    constructor() {
      this.updateOptimizationStatus = vi.fn();
      this.clearOptimizationLog = vi.fn();
      this.addOptimizationLogEntry = vi.fn();
      this.renderMilestoneCards = vi.fn();
      this.enableScheduleToggle = vi.fn();
      this.setScheduleType = vi.fn();
      this.updateMilestoneStatus = vi.fn();
    }
    init() {}
    showLoading() {}
  }
}));

describe('findDisconnectedBugs', () => {
  it('flags a bug not in any dependency tree with a recognized milestone', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    // Simulate an existing dependency tree with one bug
    app.bugs = new Map([['1', { id: 1, dependsOn: [] }]]);

    const milestonedBugs = [
      { id: 999, summary: 'Disconnected bug', targetMilestone: 'Foxfooding', dependsOn: [] }
    ];

    const result = app.findDisconnectedBugs(milestonedBugs);
    expect(result).toHaveLength(1);
    expect(result[0].bug.id).toBe(999);
    expect(result[0].targetMilestone).toBe('Foxfooding');
    expect(result[0].dependencyMilestone).toBeNull();
  });

  it('does not flag a bug that already exists in the dependency tree', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    app.bugs = new Map([['42', { id: 42, dependsOn: [] }]]);

    const milestonedBugs = [
      { id: 42, summary: 'In-tree bug', targetMilestone: 'MVP', dependsOn: [] }
    ];

    const result = app.findDisconnectedBugs(milestonedBugs);
    expect(result).toHaveLength(0);
  });

  it('ignores bugs with --- milestone', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();
    app.bugs = new Map();

    const milestonedBugs = [
      { id: 10, summary: 'No milestone', targetMilestone: '---', dependsOn: [] }
    ];

    const result = app.findDisconnectedBugs(milestonedBugs);
    expect(result).toHaveLength(0);
  });

  it('ignores bugs with unrecognized milestone values', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();
    app.bugs = new Map();

    const milestonedBugs = [
      { id: 10, summary: 'Unknown milestone', targetMilestone: 'Future Release', dependsOn: [] }
    ];

    const result = app.findDisconnectedBugs(milestonedBugs);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();
    app.bugs = new Map();

    const result = app.findDisconnectedBugs([]);
    expect(result).toHaveLength(0);
  });

  it('maps case-insensitive milestone names correctly', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();
    app.bugs = new Map();

    const milestonedBugs = [
      { id: 1, summary: 'A', targetMilestone: 'CUSTOMER PILOT', dependsOn: [] },
      { id: 2, summary: 'B', targetMilestone: 'mvp', dependsOn: [] },
      { id: 3, summary: 'C', targetMilestone: 'CustomerPilot', dependsOn: [] }
    ];

    const result = app.findDisconnectedBugs(milestonedBugs);
    expect(result).toHaveLength(3);
    expect(result[0].targetMilestone).toBe('Customer Pilot');
    expect(result[1].targetMilestone).toBe('MVP');
    expect(result[2].targetMilestone).toBe('Customer Pilot');
  });
});

describe('detectErrors integration with disconnected bugs', () => {
  it('merges disconnected bugs into milestoneMismatches', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    // Set up minimal state so detectErrors doesn't crash
    app.graph = {
      detectCycles: () => [],
      findOrphanedDependencies: () => [],
      findDuplicateSummaries: () => [],
      findMissingAssignees: () => [],
      findMissingSizes: () => [],
      findUntriagedBugs: () => []
    };
    app.bugs = new Map([['1', { id: 1, targetMilestone: '---', dependsOn: [] }]]);

    // Simulate disconnected bugs found during fetch
    app.disconnectedBugs = [
      { bug: { id: 999, summary: 'Disconnected' }, targetMilestone: 'Foxfooding', dependencyMilestone: null }
    ];

    const errors = app.detectErrors();
    expect(errors.milestoneMismatches).toContainEqual(
      expect.objectContaining({ bug: expect.objectContaining({ id: 999 }), dependencyMilestone: null })
    );
  });

  it('works when disconnectedBugs is undefined', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    app.graph = {
      detectCycles: () => [],
      findOrphanedDependencies: () => [],
      findDuplicateSummaries: () => [],
      findMissingAssignees: () => [],
      findMissingSizes: () => [],
      findUntriagedBugs: () => []
    };
    app.bugs = new Map();

    // disconnectedBugs not set (e.g. fetch failed)
    const errors = app.detectErrors();
    expect(errors.milestoneMismatches).toBeDefined();
    expect(Array.isArray(errors.milestoneMismatches)).toBe(true);
  });
});
