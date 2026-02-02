/**
 * SA Baseline Test - Uses static fixture data
 * Tests the greedy scheduler and SA to establish what's achievable
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Scheduler } from '../../js/scheduler.js';
import { DependencyGraph } from '../../js/dependency-graph.js';
import snapshot from '../fixtures/live-snapshot.json' assert { type: 'json' };
import engineersData from '../../data/engineers.json' assert { type: 'json' };

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];

describe('SA Baseline with Static Fixture', () => {
  let bugs, bugMap, graph, sortedBugs, scheduler, schedule, filteredBugs;

  beforeAll(() => {
    bugs = snapshot.bugs;
    bugMap = new Map();
    for (const bug of bugs) {
      bugMap.set(String(bug.id), bug);
    }

    graph = new DependencyGraph();
    graph.buildFromBugs(bugMap);
    const result = graph.topologicalSort();
    sortedBugs = result.valid ? result.sorted.map(id => bugMap.get(id)).filter(Boolean) : [];

    // Filter to S1-S2 severity (matching what the app does)
    // IMPORTANT: Always include milestone bugs regardless of component/severity
    const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
    filteredBugs = sortedBugs.filter(b => {
      // Always include milestones
      if (milestoneBugIds.has(String(b.id))) return true;
      // Otherwise filter by component and severity
      return b.component === 'Client' && ['S1', 'S2'].includes(b.severity);
    });

    scheduler = new Scheduler(engineersData.engineers, MILESTONES);
    schedule = scheduler.scheduleTasks(filteredBugs, graph);
  });

  it('should have expected number of unresolved S1-S2 bugs', () => {
    const unresolved = snapshot.bugs.filter(b =>
      !RESOLVED_STATUSES.includes(b.status) &&
      ['S1', 'S2'].includes(b.severity)
    );
    console.log(`Unresolved S1-S2 bugs in fixture: ${unresolved.length}`);
    expect(unresolved.length).toBe(28);
  });

  it('should report greedy schedule baseline', () => {
    const stats = scheduler.getStats(schedule);
    const risks = scheduler.checkDeadlineRisks(schedule);

    console.log('\n=== GREEDY BASELINE ===');
    console.log(`Total tasks: ${stats.totalTasks}`);
    console.log(`Scheduled: ${stats.scheduledTasks}`);
    console.log(`Completed: ${stats.completedTasks}`);
    console.log(`Total days: ${stats.totalDays}`);
    console.log(`Risks: ${risks.length}`);

    // Check milestone completion
    const milestoneCompletions = {};
    for (const milestone of MILESTONES) {
      const deps = getAllDependencies(String(milestone.bugId), graph);
      let maxEnd = null;
      for (const task of schedule) {
        if (deps.has(String(task.bug.id)) && task.endDate) {
          if (!maxEnd || task.endDate > maxEnd) maxEnd = task.endDate;
        }
      }
      milestoneCompletions[milestone.name] = maxEnd;
    }

    let deadlinesMet = 0;
    for (const milestone of MILESTONES) {
      const completion = milestoneCompletions[milestone.name];
      const met = completion && completion <= milestone.freezeDate;
      if (met) deadlinesMet++;
      console.log(`${milestone.name}: ${completion ? completion.toISOString().split('T')[0] : 'N/A'} (freeze: ${milestone.freezeDate.toISOString().split('T')[0]}) - ${met ? '✓' : '✗'}`);
    }

    console.log(`\nGreedy achieves: ${deadlinesMet}/3 deadlines`);
    expect(stats.scheduledTasks).toBeGreaterThan(0);
  });

  it('should run SA optimization (8x8k iterations)', async () => {
    // Mock worker environment for testing
    const messages = [];
    globalThis.self = {
      postMessage: (msg) => messages.push(msg),
      close: () => {}
    };

    // Import the worker module (will use our mock self)
    const worker = await import('../../js/optimal-scheduler-worker.js');

    // Build the graph as the worker expects (adjacency list format)
    // IMPORTANT: Use ALL bugs, not just filtered, so worker can compute transitive deps
    const graphData = {};
    for (const bug of bugs) {
      graphData[String(bug.id)] = bug.dependsOn || [];
    }

    // Run with tuned parameters (8 workers × 8k iterations)
    const ITERATIONS = 8000;
    const RUNS = 8;
    const results = [];

    console.log(`\n=== SA OPTIMIZATION (${RUNS}x${ITERATIONS/1000}k iterations) ===`);

    for (let run = 0; run < RUNS; run++) {
      messages.length = 0; // Clear messages

      // Simulate worker start message
      globalThis.self.onmessage({
        data: {
          type: 'start',
          data: {
            bugs: filteredBugs,
            engineers: engineersData.engineers,
            graph: graphData,
            milestones: MILESTONES.map(m => ({
              name: m.name,
              bugId: m.bugId,
              deadline: m.deadline.toISOString(),
              freezeDate: m.freezeDate.toISOString()
            })),
            iterations: ITERATIONS,
            id: run
          }
        }
      });

      // Find the complete message
      const completeMsg = messages.find(m => m.type === 'complete');
      if (completeMsg) {
        results.push({
          run,
          deadlinesMet: completeMsg.deadlinesMet,
          makespan: completeMsg.makespan,
          bestFoundAt: completeMsg.bestFoundAtIteration
        });
        const convergencePct = ((completeMsg.bestFoundAtIteration / ITERATIONS) * 100).toFixed(0);
        console.log(`Run ${run + 1}: ${completeMsg.deadlinesMet}/3 deadlines, ${completeMsg.makespan} days, converged at ${convergencePct}%`);
      }
    }

    // Best across all runs
    const best = results.reduce((a, b) =>
      b.deadlinesMet > a.deadlinesMet || (b.deadlinesMet === a.deadlinesMet && b.makespan < a.makespan) ? b : a
    );

    const successes = results.filter(r => r.deadlinesMet === 3).length;
    const avgDeadlines = (results.reduce((s, r) => s + r.deadlinesMet, 0) / RUNS).toFixed(1);
    const avgConvergence = (results.reduce((s, r) => s + (r.bestFoundAt / ITERATIONS * 100), 0) / RUNS).toFixed(1);

    console.log(`\n=== SA RESULTS ===`);
    console.log(`Best: ${best.deadlinesMet}/3 deadlines, ${best.makespan} days`);
    console.log(`Reliability: ${successes}/${RUNS} (${(successes/RUNS*100).toFixed(0)}%) achieve 3/3`);
    console.log(`Avg deadlines: ${avgDeadlines}/3`);
    console.log(`Avg convergence: ${avgConvergence}% of iterations`);

    // With current workload, 2/3 is the maximum achievable (Foxfooding infeasible)
    // Foxfooding requires 60 engineer-days but only 40 available (4 eng × 10 days)
    expect(best.deadlinesMet).toBe(2);
  });
});

function getAllDependencies(bugId, graph) {
  const visited = new Set();
  const queue = [bugId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const deps = graph.getDependencies(id) || [];
    for (const depId of deps) {
      if (!visited.has(String(depId))) queue.push(String(depId));
    }
  }
  visited.delete(bugId);
  return visited;
}
