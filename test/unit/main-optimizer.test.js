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
    { name: 'M1', bugId: 1, deadline: new Date('2026-02-01'), freezeDate: new Date('2026-01-25') },
    { name: 'M2', bugId: 2, deadline: new Date('2026-03-01'), freezeDate: new Date('2026-02-25') }
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

describe('optimal scheduler integration (main)', () => {
  it('does not restart exhaustive search once all deadlines are met', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    app.optimizerMode = 'exhaustive';
    app.exhaustiveEndTime = Date.now() + 30000;
    app.exhaustiveStartTime = Date.now() - 5000;
    app.currentScheduleType = 'greedy';
    app.lastFilteredBugs = [];
    app.startOptimalScheduler = vi.fn();
    app.greedyScore = { deadlinesMet: 1, totalLateness: 5, makespan: 20 };

    app.workerResults = [
      {
        workerId: 0,
        schedule: [{ startDate: new Date(), endDate: new Date() }],
        deadlinesMet: 2,
        totalLateness: 0,
        makespan: 10,
        bestFoundAtIteration: 10,
        totalIterations: 100
      }
    ];

    app.finalizeOptimalSchedule(2);

    expect(app.startOptimalScheduler).not.toHaveBeenCalled();
    expect(app.ui.updateOptimizationStatus).toHaveBeenCalledWith(
      'complete',
      'Exhaustive best: 2/2 deadlines'
    );
  });

  it('keeps greedy schedule when optimal results are worse', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    app.optimizerMode = 'optimal';
    app.greedyScore = { deadlinesMet: 2, totalLateness: 0, makespan: 10 };
    app.workerResults = [
      {
        workerId: 0,
        schedule: [{ startDate: new Date(), endDate: new Date() }],
        deadlinesMet: 1,
        totalLateness: 5,
        makespan: 20,
        bestFoundAtIteration: 5,
        totalIterations: 50
      }
    ];

    app.finalizeOptimalSchedule(2);

    expect(app.optimalSchedule).toBe(null);
    expect(app.ui.enableScheduleToggle).toHaveBeenCalledWith(false);
    expect(app.ui.updateOptimizationStatus).toHaveBeenCalledWith(
      'complete',
      'Greedy schedule is optimal'
    );
    expect(app.ui.addOptimizationLogEntry).toHaveBeenCalledWith(
      'Optimal schedule did not beat greedy. Keeping greedy schedule.',
      'status'
    );
  });

  it('does not log improvements that fail to beat greedy', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage() {}
      terminate() {}
    };

    app.numWorkers = 1;
    app.iterationsPerWorker = 1;
    app.engineers = [{ id: 'a', name: 'A', email: 'a@example.com', availability: 1.0 }];
    app.bugs = new Map([[1, { dependsOn: [] }]]);
    app.greedyScore = { deadlinesMet: 2, totalLateness: 0, makespan: 10 };

    const bugs = [
      { id: 1, summary: 'Bug', status: 'NEW', size: 1, assignee: null, dependsOn: [] }
    ];

    app.startOptimalScheduler(bugs);

    const worker = app.optimalWorkers[0];
    const initialLogCount = app.ui.addOptimizationLogEntry.mock.calls.length;

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 20,
        deadlineDetails: []
      }
    });

    expect(app.ui.addOptimizationLogEntry.mock.calls.length).toBe(initialLogCount);
  });

  it('logs lateness improvements even if makespan regresses', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage() {}
      terminate() {}
    };

    app.numWorkers = 1;
    app.iterationsPerWorker = 1;
    app.engineers = [{ id: 'a', name: 'A', email: 'a@example.com', availability: 1.0 }];
    app.bugs = new Map([[1, { dependsOn: [] }]]);
    app.greedyScore = { deadlinesMet: 1, totalLateness: 10, makespan: 60 };

    const bugs = [
      { id: 1, summary: 'Bug', status: 'NEW', size: 1, assignee: null, dependsOn: [] }
    ];

    app.startOptimalScheduler(bugs);

    const worker = app.optimalWorkers[0];
    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 50,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 5 }]
      }
    });

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 70,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 2 }]
      }
    });

    const lastCall = app.ui.addOptimizationLogEntry.mock.calls.at(-1);
    expect(lastCall[0]).toContain('Improved lateness');
  });

  it('logs lateness improvements distinctly when makespan regresses', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage() {}
      terminate() {}
    };

    app.numWorkers = 1;
    app.iterationsPerWorker = 1;
    app.engineers = [{ id: 'a', name: 'A', email: 'a@example.com', availability: 1.0 }];
    app.bugs = new Map([[1, { dependsOn: [] }]]);
    app.greedyScore = { deadlinesMet: 1, totalLateness: 20, makespan: 60 };

    const bugs = [
      { id: 1, summary: 'Bug', status: 'NEW', size: 1, assignee: null, dependsOn: [] }
    ];

    app.startOptimalScheduler(bugs);
    const worker = app.optimalWorkers[0];

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 50,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 10 }]
      }
    });

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 70,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 5 }]
      }
    });

    const lastCall = app.ui.addOptimizationLogEntry.mock.calls.at(-1);
    expect(lastCall[0]).toContain('Improved lateness');
  });

  it('does not log makespan improvements when lateness is worse', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage() {}
      terminate() {}
    };

    app.numWorkers = 1;
    app.iterationsPerWorker = 1;
    app.engineers = [{ id: 'a', name: 'A', email: 'a@example.com', availability: 1.0 }];
    app.bugs = new Map([[1, { dependsOn: [] }]]);
    app.greedyScore = { deadlinesMet: 1, totalLateness: 10, makespan: 60 };

    const bugs = [
      { id: 1, summary: 'Bug', status: 'NEW', size: 1, assignee: null, dependsOn: [] }
    ];

    app.startOptimalScheduler(bugs);
    const worker = app.optimalWorkers[0];

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 50,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 5 }]
      }
    });

    const logCountAfterFirst = app.ui.addOptimizationLogEntry.mock.calls.length;

    worker.onmessage?.({
      data: {
        type: 'improved',
        workerId: 0,
        deadlinesMet: 1,
        makespan: 40,
        deadlineDetails: [{ name: 'M1', met: true, daysLate: 9 }]
      }
    });

    expect(app.ui.addOptimizationLogEntry.mock.calls.length).toBe(logCountAfterFirst);
  });

  it('wires exhaustive schedule selection to optimizer start', async () => {
    const { default: EnterprisePlanner } = await import('../../js/main.js');
    const app = new EnterprisePlanner();

    app.lastFilteredBugs = [
      { id: 1, status: 'NEW', component: 'Client', severity: 'S2', dependsOn: [] }
    ];
    app.greedySchedule = [];
    app.graph = { getDependencies: () => [] };
    app.engineers = [];
    app.startOptimalScheduler = vi.fn();
    app.gantt.render = vi.fn();
    app.ui.renderMilestoneCards = vi.fn();

    app.onScheduleTypeChange('exhaustive');

    expect(app.ui.setScheduleType).toHaveBeenCalledWith('exhaustive');
    expect(app.startOptimalScheduler).toHaveBeenCalled();
  });
});
