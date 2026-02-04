/**
 * SA Parameter Tuning Test
 * Finds optimal parameters for fastest convergence to best result (1/3 deadlines + min makespan)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DependencyGraph } from '../../js/dependency-graph.js';
import snapshot from '../fixtures/live-snapshot.json' assert { type: 'json' };
import engineersData from '../../data/engineers.json' assert { type: 'json' };

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

describe('SA Parameter Tuning', () => {
  let filteredBugs, graphData;

  beforeAll(() => {
    const bugs = snapshot.bugs;
    const bugMap = new Map();
    for (const bug of bugs) {
      bugMap.set(String(bug.id), bug);
    }

    const graph = new DependencyGraph();
    graph.buildFromBugs(bugMap);
    const { sorted } = graph.topologicalSort();
    const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

    // Filter matching app logic (always include milestones)
    const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
    filteredBugs = sortedBugs.filter(b => {
      if (milestoneBugIds.has(String(b.id))) return true;
      return b.component === 'Client' && ['S1', 'S2'].includes(b.severity);
    });

    // Full graph for dependency lookups
    graphData = {};
    for (const bug of bugs) {
      graphData[String(bug.id)] = bug.dependsOn || [];
    }
  });

  it('should find optimal SA parameters', async () => {
    // Parameter combinations to test (focused on 4k-8k range)
    const configs = [
      { name: '4k', iterations: 4000 },
      { name: '5k', iterations: 5000 },
      { name: '6k', iterations: 6000 },
      { name: '7k', iterations: 7000 },
      { name: '8k', iterations: 8000 },
      { name: '10k-baseline', iterations: 10000 },
    ];

    const RUNS_PER_CONFIG = 8; // Match 8 workers
    const results = [];

    // Mock worker environment
    const messages = [];
    globalThis.self = {
      postMessage: (msg) => messages.push(msg),
      close: () => {}
    };

    // Import worker module (sets up onmessage handler on our mock self)
    await import('../../js/optimal-scheduler-worker.js');

    console.log('\n=== SA PARAMETER TUNING ===\n');
    console.log('Target: 1/3 deadlines + minimal makespan\n');

    for (const config of configs) {
      // Dynamically modify the worker's parameters by re-importing with modified globals
      // Since we can't easily modify the module's constants, we'll pass iterations via message
      // and accept the default temp/cooling for now

      const configResults = [];
      const startTime = Date.now();

      for (let run = 0; run < RUNS_PER_CONFIG; run++) {
        messages.length = 0;

        // Reset module state by creating fresh import
        // Note: We're testing with the worker's built-in params for now
        // A full test would require parameterizing the worker

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
              iterations: config.iterations,
              id: run
            }
          }
        });

        const complete = messages.find(m => m.type === 'complete');
        if (complete) {
          configResults.push({
            deadlines: complete.deadlinesMet,
            makespan: complete.makespan,
            convergedAt: complete.bestFoundAtIteration
          });
        }
      }

      const elapsed = Date.now() - startTime;

      // Analyze results - with current snapshot 2/3 deadlines is achievable
      const successes = configResults.filter(r => r.deadlines >= 2).length;
      const avgMakespan = configResults.length > 0
        ? (configResults.reduce((s, r) => s + r.makespan, 0) / configResults.length).toFixed(1)
        : 'N/A';
      const minMakespan = configResults.length > 0
        ? Math.min(...configResults.map(r => r.makespan))
        : 'N/A';
      const avgConvergence = configResults.length > 0
        ? (configResults.reduce((s, r) => s + (r.convergedAt / config.iterations * 100), 0) / configResults.length).toFixed(0)
        : 'N/A';

      results.push({
        config: config.name,
        iterations: config.iterations,
        reliability: `${successes}/${RUNS_PER_CONFIG}`,
        reliabilityPct: (successes / RUNS_PER_CONFIG * 100).toFixed(0),
        avgMakespan,
        minMakespan,
        avgConvergence: `${avgConvergence}%`,
        timeMs: elapsed
      });

      console.log(`${config.name} (${config.iterations} iters):`);
      console.log(`  Reliability: ${successes}/${RUNS_PER_CONFIG} (${(successes/RUNS_PER_CONFIG*100).toFixed(0)}%)`);
      console.log(`  Makespan: avg=${avgMakespan}, min=${minMakespan} days`);
      console.log(`  Convergence: ${avgConvergence}% of iterations`);
      console.log(`  Time: ${elapsed}ms\n`);
    }

    // Find best config (highest reliability, then lowest makespan, then fastest)
    console.log('=== RANKINGS ===\n');

    const ranked = [...results]
      .filter(r => parseInt(r.reliabilityPct) >= 100) // Must be 100% reliable
      .sort((a, b) => {
        // Sort by min makespan, then by time
        if (a.minMakespan !== b.minMakespan) return a.minMakespan - b.minMakespan;
        return a.timeMs - b.timeMs;
      });

    if (ranked.length > 0) {
      console.log('Best configs (100% reliable, sorted by makespan then speed):');
      ranked.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.config}: makespan=${r.minMakespan}, time=${r.timeMs}ms`);
      });
    } else {
      console.log('No config achieved 100% reliability. Best by reliability:');
      const byReliability = [...results].sort((a, b) =>
        parseInt(b.reliabilityPct) - parseInt(a.reliabilityPct)
      );
      byReliability.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.config}: ${r.reliability} reliable, makespan=${r.minMakespan}`);
      });
    }

    // With current snapshot, 2/3 deadlines should be reliably achievable.
    expect(results.some(r => parseInt(r.reliabilityPct, 10) >= 75)).toBe(true);
  });
});
