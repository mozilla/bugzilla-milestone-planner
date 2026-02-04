#!/usr/bin/env node
/**
 * Benchmark script for comparing optimizer modes.
 * Reuses production code as much as possible.
 */

import { Scheduler } from '../js/scheduler.js';
import { DependencyGraph } from '../js/dependency-graph.js';
import { isBetterScore } from '../js/optimizer-utils.js';
import { readFileSync } from 'fs';

// Load data
const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

// Build optimizer engineers (matches main.js buildOptimizerEngineers)
function buildOptimizerEngineers(bugs, baseEngineers) {
  const engineers = baseEngineers.map(e => ({ ...e, isExternal: false }));
  const knownEmails = new Set(
    engineers.map(e => e.email && e.email.toLowerCase()).filter(Boolean)
  );

  const externals = new Map();
  for (const bug of bugs || []) {
    if (!bug.assignee || bug.assignee === 'nobody@mozilla.org') continue;
    const email = bug.assignee.toLowerCase();
    if (knownEmails.has(email)) continue;
    if (!externals.has(email)) {
      externals.set(email, {
        id: `external:${email}`,
        name: 'External',
        email,
        availability: 1.0,
        unavailability: [],
        isExternal: true
      });
    }
  }

  return [...engineers, ...externals.values()];
}

// Production constants from main.js and worker
const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];
const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
const NUM_WORKERS = 12;
const ITERATIONS_PER_WORKER = 10000;
const EXHAUSTIVE_CONTINUOUS_COOLING_RATE = 0.999987;
const CONTINUOUS_SPLIT = Math.round(NUM_WORKERS * 0.75);

// Severity filter options (matching main.js UI)
const SEVERITY_FILTERS = {
  'S1': (sev) => sev === 'S1',
  'S1-S2': (sev) => ['S1', 'S2'].includes(sev),
  'S1+S2+untriaged': (sev) => ['S1', 'S2', 'N/A', '--'].includes(sev || 'N/A'),
  'S1-S3': (sev) => ['S1', 'S2', 'S3'].includes(sev),
  'All': () => true
};

// Prepare data (same as main.js)
function prepareData(severityFilter = 'S1-S2') {
  const bugMap = new Map();
  for (const bug of snapshot.bugs) {
    bugMap.set(String(bug.id), bug);
  }

  const graph = new DependencyGraph();
  graph.buildFromBugs(bugMap);
  const { sorted } = graph.topologicalSort();
  const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

  // Filter matching main.js
  const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
  const severityFn = SEVERITY_FILTERS[severityFilter] || SEVERITY_FILTERS['S1-S2'];

  const filteredBugs = sortedBugs.filter(b => {
    if (milestoneBugIds.has(String(b.id))) return true;
    if (RESOLVED_STATUSES.includes(b.status)) return false;
    if (b.component !== 'Client') return false;
    return severityFn(b.severity);
  });

  // Graph data for worker
  const graphData = {};
  for (const bug of snapshot.bugs) {
    graphData[String(bug.id)] = bug.dependsOn || [];
  }

  // Build engineers with external placeholders (matches main.js)
  const engineers = buildOptimizerEngineers(filteredBugs, engineersData.engineers);

  return { filteredBugs, graph, graphData, engineers };
}

// Run greedy scheduler (uses production Scheduler class)
function runGreedy(filteredBugs, graph, engineers) {
  const scheduler = new Scheduler(engineers, MILESTONES);
  const schedule = scheduler.scheduleTasks(filteredBugs, graph);
  const stats = scheduler.getStats();

  // Calculate milestone completions
  function getAllDeps(bugId) {
    const visited = new Set();
    const queue = [String(bugId)];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const deps = graph.getDependencies(id) || [];
      for (const d of deps) {
        if (!visited.has(String(d))) queue.push(String(d));
      }
    }
    return visited;
  }

  let deadlinesMet = 0;
  let totalLateness = 0;
  const details = [];

  for (const m of MILESTONES) {
    const deps = getAllDeps(m.bugId);
    let maxEnd = null;
    for (const task of schedule) {
      if (deps.has(String(task.bug.id)) && task.endDate) {
        if (!maxEnd || task.endDate > maxEnd) maxEnd = task.endDate;
      }
    }
    const met = maxEnd && maxEnd <= m.freezeDate;
    if (met) {
      deadlinesMet++;
    } else if (maxEnd) {
      totalLateness += Math.ceil((maxEnd - m.freezeDate) / (1000*60*60*24));
    }
    details.push({ name: m.name, met, endDate: maxEnd, freezeDate: m.freezeDate });
  }

  return { schedule, stats, score: { deadlinesMet, totalLateness, makespan: stats.totalDays }, details };
}

// Setup worker mock (reuses actual worker code)
async function setupWorker() {
  const workerMessages = [];
  globalThis.self = {
    postMessage: (msg) => workerMessages.push(msg),
    close: () => {}
  };
  await import('../js/optimal-scheduler-worker.js');
  return workerMessages;
}

// Run single worker instance
function runWorker(workerMessages, filteredBugs, graphData, engineers, options = {}) {
  workerMessages.length = 0;

  const startData = {
    bugs: filteredBugs,
    engineers,
    graph: graphData,
    milestones: MILESTONES.map(m => ({
      name: m.name,
      bugId: m.bugId,
      deadline: m.deadline.toISOString(),
      freezeDate: m.freezeDate.toISOString()
    })),
    iterations: options.iterations || ITERATIONS_PER_WORKER,
    id: options.id || 0,
    ...options
  };

  globalThis.self.onmessage({ data: { type: 'start', data: startData } });
  return workerMessages.find(m => m.type === 'complete');
}

async function main() {
  const severityFilter = process.argv[2] || 'S1-S2';
  console.log(`=== Optimizer Benchmark (${severityFilter}) ===\n`);

  const { filteredBugs, graph, graphData, engineers } = prepareData(severityFilter);
  console.log(`Bugs: ${filteredBugs.length} filtered (${snapshot.bugs.length} total)`);
  console.log(`Engineers: ${engineers.length} (${engineersData.engineers.length} team + ${engineers.length - engineersData.engineers.length} external)`);

  // Greedy
  console.log('\n--- GREEDY ---');
  const greedy = runGreedy(filteredBugs, graph, engineers);
  console.log(`Deadlines: ${greedy.score.deadlinesMet}/3`);
  for (const d of greedy.details) {
    const dateStr = d.endDate ? d.endDate.toISOString().split('T')[0] : 'N/A';
    const freezeStr = d.freezeDate.toISOString().split('T')[0];
    const late = d.endDate && d.endDate > d.freezeDate
      ? Math.ceil((d.endDate - d.freezeDate) / (1000*60*60*24)) : 0;
    console.log(`  ${d.name}: ${dateStr} (freeze: ${freezeStr}) ${d.met ? '✓' : `✗ ${late}d late`}`);
  }

  // Setup worker
  const workerMessages = await setupWorker();

  // Optimal (12x10k, no state preservation)
  console.log('\n--- OPTIMAL (12x10k) ---');
  let optimalBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const optimalResults = [];

  for (let i = 0; i < NUM_WORKERS; i++) {
    const result = runWorker(workerMessages, filteredBugs, graphData, engineers, { id: i });
    if (result) {
      optimalResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, optimalBest)) {
        optimalBest = score;
      }
    }
  }
  console.log(`Best: ${optimalBest.deadlinesMet}/3 deadlines, ${optimalBest.totalLateness}d lateness, ${optimalBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${optimalResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);

  // Exhaustive (simulate 60s with state preservation)
  console.log('\n--- EXHAUSTIVE (60s simulation) ---');
  const EXHAUSTIVE_DURATION_MS = 60000;
  const exhaustiveStart = Date.now();
  let exhaustiveBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  let exhaustiveBestAssignment = null;
  let rounds = 0;
  let totalIters = 0;
  let minMakespanSeen = Infinity;
  let minLatenessSeen = Infinity;

  // Worker states (matches main.js)
  const workerStates = [];
  for (let w = 0; w < NUM_WORKERS; w++) {
    workerStates.push({
      strategy: w < CONTINUOUS_SPLIT ? 'continuous' : 'reheat',
      lastAssignment: null,
      lastTemperature: null
    });
  }

  while (Date.now() - exhaustiveStart < EXHAUSTIVE_DURATION_MS) {
    for (let w = 0; w < NUM_WORKERS && (Date.now() - exhaustiveStart < EXHAUSTIVE_DURATION_MS); w++) {
      const state = workerStates[w];

      const options = { id: w };

      // Apply state preservation (matches main.js lines 1008-1022)
      if (state.lastAssignment) {
        options.startAssignment = state.lastAssignment;
      } else if (exhaustiveBestAssignment) {
        options.startAssignment = exhaustiveBestAssignment;
      }

      if (state.strategy === 'continuous') {
        options.coolingRate = EXHAUSTIVE_CONTINUOUS_COOLING_RATE;
        if (state.lastTemperature !== null) {
          options.startTemperature = state.lastTemperature;
        }
      } else if (state.strategy === 'reheat') {
        options.reheat = true;
      }

      const result = runWorker(workerMessages, filteredBugs, graphData, engineers, options);
      if (result) {
        totalIters += ITERATIONS_PER_WORKER;

        // Update worker state (matches main.js lines 977-982)
        if (result.bestAssignment) {
          state.lastAssignment = result.bestAssignment;
        }
        if (result.finalTemperature !== undefined) {
          state.lastTemperature = result.finalTemperature;
        }

        const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
        if (isBetterScore(score, exhaustiveBest)) {
          exhaustiveBest = score;
          exhaustiveBestAssignment = result.bestAssignment;
        }

        if (isBetterScore(score, { deadlinesMet: exhaustiveBest.deadlinesMet, totalLateness: minLatenessSeen, makespan: minMakespanSeen })) {
          minMakespanSeen = result.makespan;
          minLatenessSeen = score.totalLateness;
          const elapsed = ((Date.now() - exhaustiveStart) / 1000).toFixed(1);
          console.log(`  New best: ${result.deadlinesMet}/3, ${score.totalLateness}d late, ${result.makespan}d makespan at ${elapsed}s (worker ${w}, ${state.strategy})`);
        }
      }
    }
    rounds++;
  }

  const exhaustiveElapsed = ((Date.now() - exhaustiveStart) / 1000).toFixed(1);
  console.log(`Completed: ${rounds} rounds, ${(totalIters/1000)}k iterations in ${exhaustiveElapsed}s`);
  console.log(`Best: ${exhaustiveBest.deadlinesMet}/3 deadlines, ${exhaustiveBest.makespan}d makespan`);

  // Extended search for further improvements
  console.log('\n--- EXTENDED SEARCH (2 more minutes) ---');
  let foundBetter = false;
  const extendedStart = Date.now();
  const EXTENDED_DURATION_MS = 120000; // 2 more minutes

  while (Date.now() - extendedStart < EXTENDED_DURATION_MS) {
    for (let w = 0; w < NUM_WORKERS && (Date.now() - extendedStart < EXTENDED_DURATION_MS); w++) {
      const state = workerStates[w];

      const options = { id: w };
      if (state.lastAssignment) options.startAssignment = state.lastAssignment;
      else if (exhaustiveBestAssignment) options.startAssignment = exhaustiveBestAssignment;

      if (state.strategy === 'continuous') {
        options.coolingRate = EXHAUSTIVE_CONTINUOUS_COOLING_RATE;
        if (state.lastTemperature !== null) options.startTemperature = state.lastTemperature;
      } else {
        options.reheat = true;
      }

      const result = runWorker(workerMessages, filteredBugs, graphData, engineers, options);
      if (result) {
        totalIters += ITERATIONS_PER_WORKER;

        if (result.bestAssignment) state.lastAssignment = result.bestAssignment;
        if (result.finalTemperature !== undefined) state.lastTemperature = result.finalTemperature;

        const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
        if (isBetterScore(score, exhaustiveBest)) {
          exhaustiveBest = score;
          exhaustiveBestAssignment = result.bestAssignment;
          const elapsed = ((Date.now() - extendedStart) / 1000).toFixed(1);
          console.log(`  Improved: ${result.deadlinesMet}/3, ${result.makespan}d at ${elapsed}s extended`);
          foundBetter = true;
        }
      }
    }
  }

  if (!foundBetter) {
    console.log(`  No improvement found in extended search (${(totalIters/1000)}k total iterations)`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('| Mode       | Deadlines | Lateness | Makespan |');
  console.log('|------------|-----------|----------|----------|');
  console.log(`| Greedy     | ${greedy.score.deadlinesMet}/3       | ${greedy.score.totalLateness}d       | -        |`);
  console.log(`| Optimal    | ${optimalBest.deadlinesMet}/3       | ${optimalBest.totalLateness}d       | ${optimalBest.makespan}d       |`);
  console.log(`| Exhaustive | ${exhaustiveBest.deadlinesMet}/3       | ${exhaustiveBest.totalLateness}d       | ${exhaustiveBest.makespan}d       |`);
  console.log(`\nTotal iterations: ${(totalIters/1000)}k`);

  if (exhaustiveBest.totalLateness < optimalBest.totalLateness &&
      exhaustiveBest.deadlinesMet >= optimalBest.deadlinesMet) {
    console.log(`\n✓ Exhaustive improved lateness by ${optimalBest.totalLateness - exhaustiveBest.totalLateness} day(s)`);
  }

}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
