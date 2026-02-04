#!/usr/bin/env node
/**
 * Benchmark script comparing GA vs SA optimizers.
 */

import { DependencyGraph } from '../js/dependency-graph.js';
import { isBetterScore } from '../js/optimizer-utils.js';
import { readFileSync } from 'fs';

const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

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

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];
const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];

const SEVERITY_FILTERS = {
  'S1': (sev) => sev === 'S1',
  'S1-S2': (sev) => ['S1', 'S2'].includes(sev),
  'S1+S2+untriaged': (sev) => ['S1', 'S2', 'N/A', '--'].includes(sev || 'N/A'),
  'S1-S3': (sev) => ['S1', 'S2', 'S3'].includes(sev),
  'All': () => true
};

function prepareData(severityFilter = 'S1-S2') {
  const bugMap = new Map();
  for (const bug of snapshot.bugs) {
    bugMap.set(String(bug.id), bug);
  }

  const graph = new DependencyGraph();
  graph.buildFromBugs(bugMap);
  const { sorted } = graph.topologicalSort();
  const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

  const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
  const severityFn = SEVERITY_FILTERS[severityFilter] || SEVERITY_FILTERS['S1-S2'];

  const filteredBugs = sortedBugs.filter(b => {
    if (milestoneBugIds.has(String(b.id))) return true;
    if (RESOLVED_STATUSES.includes(b.status)) return false;
    if (b.component !== 'Client') return false;
    return severityFn(b.severity);
  });

  const graphData = {};
  for (const bug of snapshot.bugs) {
    graphData[String(bug.id)] = bug.dependsOn || [];
  }

  const engineers = buildOptimizerEngineers(filteredBugs, engineersData.engineers);

  return { filteredBugs, graph, graphData, engineers };
}

// Store worker handlers separately since module imports only run once
let saOnmessage = null;
let gaOnmessage = null;

async function setupSAWorker() {
  const messages = [];
  globalThis.self = {
    postMessage: (msg) => messages.push(msg),
    close: () => {}
  };
  await import('../js/optimal-scheduler-worker.js');
  saOnmessage = globalThis.self.onmessage;
  return messages;
}

async function setupGAWorker() {
  const messages = [];
  globalThis.self = {
    postMessage: (msg) => messages.push(msg),
    close: () => {}
  };
  await import('../js/ga-scheduler-worker.js');
  gaOnmessage = globalThis.self.onmessage;
  return messages;
}

function runSAWorker(messages, filteredBugs, graphData, engineers, options = {}) {
  messages.length = 0;

  // Temporarily set postMessage for this worker
  const savedPostMessage = globalThis.self.postMessage;
  globalThis.self.postMessage = (msg) => messages.push(msg);

  saOnmessage({
    data: {
      type: 'start',
      data: {
        bugs: filteredBugs,
        engineers,
        graph: graphData,
        milestones: MILESTONES.map(m => ({
          name: m.name,
          bugId: m.bugId,
          deadline: m.deadline.toISOString(),
          freezeDate: m.freezeDate.toISOString()
        })),
        iterations: options.iterations || 10000,
        id: options.id || 0,
        ...options
      }
    }
  });

  globalThis.self.postMessage = savedPostMessage;
  return messages.find(m => m.type === 'complete');
}

function runGAWorker(messages, filteredBugs, graphData, engineers, options = {}) {
  messages.length = 0;

  // Temporarily set postMessage for this worker
  const savedPostMessage = globalThis.self.postMessage;
  globalThis.self.postMessage = (msg) => messages.push(msg);

  gaOnmessage({
    data: {
      type: 'start',
      data: {
        bugs: filteredBugs,
        engineers,
        graph: graphData,
        milestones: MILESTONES.map(m => ({
          name: m.name,
          bugId: m.bugId,
          deadline: m.deadline.toISOString(),
          freezeDate: m.freezeDate.toISOString()
        })),
        generations: options.generations || 200,
        populationSize: options.populationSize || 50,
        id: options.id || 0,
        ...options
      }
    }
  });

  globalThis.self.postMessage = savedPostMessage;
  return messages.find(m => m.type === 'complete');
}

async function main() {
  const severityFilter = process.argv[2] || 'S1-S2';
  console.log(`=== SA vs GA Benchmark (${severityFilter}) ===\n`);

  const { filteredBugs, graphData, engineers } = prepareData(severityFilter);
  console.log(`Bugs: ${filteredBugs.length}`);
  console.log(`Engineers: ${engineers.length}`);

  // Setup workers
  const saMessages = await setupSAWorker();
  const gaMessages = await setupGAWorker();

  const NUM_RUNS = 8;

  // SA benchmark
  console.log('\n--- SIMULATED ANNEALING (10k iterations x 8 runs) ---');
  const saStart = Date.now();
  let saBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const saResults = [];

  for (let i = 0; i < NUM_RUNS; i++) {
    const result = runSAWorker(saMessages, filteredBugs, graphData, engineers, {
      id: i,
      iterations: 10000
    });
    if (result) {
      saResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, saBest)) {
        saBest = score;
      }
    }
  }

  const saElapsed = Date.now() - saStart;
  console.log(`Best: ${saBest.deadlinesMet}/3 deadlines, ${saBest.totalLateness}d lateness, ${saBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${saResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);
  console.log(`Time: ${saElapsed}ms (${(saElapsed / NUM_RUNS).toFixed(0)}ms/run)`);
  console.log(`Convergence: ${saResults.map(r => Math.round(r.bestFoundAtIteration / 100)).join(', ')}% of iterations`);

  // GA benchmark - equivalent compute: 50 pop × 200 gen = 10k evaluations
  console.log('\n--- GENETIC ALGORITHM (50 pop × 200 gen x 8 runs) ---');
  const gaStart = Date.now();
  let gaBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const gaResults = [];

  for (let i = 0; i < NUM_RUNS; i++) {
    const result = runGAWorker(gaMessages, filteredBugs, graphData, engineers, {
      id: i,
      generations: 200,
      populationSize: 50
    });
    if (result) {
      gaResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, gaBest)) {
        gaBest = score;
      }
    }
  }

  const gaElapsed = Date.now() - gaStart;
  console.log(`Best: ${gaBest.deadlinesMet}/3 deadlines, ${gaBest.totalLateness}d lateness, ${gaBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${gaResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);
  console.log(`Time: ${gaElapsed}ms (${(gaElapsed / NUM_RUNS).toFixed(0)}ms/run)`);
  console.log(`Convergence: gen ${gaResults.map(r => r.bestFoundAtGeneration).join(', ')}`);

  // Try higher generations
  console.log('\n--- GA HIGH (50 pop × 500 gen x 4 runs) ---');
  const gaHighStart = Date.now();
  let gaHighBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const gaHighResults = [];

  for (let i = 0; i < 4; i++) {
    const result = runGAWorker(gaMessages, filteredBugs, graphData, engineers, {
      id: i,
      generations: 500,
      populationSize: 50
    });
    if (result) {
      gaHighResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, gaHighBest)) {
        gaHighBest = score;
      }
    }
  }

  const gaHighElapsed = Date.now() - gaHighStart;
  console.log(`Best: ${gaHighBest.deadlinesMet}/3 deadlines, ${gaHighBest.totalLateness}d lateness, ${gaHighBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${gaHighResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);
  console.log(`Time: ${gaHighElapsed}ms (${(gaHighElapsed / 4).toFixed(0)}ms/run)`);

  // Try larger population
  console.log('\n--- GA LARGE POP (100 pop × 200 gen x 4 runs) ---');
  const gaLargeStart = Date.now();
  let gaLargeBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const gaLargeResults = [];

  for (let i = 0; i < 4; i++) {
    const result = runGAWorker(gaMessages, filteredBugs, graphData, engineers, {
      id: i,
      generations: 200,
      populationSize: 100
    });
    if (result) {
      gaLargeResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, gaLargeBest)) {
        gaLargeBest = score;
      }
    }
  }

  const gaLargeElapsed = Date.now() - gaLargeStart;
  console.log(`Best: ${gaLargeBest.deadlinesMet}/3 deadlines, ${gaLargeBest.totalLateness}d lateness, ${gaLargeBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${gaLargeResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);
  console.log(`Time: ${gaLargeElapsed}ms (${(gaLargeElapsed / 4).toFixed(0)}ms/run)`);

  // Try GA with higher mutation rate (better exploration)
  console.log('\n--- GA TUNED (50 pop × 300 gen, mut=0.15 x 4 runs) ---');
  const gaTunedStart = Date.now();
  let gaTunedBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  const gaTunedResults = [];

  for (let i = 0; i < 4; i++) {
    const result = runGAWorker(gaMessages, filteredBugs, graphData, engineers, {
      id: i,
      generations: 300,
      populationSize: 50,
      mutationRate: 0.15
    });
    if (result) {
      gaTunedResults.push(result);
      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, gaTunedBest)) {
        gaTunedBest = score;
      }
    }
  }

  const gaTunedElapsed = Date.now() - gaTunedStart;
  console.log(`Best: ${gaTunedBest.deadlinesMet}/3 deadlines, ${gaTunedBest.totalLateness}d lateness, ${gaTunedBest.makespan}d makespan`);
  console.log(`Makespan distribution: ${gaTunedResults.map(r => r.makespan).sort((a,b) => a-b).join(', ')}`);
  console.log(`Time: ${gaTunedElapsed}ms (${(gaTunedElapsed / 4).toFixed(0)}ms/run)`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('| Algorithm      | Deadlines | Lateness | Makespan | Time/run |');
  console.log('|----------------|-----------|----------|----------|----------|');
  console.log(`| SA (10k)       | ${saBest.deadlinesMet}/3       | ${saBest.totalLateness}d        | ${saBest.makespan}d        | ${(saElapsed / NUM_RUNS).toFixed(0)}ms     |`);
  console.log(`| GA (50×200)    | ${gaBest.deadlinesMet}/3       | ${gaBest.totalLateness}d        | ${gaBest.makespan}d        | ${(gaElapsed / NUM_RUNS).toFixed(0)}ms     |`);
  console.log(`| GA (50×500)    | ${gaHighBest.deadlinesMet}/3       | ${gaHighBest.totalLateness}d        | ${gaHighBest.makespan}d        | ${(gaHighElapsed / 4).toFixed(0)}ms     |`);
  console.log(`| GA (100×200)   | ${gaLargeBest.deadlinesMet}/3       | ${gaLargeBest.totalLateness}d        | ${gaLargeBest.makespan}d        | ${(gaLargeElapsed / 4).toFixed(0)}ms     |`);
  console.log(`| GA tuned       | ${gaTunedBest.deadlinesMet}/3       | ${gaTunedBest.totalLateness}d        | ${gaTunedBest.makespan}d        | ${(gaTunedElapsed / 4).toFixed(0)}ms     |`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
