/**
 * Optimal Scheduler Web Worker
 * Runs in background to find globally optimal schedule.
 * Prioritizes meeting deadlines over minimizing total time.
 */

// Size to days mapping (must match scheduler.js)
const SIZE_TO_DAYS = { 1: 1, 2: 5, 3: 10, 4: 20, 5: 60 };
const DEFAULT_SIZE = 3;
const DEFAULT_DAYS = 10;

// Default milestones (overridden by passed milestones)
let activeMilestones = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
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
    const { bugs, engineers, graph, milestones } = data;

    // Update active milestones if provided
    if (milestones && milestones.length > 0) {
      activeMilestones = milestones.map(m => ({
        name: m.name,
        bugId: m.bugId,
        deadline: new Date(m.deadline),
        freezeDate: new Date(m.freezeDate)
      }));
      console.log('[Worker] Using', activeMilestones.length, 'milestones:', activeMilestones.map(m => m.name).join(', '));
    }

    optimize(bugs, engineers, graph);
  } else if (type === 'stop') {
    self.close();
  }
};

/**
 * Main optimization entry point
 */
function optimize(bugs, engineers, graph) {
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

  // Build dependency map from the FULL graph (not just filtered bugs)
  // This ensures we can traverse dependency chains through non-scheduled bugs
  const dependencyMap = new Map();
  for (const [bugId, deps] of Object.entries(graph)) {
    dependencyMap.set(String(bugId), deps.map(d => String(d)));
  }

  // Log milestone-aware scheduling info
  const bugToMilestone = assignBugsToMilestones(tasks, dependencyMap);
  const sortedMilestones = [...activeMilestones].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  for (const milestone of sortedMilestones) {
    const count = [...bugToMilestone.values()].filter(m => String(m.bugId) === String(milestone.bugId)).length;
    console.log(`[Worker] Milestone ${milestone.name}: ${count} tasks`);
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
    branchAndBound(tasks, engineers, dependencyMap);
  } else {
    self.postMessage({
      type: 'log',
      logType: 'status',
      message: `Using simulated annealing (${tasks.length} tasks, ${SA_ITERATIONS.toLocaleString()} iterations)`
    });
    simulatedAnnealing(tasks, engineers, dependencyMap);
  }
}

/**
 * Assign bugs to milestones based on dependency relationships
 * A bug belongs to the earliest milestone that depends on it (directly or transitively)
 * This mirrors the logic in scheduler.js
 */
function assignBugsToMilestones(tasks, dependencyMap) {
  const bugToMilestone = new Map();

  // Sort milestones by deadline (earliest first)
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );

  // For each bug, find which milestone(s) depend on it
  // Assign to the earliest such milestone
  for (const task of tasks) {
    const bugId = String(task.id);

    for (const milestone of sortedMilestones) {
      const milestoneId = String(milestone.bugId);

      // Check if this bug is the milestone itself or a dependency of the milestone
      if (bugId === milestoneId || isDependencyOf(bugId, milestoneId, dependencyMap)) {
        bugToMilestone.set(bugId, milestone);
        break; // Assign to earliest milestone only
      }
    }
  }

  return bugToMilestone;
}

/**
 * Check if bugId is a (transitive) dependency of targetId
 */
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

/**
 * Get all transitive dependencies for a bug
 */
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

  visited.delete(String(bugId)); // Don't include the bug itself
  return visited;
}

/**
 * Calculate milestone completion date by finding max end time of ALL transitive dependencies
 * This matches the UI's calculateMilestoneCompletions logic
 */
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

/**
 * Evaluate a schedule and return score
 * Score prioritizes: 1) deadlines met, 2) lower makespan
 */
function evaluateSchedule(taskEndTimes, tasks, dependencyMap) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let deadlinesMet = 0;
  let makespan = 0;
  const deadlineDetails = [];

  // Calculate makespan
  for (const endDays of Object.values(taskEndTimes)) {
    if (endDays > makespan) makespan = endDays;
  }

  // Check each milestone - use max of ALL transitive dependency end times
  for (const milestone of activeMilestones) {
    const milestoneBugId = String(milestone.bugId);
    const milestoneEndDays = getMilestoneCompletionDays(milestoneBugId, taskEndTimes, dependencyMap);

    if (milestoneEndDays > 0) {
      const endDate = addWorkingDays(today, milestoneEndDays);
      // Compare actual dates
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
function branchAndBound(tasks, engineers, dependencyMap) {
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
      const score = evaluateSchedule(taskEndTimes, tasks, dependencyMap);

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
      const effort = calculateEffort(task, engineer);
      const startTime = Math.max(engineerAvailable[e], earliestStart);
      const endTime = startTime + effort.days;
      candidates.push({ e, startTime, endTime, effort });
    }

    // Sort by end time for better pruning
    candidates.sort((a, b) => a.endTime - b.endTime);

    for (const { e, startTime, endTime, effort } of candidates) {
      // Pruning: if this can't improve on best, skip
      // (Only prune on makespan if we already meet all deadlines)
      if (bestScore.deadlinesMet === activeMilestones.length && endTime >= bestScore.makespan) {
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

  finishOptimization(tasks, engineers, dependencyMap, nodesExplored);
}

/**
 * Simulated Annealing for larger problems
 */
function simulatedAnnealing(tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const numEngineers = engineers.length;

  // Generate initial solution (random assignment)
  let currentAssignment = generateInitialAssignment(tasks, engineers);
  let currentEndTimes = computeEndTimes(currentAssignment, tasks, engineers, dependencyMap);
  let currentScore = evaluateSchedule(currentEndTimes, tasks, dependencyMap);

  bestScore = { ...currentScore };
  bestAssignment = [...currentAssignment];

  self.postMessage({
    type: 'log',
    logType: 'status',
    message: `Initial: ${currentScore.deadlinesMet}/${activeMilestones.length} deadlines, ${currentScore.makespan.toFixed(0)} days`
  });

  let temperature = SA_INITIAL_TEMP;
  let lastReportIteration = 0;

  for (let i = 0; i < SA_ITERATIONS; i++) {
    // Generate neighbor
    const neighbor = [...currentAssignment];
    const taskIdx = Math.floor(Math.random() * n);
    const newEngineer = Math.floor(Math.random() * numEngineers);
    neighbor[taskIdx] = newEngineer;

    const neighborEndTimes = computeEndTimes(neighbor, tasks, engineers, dependencyMap);
    if (!neighborEndTimes) continue; // Invalid (cycle or error)

    const neighborScore = evaluateSchedule(neighborEndTimes, tasks, dependencyMap);

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

  finishOptimization(tasks, engineers, dependencyMap, SA_ITERATIONS);
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
    message = `NEW DEADLINE MET! Now meeting ${newScore.deadlinesMet}/${activeMilestones.length} deadlines (${deadlineNames}). Makespan: ${newScore.makespan.toFixed(0)} days`;
  } else {
    message = `Improved makespan: ${newScore.makespan.toFixed(0)} days (was ${oldScore.makespan.toFixed(0)}). Deadlines: ${newScore.deadlinesMet}/${activeMilestones.length}`;
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
function finishOptimization(tasks, engineers, dependencyMap, iterations) {
  if (bestAssignment) {
    const schedule = buildScheduleFromAssignment(bestAssignment, tasks, engineers, dependencyMap);

    self.postMessage({
      type: 'log',
      logType: 'status',
      message: `Optimization complete after ${iterations.toLocaleString()} iterations. Final: ${bestScore.deadlinesMet}/${activeMilestones.length} deadlines, ${bestScore.makespan.toFixed(0)} days`
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
 * Generate initial assignment (random)
 */
function generateInitialAssignment(tasks, engineers) {
  const assignment = [];

  for (const task of tasks) {
    // Random assignment to any engineer
    assignment.push(Math.floor(Math.random() * engineers.length));
  }

  return assignment;
}

/**
 * Compute end times for an assignment
 * Tasks are processed in milestone order (earliest deadline first) to match greedy scheduler
 */
function computeEndTimes(assignment, tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const processed = new Set();
  let remaining = n;
  let maxIterations = n * n;

  // Assign tasks to milestones and create processing order
  const bugToMilestone = assignBugsToMilestones(tasks, dependencyMap);

  // Sort milestones by deadline
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );

  // Create ordered index list: earlier milestones first, then unassigned
  const taskOrder = [];
  for (const milestone of sortedMilestones) {
    for (let i = 0; i < n; i++) {
      const taskMilestone = bugToMilestone.get(String(tasks[i].id));
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) {
        taskOrder.push(i);
      }
    }
  }
  // Add any tasks not assigned to a milestone
  for (let i = 0; i < n; i++) {
    if (!taskOrder.includes(i)) {
      taskOrder.push(i);
    }
  }

  while (remaining > 0 && maxIterations-- > 0) {
    let madeProgress = false;

    // Process tasks in milestone priority order
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

      // Assignment can be either a number (SA) or object with engineerIndex (B&B)
      const assignmentEntry = assignment[i];
      const engineerIdx = typeof assignmentEntry === 'object' ? assignmentEntry.engineerIndex : assignmentEntry;
      const engineer = engineers[engineerIdx];

      if (!engineer) continue;

      const effort = calculateEffort(task, engineer);

      // Meta bugs (0 days) complete when dependencies complete
      let startTime, endTime;
      if (effort.days === 0) {
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

    if (!madeProgress && remaining > 0) {
      return null; // Cycle detected
    }
  }

  return taskEndTimes;
}

/**
 * Build schedule from assignment array
 * Tasks are processed in milestone order (earliest deadline first) to match greedy scheduler
 */
function buildScheduleFromAssignment(assignment, tasks, engineers, dependencyMap) {
  const n = tasks.length;
  const engineerAvailable = new Array(engineers.length).fill(0);
  const taskEndTimes = {};
  const schedule = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const processed = new Set();
  let remaining = n;

  // Assign tasks to milestones and create processing order
  const bugToMilestone = assignBugsToMilestones(tasks, dependencyMap);

  // Sort milestones by deadline
  const sortedMilestones = [...activeMilestones].sort((a, b) =>
    a.deadline.getTime() - b.deadline.getTime()
  );

  // Create ordered index list: earlier milestones first, then unassigned
  const taskOrder = [];
  for (const milestone of sortedMilestones) {
    for (let i = 0; i < n; i++) {
      const taskMilestone = bugToMilestone.get(String(tasks[i].id));
      if (taskMilestone && String(taskMilestone.bugId) === String(milestone.bugId)) {
        taskOrder.push(i);
      }
    }
  }
  // Add any tasks not assigned to a milestone
  for (let i = 0; i < n; i++) {
    if (!taskOrder.includes(i)) {
      taskOrder.push(i);
    }
  }

  while (remaining > 0) {
    // Process tasks in milestone priority order
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

      // Assignment can be either a number (SA) or object with engineerIndex (B&B)
      const assignmentEntry = assignment[i];
      const engineerIdx = typeof assignmentEntry === 'object' ? assignmentEntry.engineerIndex : assignmentEntry;
      const engineer = engineers[engineerIdx];

      if (!engineer) {
        console.error('[Worker] Engineer not found for index', engineerIdx, 'assignment:', assignmentEntry);
        continue;
      }

      const effort = calculateEffort(task, engineer);

      // Meta bugs (0 days) complete when dependencies complete, not affected by engineer availability
      let startTime, endTime;
      if (effort.days === 0) {
        startTime = earliestStart;
        endTime = earliestStart;
        // Don't update engineerAvailable - meta bugs don't consume engineer time
      } else {
        startTime = Math.max(engineerAvailable[engineerIdx], earliestStart);
        endTime = startTime + effort.days;
        engineerAvailable[engineerIdx] = endTime;
      }
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
function calculateEffort(task, engineer) {
  // Meta bugs take 0 time
  if (task.isMeta) {
    return { days: 0, baseDays: 0, sizeEstimated: false, isMeta: true };
  }

  let size = task.size;
  let sizeEstimated = task.sizeEstimated || false;

  if (size === null || size === undefined) {
    size = DEFAULT_SIZE;
    sizeEstimated = true;
  }

  const baseDays = calculateDaysFromSize(size);

  // Apply availability factor (e.g., 0.2 = 20% time means 5x longer)
  const availabilityFactor = engineer.availability || 1.0;
  const days = Math.ceil(baseDays / availabilityFactor);

  return { days, baseDays, sizeEstimated };
}

/**
 * Calculate days from size, supporting fractional sizes
 */
function calculateDaysFromSize(size) {
  // Integer sizes use the lookup table
  if (Number.isInteger(size) && SIZE_TO_DAYS[size]) {
    return SIZE_TO_DAYS[size];
  }

  // Fractional sizes: interpolate between adjacent values
  const lowerSize = Math.floor(size);
  const upperSize = Math.ceil(size);

  // Handle edge cases
  if (lowerSize < 1) return SIZE_TO_DAYS[1];
  if (upperSize > 5) return SIZE_TO_DAYS[5];
  if (lowerSize === upperSize) return SIZE_TO_DAYS[lowerSize] || DEFAULT_DAYS;

  const lowerDays = SIZE_TO_DAYS[lowerSize] || DEFAULT_DAYS;
  const upperDays = SIZE_TO_DAYS[upperSize] || DEFAULT_DAYS;
  const fraction = size - lowerSize;

  return Math.ceil(lowerDays + fraction * (upperDays - lowerDays));
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
