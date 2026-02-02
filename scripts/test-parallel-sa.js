#!/usr/bin/env node

/**
 * Test parallel SA properly - measure wall-clock time for parallel execution
 * and compare reliability vs single long run.
 */

import { Scheduler } from '../js/scheduler.js';
import { DependencyGraph } from '../js/dependency-graph.js';
import {
  calculateEffort,
  addWorkingDays,
  isResolved
} from '../js/scheduler-core.js';
import { readFileSync } from 'fs';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';

const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
const milestoneBugIds = MILESTONES.map(m => m.bugId);
const SA_INITIAL_TEMP = 1000;
const SA_COOLING_RATE = 0.99995;

// --- All the helper functions ---
function prepareData() {
  const bugs = snapshot.bugs;
  const bugMap = new Map();
  for (const bug of bugs) bugMap.set(String(bug.id), bug);

  const graph = new DependencyGraph();
  graph.buildFromBugs(bugMap);
  const { sorted } = graph.topologicalSort();
  const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

  const filteredBugs = sortedBugs
    .filter(bug => milestoneBugIds.includes(bug.id) || !RESOLVED_STATUSES.includes(bug.status))
    .filter(bug => milestoneBugIds.includes(bug.id) || bug.component === 'Client')
    .filter(bug => {
      if (milestoneBugIds.includes(bug.id)) return true;
      const sev = bug.severity || 'N/A';
      return sev === 'S1' || sev === 'S2';
    });

  const dependencyMap = new Map();
  for (const bug of bugs) dependencyMap.set(String(bug.id), bug.dependsOn.map(d => String(d)));

  return { filteredBugs, dependencyMap };
}

function assignBugsToMilestones(tasks, dependencyMap) {
  const bugToMilestone = new Map();
  const sortedMilestones = [...MILESTONES].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  for (const task of tasks) {
    const bugId = String(task.id);
    for (const milestone of sortedMilestones) {
      const milestoneId = String(milestone.bugId);
      if (bugId === milestoneId || isDependencyOf(bugId, milestoneId, dependencyMap)) {
        bugToMilestone.set(bugId, milestone);
        break;
      }
    }
  }
  return bugToMilestone;
}

function isDependencyOf(bugId, targetId, dependencyMap) {
  const visited = new Set();
  const queue = [targetId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const deps = dependencyMap.get(currentId) || [];
    for (const depId of deps) {
      if (String(depId) === bugId) return true;
      if (!visited.has(String(depId))) queue.push(String(depId));
    }
  }
  return false;
}

function getAllDependencies(bugId, dependencyMap) {
  const visited = new Set();
  const queue = [String(bugId)];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const deps = dependencyMap.get(id) || [];
    for (const depId of deps) {
      if (!visited.has(String(depId))) queue.push(String(depId));
    }
  }
  visited.delete(String(bugId));
  return visited;
}

function getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap) {
  const deps = getAllDependencies(milestoneBugId, dependencyMap);
  let maxEndDays = taskEndTimes[String(milestoneBugId)] || 0;
  for (const depId of deps) {
    const depEndDays = taskEndTimes[String(depId)];
    if (depEndDays !== undefined && depEndDays > maxEndDays) maxEndDays = depEndDays;
  }
  return maxEndDays;
}

function evaluateSchedule(taskEndTimes, tasks, dependencyMap) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let deadlinesMet = 0;
  let makespan = 0;

  for (const endDays of Object.values(taskEndTimes)) {
    if (endDays > makespan) makespan = endDays;
  }

  for (const milestone of MILESTONES) {
    const milestoneBugId = String(milestone.bugId);
    const milestoneEndDays = getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap);
    if (milestoneEndDays > 0) {
      const endDate = addWorkingDays(today, milestoneEndDays);
      if (endDate <= milestone.freezeDate) deadlinesMet++;
    }
  }
  return { deadlinesMet, makespan };
}

function isBetter(newScore, oldScore) {
  if (newScore.deadlinesMet > oldScore.deadlinesMet) return true;
  if (newScore.deadlinesMet < oldScore.deadlinesMet) return false;
  return newScore.makespan < oldScore.makespan;
}

function computeEndTimes(assignment, tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const processed = new Set();
  let remaining = n;
  let maxIterations = n * n;

  const bugToMilestone = assignBugsToMilestones(tasks, dependencyMap);
  const sortedMilestones = [...MILESTONES].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const taskOrder = [];
  for (const milestone of sortedMilestones) {
    for (let i = 0; i < n; i++) {
      const taskMilestone = bugToMilestone.get(String(tasks[i].id));
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) taskOrder.push(i);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!taskOrder.includes(i)) taskOrder.push(i);
  }

  while (remaining > 0 && maxIterations-- > 0) {
    let madeProgress = false;
    for (const i of taskOrder) {
      if (processed.has(i)) continue;
      const task = tasks[i];
      const taskId = String(task.id);
      const deps = dependencyMap.get(taskId) || [];

      let canProcess = true;
      let earliestStart = 0;
      for (const depId of deps) {
        const depIdx = tasks.findIndex(t => String(t.id) === String(depId));
        if (depIdx !== -1 && !processed.has(depIdx)) { canProcess = false; break; }
        earliestStart = Math.max(earliestStart, taskEndTimes[String(depId)] || 0);
      }
      if (!canProcess) continue;

      const engineerIdx = assignment[i];
      const engineer = engineers[engineerIdx];
      if (!engineer) continue;

      const effort = calculateEffort(task, engineer);
      let endTime;
      if (effort.isMeta) {
        endTime = earliestStart;
      } else {
        const startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
        endTime = startTime + effort.days;
        engineerAvailable[engineerIdx] = endTime;
      }
      taskEndTimes[taskId] = endTime;
      processed.add(i);
      remaining--;
      madeProgress = true;
    }
    if (!madeProgress && remaining > 0) return null;
  }
  return taskEndTimes;
}

function runSA(tasks, dependencyMap, iterations) {
  const engineers = engineersData.engineers;
  const n = tasks.length;
  const numEngineers = engineers.length;

  let currentAssignment = tasks.map(() => Math.floor(Math.random() * numEngineers));
  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap);
  let currentScore = evaluateSchedule(currentEndTimes, tasks, dependencyMap);

  let bestScore = { ...currentScore };
  let temperature = SA_INITIAL_TEMP;

  for (let i = 0; i < iterations; i++) {
    const neighbor = [...currentAssignment];
    neighbor[Math.floor(Math.random() * n)] = Math.floor(Math.random() * numEngineers);

    const neighborEndTimes = computeEndTimes(neighbor, tasks, engineers, dependencyMap);
    if (!neighborEndTimes) continue;

    const neighborScore = evaluateSchedule(neighborEndTimes, tasks, dependencyMap);
    const delta = (neighborScore.deadlinesMet * 10000 - neighborScore.makespan) -
                  (currentScore.deadlinesMet * 10000 - currentScore.makespan);

    if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
      currentAssignment = neighbor;
      currentEndTimes = neighborEndTimes;
      currentScore = neighborScore;
      if (isBetter(currentScore, bestScore)) bestScore = { ...currentScore };
    }
    temperature *= SA_COOLING_RATE;
  }

  return bestScore;
}

async function main() {
  console.log('=== Parallel SA Analysis ===\n');
  console.log('Reliability = % of runs achieving 3/3 deadlines met\n');

  const { filteredBugs, dependencyMap } = prepareData();
  const tasks = filteredBugs.filter(b => !isResolved(b));
  console.log(`Tasks: ${tasks.length}, Engineers: ${engineersData.engineers.length}\n`);

  const configs = [
    { name: '1×100k', runs: 1, iterations: 100000 },
    { name: '2×50k', runs: 2, iterations: 50000 },
    { name: '5×20k', runs: 5, iterations: 20000 },
    { name: '10×10k', runs: 10, iterations: 10000 },
    { name: '20×5k', runs: 20, iterations: 5000 },
  ];

  console.log('Testing configurations (10 trials each):\n');

  for (const config of configs) {
    const trials = [];

    for (let trial = 0; trial < 10; trial++) {
      // Simulate parallel runs - wall clock = time of single run
      const startTime = performance.now();

      let bestScore = { deadlinesMet: 0, makespan: Infinity };
      for (let r = 0; r < config.runs; r++) {
        const score = runSA(tasks, dependencyMap, config.iterations);
        if (isBetter(score, bestScore)) bestScore = score;
      }

      // Wall-clock for parallel would be time of ONE run, not sum
      // But we're running sequentially, so divide by runs to simulate parallel
      const seqTime = performance.now() - startTime;
      const parallelTime = seqTime / config.runs;

      trials.push({
        deadlines: bestScore.deadlinesMet,
        makespan: bestScore.makespan,
        seqTime,
        parallelTime
      });
    }

    const success = trials.filter(t => t.deadlines === 3).length;
    const avgSeqTime = trials.reduce((a, t) => a + t.seqTime, 0) / trials.length;
    const avgParallelTime = trials.reduce((a, t) => a + t.parallelTime, 0) / trials.length;
    const avgMakespan = trials.reduce((a, t) => a + t.makespan, 0) / trials.length;

    console.log(`${config.name}:`);
    console.log(`  Reliability: ${success * 10}% (${success}/10 achieved 3/3 deadlines)`);
    console.log(`  Avg makespan: ${avgMakespan.toFixed(0)} days`);
    console.log(`  Wall-clock (sequential): ${(avgSeqTime/1000).toFixed(2)}s`);
    console.log(`  Wall-clock (parallel):   ${(avgParallelTime/1000).toFixed(2)}s`);
    console.log();
  }

  console.log('=== Summary ===\n');
  console.log('| Config  | Reliability | Makespan | Sequential | Parallel |');
  console.log('|---------|-------------|----------|------------|----------|');

  // Re-run for summary table
  for (const config of configs) {
    const trials = [];
    for (let trial = 0; trial < 10; trial++) {
      const startTime = performance.now();
      let bestScore = { deadlinesMet: 0, makespan: Infinity };
      for (let r = 0; r < config.runs; r++) {
        const score = runSA(tasks, dependencyMap, config.iterations);
        if (isBetter(score, bestScore)) bestScore = score;
      }
      const seqTime = performance.now() - startTime;
      trials.push({ deadlines: bestScore.deadlinesMet, makespan: bestScore.makespan, seqTime });
    }

    const success = trials.filter(t => t.deadlines === 3).length;
    const avgSeqTime = trials.reduce((a, t) => a + t.seqTime, 0) / trials.length;
    const avgParallelTime = avgSeqTime / config.runs;
    const avgMakespan = trials.reduce((a, t) => a + t.makespan, 0) / trials.length;

    console.log(`| ${config.name.padEnd(7)} | ${(success*10).toString().padStart(3)}%        | ${avgMakespan.toFixed(0).padStart(4)} days | ${(avgSeqTime/1000).toFixed(2).padStart(6)}s    | ${(avgParallelTime/1000).toFixed(2).padStart(6)}s  |`);
  }

  console.log('\nNote: "Parallel" assumes all runs execute simultaneously.');
  console.log('Total work is the same, but wall-clock is divided by number of parallel runs.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
