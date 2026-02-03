import { describe, it, expect, beforeAll } from 'vitest';

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
});
