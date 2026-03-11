/**
 * Schedule entry schema consistency test.
 *
 * Both the greedy Scheduler and the GA worker must produce schedule entries
 * with the same set of fields.  A missing field (like the `milestone` bug
 * fixed in this commit) silently breaks downstream consumers such as
 * GanttRenderer.isAtRisk().
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Scheduler } from '../../js/scheduler.js';
import { DependencyGraph } from '../../js/dependency-graph.js';

// Canonical fields that every non-completed schedule entry MUST have.
// If you add a field to the greedy scheduler's schedule.push(), add it here
// and ensure the GA worker's buildScheduleFromAssignment also includes it.
const REQUIRED_FIELDS = ['bug', 'startDate', 'endDate', 'engineer', 'effort', 'completed', 'milestone'];

describe('Schedule entry schema consistency', () => {

  describe('Greedy scheduler output', () => {
    const engineers = [
      { id: 'eng1', name: 'Alice', email: 'alice@mozilla.com', availability: 1.0 }
    ];
    const milestones = [
      {
        name: 'Test MS',
        bugId: 100,
        deadline: new Date('2026-06-01'),
        freezeDate: new Date('2026-05-25')
      }
    ];

    // Helper: topologicalSort returns string IDs; map them to bug objects like main.js does
    function sortBugs(bugs, graph) {
      const bugMap = new Map(bugs.map(b => [String(b.id), b]));
      const { sorted } = graph.topologicalSort();
      return sorted.map(id => bugMap.get(id)).filter(Boolean);
    }

    it('non-completed entries should have all required fields', () => {
      const bugs = [
        { id: 100, summary: 'Milestone', dependsOn: [101], blocks: [], status: 'NEW', assignee: 'nobody@mozilla.org', whiteboard: '[meta]', keywords: ['meta'], severity: 'S1', component: 'General' },
        { id: 101, summary: 'Work item', dependsOn: [], blocks: [100], status: 'NEW', assignee: 'alice@mozilla.com', whiteboard: '[size=2]', keywords: [], severity: 'S1', size: 2, component: 'General' }
      ];

      const graph = new DependencyGraph();
      for (const b of bugs) graph.addNode(b);
      const sortedBugs = sortBugs(bugs, graph);

      const scheduler = new Scheduler(engineers, milestones);
      scheduler.scheduleTasks(sortedBugs, graph);

      const nonCompleted = scheduler.schedule.filter(t => !t.completed);
      expect(nonCompleted.length).toBeGreaterThan(0);

      for (const entry of nonCompleted) {
        for (const field of REQUIRED_FIELDS) {
          expect(entry, `Schedule entry for bug ${entry.bug.id} missing '${field}'`)
            .toHaveProperty(field);
        }
      }
    });

    it('completed entries should have all required fields', () => {
      const bugs = [
        { id: 100, summary: 'Milestone', dependsOn: [102], blocks: [], status: 'NEW', assignee: 'nobody@mozilla.org', whiteboard: '[meta]', keywords: ['meta'], severity: 'S1', component: 'General' },
        { id: 102, summary: 'Done item', dependsOn: [], blocks: [100], status: 'RESOLVED', resolution: 'FIXED', assignee: 'alice@mozilla.com', whiteboard: '[size=1]', keywords: [], severity: 'S1', size: 1, component: 'General' }
      ];

      const graph = new DependencyGraph();
      for (const b of bugs) graph.addNode(b);
      const sortedBugs = sortBugs(bugs, graph);

      const scheduler = new Scheduler(engineers, milestones);
      scheduler.scheduleTasks(sortedBugs, graph);

      const completed = scheduler.schedule.filter(t => t.completed);
      expect(completed.length).toBeGreaterThan(0);

      for (const entry of completed) {
        for (const field of REQUIRED_FIELDS) {
          expect(entry, `Completed entry for bug ${entry.bug.id} missing '${field}'`)
            .toHaveProperty(field);
        }
      }
    });
  });

  describe('GA worker output', () => {
    let capturedMessages;
    let workerOnMessage;

    beforeAll(async () => {
      // Mock Web Worker globals before importing the worker module
      capturedMessages = [];
      globalThis.self = {
        onmessage: null,
        postMessage: (msg) => capturedMessages.push(msg),
        close: vi.fn()
      };

      // Dynamically import the worker (it sets self.onmessage at module level)
      await import('../../js/ga-scheduler-worker.js');
      workerOnMessage = globalThis.self.onmessage;
    });

    it('schedule entries should have all required fields', () => {
      const bugs = [
        { id: 500, summary: 'MS bug', dependsOn: [501], blocks: [], status: 'NEW', assignee: 'nobody@mozilla.org', whiteboard: '[meta]', keywords: ['meta'], severity: 'S1', isMeta: true, component: 'General' },
        { id: 501, summary: 'Work bug', dependsOn: [], blocks: [500], status: 'NEW', assignee: 'alice@mozilla.com', whiteboard: '[size=2]', keywords: [], severity: 'S1', size: 2, isMeta: false, component: 'General' }
      ];

      const engineers = [
        { id: 'eng1', name: 'Alice', email: 'alice@mozilla.com', availability: 1.0 }
      ];

      // The worker expects `graph` as a plain object: { bugId: [depId, ...] }
      const graph = {};
      for (const b of bugs) {
        graph[String(b.id)] = (b.dependsOn || []).map(String);
      }

      const milestones = [
        { name: 'Test MS', bugId: 500, deadline: '2026-06-01', freezeDate: '2026-05-25' }
      ];

      capturedMessages.length = 0;

      // Send a 'start' message with minimal generations to run quickly
      workerOnMessage({
        data: {
          type: 'start',
          data: {
            bugs,
            engineers,
            graph,
            milestones,
            generations: 1,
            populationSize: 2,
            id: 0
          }
        }
      });

      // The worker calls postMessage synchronously; find the 'complete' message
      const complete = capturedMessages.find(m => m.type === 'complete');
      expect(complete, 'Worker should have posted a "complete" message').toBeTruthy();
      expect(complete.schedule, 'Worker should return a schedule').toBeTruthy();
      expect(complete.schedule.length).toBeGreaterThan(0);

      for (const entry of complete.schedule) {
        for (const field of REQUIRED_FIELDS) {
          expect(
            entry,
            `GA worker schedule entry for bug ${entry.bug?.id || '?'} missing '${field}'`
          ).toHaveProperty(field);
        }
      }
    });
  });
});
