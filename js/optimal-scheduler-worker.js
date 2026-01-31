/**
 * Optimal Scheduler Web Worker
 * Runs in background to find globally optimal schedule.
 * Prioritizes meeting deadlines over minimizing total time.
 */

// Size to days mapping (must match scheduler.js)
const SIZE_TO_DAYS = { 1: 1, 2: 5, 3: 10, 4: 20, 5: 60 };
const DEFAULT_SIZE = 3;
const SKILL_MODIFIERS = { 1: 1.0, 2: 1.25, 3: 1.5 };

// Milestones from SPEC.md (must match gantt-renderer.js)
const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2025-02-23'), freezeDate: new Date('2025-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2025-03-30'), freezeDate: new Date('2025-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2025-09-15'), freezeDate: new Date('2025-09-08') }
];

// Thresholds
const BRANCH_BOUND_THRESHOLD = 10;
const SA_ITERATIONS = 100000;
const SA_INITIAL_TEMP = 1000;
const SA_COOLING_RATE = 0.99995;

// Best solution tracking
let bestScore = { deadlinesMet: -1, makespan: Infinity };
let bestAssignment = null;

/**
 * Main message handler
 */
self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'start') {
    const { bugs, engineers, graph, sizeEstimates, taskLanguages, greedyMakespan } = data;
    optimize(bugs, engineers, graph, sizeEstimates, taskLanguages, greedyMakespan);
  } else if (type === 'stop') {
    self.close();
  }
};

/**
 * Main optimization entry point
 */
function optimize(bugs, engineers, graph, sizeEstimates, taskLanguages, greedyMakespan) {
  const tasks = bugs.filter(b => b.status !== 'RESOLVED' && b.status !== 'VERIFIED');

  self.postMessage({
    type: 'log',
    logType: 'status',
    message: `Starting optimization for ${tasks.length} tasks with ${engineers.length} engineers`
  });

  if (tasks.length === 0) {
    self.postMessage({ type: 'complete', schedule: null, improved: false });
    return;
  }

  // Build dependency map
  const dependencyMap = new Map();
  for (const task of bugs) {
    dependencyMap.set(String(task.id), task.dependsOn || []);
  }

  // Reset best tracking
  bestScore = { deadlinesMet: -1, makespan: Infinity };
  bestAssignment = null;

  // Choose algorithm based on problem size
  if (tasks.length <= BRANCH_BOUND_THRESHOLD) {
    self.postMessage({
      type: 'log',
      logType: 'status',
      message: `Using branch-and-bound (${tasks.length} tasks)`
    });
    branchAndBound(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);
  } else {
    self.postMessage({
      type: 'log',
      logType: 'status',
      message: `Using simulated annealing (${tasks.length} tasks, ${SA_ITERATIONS.toLocaleString()} iterations)`
    });
    simulatedAnnealing(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);
  }
}

/**
 * Evaluate a schedule and return score
 * Score prioritizes: 1) deadlines met, 2) lower makespan
 */
function evaluateSchedule(taskEndTimes, tasks) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let deadlinesMet = 0;
  let makespan = 0;
  const deadlineDetails = [];

  // Calculate makespan
  for (const endDays of Object.values(taskEndTimes)) {
    if (endDays > makespan) makespan = endDays;
  }

  // Check each milestone
  for (const milestone of MILESTONES) {
    const milestoneBugId = String(milestone.bugId);
    const milestoneEndDays = taskEndTimes[milestoneBugId];

    if (milestoneEndDays !== undefined) {
      const endDate = addWorkingDays(today, milestoneEndDays);
      const freezeDays = Math.floor((milestone.freezeDate - today) / (1000 * 60 * 60 * 24));

      if (milestoneEndDays <= freezeDays) {
        deadlinesMet++;
        deadlineDetails.push({ name: milestone.name, met: true, endDays: milestoneEndDays, freezeDays });
      } else {
        deadlineDetails.push({ name: milestone.name, met: false, endDays: milestoneEndDays, freezeDays });
      }
    }
  }

  return { deadlinesMet, makespan, deadlineDetails };
}

/**
 * Compare two scores - returns true if newScore is better
 */
function isBetter(newScore, oldScore) {
  // First priority: more deadlines met
  if (newScore.deadlinesMet > oldScore.deadlinesMet) return true;
  if (newScore.deadlinesMet < oldScore.deadlinesMet) return false;

  // Second priority: lower makespan
  return newScore.makespan < oldScore.makespan;
}

/**
 * Branch and Bound for small problems
 */
function branchAndBound(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages) {
  const n = tasks.length;
  const numEngineers = engineers.length;
  let nodesExplored = 0;

  function search(taskIndex, assignment, engineerAvailable, taskEndTimes) {
    nodesExplored++;

    if (nodesExplored % 5000 === 0) {
      self.postMessage({
        type: 'progress',
        explored: nodesExplored,
        bestDeadlines: bestScore.deadlinesMet,
        bestMakespan: bestScore.makespan
      });
    }

    // Base case: all tasks assigned
    if (taskIndex === n) {
      const score = evaluateSchedule(taskEndTimes, tasks);

      if (isBetter(score, bestScore)) {
        const oldScore = { ...bestScore };
        bestScore = score;
        bestAssignment = [...assignment];

        reportImprovement(oldScore, score);
      }
      return;
    }

    const task = tasks[taskIndex];
    const taskId = String(task.id);

    // Calculate earliest start based on dependencies
    let earliestStart = 0;
    const deps = dependencyMap.get(taskId) || [];
    for (const depId of deps) {
      const depEnd = taskEndTimes[String(depId)] || 0;
      earliestStart = Math.max(earliestStart, depEnd);
    }

    // Try each engineer, sorted by expected completion time
    const candidates = [];
    for (let e = 0; e < numEngineers; e++) {
      const engineer = engineers[e];
      const effort = calculateEffort(task, engineer, sizeEstimates, taskLanguages);
      const startTime = Math.max(engineerAvailable[e], earliestStart);
      const endTime = startTime + effort.days;
      candidates.push({ e, startTime, endTime, effort });
    }

    // Sort by end time for better pruning
    candidates.sort((a, b) => a.endTime - b.endTime);

    for (const { e, startTime, endTime, effort } of candidates) {
      // Pruning: if this can't improve on best, skip
      // (Only prune on makespan if we already meet all deadlines)
      if (bestScore.deadlinesMet === MILESTONES.length && endTime >= bestScore.makespan) {
        continue;
      }

      assignment[taskIndex] = { engineerIndex: e, startTime, endTime, effort };
      const newEngineerAvailable = [...engineerAvailable];
      newEngineerAvailable[e] = endTime;
      const newTaskEndTimes = { ...taskEndTimes, [taskId]: endTime };

      search(taskIndex + 1, assignment, newEngineerAvailable, newTaskEndTimes);
    }
  }

  const initialAssignment = new Array(n).fill(null);
  const initialAvailable = new Array(numEngineers).fill(0);
  const initialEndTimes = {};

  search(0, initialAssignment, initialAvailable, initialEndTimes);

  finishOptimization(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages, nodesExplored);
}

/**
 * Simulated Annealing for larger problems
 */
function simulatedAnnealing(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages) {
  const n = tasks.length;
  const numEngineers = engineers.length;

  // Generate initial solution
  let currentAssignment = generateInitialAssignment(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);
  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);
  let currentScore = evaluateSchedule(currentEndTimes, tasks);

  bestScore = { ...currentScore };
  bestAssignment = [...currentAssignment];

  self.postMessage({
    type: 'log',
    logType: 'status',
    message: `Initial: ${currentScore.deadlinesMet}/${MILESTONES.length} deadlines, ${currentScore.makespan.toFixed(0)} days`
  });

  let temperature = SA_INITIAL_TEMP;
  let lastReportIteration = 0;

  for (let i = 0; i < SA_ITERATIONS; i++) {
    // Generate neighbor
    const neighbor = [...currentAssignment];
    const taskIdx = Math.floor(Math.random() * n);
    const newEngineer = Math.floor(Math.random() * numEngineers);
    neighbor[taskIdx] = newEngineer;

    const neighborEndTimes = computeEndTimes(neighbor, tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);
    if (!neighborEndTimes) continue; // Invalid (cycle or error)

    const neighborScore = evaluateSchedule(neighborEndTimes, tasks);

    // Calculate acceptance
    const currentValue = currentScore.deadlinesMet * 10000 - currentScore.makespan;
    const neighborValue = neighborScore.deadlinesMet * 10000 - neighborScore.makespan;
    const delta = neighborValue - currentValue;

    if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
      currentAssignment = neighbor;
      currentEndTimes = neighborEndTimes;
      currentScore = neighborScore;

      if (isBetter(currentScore, bestScore)) {
        const oldScore = { ...bestScore };
        bestScore = { ...currentScore };
        bestAssignment = [...currentAssignment];

        reportImprovement(oldScore, bestScore);
      }
    }

    temperature *= SA_COOLING_RATE;

    // Progress report every 10000 iterations
    if (i - lastReportIteration >= 10000) {
      self.postMessage({
        type: 'progress',
        iteration: i,
        temperature: temperature.toFixed(2),
        currentDeadlines: currentScore.deadlinesMet,
        currentMakespan: currentScore.makespan,
        bestDeadlines: bestScore.deadlinesMet,
        bestMakespan: bestScore.makespan
      });
      lastReportIteration = i;
    }
  }

  finishOptimization(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages, SA_ITERATIONS);
}

/**
 * Report improvement to main thread
 */
function reportImprovement(oldScore, newScore) {
  let message = '';
  let logType = 'improvement';

  if (newScore.deadlinesMet > oldScore.deadlinesMet) {
    logType = 'deadline';
    const deadlineNames = newScore.deadlineDetails
      .filter(d => d.met)
      .map(d => d.name)
      .join(', ');
    message = `NEW DEADLINE MET! Now meeting ${newScore.deadlinesMet}/${MILESTONES.length} deadlines (${deadlineNames}). Makespan: ${newScore.makespan.toFixed(0)} days`;
  } else {
    message = `Improved makespan: ${newScore.makespan.toFixed(0)} days (was ${oldScore.makespan.toFixed(0)}). Deadlines: ${newScore.deadlinesMet}/${MILESTONES.length}`;
  }

  self.postMessage({
    type: 'log',
    logType,
    message
  });

  self.postMessage({
    type: 'improved',
    deadlinesMet: newScore.deadlinesMet,
    makespan: newScore.makespan,
    deadlineDetails: newScore.deadlineDetails
  });
}

/**
 * Finish optimization and send final results
 */
function finishOptimization(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages, iterations) {
  if (bestAssignment) {
    const schedule = buildScheduleFromAssignment(bestAssignment, tasks, engineers, dependencyMap, sizeEstimates, taskLanguages);

    self.postMessage({
      type: 'log',
      logType: 'status',
      message: `Optimization complete after ${iterations.toLocaleString()} iterations. Final: ${bestScore.deadlinesMet}/${MILESTONES.length} deadlines, ${bestScore.makespan.toFixed(0)} days`
    });

    self.postMessage({
      type: 'complete',
      schedule,
      deadlinesMet: bestScore.deadlinesMet,
      makespan: bestScore.makespan,
      improved: true,
      iterations
    });
  } else {
    self.postMessage({ type: 'complete', schedule: null, improved: false });
  }
}

/**
 * Generate initial assignment (skill-biased random)
 */
function generateInitialAssignment(tasks, engineers, dependencyMap, sizeEstimates, taskLanguages) {
  const assignment = [];

  for (const task of tasks) {
    const language = taskLanguages[task.id] || task.language;
    let bestEngineer = 0;
    let bestRank = Infinity;

    for (let e = 0; e < engineers.length; e++) {
      const rank = getSkillRank(engineers[e], language);
      if (rank < bestRank || (rank === bestRank && Math.random() < 0.3)) {
        bestRank = rank;
        bestEngineer = e;
      }
    }

    assignment.push(Math.random() < 0.7 ? bestEngineer : Math.floor(Math.random() * engineers.length));
  }

  return assignment;
}

/**
 * Compute end times for an assignment
 */
function computeEndTimes(assignment, tasks, engineers, dependencyMap, sizeEstimates, taskLanguages) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const processed = new Set();
  let remaining = n;
  let maxIterations = n * n;

  while (remaining > 0 && maxIterations-- > 0) {
    let madeProgress = false;

    for (let i = 0; i < n; i++) {
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
      const effort = calculateEffort(task, engineer, sizeEstimates, taskLanguages);

      const startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
      const endTime = startTime + effort.days;

      engineerAvailable[engineerIdx] = endTime;
      taskEndTimes[taskId] = endTime;
      processed.add(i);
      remaining--;
      madeProgress = true;
    }

    if (!madeProgress && remaining > 0) {
      return null; // Cycle detected
    }
  }

  return taskEndTimes;
}

/**
 * Build schedule from assignment array
 */
function buildScheduleFromAssignment(assignment, tasks, engineers, dependencyMap, sizeEstimates, taskLanguages) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const schedule = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const processed = new Set();
  let remaining = n;

  while (remaining > 0) {
    for (let i = 0; i < n; i++) {
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
      const effort = calculateEffort(task, engineer, sizeEstimates, taskLanguages);

      const startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
      const endTime = startTime + effort.days;

      engineerAvailable[engineerIdx] = endTime;
      taskEndTimes[taskId] = endTime;

      schedule.push({
        bug: task,
        startDate: addWorkingDays(today, startTime),
        endDate: addWorkingDays(today, endTime),
        engineer,
        effort,
        completed: false
      });

      processed.add(i);
      remaining--;
    }
  }

  return schedule;
}

/**
 * Calculate effort for a task/engineer combination
 */
function calculateEffort(task, engineer, sizeEstimates, taskLanguages) {
  let size = task.size;
  let sizeEstimated = task.sizeEstimated;

  if (size === null || size === undefined) {
    size = sizeEstimates[task.id] || DEFAULT_SIZE;
    sizeEstimated = true;
  }

  const baseDays = SIZE_TO_DAYS[size] || SIZE_TO_DAYS[DEFAULT_SIZE];
  const language = taskLanguages[task.id] || task.language;
  const skillRank = getSkillRank(engineer, language);
  const modifier = SKILL_MODIFIERS[skillRank] || SKILL_MODIFIERS[3];

  const availabilityFactor = engineer.availability || 1.0;
  const days = Math.ceil((baseDays * modifier) / availabilityFactor);

  return { days, baseDays, modifier, skillRank, sizeEstimated };
}

/**
 * Get skill rank (1-3) for engineer/language
 */
function getSkillRank(engineer, language) {
  if (!language || !engineer.skills) return 3;
  const idx = engineer.skills.findIndex(s => s.toLowerCase() === language.toLowerCase());
  return idx === -1 ? 3 : idx + 1;
}

/**
 * Add working days to a date
 */
function addWorkingDays(startDate, days) {
  const result = new Date(startDate);
  let remaining = Math.floor(days);

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) {
      remaining--;
    }
  }

  return result;
}
