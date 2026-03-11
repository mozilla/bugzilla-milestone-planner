import { describe, it, expect, beforeAll, vi } from 'vitest';

// Minimal DOM mock so GanttRenderer constructor doesn't crash.
// Always ensure getElementById exists — another test file's mock may have
// defined document without it.
beforeAll(() => {
  if (typeof document === 'undefined') {
    Object.defineProperty(globalThis, 'document', {
      value: { getElementById: () => null, addEventListener: vi.fn() },
      configurable: true
    });
  } else if (typeof document.getElementById !== 'function') {
    document.getElementById = () => null;
  }
});

import { GanttRenderer } from '../../js/gantt-renderer.js';
import { DependencyGraph } from '../../js/dependency-graph.js';

const CUSTOMER_PILOT = {
  name: 'Customer Pilot',
  bugId: 2012055,
  deadline: new Date('2026-03-30'),
  freezeDate: new Date('2026-03-23')
};

const PAST_MILESTONES = [
  { name: 'Foxfooding Alpha', bugzillaName: 'Foxfooding', deadline: '2026-03-02' }
];

const MILESTONE_NAME_MAP = {
  '---': null,
  'foxfooding': 'Foxfooding Alpha',
  'pilot': 'Customer Pilot'
};

function makeTask({ bugId, endDate, milestone = undefined, targetMilestone = undefined, size = 2 }) {
  return {
    bug: {
      id: bugId,
      summary: `Test bug ${bugId}`,
      assignee: 'dev@mozilla.com',
      dependsOn: [],
      blocks: [],
      size,
      sizeEstimated: size === null,
      isMeta: false,
      targetMilestone
    },
    startDate: new Date('2026-03-11'),
    endDate: new Date(endDate),
    engineer: { id: 'eng1', name: 'Dev', availability: 1.0 },
    effort: { days: 5, isMeta: false, sizeEstimated: size === null },
    completed: false,
    milestone
  };
}

describe('GanttRenderer isAtRisk', () => {
  let renderer;

  beforeAll(() => {
    renderer = new GanttRenderer('gantt-container', [CUSTOMER_PILOT]);
    renderer.pastMilestones = PAST_MILESTONES;
    renderer.milestoneNameMap = MILESTONE_NAME_MAP;
  });

  it('marks task as at-risk when end date is past freeze date and milestone is set', () => {
    const task = makeTask({
      bugId: 1001,
      endDate: '2026-03-25', // past freeze (Mar 23)
      milestone: CUSTOMER_PILOT
    });
    expect(renderer.isAtRisk(task)).toBe(true);
  });

  it('does NOT mark task as at-risk when end date is before freeze date', () => {
    const task = makeTask({
      bugId: 1002,
      endDate: '2026-03-20', // before freeze (Mar 23)
      milestone: CUSTOMER_PILOT
    });
    expect(renderer.isAtRisk(task)).toBe(false);
  });

  it('marks open task from past milestone as at-risk via targetMilestone', () => {
    const task = makeTask({
      bugId: 1003,
      endDate: '2026-03-25',
      targetMilestone: 'Foxfooding'
    });
    expect(renderer.isAtRisk(task)).toBe(true);
  });

  it('does NOT mark orphan task (milestone: null) as at-risk even if past freeze date', () => {
    // Task not in any milestone's dependency tree — should not be at-risk
    const task = makeTask({
      bugId: 2012425,
      endDate: '2026-04-01', // well past Customer Pilot freeze
      milestone: null
    });
    expect(renderer.isAtRisk(task)).toBe(false);
  });

  it('does NOT mark task as at-risk when milestone field is undefined', () => {
    // Edge case: milestone field missing entirely — treated as no milestone
    const task = makeTask({
      bugId: 2012426,
      endDate: '2026-04-01',
      milestone: undefined
    });
    expect(renderer.isAtRisk(task)).toBe(false);
  });

  it('convertToGanttTasks assigns gantt-at-risk class to tasks past freeze date', () => {
    const graph = new DependencyGraph();
    const bugs = [
      { id: 2012055, summary: 'Customer Pilot', dependsOn: [1001, 1002], blocks: [], status: 'NEW' },
      { id: 1001, summary: 'Bug past freeze', dependsOn: [], blocks: [2012055], status: 'NEW' },
      { id: 1002, summary: 'Bug before freeze', dependsOn: [], blocks: [2012055], status: 'NEW' }
    ];
    for (const b of bugs) graph.addNode(b);

    const scheduledTasks = [
      makeTask({ bugId: 1001, endDate: '2026-03-25', milestone: CUSTOMER_PILOT }),
      makeTask({ bugId: 1002, endDate: '2026-03-20', milestone: CUSTOMER_PILOT })
    ];

    const ganttTasks = renderer.convertToGanttTasks(scheduledTasks, graph, []);

    const riskTask = ganttTasks.find(t => t.id === '1001');
    const safeTask = ganttTasks.find(t => t.id === '1002');

    expect(riskTask.custom_class).toContain('gantt-at-risk');
    expect(safeTask.custom_class).not.toContain('gantt-at-risk');
  });

  it('convertToGanttTasks does NOT assign gantt-at-risk class to orphan tasks without milestone', () => {
    const graph = new DependencyGraph();
    const bugs = [
      { id: 2012055, summary: 'Customer Pilot', dependsOn: [3001], blocks: [], status: 'NEW' },
      { id: 3001, summary: 'Orphan bug', dependsOn: [], blocks: [2012055], status: 'NEW' }
    ];
    for (const b of bugs) graph.addNode(b);

    // Task with milestone: null (orphan — not in any milestone)
    const scheduledTasks = [
      makeTask({ bugId: 3001, endDate: '2026-04-01', milestone: null })
    ];

    const ganttTasks = renderer.convertToGanttTasks(scheduledTasks, graph, []);
    const task = ganttTasks.find(t => t.id === '3001');

    expect(task.custom_class).not.toContain('gantt-at-risk');
  });
});

describe('isAtRisk and checkDeadlineRisks consistency', () => {
  // Both code paths must agree on which tasks are at-risk.
  // If a task is red in the Gantt chart (isAtRisk=true), it should also
  // appear in the Deadline Risks table (checkDeadlineRisks), and vice versa.

  const milestone = {
    name: 'Customer Pilot',
    bugId: 2012055,
    deadline: new Date('2026-03-30'),
    freezeDate: new Date('2026-03-23')
  };
  const milestones = [milestone];
  let ganttRenderer;

  beforeAll(() => {
    ganttRenderer = new GanttRenderer('gantt-container', milestones);
  });

  it('both flag task with milestone past freeze date', async () => {
    const { Scheduler } = await import('../../js/scheduler.js');
    const task = {
      bug: { id: 1, summary: 'Late', targetMilestone: null },
      startDate: new Date('2026-03-11'),
      endDate: new Date('2026-03-25'),
      engineer: { id: 'e1', name: 'Dev', availability: 1.0 },
      effort: { days: 10, isMeta: false, sizeEstimated: false },
      completed: false,
      milestone
    };

    const ganttResult = ganttRenderer.isAtRisk(task);
    const scheduler = new Scheduler([], milestones);
    const risks = scheduler.checkDeadlineRisks(milestones, {}, [task]);

    expect(ganttResult).toBe(true);
    expect(risks.length).toBe(1);
  });

  it('neither flags task with milestone before freeze date', async () => {
    const { Scheduler } = await import('../../js/scheduler.js');
    const task = {
      bug: { id: 2, summary: 'On time', targetMilestone: null },
      startDate: new Date('2026-03-11'),
      endDate: new Date('2026-03-20'),
      engineer: { id: 'e1', name: 'Dev', availability: 1.0 },
      effort: { days: 7, isMeta: false, sizeEstimated: false },
      completed: false,
      milestone
    };

    const ganttResult = ganttRenderer.isAtRisk(task);
    const scheduler = new Scheduler([], milestones);
    const risks = scheduler.checkDeadlineRisks(milestones, {}, [task]);

    expect(ganttResult).toBe(false);
    expect(risks.length).toBe(0);
  });

  it('neither flags orphan task (no milestone) even if past freeze date', async () => {
    const { Scheduler } = await import('../../js/scheduler.js');
    const task = {
      bug: { id: 3, summary: 'Orphan', targetMilestone: null },
      startDate: new Date('2026-03-11'),
      endDate: new Date('2026-04-15'),
      engineer: { id: 'e1', name: 'Dev', availability: 1.0 },
      effort: { days: 25, isMeta: false, sizeEstimated: false },
      completed: false,
      milestone: null
    };

    const ganttResult = ganttRenderer.isAtRisk(task);
    const scheduler = new Scheduler([], milestones);
    const risks = scheduler.checkDeadlineRisks(milestones, {}, [task]);

    expect(ganttResult).toBe(false);
    expect(risks.length).toBe(0);
  });

  it('neither flags completed task', async () => {
    const { Scheduler } = await import('../../js/scheduler.js');
    const task = {
      bug: { id: 4, summary: 'Done', targetMilestone: null },
      startDate: null,
      endDate: null,
      engineer: null,
      effort: null,
      completed: true,
      milestone
    };

    const ganttResult = ganttRenderer.isAtRisk(task);
    const scheduler = new Scheduler([], milestones);
    const risks = scheduler.checkDeadlineRisks(milestones, {}, [task]);

    expect(ganttResult).toBe(false);
    expect(risks.length).toBe(0);
  });
});
