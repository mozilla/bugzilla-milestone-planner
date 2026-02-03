import { describe, it, expect, beforeAll } from 'vitest';
import { normalizeStartDate } from '../../js/scheduler-core.js';

describe('optimal scheduler worker options', () => {
  const messages = [];

  beforeAll(async () => {
    globalThis.self = {
      postMessage: (msg) => messages.push(msg),
      close: () => {}
    };
    await import('../../js/optimal-scheduler-worker.js');
  });

  it('returns bestAssignment and finalTemperature for SA runs', () => {
    const bugs = [];
    for (let i = 0; i < 11; i++) {
      bugs.push({
        id: 1000 + i,
        summary: `Bug ${i}`,
        status: 'NEW',
        size: 1,
        assignee: null,
        dependsOn: []
      });
    }

    const engineers = [
      { id: 'a', name: 'A', availability: 1.0 },
      { id: 'b', name: 'B', availability: 1.0 }
    ];

    const graph = {};
    for (const bug of bugs) {
      graph[String(bug.id)] = [];
    }

    const startAssignment = new Array(bugs.length).fill(0);

    messages.length = 0;
    globalThis.self.onmessage({
      data: {
        type: 'start',
        data: {
          bugs,
          engineers,
          graph,
          milestones: [],
          iterations: 200,
          id: 0,
          startAssignment,
          startTemperature: 500,
          reheat: true
        }
      }
    });

    const complete = messages.find(m => m.type === 'complete');
    expect(complete).toBeDefined();
    expect(Array.isArray(complete.bestAssignment)).toBe(true);
    expect(complete.bestAssignment.length).toBe(bugs.length);
    expect(Number.isFinite(complete.finalTemperature)).toBe(true);
  });

  it('respects engineer unavailability when building schedules', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const unavailableStart = new Date(today);
    const unavailableEnd = new Date(today);
    unavailableEnd.setDate(unavailableEnd.getDate() + 3);

    const engineer = {
      id: 'a',
      name: 'A',
      email: 'a@mozilla.com',
      availability: 1.0,
      unavailability: [
        { start: unavailableStart.toISOString(), end: unavailableEnd.toISOString() }
      ]
    };

    const bugs = [
      {
        id: 42,
        summary: 'Blocked by PTO',
        status: 'NEW',
        size: 1,
        assignee: 'a@mozilla.com',
        dependsOn: []
      }
    ];

    const graph = { '42': [] };

    messages.length = 0;
    globalThis.self.onmessage({
      data: {
        type: 'start',
        data: {
          bugs,
          engineers: [engineer],
          graph,
          milestones: [],
          iterations: 100,
          id: 0
        }
      }
    });

    const complete = messages.find(m => m.type === 'complete');
    expect(complete).toBeDefined();
    expect(Array.isArray(complete.schedule)).toBe(true);
    expect(complete.schedule.length).toBe(1);

    const scheduled = complete.schedule[0];
    const expectedStart = normalizeStartDate(new Date(today), engineer);
    expect(scheduled.startDate.toISOString().split('T')[0])
      .toBe(expectedStart.toISOString().split('T')[0]);
  });

  it('does not assign unassigned bugs to external placeholder engineers', () => {
    const bugs = [
      {
        id: 77,
        summary: 'Unassigned task',
        status: 'NEW',
        size: 1,
        assignee: null,
        dependsOn: []
      }
    ];

    const engineers = [
      { id: 'ext', name: 'External', email: 'external@example.com', availability: 1.0, isExternal: true },
      { id: 'real', name: 'Real', email: 'real@example.com', availability: 1.0, isExternal: false }
    ];

    const graph = { '77': [] };

    messages.length = 0;
    globalThis.self.onmessage({
      data: {
        type: 'start',
        data: {
          bugs,
          engineers,
          graph,
          milestones: [],
          iterations: 10,
          id: 0
        }
      }
    });

    const complete = messages.find(m => m.type === 'complete');
    expect(complete).toBeDefined();
    const scheduled = complete.schedule?.[0];
    expect(scheduled).toBeDefined();
    expect(scheduled.engineer?.isExternal).toBe(false);
    expect(scheduled.engineer?.id).toBe('real');
  });
});
