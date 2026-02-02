#!/usr/bin/env node

/**
 * Test SA improvements from JOB_SCHEDULING.md:
 * 1. Early termination: Stop if no improvement for N iterations
 * 2. Better initial solution: Use greedy result as SA starting point
 * 3. Parallel SA: Run multiple instances (simulated sequentially for testing)
 */

import { Scheduler } from '../js/scheduler.js';
import { DependencyGraph } from '../js/dependency-graph.js';
import {
  calculateEffort,
  addWorkingDays,
  isResolved
} from '../js/scheduler-core.js';
import { readFileSync } from 'fs';

const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
const milestoneBugIds = MILESTONES.map(m => m.bugId);

// SA parameters
const SA_INITIAL_TEMP = 1000;
const SA_COOLING_RATE = 0.99995;

function prepareData() {
  const bugs = snapshot.bugs;
  const bugMap = new Map();
  for (const bug of bugs) {
    bugMap.set(String(bug.id), bug);
  }

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
  for (const bug of bugs) {
    dependencyMap.set(String(bug.id), bug.dependsOn.map(d => String(d)));
  }

  return { filteredBugs, graph, dependencyMap };
}

// --- Helper functions (same as perf-test) ---
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
  const deadlineDetails = [];

  for (const endDays of Object.values(taskEndTimes)) {
    if (endDays > makespan) makespan = endDays;
  }

  for (const milestone of MILESTONES) {
    const milestoneBugId = String(milestone.bugId);
    const milestoneEndDays = getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap);
    if (milestoneEndDays > 0) {
      const endDate = addWorkingDays(today, milestoneEndDays);
      if (endDate <= milestone.freezeDate) {
        deadlinesMet++;
        deadlineDetails.push({ name: milestone.name, met: true, endDate, freezeDate: milestone.freezeDate });
      } else {
        deadlineDetails.push({ name: milestone.name, met: false, endDate, freezeDate: milestone.freezeDate });
      }
    }
  }
  return { deadlinesMet, makespan, deadlineDetails };
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
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) {
        taskOrder.push(i);
      }
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
        if (depIdx !== -1 && !processed.has(depIdx)) {
          canProcess = false;
          break;
        }
        earliestStart = Math.max(earliestStart, taskEndTimes[String(depId)] || 0);
      }
      if (!canProcess) continue;

      const engineerIdx = assignment[i];
      const engineer = engineers[engineerIdx];
      if (!engineer) continue;

      const effort = calculateEffort(task, engineer);
      let startTime, endTime;
      if (effort.isMeta) {
        startTime = earliestStart;
        endTime = earliestStart;
      } else {
        startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
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

// --- Generate greedy-based initial assignment ---
function getGreedyAssignment(tasks, engineers, dependencyMap) {
  // Find which engineer greedy would assign each task to
  const assignment = [];
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const processed = new Set();

  const bugToMilestone = assignBugsToMilestones(tasks, dependencyMap);
  const sortedMilestones = [...MILESTONES].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const taskOrder = [];
  for (const milestone of sortedMilestones) {
    for (let i = 0; i < tasks.length; i++) {
      const taskMilestone = bugToMilestone.get(String(tasks[i].id));
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) {
        taskOrder.push(i);
      }
    }
  }
  for (let i = 0; i < tasks.length; i++) {
    if (!taskOrder.includes(i)) taskOrder.push(i);
  }

  // Initialize assignment array
  for (let i = 0; i < tasks.length; i++) {
    assignment[i] = 0;
  }

  let remaining = tasks.length;
  while (remaining > 0) {
    for (const i of taskOrder) {
      if (processed.has(i)) continue;
      const task = tasks[i];
      const taskId = String(task.id);
      const deps = dependencyMap.get(taskId) || [];

      let canProcess = true;
      let earliestStart = 0;
      for (const depId of deps) {
        const depIdx = tasks.findIndex(t => String(t.id) === String(depId));
        if (depIdx !== -1 && !processed.has(depIdx)) {
          canProcess = false;
          break;
        }
        earliestStart = Math.max(earliestStart, taskEndTimes[String(depId)] || 0);
      }
      if (!canProcess) continue;

      // Find best engineer (earliest completion)
      let bestEngineer = 0;
      let bestEndTime = Infinity;
      for (let e = 0; e < engineers.length; e++) {
        const effort = calculateEffort(task, engineers[e]);
        const startTime = Math.max(engineerAvailable[e], earliestStart);
        const endTime = effort.isMeta ? earliestStart : startTime + effort.days;
        if (endTime < bestEndTime) {
          bestEndTime = endTime;
          bestEngineer = e;
        }
      }

      assignment[i] = bestEngineer;
      const effort = calculateEffort(task, engineers[bestEngineer]);
      if (!effort.isMeta) {
        engineerAvailable[bestEngineer] = bestEndTime;
      }
      taskEndTimes[taskId] = bestEndTime;
      processed.add(i);
      remaining--;
    }
  }

  return assignment;
}

// --- SA with options ---
function runSA(tasks, dependencyMap, options = {}) {
  const {
    iterations = 100000,
    earlyTermination = 0,  // Stop if no improvement for this many iterations (0 = disabled)
    useGreedyInit = false,
    verbose = false
  } = options;

  const engineers = engineersData.engineers;
  const n = tasks.length;
  const numEngineers = engineers.length;

  // Initial assignment
  let currentAssignment;
  if (useGreedyInit) {
    currentAssignment = getGreedyAssignment(tasks, engineers, dependencyMap);
  } else {
    currentAssignment = tasks.map(() => Math.floor(Math.random() * numEngineers));
  }

  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap);
  let currentScore = evaluateSchedule(currentEndTimes, tasks, dependencyMap);

  let bestScore = { ...currentScore };
  let bestAssignment = [...currentAssignment];

  let temperature = SA_INITIAL_TEMP;
  let improvements = 0;
  let iterationsSinceImprovement = 0;
  let actualIterations = 0;

  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    actualIterations = i + 1;

    const neighbor = [...currentAssignment];
    const taskIdx = Math.floor(Math.random() * n);
    neighbor[taskIdx] = Math.floor(Math.random() * numEngineers);

    const neighborEndTimes = computeEndTimes(neighbor, tasks, engineers, dependencyMap);
    if (!neighborEndTimes) continue;

    const neighborScore = evaluateSchedule(neighborEndTimes, tasks, dependencyMap);

    const currentValue = currentScore.deadlinesMet * 10000 - currentScore.makespan;
    const neighborValue = neighborScore.deadlinesMet * 10000 - neighborScore.makespan;
    const delta = neighborValue - currentValue;

    if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
      currentAssignment = neighbor;
      currentEndTimes = neighborEndTimes;
      currentScore = neighborScore;

      if (isBetter(currentScore, bestScore)) {
        bestScore = { ...currentScore };
        bestAssignment = [...currentAssignment];
        improvements++;
        iterationsSinceImprovement = 0;
      } else {
        iterationsSinceImprovement++;
      }
    } else {
      iterationsSinceImprovement++;
    }

    temperature *= SA_COOLING_RATE;

    // Early termination check
    if (earlyTermination > 0 && iterationsSinceImprovement >= earlyTermination) {
      if (verbose) {
        console.log(`  Early termination at iteration ${i} (no improvement for ${earlyTermination} iterations)`);
      }
      break;
    }
  }

  const endTime = performance.now();

  return {
    score: bestScore,
    assignment: bestAssignment,
    runtime: endTime - startTime,
    improvements,
    actualIterations
  };
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function printResult(label, result) {
  console.log(`\n${label}:`);
  console.log(`  Runtime: ${(result.runtime / 1000).toFixed(2)}s`);
  console.log(`  Iterations: ${result.actualIterations.toLocaleString()}`);
  console.log(`  Improvements: ${result.improvements}`);
  console.log(`  Deadlines: ${result.score.deadlinesMet}/${MILESTONES.length}`);
  console.log(`  Makespan: ${result.score.makespan.toFixed(0)} days`);
  for (const d of result.score.deadlineDetails) {
    const status = d.met ? '✓' : '✗';
    console.log(`    ${d.name}: ${formatDate(d.endDate)} (freeze: ${formatDate(d.freezeDate)}) ${status}`);
  }
}

async function main() {
  console.log('=== SA Improvement Tests ===\n');

  const { filteredBugs, dependencyMap } = prepareData();
  const tasks = filteredBugs.filter(b => !isResolved(b));

  console.log(`Tasks: ${tasks.length}, Engineers: ${engineersData.engineers.length}`);

  // Test 1: Baseline (random init, no early termination)
  console.log('\n--- Test 1: Baseline (100k iterations, random init) ---');
  const baseline = runSA(tasks, dependencyMap, {
    iterations: 100000,
    useGreedyInit: false,
    earlyTermination: 0
  });
  printResult('Baseline', baseline);

  // Test 2: Greedy initialization
  console.log('\n--- Test 2: Greedy initialization (100k iterations) ---');
  const greedyInit = runSA(tasks, dependencyMap, {
    iterations: 100000,
    useGreedyInit: true,
    earlyTermination: 0
  });
  printResult('Greedy Init', greedyInit);

  // Test 3: Early termination (10k iterations without improvement)
  console.log('\n--- Test 3: Early termination (stop after 10k stale iterations) ---');
  const earlyTerm = runSA(tasks, dependencyMap, {
    iterations: 100000,
    useGreedyInit: false,
    earlyTermination: 10000,
    verbose: true
  });
  printResult('Early Termination', earlyTerm);

  // Test 4: Greedy init + early termination
  console.log('\n--- Test 4: Greedy init + early termination ---');
  const combined = runSA(tasks, dependencyMap, {
    iterations: 100000,
    useGreedyInit: true,
    earlyTermination: 10000,
    verbose: true
  });
  printResult('Combined', combined);

  // Test 5: Multiple runs (simulated parallelism) with random init
  console.log('\n--- Test 5: Multiple runs (5x 20k iterations, random init) ---');
  let bestMulti = null;
  let totalMultiTime = 0;
  for (let run = 0; run < 5; run++) {
    const result = runSA(tasks, dependencyMap, {
      iterations: 20000,
      useGreedyInit: false,
      earlyTermination: 0
    });
    totalMultiTime += result.runtime;
    if (!bestMulti || isBetter(result.score, bestMulti.score)) {
      bestMulti = result;
    }
  }
  bestMulti.runtime = totalMultiTime;
  bestMulti.actualIterations = 100000; // Total across all runs
  printResult('Multi-run best', bestMulti);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`
| Method                    | Runtime | Deadlines | Makespan |
|---------------------------|---------|-----------|----------|
| Baseline (100k, random)   | ${(baseline.runtime/1000).toFixed(2)}s   | ${baseline.score.deadlinesMet}/3       | ${baseline.score.makespan.toFixed(0)} days  |
| Greedy Init (100k)        | ${(greedyInit.runtime/1000).toFixed(2)}s   | ${greedyInit.score.deadlinesMet}/3       | ${greedyInit.score.makespan.toFixed(0)} days  |
| Early Term (10k stale)    | ${(earlyTerm.runtime/1000).toFixed(2)}s   | ${earlyTerm.score.deadlinesMet}/3       | ${earlyTerm.score.makespan.toFixed(0)} days  |
| Greedy + Early Term       | ${(combined.runtime/1000).toFixed(2)}s   | ${combined.score.deadlinesMet}/3       | ${combined.score.makespan.toFixed(0)} days  |
| Multi-run (5x20k)         | ${(bestMulti.runtime/1000).toFixed(2)}s   | ${bestMulti.score.deadlinesMet}/3       | ${bestMulti.score.makespan.toFixed(0)} days  |
`);

  // Recommendations
  console.log('Observations:');
  if (greedyInit.score.deadlinesMet >= baseline.score.deadlinesMet) {
    console.log('- Greedy initialization provides a good starting point');
  }
  if (earlyTerm.runtime < baseline.runtime * 0.5 &&
      earlyTerm.score.deadlinesMet >= baseline.score.deadlinesMet) {
    console.log('- Early termination significantly reduces runtime with similar quality');
  }
  if (combined.runtime < baseline.runtime &&
      combined.score.deadlinesMet >= baseline.score.deadlinesMet) {
    console.log('- Combined approach (greedy init + early term) is recommended');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
