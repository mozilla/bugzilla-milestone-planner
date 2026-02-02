/**
 * Resource Scheduler module
 * Greedy scheduling algorithm for task assignment
 */

// Size to days mapping (fractional sizes interpolate)
const SIZE_TO_DAYS = {
  1: 1,
  2: 5,
  3: 10,
  4: 20,
  5: 60
};

// Default size when not specified (2 weeks = 10 working days)
const DEFAULT_SIZE = 3;
const DEFAULT_DAYS = 10;

export class Scheduler {
  constructor(engineers, milestones) {
    this.engineers = engineers;
    this.milestones = milestones;
    this.schedule = [];
    this.engineerSchedules = new Map();
    this.warnings = [];

    // Initialize engineer schedules
    for (const engineer of engineers) {
      this.engineerSchedules.set(engineer.id, {
        engineer,
        tasks: [],
        nextAvailable: new Date()
      });
    }
  }

  /**
   * Calculate effort in days for a task
   * @param {Object} bug - Bug object
   * @param {Object} engineer - Engineer object
   * @returns {{days: number, baseDays: number, sizeEstimated: boolean}}
   */
  calculateEffort(bug, engineer) {
    // Meta bugs take 0 time (they're tracking bugs)
    if (bug.isMeta) {
      return {
        days: 0,
        baseDays: 0,
        sizeEstimated: false,
        isMeta: true
      };
    }

    // Get size from bug or use default (2 weeks)
    let size = bug.size;
    let sizeEstimated = bug.sizeEstimated || false;

    if (size === null || size === undefined) {
      size = DEFAULT_SIZE;
      sizeEstimated = true;
    }

    // Calculate base days, supporting fractional sizes via interpolation
    const baseDays = this.calculateDaysFromSize(size);

    // Apply availability factor (e.g., 0.2 = 20% time means 5x longer)
    const availabilityFactor = engineer.availability || 1.0;
    const adjustedDays = Math.ceil(baseDays / availabilityFactor);

    return {
      days: adjustedDays,
      baseDays,
      sizeEstimated
    };
  }

  /**
   * Calculate days from size, supporting fractional sizes
   * @param {number} size - Size value (can be fractional like 3.5)
   * @returns {number} Days of effort
   */
  calculateDaysFromSize(size) {
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
   * Find the best available engineer for a task
   * @param {Object} bug - Bug object
   * @param {Date} earliestStart - Earliest possible start date
   * @returns {{engineer: Object, startDate: Date, effort: Object}|null}
   */
  findBestEngineer(bug, earliestStart) {
    let bestMatch = null;
    let bestEndTime = Infinity;

    for (const [engineerId, schedule] of this.engineerSchedules) {
      const engineer = schedule.engineer;

      // Calculate effort for this engineer
      const effort = this.calculateEffort(bug, engineer);

      // Determine start date (max of engineer availability and earliest start)
      const startDate = new Date(Math.max(
        schedule.nextAvailable.getTime(),
        earliestStart.getTime()
      ));

      // Score: prefer earlier completion
      const endDate = this.addWorkingDays(startDate, effort.days, engineer);

      if (endDate.getTime() < bestEndTime) {
        bestEndTime = endDate.getTime();
        bestMatch = {
          engineer,
          startDate,
          effort,
          endDate
        };
      }
    }

    return bestMatch;
  }

  /**
   * Schedule all tasks with milestone-aware prioritization
   * Processes milestones in deadline order (earliest first), so engineer
   * availability from earlier milestones carries forward to later ones.
   *
   * @param {Array<Object>} sortedBugs - Bugs in topological order
   * @param {DependencyGraph} graph - Dependency graph
   * @returns {Array<Object>} Scheduled tasks
   */
  scheduleTasks(sortedBugs, graph) {
    this.schedule = [];
    this.warnings = [];

    // Reset engineer availability to today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const schedule of this.engineerSchedules.values()) {
      schedule.nextAvailable = new Date(today);
      schedule.tasks = [];
    }

    // Map to track task end dates
    const taskEndDates = new Map();

    // Group bugs by milestone (which milestone they belong to)
    const bugToMilestone = this.assignBugsToMilestones(sortedBugs, graph);

    // Sort milestones by deadline (earliest first)
    const sortedMilestones = [...this.milestones].sort((a, b) =>
      a.deadline.getTime() - b.deadline.getTime()
    );

    console.log(`[Scheduler] Processing ${sortedMilestones.length} milestones in deadline order:`);
    for (const m of sortedMilestones) {
      console.log(`  - ${m.name}: deadline ${this.formatDate(m.deadline)}`);
    }

    // Process each milestone in sequence
    for (const milestone of sortedMilestones) {
      const milestoneBugIds = bugToMilestone.get(String(milestone.bugId)) || new Set();

      // Get bugs for this milestone in topological order
      const milestoneBugs = sortedBugs.filter(bug =>
        milestoneBugIds.has(String(bug.id))
      );

      console.log(`[Scheduler] Milestone ${milestone.name}: ${milestoneBugs.length} bugs`);

      // Schedule this milestone's bugs
      for (const bug of milestoneBugs) {
        this.scheduleBug(bug, graph, taskEndDates, today, milestone);
      }
    }

    // Schedule any remaining bugs not assigned to a milestone
    const scheduledIds = new Set(this.schedule.map(t => String(t.bug.id)));
    const remainingBugs = sortedBugs.filter(bug => !scheduledIds.has(String(bug.id)));

    if (remainingBugs.length > 0) {
      console.log(`[Scheduler] Scheduling ${remainingBugs.length} remaining bugs not in any milestone`);
      for (const bug of remainingBugs) {
        this.scheduleBug(bug, graph, taskEndDates, today);
      }
    }

    return this.schedule;
  }

  /**
   * Assign bugs to milestones based on dependency relationships
   * A bug belongs to the earliest milestone that depends on it (directly or transitively)
   *
   * @param {Array<Object>} bugs - All bugs
   * @param {DependencyGraph} graph - Dependency graph
   * @returns {Map<string, Set<string>>} Map of milestone bugId to set of bug IDs
   */
  assignBugsToMilestones(bugs, graph) {
    const bugToMilestone = new Map();

    // Initialize sets for each milestone
    for (const milestone of this.milestones) {
      bugToMilestone.set(String(milestone.bugId), new Set());
    }

    // Sort milestones by deadline (earliest first)
    const sortedMilestones = [...this.milestones].sort((a, b) =>
      a.deadline.getTime() - b.deadline.getTime()
    );

    // For each bug, find which milestone(s) depend on it
    // Assign to the earliest such milestone
    for (const bug of bugs) {
      const bugId = String(bug.id);

      for (const milestone of sortedMilestones) {
        const milestoneId = String(milestone.bugId);

        // Check if this bug is the milestone itself or a dependency of the milestone
        if (bugId === milestoneId || this.isDependencyOf(bugId, milestoneId, graph)) {
          bugToMilestone.get(milestoneId).add(bugId);
          break; // Assign to earliest milestone only
        }
      }
    }

    return bugToMilestone;
  }

  /**
   * Check if bugId is a (transitive) dependency of targetId
   */
  isDependencyOf(bugId, targetId, graph) {
    const visited = new Set();
    const queue = [targetId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const deps = graph.getDependencies(currentId);
      for (const depId of deps) {
        if (depId === bugId) return true;
        if (!visited.has(depId)) {
          queue.push(depId);
        }
      }
    }

    return false;
  }

  /**
   * Schedule a single bug
   * @param {Object} bug - Bug object
   * @param {DependencyGraph} graph - Dependency graph
   * @param {Map} taskEndDates - Map of bug ID to end date
   * @param {Date} today - Today's date
   * @param {Object|null} milestone - Milestone this bug belongs to (optional)
   */
  scheduleBug(bug, graph, taskEndDates, today, milestone = null) {
    // Skip if already scheduled
    if (taskEndDates.has(String(bug.id))) {
      return;
    }

    // Skip completed bugs
    if (bug.status === 'RESOLVED' || bug.status === 'VERIFIED') {
      taskEndDates.set(String(bug.id), today);
      this.schedule.push({
        bug,
        startDate: null,
        endDate: null,
        engineer: null,
        effort: null,
        completed: true,
        milestone: milestone
      });
      return;
    }

    // Calculate earliest start based on dependencies
    let earliestStart = new Date(today);
    const dependencies = graph.getDependencies(String(bug.id));

    for (const depId of dependencies) {
      const depEndDate = taskEndDates.get(depId);
      if (depEndDate && depEndDate > earliestStart) {
        earliestStart = new Date(depEndDate);
      }
    }

    // Find best engineer
    const assignment = this.findBestEngineer(bug, earliestStart);

    if (!assignment) {
      this.warnings.push({
        type: 'no_engineer',
        bug,
        message: `No engineer available for bug ${bug.id}`
      });
      return;
    }

    let { engineer, startDate, effort, endDate } = assignment;

    // Meta bugs (0 days) complete when dependencies complete, not affected by engineer availability
    if (effort.days === 0) {
      startDate = earliestStart;
      endDate = earliestStart;
      // Don't update engineer schedule - meta bugs don't consume engineer time
    } else {
      // Update engineer schedule
      const engineerSchedule = this.engineerSchedules.get(engineer.id);
      engineerSchedule.nextAvailable = new Date(endDate);
      engineerSchedule.tasks.push(bug.id);
    }

    // Record task end date
    taskEndDates.set(String(bug.id), endDate);

    // Add to schedule
    this.schedule.push({
      bug,
      startDate,
      endDate,
      engineer,
      effort,
      completed: false,
      milestone: milestone
    });
  }

  /**
   * Add working days to a date (skip weekends and unavailability periods)
   * @param {Date} startDate
   * @param {number} days
   * @param {Object} engineer - Engineer object with unavailability array
   * @returns {Date}
   */
  addWorkingDays(startDate, days, engineer = null) {
    const result = new Date(startDate);
    let remaining = days;

    while (remaining > 0) {
      result.setDate(result.getDate() + 1);
      const dayOfWeek = result.getDay();

      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      // Skip unavailability periods for this engineer
      if (engineer && this.isUnavailable(result, engineer)) {
        continue;
      }

      remaining--;
    }

    return result;
  }

  /**
   * Check if a date falls within an engineer's unavailability period
   * @param {Date} date - Date to check
   * @param {Object} engineer - Engineer object with unavailability array
   * @returns {boolean}
   */
  isUnavailable(date, engineer) {
    if (!engineer.unavailability || !Array.isArray(engineer.unavailability)) {
      return false;
    }

    const dateStr = this.formatDate(date);

    for (const period of engineer.unavailability) {
      if (dateStr >= period.start && dateStr <= period.end) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for deadline risks
   * @param {Array<{bugId: number, deadline: Date, freezeDate: Date, name: string}>} milestoneInfo
   * @returns {Array<Object>} Tasks at risk
   */
  checkDeadlineRisks(milestoneInfo) {
    const risks = [];

    for (const task of this.schedule) {
      if (task.completed) continue;

      for (const milestone of milestoneInfo) {
        // Check if this bug blocks the milestone
        if (String(task.bug.id) === String(milestone.bugId) ||
            this.isBlockingMilestone(task.bug.id, milestone.bugId)) {

          // Check against feature freeze date
          if (task.endDate > milestone.freezeDate) {
            risks.push({
              task,
              milestone,
              type: 'freeze',
              message: `Bug ${task.bug.id} ends ${this.formatDate(task.endDate)}, after ${milestone.name} feature freeze ${this.formatDate(milestone.freezeDate)}`
            });
          } else if (task.endDate > milestone.deadline) {
            risks.push({
              task,
              milestone,
              type: 'deadline',
              message: `Bug ${task.bug.id} ends ${this.formatDate(task.endDate)}, after ${milestone.name} deadline ${this.formatDate(milestone.deadline)}`
            });
          }
        }
      }
    }

    return risks;
  }

  /**
   * Check if a bug blocks a milestone (simplified check)
   */
  isBlockingMilestone(bugId, milestoneBugId) {
    // This would need the graph to properly determine
    // For now, assume all bugs in the schedule are relevant
    return true;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get schedule statistics
   */
  getStats() {
    const totalTasks = this.schedule.length;
    const completedTasks = this.schedule.filter(t => t.completed).length;
    const scheduledTasks = this.schedule.filter(t => !t.completed).length;

    let totalDays = 0;
    let estimatedCount = 0;

    for (const task of this.schedule) {
      if (task.effort) {
        totalDays += task.effort.days;
        if (task.effort.sizeEstimated) {
          estimatedCount++;
        }
      }
    }

    // Find earliest and latest dates
    let earliestStart = null;
    let latestEnd = null;

    for (const task of this.schedule) {
      if (task.startDate && (!earliestStart || task.startDate < earliestStart)) {
        earliestStart = task.startDate;
      }
      if (task.endDate && (!latestEnd || task.endDate > latestEnd)) {
        latestEnd = task.endDate;
      }
    }

    return {
      totalTasks,
      completedTasks,
      scheduledTasks,
      totalDays,
      estimatedCount,
      warningCount: this.warnings.length,
      earliestStart,
      latestEnd
    };
  }

  /**
   * Get engineer workload summary
   */
  getEngineerWorkloads() {
    const workloads = [];

    for (const [engineerId, schedule] of this.engineerSchedules) {
      const tasks = this.schedule.filter(
        t => t.engineer && t.engineer.id === engineerId && !t.completed
      );

      let totalDays = 0;
      for (const task of tasks) {
        if (task.effort) {
          totalDays += task.effort.days;
        }
      }

      workloads.push({
        engineer: schedule.engineer,
        taskCount: tasks.length,
        totalDays,
        nextAvailable: schedule.nextAvailable
      });
    }

    return workloads;
  }
}

export default Scheduler;
