/**
 * Genetic Algorithm Scheduler Web Worker
 * Alternative to Simulated Annealing for schedule optimization.
 * Prioritizes meeting deadlines over minimizing total time.
 */

import {
  calculateEffort,
  addWorkingDays,
  isResolved,
  normalizeAssigneeEmail,
  normalizeStartDate
} from './scheduler-core.js';

// Default milestones (overridden by passed milestones)
let activeMilestones = [
  { name: 'Foxfooding Alpha', bugId: 1980342, deadline: new Date('2026-03-02'), freezeDate: new Date('2026-02-23') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];

// GA Parameters (tuned for speed: 40×100 is 2.5x faster than 50×200 baseline)
const POPULATION_SIZE = 40;
const ELITE_COUNT = 4;           // Top 10% preserved unchanged
const TOURNAMENT_SIZE = 3;       // Tournament selection size
const CROSSOVER_RATE = 0.8;      // Probability of crossover
const MUTATION_RATE = 0.1;       // Probability of mutation per gene
const GENERATIONS_DEFAULT = 100;

// Memetic parameters (local search on elite individuals)
const LOCAL_SEARCH_SWAPS = 10;   // Random swaps to try per elite individual

// Scoring weights (same as SA)
const DEADLINE_WEIGHT = 5000;
const LATENESS_WEIGHT = 100;

// State
let bestScore = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
let bestAssignment = null;
let unavailabilityRangesByEngineer = null;
let optimizationToday = null;
let workerId = 0;

// Precomputed caches (reset at optimization start)
let cachedBugToMilestone = null;
let cachedTaskIdIndex = null;
let cachedMilestoneDeps = null;

function buildEngineerEmailIndex(engineers) {
  const map = new Map();
  for (let i = 0; i < engineers.length; i++) {
    const email = normalizeAssigneeEmail(engineers[i]?.email);
    if (email) {
      map.set(email, i);
    }
  }
  return map;
}

// Runtime parameters (can be overridden per call)
let mutationRate = MUTATION_RATE;
let localSearchSwaps = LOCAL_SEARCH_SWAPS;

self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'start') {
    const {
      bugs,
      engineers,
      graph,
      milestones,
      generations,
      populationSize,
      id,
      seedPopulation
    } = data;

    workerId = id || 0;
    mutationRate = data.mutationRate || MUTATION_RATE;
    localSearchSwaps = data.localSearchSwaps !== undefined ? data.localSearchSwaps : LOCAL_SEARCH_SWAPS;

    if (milestones && milestones.length > 0) {
      activeMilestones = milestones.map(m => ({
        name: m.name,
        bugId: m.bugId,
        deadline: new Date(m.deadline),
        freezeDate: new Date(m.freezeDate)
      }));
    }

    optimize(
      bugs,
      engineers,
      graph,
      generations || GENERATIONS_DEFAULT,
      populationSize || POPULATION_SIZE,
      seedPopulation
    );
  } else if (type === 'stop') {
    self.close();
  }
};

function optimize(bugs, engineers, graph, generations, populationSize, seedPopulation) {
  optimizationToday = new Date();
  optimizationToday.setHours(0, 0, 0, 0);
  unavailabilityRangesByEngineer = buildUnavailabilityRanges(engineers, optimizationToday);

  const tasks = bugs.filter(b => !isResolved(b));

  if (tasks.length === 0) {
    self.postMessage({ type: 'complete', schedule: null, improved: false, workerId });
    return;
  }

  const engineerEmailIndex = buildEngineerEmailIndex(engineers);
  for (const task of tasks) {
    const assigneeEmail = normalizeAssigneeEmail(task.assignee);
    if (assigneeEmail && assigneeEmail !== 'nobody@mozilla.org' && engineerEmailIndex.has(assigneeEmail)) {
      task.lockedEngineerIndex = engineerEmailIndex.get(assigneeEmail);
    } else {
      task.lockedEngineerIndex = null;
    }
  }

  const dependencyMap = new Map();
  for (const [bugId, deps] of Object.entries(graph)) {
    dependencyMap.set(String(bugId), deps.map(d => String(d)));
  }

  // Precompute static data structures (milestone assignments, task order, etc.)
  // These don't change between iterations, so computing once saves significant time
  precomputeCaches(tasks, dependencyMap);

  bestScore = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
  bestAssignment = null;

  geneticAlgorithm(tasks, engineers, dependencyMap, generations, populationSize, seedPopulation);
}

function geneticAlgorithm(tasks, engineers, dependencyMap, generations, populationSize, seedPopulation) {
  const n = tasks.length;
  const nonExternalIndices = getNonExternalIndices(engineers);

  // Find unlocked task indices
  const unlockedTasks = [];
  for (let i = 0; i < n; i++) {
    if (tasks[i].lockedEngineerIndex === null || tasks[i].lockedEngineerIndex === undefined) {
      unlockedTasks.push(i);
    }
  }

  if (unlockedTasks.length === 0) {
    // All tasks are locked, just evaluate the fixed assignment
    const assignment = tasks.map(t => t.lockedEngineerIndex);
    const endTimes = computeEndTimes(assignment, tasks, engineers, dependencyMap);
    const score = evaluateSchedule(endTimes, tasks, dependencyMap);
    bestScore = score;
    bestAssignment = assignment;
    finishOptimization(tasks, engineers, dependencyMap, 0);
    return;
  }

  // Initialize population
  let population = [];

  // Add seed individuals if provided
  if (Array.isArray(seedPopulation)) {
    for (const seed of seedPopulation) {
      if (Array.isArray(seed) && seed.length === n) {
        population.push([...seed]);
      }
    }
  }

  // Fill rest with random individuals
  while (population.length < populationSize) {
    population.push(generateRandomAssignment(tasks, engineers, nonExternalIndices));
  }

  // Evaluate initial population
  let fitnessScores = population.map(ind => {
    const endTimes = computeEndTimes(ind, tasks, engineers, dependencyMap);
    return endTimes ? evaluateSchedule(endTimes, tasks, dependencyMap) : null;
  });

  // Find initial best
  for (let i = 0; i < population.length; i++) {
    if (fitnessScores[i] && isBetter(fitnessScores[i], bestScore)) {
      bestScore = { ...fitnessScores[i] };
      bestAssignment = [...population[i]];
    }
  }

  // Report initial best
  reportImprovement({ deadlinesMet: -1, makespan: Infinity }, bestScore, 0);

  let bestFoundAtGeneration = 0;
  const progressInterval = Math.max(10, Math.floor(generations / 10));

  for (let gen = 0; gen < generations; gen++) {
    // Create new population
    const newPopulation = [];

    // Elitism: keep top individuals, apply local search only to the best one
    const ranked = population
      .map((ind, i) => ({ ind, score: fitnessScores[i] }))
      .filter(x => x.score !== null)
      .sort((a, b) => compareFitness(b.score, a.score));

    for (let i = 0; i < Math.min(ELITE_COUNT, ranked.length); i++) {
      if (i === 0 && localSearchSwaps > 0) {
        // Apply local search only to the best individual (preserve diversity)
        const { individual: improved } = localSearch(
          ranked[i].ind, tasks, engineers, dependencyMap,
          nonExternalIndices, unlockedTasks, ranked[i].score
        );
        newPopulation.push(improved);
      } else {
        newPopulation.push([...ranked[i].ind]);
      }
    }

    // Generate rest through selection, crossover, mutation
    while (newPopulation.length < populationSize) {
      // Tournament selection
      const parent1 = tournamentSelect(population, fitnessScores, TOURNAMENT_SIZE);
      const parent2 = tournamentSelect(population, fitnessScores, TOURNAMENT_SIZE);

      let child1, child2;

      // Crossover
      if (Math.random() < CROSSOVER_RATE) {
        [child1, child2] = crossover(parent1, parent2, tasks, unlockedTasks);
      } else {
        child1 = [...parent1];
        child2 = [...parent2];
      }

      // Mutation
      mutate(child1, tasks, nonExternalIndices, unlockedTasks);
      mutate(child2, tasks, nonExternalIndices, unlockedTasks);

      newPopulation.push(child1);
      if (newPopulation.length < populationSize) {
        newPopulation.push(child2);
      }
    }

    population = newPopulation;

    // Evaluate new population
    fitnessScores = population.map(ind => {
      const endTimes = computeEndTimes(ind, tasks, engineers, dependencyMap);
      return endTimes ? evaluateSchedule(endTimes, tasks, dependencyMap) : null;
    });

    // Update best
    for (let i = 0; i < population.length; i++) {
      if (fitnessScores[i] && isBetter(fitnessScores[i], bestScore)) {
        const oldScore = { ...bestScore };
        bestScore = { ...fitnessScores[i] };
        bestAssignment = [...population[i]];
        bestFoundAtGeneration = gen;
        reportImprovement(oldScore, bestScore, gen);
      }
    }

    // Progress report
    if (gen > 0 && gen % progressInterval === 0) {
      const avgMakespan = fitnessScores
        .filter(s => s !== null)
        .reduce((sum, s) => sum + s.makespan, 0) / fitnessScores.filter(s => s !== null).length;

      self.postMessage({
        type: 'progress',
        workerId,
        generation: gen,
        populationSize: population.length,
        bestDeadlines: bestScore.deadlinesMet,
        bestMakespan: bestScore.makespan,
        avgMakespan: Math.round(avgMakespan)
      });
    }
  }

  finishOptimization(tasks, engineers, dependencyMap, generations, bestFoundAtGeneration);
}

function generateRandomAssignment(tasks, engineers, nonExternalIndices) {
  const assignment = [];
  const pool = nonExternalIndices.length > 0 ? nonExternalIndices : [...Array(engineers.length).keys()];

  for (const task of tasks) {
    if (task.lockedEngineerIndex !== null && task.lockedEngineerIndex !== undefined) {
      assignment.push(task.lockedEngineerIndex);
    } else {
      assignment.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }

  return assignment;
}

function tournamentSelect(population, fitnessScores, tournamentSize) {
  let best = null;
  let bestScore = null;

  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * population.length);
    const score = fitnessScores[idx];
    if (score !== null && (bestScore === null || isBetter(score, bestScore))) {
      best = population[idx];
      bestScore = score;
    }
  }

  return best || population[Math.floor(Math.random() * population.length)];
}

function crossover(parent1, parent2, tasks, unlockedTasks) {
  // Two-point crossover on unlocked tasks only
  const child1 = [...parent1];
  const child2 = [...parent2];

  if (unlockedTasks.length < 2) {
    return [child1, child2];
  }

  // Pick two crossover points
  const pt1 = Math.floor(Math.random() * unlockedTasks.length);
  const pt2 = Math.floor(Math.random() * unlockedTasks.length);
  const start = Math.min(pt1, pt2);
  const end = Math.max(pt1, pt2);

  // Swap genes between points (only for unlocked tasks)
  for (let i = start; i <= end; i++) {
    const taskIdx = unlockedTasks[i];
    const temp = child1[taskIdx];
    child1[taskIdx] = child2[taskIdx];
    child2[taskIdx] = temp;
  }

  return [child1, child2];
}

function mutate(individual, tasks, nonExternalIndices, unlockedTasks) {
  const pool = nonExternalIndices.length > 0 ? nonExternalIndices : [...Array(tasks.length).keys()];

  for (const taskIdx of unlockedTasks) {
    if (Math.random() < mutationRate) {
      individual[taskIdx] = pool[Math.floor(Math.random() * pool.length)];
    }
  }
}

/**
 * Memetic local search: try random swaps on an individual and keep improvements.
 * Returns the improved individual and its score.
 */
function localSearch(individual, tasks, engineers, dependencyMap, nonExternalIndices, unlockedTasks, currentScore) {
  if (localSearchSwaps <= 0 || unlockedTasks.length === 0) {
    return { individual, score: currentScore };
  }

  const pool = nonExternalIndices.length > 0 ? nonExternalIndices : [...Array(engineers.length).keys()];
  let best = [...individual];
  let bestScore = currentScore;

  for (let i = 0; i < localSearchSwaps; i++) {
    // Pick a random unlocked task and try a different engineer
    const taskIdx = unlockedTasks[Math.floor(Math.random() * unlockedTasks.length)];
    const oldEngineer = best[taskIdx];
    const newEngineer = pool[Math.floor(Math.random() * pool.length)];

    if (newEngineer === oldEngineer) continue;

    // Try the swap
    const candidate = [...best];
    candidate[taskIdx] = newEngineer;

    const endTimes = computeEndTimes(candidate, tasks, engineers, dependencyMap);
    if (!endTimes) continue;

    const score = evaluateSchedule(endTimes, tasks, dependencyMap);
    if (isBetter(score, bestScore)) {
      best = candidate;
      bestScore = score;
    }
  }

  return { individual: best, score: bestScore };
}

function compareFitness(a, b) {
  // Returns positive if a is better than b
  if (a.deadlinesMet !== b.deadlinesMet) return a.deadlinesMet - b.deadlinesMet;
  if (a.totalLateness !== b.totalLateness) return b.totalLateness - a.totalLateness;
  return b.makespan - a.makespan;
}

function isBetter(newScore, oldScore) {
  if (newScore.deadlinesMet > oldScore.deadlinesMet) return true;
  if (newScore.deadlinesMet < oldScore.deadlinesMet) return false;
  if (newScore.totalLateness < oldScore.totalLateness) return true;
  if (newScore.totalLateness > oldScore.totalLateness) return false;
  return newScore.makespan < oldScore.makespan;
}

function getNonExternalIndices(engineers) {
  const indices = [];
  for (let i = 0; i < engineers.length; i++) {
    if (!engineers[i]?.isExternal) {
      indices.push(i);
    }
  }
  return indices;
}

// === Schedule evaluation (same as SA worker) ===

/**
 * Precompute all static data structures at optimization start.
 * These don't change between iterations since they only depend on the dependency graph.
 */
function precomputeCaches(tasks, dependencyMap) {
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );

  // Precompute transitive dependencies for each milestone
  cachedMilestoneDeps = new Map();
  for (const m of sortedMilestones) {
    cachedMilestoneDeps.set(String(m.bugId), getAllDependencies(m.bugId, dependencyMap));
  }

  // Assign bugs to milestones using precomputed deps (O(1) lookups)
  cachedBugToMilestone = new Map();
  for (const task of tasks) {
    const bugId = String(task.id);
    for (const milestone of sortedMilestones) {
      const milestoneId = String(milestone.bugId);
      if (bugId === milestoneId || cachedMilestoneDeps.get(milestoneId).has(bugId)) {
        cachedBugToMilestone.set(bugId, milestone);
        break;
      }
    }
  }

  // Precompute task ID to index mapping for O(1) lookups
  cachedTaskIdIndex = new Map();
  for (let i = 0; i < tasks.length; i++) {
    cachedTaskIdIndex.set(String(tasks[i].id), i);
  }
}

function assignBugsToMilestones(tasks, dependencyMap) {
  // Use cached mapping if available
  if (cachedBugToMilestone) {
    return cachedBugToMilestone;
  }

  const bugToMilestone = new Map();
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
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
      if (!visited.has(String(depId))) {
        queue.push(String(depId));
      }
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
      if (!visited.has(String(depId))) {
        queue.push(String(depId));
      }
    }
  }

  visited.delete(String(bugId));
  return visited;
}

function getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap) {
  // Use cached deps if available, otherwise compute
  const deps = cachedMilestoneDeps?.get(String(milestoneBugId)) || getAllDependencies(milestoneBugId, dependencyMap);
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
  const today = optimizationToday || new Date();
  today.setHours(0, 0, 0, 0);

  let deadlinesMet = 0;
  let totalLateness = 0;
  let makespan = 0;
  const deadlineDetails = [];

  for (const endDays of Object.values(taskEndTimes)) {
    if (endDays > makespan) makespan = endDays;
  }

  for (const milestone of activeMilestones) {
    const milestoneBugId = String(milestone.bugId);
    const milestoneEndDays = getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap);

    if (milestoneEndDays > 0) {
      const endDate = addWorkingDays(today, milestoneEndDays);
      if (endDate <= milestone.freezeDate) {
        deadlinesMet++;
        deadlineDetails.push({ name: milestone.name, met: true, endDate, freezeDate: milestone.freezeDate });
      } else {
        const daysLate = Math.ceil((endDate - milestone.freezeDate) / (1000 * 60 * 60 * 24));
        totalLateness += daysLate;
        deadlineDetails.push({ name: milestone.name, met: false, endDate, freezeDate: milestone.freezeDate, daysLate });
      }
    }
  }

  return { deadlinesMet, totalLateness, makespan, deadlineDetails };
}

// === Unavailability handling (same as SA worker) ===

function buildUnavailabilityRanges(engineers, today) {
  const ranges = new Array(engineers.length).fill(null).map(() => []);
  for (let i = 0; i < engineers.length; i++) {
    const periods = engineers[i]?.unavailability || [];
    if (!Array.isArray(periods) || periods.length === 0) continue;

    for (const period of periods) {
      if (!period?.start || !period?.end) continue;
      const startDate = new Date(period.start);
      const endDate = new Date(period.end);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      if (endDate < today) continue;

      const clampedStart = startDate < today ? today : startDate;
      const startIdx = countWorkingDays(today, clampedStart);
      const endIdx = countWorkingDays(today, endDate);
      if (endIdx < startIdx) continue;
      ranges[i].push({ start: startIdx, end: endIdx });
    }

    ranges[i].sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of ranges[i]) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range });
      } else {
        last.end = Math.max(last.end, range.end);
      }
    }
    ranges[i] = merged;
  }
  return ranges;
}

function countWorkingDays(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  const current = new Date(startDate);
  let days = 0;
  while (current < endDate) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      days += 1;
    }
  }
  return days;
}

function adjustStartForUnavailability(start, ranges) {
  if (!ranges || ranges.length === 0) return start;
  let current = start;
  for (const range of ranges) {
    if (current < range.start) break;
    if (current >= range.start && current <= range.end) {
      current = range.end + 1;
    }
  }
  return current;
}

function countBlockedDaysInInterval(ranges, from, to) {
  if (!ranges || ranges.length === 0) return 0;
  if (to < from) return 0;
  let blocked = 0;
  for (const range of ranges) {
    if (range.start > to) break;
    if (range.end < from) continue;
    const overlapStart = Math.max(from, range.start);
    const overlapEnd = Math.min(to, range.end);
    if (overlapEnd >= overlapStart) {
      blocked += (overlapEnd - overlapStart + 1);
    }
  }
  return blocked;
}

function addWorkingDaysSkippingRanges(start, days, ranges) {
  if (days <= 0) return start;
  if (!ranges || ranges.length === 0) return start + days;

  let end = start + days;
  while (true) {
    const blocked = countBlockedDaysInInterval(ranges, start + 1, end);
    if (blocked === 0) return end;
    end += blocked;
  }
}

// === End time computation (same as SA worker) ===

function computeEndTimes(assignment, tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const processed = new Set();
  let remaining = n;
  let maxIterations = n * n;

  // Build task order using cached bug-to-milestone mapping
  const bugToMilestone = cachedBugToMilestone || assignBugsToMilestones(tasks, dependencyMap);
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );
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
    if (!taskOrder.includes(i)) {
      taskOrder.push(i);
    }
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
        // Use cached index lookup (O(1)) instead of findIndex (O(n))
        const depIdx = cachedTaskIdIndex ? cachedTaskIdIndex.get(String(depId)) : tasks.findIndex(t => String(t.id) === String(depId));
        if (depIdx !== undefined && depIdx !== -1 && !processed.has(depIdx)) {
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
        const ranges = unavailabilityRangesByEngineer ? unavailabilityRangesByEngineer[engineerIdx] : null;
        if (ranges && ranges.length > 0) {
          startTime = adjustStartForUnavailability(startTime, ranges);
        }
        endTime = addWorkingDaysSkippingRanges(startTime, effort.days, ranges);
        engineerAvailable[engineerIdx] = endTime;
      }
      taskEndTimes[taskId] = endTime;
      processed.add(i);
      remaining--;
      madeProgress = true;
    }

    if (!madeProgress && remaining > 0) {
      return null;
    }
  }

  return taskEndTimes;
}

function buildScheduleFromAssignment(assignment, tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const schedule = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const processed = new Set();
  let remaining = n;

  // Build task order using cached bug-to-milestone mapping
  const bugToMilestone = cachedBugToMilestone || assignBugsToMilestones(tasks, dependencyMap);
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );
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
    if (!taskOrder.includes(i)) {
      taskOrder.push(i);
    }
  }

  while (remaining > 0) {
    for (const i of taskOrder) {
      if (processed.has(i)) continue;

      const task = tasks[i];
      const taskId = String(task.id);
      const deps = dependencyMap.get(taskId) || [];

      let canProcess = true;
      let earliestStart = 0;

      for (const depId of deps) {
        // Use cached index lookup (O(1)) instead of findIndex (O(n))
        const depIdx = cachedTaskIdIndex ? cachedTaskIdIndex.get(String(depId)) : tasks.findIndex(t => String(t.id) === String(depId));
        if (depIdx !== undefined && depIdx !== -1 && !processed.has(depIdx)) {
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
      let assignedEngineer = engineer;
      if (effort.isMeta) {
        startTime = earliestStart;
        endTime = earliestStart;
        assignedEngineer = null;
      } else {
        startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
        const ranges = unavailabilityRangesByEngineer ? unavailabilityRangesByEngineer[engineerIdx] : null;
        if (ranges && ranges.length > 0) {
          startTime = adjustStartForUnavailability(startTime, ranges);
        }
        endTime = addWorkingDaysSkippingRanges(startTime, effort.days, ranges);
        engineerAvailable[engineerIdx] = endTime;
      }
      taskEndTimes[taskId] = endTime;

      schedule.push({
        bug: task,
        startDate: addWorkingDays(today, startTime),
        endDate: addWorkingDays(today, endTime),
        engineer: assignedEngineer,
        effort,
        completed: false
      });

      processed.add(i);
      remaining--;
    }
  }

  return schedule;
}

function reportImprovement(oldScore, newScore, generation = 0) {
  self.postMessage({
    type: 'improved',
    workerId,
    deadlinesMet: newScore.deadlinesMet,
    totalLateness: newScore.totalLateness,
    makespan: newScore.makespan,
    deadlineDetails: newScore.deadlineDetails,
    foundAtGeneration: generation
  });
}

function finishOptimization(tasks, engineers, dependencyMap, generations, bestFoundAtGeneration = 0) {
  if (bestAssignment) {
    const schedule = buildScheduleFromAssignment(bestAssignment, tasks, engineers, dependencyMap);

    self.postMessage({
      type: 'complete',
      workerId,
      schedule,
      deadlinesMet: bestScore.deadlinesMet,
      totalLateness: bestScore.totalLateness,
      makespan: bestScore.makespan,
      bestAssignment,
      improved: true,
      generations,
      bestFoundAtGeneration
    });
  } else {
    self.postMessage({ type: 'complete', workerId, schedule: null, improved: false });
  }
}
