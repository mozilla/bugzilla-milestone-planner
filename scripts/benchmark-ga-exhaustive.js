#!/usr/bin/env node
/**
 * Benchmark GA vs SA for exhaustive mode (continuous improvement over time).
 */

import { DependencyGraph } from '../js/dependency-graph.js';
import { isBetterScore } from '../js/optimizer-utils.js';
import { readFileSync } from 'fs';

const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

function buildOptimizerEngineers(bugs, baseEngineers) {
  const engineers = baseEngineers.map(e => ({ ...e, isExternal: false }));
  const knownEmails = new Set(engineers.map(e => e.email?.toLowerCase()).filter(Boolean));
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
  'S1-S2': (sev) => ['S1', 'S2'].includes(sev),
  'S1+S2+untriaged': (sev) => ['S1', 'S2', 'N/A', '--'].includes(sev || 'N/A'),
  'All': () => true
};

function prepareData(severityFilter = 'S1-S2') {
  const bugMap = new Map();
  for (const bug of snapshot.bugs) bugMap.set(String(bug.id), bug);

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
  for (const bug of snapshot.bugs) graphData[String(bug.id)] = bug.dependsOn || [];

  const engineers = buildOptimizerEngineers(filteredBugs, engineersData.engineers);
  return { filteredBugs, graphData, engineers };
}

let saOnmessage = null;
let gaOnmessage = null;

async function setupWorkers() {
  // SA
  let saMessages = [];
  globalThis.self = {
    postMessage: (msg) => saMessages.push(msg),
    close: () => {}
  };
  await import('../js/optimal-scheduler-worker.js');
  saOnmessage = globalThis.self.onmessage;

  // GA
  let gaMessages = [];
  globalThis.self = {
    postMessage: (msg) => gaMessages.push(msg),
    close: () => {}
  };
  await import('../js/ga-scheduler-worker.js');
  gaOnmessage = globalThis.self.onmessage;

  return { saMessages, gaMessages };
}

function runSA(messages, data, options = {}) {
  messages.length = 0;
  const saved = globalThis.self.postMessage;
  globalThis.self.postMessage = (msg) => messages.push(msg);

  saOnmessage({
    data: {
      type: 'start',
      data: {
        bugs: data.filteredBugs,
        engineers: data.engineers,
        graph: data.graphData,
        milestones: MILESTONES.map(m => ({
          name: m.name, bugId: m.bugId,
          deadline: m.deadline.toISOString(),
          freezeDate: m.freezeDate.toISOString()
        })),
        iterations: options.iterations || 10000,
        id: options.id || 0,
        ...options
      }
    }
  });

  globalThis.self.postMessage = saved;
  return messages.find(m => m.type === 'complete');
}

function runGA(messages, data, options = {}) {
  messages.length = 0;
  const saved = globalThis.self.postMessage;
  globalThis.self.postMessage = (msg) => messages.push(msg);

  gaOnmessage({
    data: {
      type: 'start',
      data: {
        bugs: data.filteredBugs,
        engineers: data.engineers,
        graph: data.graphData,
        milestones: MILESTONES.map(m => ({
          name: m.name, bugId: m.bugId,
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

  globalThis.self.postMessage = saved;
  return messages.find(m => m.type === 'complete');
}

async function main() {
  const severityFilter = process.argv[2] || 'All';
  const testDuration = parseInt(process.argv[3]) || 30; // seconds

  console.log(`=== Exhaustive Mode Benchmark (${severityFilter}, ${testDuration}s) ===\n`);

  const data = prepareData(severityFilter);
  console.log(`Bugs: ${data.filteredBugs.length}, Engineers: ${data.engineers.length}\n`);

  const { saMessages, gaMessages } = await setupWorkers();

  // --- SA Exhaustive (continuous with state preservation) ---
  console.log('--- SA EXHAUSTIVE ---');
  const saStart = Date.now();
  let saBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  let saLastAssignment = null;
  let saLastTemp = null;
  let saRounds = 0;
  const saImprovements = [];

  while (Date.now() - saStart < testDuration * 1000) {
    const options = { iterations: 10000, id: saRounds };
    if (saLastAssignment) {
      options.startAssignment = saLastAssignment;
      options.coolingRate = 0.999987; // Slower cooling for continuous
      if (saLastTemp !== null) options.startTemperature = saLastTemp;
    }

    const result = runSA(saMessages, data, options);
    saRounds++;

    if (result) {
      saLastAssignment = result.bestAssignment;
      saLastTemp = result.finalTemperature;

      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, saBest)) {
        const elapsed = ((Date.now() - saStart) / 1000).toFixed(1);
        saImprovements.push({ time: elapsed, ...score });
        saBest = score;
        console.log(`  ${elapsed}s: ${score.deadlinesMet}/3, ${score.totalLateness}d late, ${score.makespan}d makespan`);
      }
    }
  }
  const saElapsed = ((Date.now() - saStart) / 1000).toFixed(1);
  console.log(`Completed: ${saRounds} rounds in ${saElapsed}s`);
  console.log(`Best: ${saBest.deadlinesMet}/3, ${saBest.totalLateness}d late, ${saBest.makespan}d makespan\n`);

  // --- GA Exhaustive (population seeding) ---
  console.log('--- GA EXHAUSTIVE ---');
  const gaStart = Date.now();
  let gaBest = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  let gaSeedPopulation = null;
  let gaRounds = 0;
  const gaImprovements = [];

  while (Date.now() - gaStart < testDuration * 1000) {
    const options = { generations: 200, populationSize: 50, id: gaRounds };
    if (gaSeedPopulation) {
      options.seedPopulation = gaSeedPopulation;
    }

    const result = runGA(gaMessages, data, options);
    gaRounds++;

    if (result) {
      // Seed next round with best assignment
      if (result.bestAssignment) {
        gaSeedPopulation = [result.bestAssignment];
      }

      const score = { deadlinesMet: result.deadlinesMet, totalLateness: result.totalLateness || 0, makespan: result.makespan };
      if (isBetterScore(score, gaBest)) {
        const elapsed = ((Date.now() - gaStart) / 1000).toFixed(1);
        gaImprovements.push({ time: elapsed, ...score });
        gaBest = score;
        console.log(`  ${elapsed}s: ${score.deadlinesMet}/3, ${score.totalLateness}d late, ${score.makespan}d makespan`);
      }
    }
  }
  const gaElapsed = ((Date.now() - gaStart) / 1000).toFixed(1);
  console.log(`Completed: ${gaRounds} rounds in ${gaElapsed}s`);
  console.log(`Best: ${gaBest.deadlinesMet}/3, ${gaBest.totalLateness}d late, ${gaBest.makespan}d makespan\n`);

  // --- Summary ---
  console.log('=== SUMMARY ===');
  console.log(`| Algorithm | Rounds | Best Deadlines | Best Lateness | Best Makespan |`);
  console.log(`|-----------|--------|----------------|---------------|---------------|`);
  console.log(`| SA        | ${saRounds}      | ${saBest.deadlinesMet}/3            | ${saBest.totalLateness}d             | ${saBest.makespan}d             |`);
  console.log(`| GA        | ${gaRounds}      | ${gaBest.deadlinesMet}/3            | ${gaBest.totalLateness}d             | ${gaBest.makespan}d             |`);

  console.log('\nImprovement timeline:');
  console.log('SA:', saImprovements.map(i => `${i.time}s→${i.makespan}d`).join(', ') || 'none');
  console.log('GA:', gaImprovements.map(i => `${i.time}s→${i.makespan}d`).join(', ') || 'none');

  // Time to best
  const saTimeToBest = saImprovements.length > 0 ? saImprovements[saImprovements.length - 1].time : 'N/A';
  const gaTimeToBest = gaImprovements.length > 0 ? gaImprovements[gaImprovements.length - 1].time : 'N/A';
  console.log(`\nTime to best: SA=${saTimeToBest}s, GA=${gaTimeToBest}s`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
