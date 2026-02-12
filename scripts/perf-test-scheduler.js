#!/usr/bin/env node

/**
 * Performance test for the scheduling algorithms.
 * Runs both greedy and simulated annealing on the snapshot data.
 *
 * Usage: node scripts/perf-test-scheduler.js
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

// SA parameters (same as worker)
const SA_ITERATIONS = 100000;
const SA_INITIAL_TEMP = 1000;
const SA_COOLING_RATE = 0.99995;

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

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

  // Apply filters (S1-S2, Client, unresolved)
  const filteredBugs = sortedBugs
    .filter(bug =>
      milestoneBugIds.includes(bug.id) ||
      !RESOLVED_STATUSES.includes(bug.status)
    )
    .filter(bug =>
      milestoneBugIds.includes(bug.id) ||
      bug.component === 'Client'
    )
    .filter(bug => {
      if (milestoneBugIds.includes(bug.id)) return true;
      const sev = bug.severity || 'N/A';
      return sev === 'S1' || sev === 'S2';
    });

  // Build dependency map from ALL bugs (not just filtered)
  const dependencyMap = new Map();
  for (const bug of bugs) {
    dependencyMap.set(String(bug.id), bug.dependsOn.map(d => String(d)));
  }

  return { filteredBugs, graph, dependencyMap, bugMap };
}

function runGreedyScheduler(filteredBugs, graph) {
  const engineers = engineersData.engineers;
  const scheduler = new Scheduler(engineers, MILESTONES);

  const startTime = performance.now();
  const schedule = scheduler.scheduleTasks(filteredBugs, graph);
  const endTime = performance.now();

  return {
    schedule,
    runtime: endTime - startTime,
    stats: scheduler.getStats()
  };
}

// Simulated annealing implementation (adapted from worker)
function assignBugsToMilestones(tasks, dependencyMap) {
  const bugToMilestone = new Map();
  const sortedMilestones = [...MILESTONES].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );

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
    if (depEndDays !== undefined && depEndDays > maxEndDays) {
      maxEndDays = depEndDays;
    }
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

function runSimulatedAnnealing(tasks, dependencyMap, iterations = SA_ITERATIONS) {
  const engineers = engineersData.engineers;
  const n = tasks.length;
  const numEngineers = engineers.length;

  // Initial random assignment
  let currentAssignment = tasks.map(() => Math.floor(Math.random() * numEngineers));
  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap);
  let currentScore = evaluateSchedule(currentEndTimes, tasks, dependencyMap);

  let bestScore = { ...currentScore };
  let bestAssignment = [...currentAssignment];

  let temperature = SA_INITIAL_TEMP;
  let improvements = 0;

  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
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
      }
    }

    temperature *= SA_COOLING_RATE;
  }

  const endTime = performance.now();

  return {
    score: bestScore,
    assignment: bestAssignment,
    runtime: endTime - startTime,
    improvements,
    iterations
  };
}

function calculateMilestoneCompletions(schedule, dependencyMap) {
  const completions = new Map();
  const taskEndDates = new Map();

  for (const task of schedule) {
    if (task.endDate) {
      taskEndDates.set(String(task.bug.id), task.endDate);
    }
  }

  for (const milestone of MILESTONES) {
    const bugId = String(milestone.bugId);
    const deps = getAllDependencies(bugId, dependencyMap);
    let latestEnd = taskEndDates.get(bugId) || null;

    for (const depId of deps) {
      const depEnd = taskEndDates.get(depId);
      if (depEnd && (!latestEnd || depEnd > latestEnd)) {
        latestEnd = depEnd;
      }
    }

    if (latestEnd) {
      completions.set(milestone.name, latestEnd);
    }
  }

  return completions;
}

async function main() {
  console.log('=== Scheduler Performance Test ===\n');
  console.log(`Snapshot: ${snapshot.stats.totalBugs} bugs total`);
  console.log(`Captured: ${snapshot.capturedAt}\n`);

  const { filteredBugs, graph, dependencyMap } = prepareData();
  const unresolvedTasks = filteredBugs.filter(b => !isResolved(b));

  console.log(`Filtered bugs (S1-S2, Client, unresolved): ${filteredBugs.length}`);
  console.log(`Tasks to schedule: ${unresolvedTasks.length}`);
  console.log(`Engineers: ${engineersData.engineers.length}\n`);

  // Run greedy scheduler
  console.log('--- Greedy Scheduler ---');
  const greedy = runGreedyScheduler(filteredBugs, graph);
  console.log(`Runtime: ${greedy.runtime.toFixed(2)}ms`);
  console.log(`Total days: ${greedy.stats.totalDays}`);
  console.log(`Earliest start: ${formatDate(greedy.stats.earliestStart)}`);
  console.log(`Latest end: ${formatDate(greedy.stats.latestEnd)}`);

  const greedyCompletions = calculateMilestoneCompletions(greedy.schedule, dependencyMap);
  console.log('\nMilestone completions (greedy):');
  for (const milestone of MILESTONES) {
    const completion = greedyCompletions.get(milestone.name);
    const freeze = milestone.freezeDate;
    const status = completion <= freeze ? '✓' : '✗';
    console.log(`  ${milestone.name}: ${completion ? formatDate(completion) : 'N/A'} (freeze: ${formatDate(freeze)}) ${status}`);
  }

  // Run simulated annealing
  console.log('\n--- Simulated Annealing ---');
  console.log(`Iterations: ${SA_ITERATIONS.toLocaleString()}`);

  const sa = runSimulatedAnnealing(unresolvedTasks, dependencyMap);
  console.log(`Runtime: ${(sa.runtime / 1000).toFixed(2)}s`);
  console.log(`Improvements found: ${sa.improvements}`);
  console.log(`Best score: ${sa.score.deadlinesMet}/${MILESTONES.length} deadlines met, ${sa.score.makespan.toFixed(0)} days makespan`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('\nMilestone completions (SA):');
  for (const detail of sa.score.deadlineDetails) {
    const status = detail.met ? '✓' : '✗';
    console.log(`  ${detail.name}: ${formatDate(detail.endDate)} (freeze: ${formatDate(detail.freezeDate)}) ${status}`);
  }

  // Compare
  console.log('\n--- Comparison ---');
  const greedyMakespan = Math.ceil((greedy.stats.latestEnd - today) / (1000 * 60 * 60 * 24));
  const saMakespan = sa.score.makespan;
  const makespanDiff = greedyMakespan - saMakespan;

  console.log(`Greedy makespan: ~${greedyMakespan} calendar days`);
  console.log(`SA makespan: ${saMakespan.toFixed(0)} working days`);

  if (makespanDiff > 0) {
    console.log(`SA improved makespan by ~${makespanDiff.toFixed(0)} days`);
  } else if (makespanDiff < 0) {
    console.log(`Greedy was better by ~${Math.abs(makespanDiff).toFixed(0)} days`);
  } else {
    console.log(`Both produced similar makespans`);
  }

  // Count deadlines met by greedy
  let greedyDeadlinesMet = 0;
  for (const milestone of MILESTONES) {
    const completion = greedyCompletions.get(milestone.name);
    if (completion && completion <= milestone.freezeDate) {
      greedyDeadlinesMet++;
    }
  }

  console.log(`\nDeadlines met: Greedy=${greedyDeadlinesMet}/${MILESTONES.length}, SA=${sa.score.deadlinesMet}/${MILESTONES.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
