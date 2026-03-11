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

  // This is the core failure scenario:
  // GA worker output lacks `milestone` field, so tasks past the freeze date
  // are not marked as at-risk even though they should be.
  it('marks task as at-risk when end date is past freeze date even without milestone field (GA worker output)', () => {
    // Simulate GA worker output: task has no `milestone` field
    const task = makeTask({
      bugId: 2012425,
      endDate: '2026-04-01', // well past Customer Pilot deadline
      milestone: undefined   // <-- GA worker doesn't set this
    });
    // This task is a dependency of Customer Pilot but the GA worker
    // doesn't include the milestone in its schedule output.
    // isAtRisk should still detect it as at-risk.
    expect(renderer.isAtRisk(task)).toBe(true);
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

  // Demonstrates the actual bug: GA worker produces tasks without milestone,
  // so convertToGanttTasks fails to mark them as at-risk.
  it('convertToGanttTasks assigns gantt-at-risk class even when milestone field is missing (GA worker bug)', () => {
    const graph = new DependencyGraph();
    const bugs = [
      { id: 2012055, summary: 'Customer Pilot', dependsOn: [3001], blocks: [], status: 'NEW' },
      { id: 3001, summary: 'Late bug from GA', dependsOn: [], blocks: [2012055], status: 'NEW' }
    ];
    for (const b of bugs) graph.addNode(b);

    // Task WITHOUT milestone field, simulating GA worker output
    const scheduledTasks = [
      makeTask({ bugId: 3001, endDate: '2026-04-01', milestone: undefined })
    ];

    const ganttTasks = renderer.convertToGanttTasks(scheduledTasks, graph, []);
    const task = ganttTasks.find(t => t.id === '3001');

    expect(task.custom_class).toContain('gantt-at-risk');
  });
});
