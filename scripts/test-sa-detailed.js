#!/usr/bin/env node

/**
 * Detailed SA testing to understand:
 * 1. Why greedy init + early term sometimes fails
 * 2. What early termination threshold works best
 * 3. Statistical reliability of different approaches
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
  { name: 'Foxfooding Alpha', bugId: 1980342, deadline: new Date('2026-03-02'), freezeDate: new Date('2026-02-23') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
const milestoneBugIds = MILESTONES.map(m => m.bugId);
const SA_INITIAL_TEMP = 1000;
const SA_COOLING_RATE = 0.99995;

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

// Copy helper functions from test-sa-improvements.js
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

function getGreedyAssignment(tasks, engineers, dependencyMap) {
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
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) taskOrder.push(i);
    }
  }
  for (let i = 0; i < tasks.length; i++) {
    if (!taskOrder.includes(i)) taskOrder.push(i);
  }

  for (let i = 0; i < tasks.length; i++) assignment[i] = 0;

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
        if (depIdx !== -1 && !processed.has(depIdx)) { canProcess = false; break; }
        earliestStart = Math.max(earliestStart, taskEndTimes[String(depId)] || 0);
      }
      if (!canProcess) continue;

      let bestEngineer = 0;
      let bestEndTime = Infinity;
      for (let e = 0; e < engineers.length; e++) {
        const effort = calculateEffort(task, engineers[e]);
        const startTime = Math.max(engineerAvailable[e], earliestStart);
        const endTime = effort.isMeta ? earliestStart : startTime + effort.days;
        if (endTime < bestEndTime) { bestEndTime = endTime; bestEngineer = e; }
      }

      assignment[i] = bestEngineer;
      const effort = calculateEffort(task, engineers[bestEngineer]);
      if (!effort.isMeta) engineerAvailable[bestEngineer] = bestEndTime;
      taskEndTimes[taskId] = bestEndTime;
      processed.add(i);
      remaining--;
    }
  }
  return assignment;
}

function runSA(tasks, dependencyMap, options = {}) {
  const { iterations = 100000, earlyTermination = 0, useGreedyInit = false } = options;

  const engineers = engineersData.engineers;
  const n = tasks.length;
  const numEngineers = engineers.length;

  let currentAssignment = useGreedyInit
    ? getGreedyAssignment(tasks, engineers, dependencyMap)
    : tasks.map(() => Math.floor(Math.random() * numEngineers));

  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap);
  let currentScore = evaluateSchedule(currentEndTimes, tasks, dependencyMap);

  let bestScore = { ...currentScore };
  let bestAssignment = [...currentAssignment];

  let temperature = SA_INITIAL_TEMP;
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
        iterationsSinceImprovement = 0;
      } else {
        iterationsSinceImprovement++;
      }
    } else {
      iterationsSinceImprovement++;
    }

    temperature *= SA_COOLING_RATE;

    if (earlyTermination > 0 && iterationsSinceImprovement >= earlyTermination) break;
  }

  return {
    score: bestScore,
    runtime: performance.now() - startTime,
    actualIterations
  };
}

async function main() {
  console.log('=== Detailed SA Analysis ===\n');

  const { filteredBugs, dependencyMap } = prepareData();
  const tasks = filteredBugs.filter(b => !isResolved(b));
  console.log(`Tasks: ${tasks.length}, Engineers: ${engineersData.engineers.length}\n`);

  // First, evaluate greedy solution
  const engineers = engineersData.engineers;
  const greedyAssignment = getGreedyAssignment(tasks, engineers, dependencyMap);
  const greedyEndTimes = computeEndTimes(greedyAssignment, tasks, engineers, dependencyMap);
  const greedyScore = evaluateSchedule(greedyEndTimes, tasks, dependencyMap);
  console.log(`Greedy baseline: ${greedyScore.deadlinesMet}/3 deadlines, ${greedyScore.makespan} days\n`);

  // Test 1: Statistical reliability (10 runs each)
  console.log('--- Statistical Test (10 runs each) ---\n');

  const configs = [
    { name: 'Random init, no early term', useGreedyInit: false, earlyTermination: 0 },
    { name: 'Random init, 5k early term', useGreedyInit: false, earlyTermination: 5000 },
    { name: 'Random init, 10k early term', useGreedyInit: false, earlyTermination: 10000 },
    { name: 'Random init, 20k early term', useGreedyInit: false, earlyTermination: 20000 },
    { name: 'Greedy init, no early term', useGreedyInit: true, earlyTermination: 0 },
    { name: 'Greedy init, 5k early term', useGreedyInit: true, earlyTermination: 5000 },
    { name: 'Greedy init, 10k early term', useGreedyInit: true, earlyTermination: 10000 },
  ];

  const results = [];

  for (const config of configs) {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const result = runSA(tasks, dependencyMap, {
        iterations: 100000,
        ...config
      });
      runs.push(result);
    }

    const deadlines = runs.map(r => r.score.deadlinesMet);
    const makespans = runs.map(r => r.score.makespan);
    const runtimes = runs.map(r => r.runtime);
    const iterations = runs.map(r => r.actualIterations);

    const avgDeadlines = deadlines.reduce((a, b) => a + b, 0) / runs.length;
    const avgMakespan = makespans.reduce((a, b) => a + b, 0) / runs.length;
    const avgRuntime = runtimes.reduce((a, b) => a + b, 0) / runs.length;
    const avgIterations = iterations.reduce((a, b) => a + b, 0) / runs.length;

    const all3 = deadlines.filter(d => d === 3).length;

    results.push({
      name: config.name,
      avgDeadlines,
      avgMakespan,
      avgRuntime,
      avgIterations,
      all3,
      minMakespan: Math.min(...makespans),
      maxMakespan: Math.max(...makespans)
    });

    console.log(`${config.name}:`);
    console.log(`  Deadlines: avg=${avgDeadlines.toFixed(1)}, all3=${all3}/10`);
    console.log(`  Makespan: avg=${avgMakespan.toFixed(0)}, range=[${Math.min(...makespans)}, ${Math.max(...makespans)}]`);
    console.log(`  Runtime: avg=${(avgRuntime/1000).toFixed(2)}s, iterations=${Math.round(avgIterations/1000)}k\n`);
  }

  // Summary table
  console.log('\n=== Summary Table ===\n');
  console.log('| Config                      | 3/3 Rate | Avg Makespan | Avg Runtime | Iterations |');
  console.log('|-----------------------------|----------|--------------|-------------|------------|');
  for (const r of results) {
    console.log(`| ${r.name.padEnd(27)} | ${(r.all3*10).toString().padStart(3)}%     | ${r.avgMakespan.toFixed(0).padStart(5)} days   | ${(r.avgRuntime/1000).toFixed(2).padStart(6)}s    | ${Math.round(r.avgIterations/1000).toString().padStart(5)}k     |`);
  }

  // Recommendations
  console.log('\n=== Recommendations ===\n');

  const bestReliability = results.reduce((best, r) => r.all3 > best.all3 ? r : best);
  const bestSpeed = results.filter(r => r.all3 >= 8).reduce((best, r) =>
    r.avgRuntime < best.avgRuntime ? r : best, results[0]);

  console.log(`Best reliability: "${bestReliability.name}" (${bestReliability.all3*10}% hit all 3 deadlines)`);
  console.log(`Best speed (>=80% reliable): "${bestSpeed.name}" (${(bestSpeed.avgRuntime/1000).toFixed(2)}s avg)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
