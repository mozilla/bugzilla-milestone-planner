/**
 * Enterprise Project Planner - Main Application
 * Coordinates all modules and handles application lifecycle
 */

import { BugzillaAPI } from './bugzilla-api.js';
import { DependencyGraph } from './dependency-graph.js';
import { Scheduler } from './scheduler.js';
import { GanttRenderer, MILESTONES } from './gantt-renderer.js';
import { UIController } from './ui-controller.js';

class EnterprisePlanner {
  constructor() {
    this.api = new BugzillaAPI();
    this.graph = new DependencyGraph();
    this.scheduler = null;
    this.gantt = new GanttRenderer('gantt-chart');
    this.ui = new UIController();

    this.engineers = [];
    this.bugs = new Map();

    // Optimal scheduler
    this.optimalWorker = null;
    this.greedySchedule = null;
    this.optimalSchedule = null;
    this.currentScheduleType = 'greedy';

    // Filters
    this.severityFilter = 'S2';
    this.milestoneFilter = '';
    this.sortedBugs = [];
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('Initializing Enterprise Project Planner...');

    // Initialize UI
    this.ui.init();
    this.ui.showLoading();

    // Set up API callbacks
    this.api.setProgressCallback((progress) => this.onProgress(progress));
    this.api.setBugDiscoveredCallback((bug) => this.onBugDiscovered(bug));

    // Set up UI event listeners
    this.ui.setupEventListeners({
      onViewModeChange: (mode) => this.onViewModeChange(mode),
      onMilestoneFilter: (bugId) => this.onMilestoneFilter(bugId),
      onSeverityFilter: (severity) => this.onSeverityFilter(severity),
      onRefresh: () => this.refresh(),
      onScheduleTypeChange: (type) => this.onScheduleTypeChange(type)
    });

    // Load static data and fetch bugs
    await this.loadStaticData();
    await this.fetchAndProcess();
  }

  /**
   * Load static JSON data files
   */
  async loadStaticData() {
    try {
      // Load engineers
      const engineersRes = await fetch('./data/engineers.json');
      const engineersData = await engineersRes.json();
      this.engineers = engineersData.engineers || [];
      console.log(`Loaded ${this.engineers.length} engineers`);

    } catch (error) {
      console.error('Error loading static data:', error);
      this.ui.showError(`Failed to load configuration: ${error.message}`);
    }
  }

  /**
   * Fetch bugs from Bugzilla and process them
   */
  async fetchAndProcess() {
    try {
      // Get milestone bug IDs
      const milestoneBugIds = MILESTONES.map(m => m.bugId);

      // Update UI for each milestone as we process
      for (const milestone of MILESTONES) {
        this.ui.updateMilestoneStatus(milestone.bugId, 'pending', 0);
      }

      // Fetch all dependencies
      console.log('Fetching bugs from Bugzilla...');
      this.bugs = await this.api.fetchAllDependencies(milestoneBugIds);
      console.log(`Fetched ${this.bugs.size} bugs total`);

      // Build dependency graph
      console.log('Building dependency graph...');
      this.graph = new DependencyGraph();
      this.graph.buildFromBugs(this.bugs);

      // Detect errors
      const errors = this.detectErrors();

      // Topological sort
      const { sorted, valid, cycles } = this.graph.topologicalSort();

      if (!valid) {
        console.error('Graph has cycles:', cycles);
        this.ui.showError('Dependency graph contains cycles. See errors section.');
      }

      // Get sorted bugs and store for filtering later
      this.sortedBugs = sorted.map(id => this.bugs.get(id)).filter(Boolean);

      // Apply filters
      let filteredBugs = this.filterResolvedBugs(this.sortedBugs);
      filteredBugs = this.filterBugsByComponent(filteredBugs);
      filteredBugs = this.filterBugsBySeverity(filteredBugs);
      filteredBugs = this.filterBugsByMilestone(filteredBugs);
      const activeMilestones = this.getActiveMilestones();
      console.log(`Sorted ${this.sortedBugs.length} bugs, ${filteredBugs.length} after filters (excluding resolved, Client only)`);

      // Schedule tasks
      console.log('Scheduling tasks...');
      this.scheduler = new Scheduler(this.engineers, activeMilestones);
      const schedule = this.scheduler.scheduleTasks(filteredBugs, this.graph);
      console.log(`Scheduled ${schedule.length} tasks`);

      // Check deadline risks
      const risks = this.scheduler.checkDeadlineRisks(activeMilestones);

      // Store greedy schedule
      this.greedySchedule = schedule;

      // Render UI
      this.ui.showLoaded();
      this.renderResults(schedule, errors, risks, activeMilestones);

      // Start optimal scheduler in background
      this.startOptimalScheduler(filteredBugs, activeMilestones);

    } catch (error) {
      console.error('Error during fetch and process:', error);
      this.ui.showError(`Failed to fetch data: ${error.message}`);
    }
  }

  /**
   * Detect errors and inconsistencies
   */
  detectErrors() {
    const cycles = this.graph.detectCycles();
    const orphaned = this.graph.findOrphanedDependencies();
    const duplicates = this.graph.findDuplicateSummaries();
    const missingAssignees = this.graph.findMissingAssignees();
    const missingSizes = this.graph.findMissingSizes();

    return {
      cycles,
      orphaned,
      duplicates,
      missingAssignees,
      missingSizes
    };
  }

  /**
   * Render all results
   */
  renderResults(schedule, errors, risks, activeMilestones = MILESTONES) {
    // Render Gantt chart
    this.gantt.render(schedule, this.graph);

    // Render milestone cards with estimated completions (only active milestones)
    const milestoneCompletions = this.calculateMilestoneCompletions(schedule);
    this.ui.renderMilestoneCards(activeMilestones, milestoneCompletions);

    // Render statistics
    const stats = this.scheduler.getStats();
    this.ui.renderStats(stats);

    // Render tables
    const estimatedBugs = schedule
      .filter(t => t.effort && t.effort.sizeEstimated)
      .map(t => t.bug);
    this.ui.renderEstimatedTable(estimatedBugs);
    this.ui.renderRisksTable(risks);

    // Render errors markdown
    this.ui.renderErrorsMarkdown(errors);

    // Log summary
    console.log('Schedule stats:', stats);
    console.log('Errors:', errors);
    console.log('Risks:', risks.length);
  }

  /**
   * Calculate estimated completion dates for each milestone
   * A milestone is complete when all its dependencies are complete
   */
  calculateMilestoneCompletions(schedule) {
    const completions = new Map();

    for (const milestone of MILESTONES) {
      const bugId = String(milestone.bugId);

      // Find the milestone task in the schedule
      const milestoneTask = schedule.find(t => String(t.bug.id) === bugId);

      if (milestoneTask) {
        if (milestoneTask.completed) {
          // Already completed
          completions.set(bugId, new Date());
        } else if (milestoneTask.endDate) {
          completions.set(bugId, milestoneTask.endDate);
        }
      }

      // Also check all dependencies - milestone completes when last dependency completes
      const deps = this.getAllDependencies(bugId);
      let latestEnd = completions.get(bugId) || null;

      for (const depId of deps) {
        const depTask = schedule.find(t => String(t.bug.id) === depId);
        if (depTask && depTask.endDate && (!latestEnd || depTask.endDate > latestEnd)) {
          latestEnd = depTask.endDate;
        }
      }

      if (latestEnd) {
        completions.set(bugId, latestEnd);
      }
    }

    return completions;
  }

  /**
   * Get all dependencies (transitive) for a bug
   */
  getAllDependencies(bugId) {
    const visited = new Set();
    const queue = [bugId];

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const deps = this.graph.getDependencies(id);
      for (const depId of deps) {
        if (!visited.has(depId)) {
          queue.push(depId);
        }
      }
    }

    visited.delete(bugId); // Don't include the bug itself
    return visited;
  }

  /**
   * Progress callback
   */
  onProgress(progress) {
    this.ui.updateProgress(progress);

    // Update milestone statuses based on fetched bugs
    for (const milestone of MILESTONES) {
      const bug = this.bugs.get(String(milestone.bugId));
      if (bug) {
        const depCount = this.countDependencies(milestone.bugId);
        this.ui.updateMilestoneStatus(milestone.bugId, 'complete', depCount);
      }
    }
  }

  /**
   * Bug discovered callback
   */
  onBugDiscovered(bug) {
    this.ui.addRecentBug(bug);
  }

  /**
   * Count dependencies for a milestone
   */
  countDependencies(bugId) {
    const visited = new Set();
    const queue = [String(bugId)];

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const bug = this.bugs.get(id);
      if (bug && bug.dependsOn) {
        for (const depId of bug.dependsOn) {
          if (!visited.has(String(depId))) {
            queue.push(String(depId));
          }
        }
      }
    }

    return visited.size - 1; // Exclude the milestone itself
  }

  /**
   * View mode change handler
   */
  onViewModeChange(mode) {
    this.gantt.setViewMode(mode);
  }

  /**
   * Milestone filter handler
   */
  onMilestoneFilter(bugId) {
    console.log('Milestone filter changed to:', bugId || 'all');
    this.milestoneFilter = bugId;
    if (this.sortedBugs.length > 0) {
      this.rescheduleWithFilter();
    }
  }

  /**
   * Severity filter handler
   */
  onSeverityFilter(severity) {
    console.log('Severity filter changed to:', severity || 'all');
    this.severityFilter = severity;
    if (this.sortedBugs.length > 0) {
      this.rescheduleWithFilter();
    }
  }

  /**
   * Filter out resolved/fixed bugs
   */
  filterResolvedBugs(bugs) {
    const resolvedStatuses = ['RESOLVED', 'VERIFIED', 'CLOSED'];
    return bugs.filter(bug => {
      // Always include milestone bugs (they represent the milestone itself)
      if (MILESTONES.some(m => String(m.bugId) === String(bug.id))) return true;
      // Exclude resolved bugs
      return !resolvedStatuses.includes(bug.status);
    });
  }

  /**
   * Filter bugs by component (only Client component)
   */
  filterBugsByComponent(bugs) {
    return bugs.filter(bug => {
      // Always include milestone bugs
      if (MILESTONES.some(m => String(m.bugId) === String(bug.id))) return true;
      // Only include bugs from the Client component
      return bug.component === 'Client';
    });
  }

  /**
   * Filter bugs by severity
   */
  filterBugsBySeverity(bugs) {
    if (!this.severityFilter) return bugs;

    // Special case: S1+S2+untriaged
    if (this.severityFilter === 'S2+untriaged') {
      return bugs.filter(bug => {
        if (MILESTONES.some(m => String(m.bugId) === String(bug.id))) return true;
        const sev = bug.severity || 'N/A';
        return sev === 'S1' || sev === 'S2' || sev === 'N/A' || sev === '--';
      });
    }

    const severityOrder = ['S1', 'S2', 'S3', 'S4'];
    const maxIdx = severityOrder.indexOf(this.severityFilter);
    if (maxIdx === -1) return bugs;
    const included = severityOrder.slice(0, maxIdx + 1);
    return bugs.filter(bug => {
      if (MILESTONES.some(m => String(m.bugId) === String(bug.id))) return true;
      return included.includes(bug.severity || 'N/A');
    });
  }

  /**
   * Filter bugs by milestone
   */
  filterBugsByMilestone(bugs) {
    if (!this.milestoneFilter) return bugs;
    const deps = this.getAllDependencies(this.milestoneFilter);
    deps.add(this.milestoneFilter);
    return bugs.filter(bug => deps.has(String(bug.id)));
  }

  /**
   * Get active milestones based on filter
   */
  getActiveMilestones() {
    if (!this.milestoneFilter) return MILESTONES;
    return MILESTONES.filter(m => String(m.bugId) === this.milestoneFilter);
  }

  /**
   * Re-schedule with current filters
   */
  rescheduleWithFilter() {
    this.stopOptimalScheduler();
    let filteredBugs = this.filterResolvedBugs(this.sortedBugs);
    filteredBugs = this.filterBugsByComponent(filteredBugs);
    filteredBugs = this.filterBugsBySeverity(filteredBugs);
    filteredBugs = this.filterBugsByMilestone(filteredBugs);
    const activeMilestones = this.getActiveMilestones();
    console.log(`Re-scheduling: ${filteredBugs.length} bugs (excluding resolved, Client only), ${activeMilestones.length} milestones`);

    this.scheduler = new Scheduler(this.engineers, activeMilestones);
    const schedule = this.scheduler.scheduleTasks(filteredBugs, this.graph);
    this.greedySchedule = schedule;
    const errors = this.detectErrors();
    const risks = this.scheduler.checkDeadlineRisks(activeMilestones);
    this.renderResults(schedule, errors, risks, activeMilestones);
    if (filteredBugs.length > 0) {
      this.startOptimalScheduler(filteredBugs, activeMilestones);
    }
  }

  /**
   * Refresh data from Bugzilla
   */
  async refresh() {
    console.log('Refreshing data...');

    // Stop any running optimizer
    this.stopOptimalScheduler();

    this.api.clearCache();
    this.ui.showLoading();

    // Reset milestone status
    for (const milestone of MILESTONES) {
      this.ui.updateMilestoneStatus(milestone.bugId, 'pending', 0);
    }

    await this.fetchAndProcess();
  }

  /**
   * Start the optimal scheduler web worker
   */
  startOptimalScheduler(sortedBugs, milestones = MILESTONES) {
    // Stop any existing worker
    this.stopOptimalScheduler();

    // Calculate greedy makespan for comparison
    const greedyMakespan = this.calculateMakespan(this.greedySchedule);
    const numMilestones = milestones.length;

    this.ui.updateOptimizationStatus('running', 'Starting optimization...');
    this.ui.clearOptimizationLog();

    try {
      this.optimalWorker = new Worker('./js/optimal-scheduler-worker.js');

      this.optimalWorker.onmessage = (e) => {
        const { type, ...data } = e.data;

        switch (type) {
          case 'log':
            // Add entry to optimization log
            this.ui.addOptimizationLogEntry(data.message, data.logType);
            break;

          case 'progress':
            const progressMsg = data.iteration !== undefined
              ? `Iter ${data.iteration.toLocaleString()}: ${data.bestDeadlines}/${numMilestones} deadlines, ${data.bestMakespan?.toFixed(0)} days`
              : `Explored ${data.explored.toLocaleString()} nodes: ${data.bestDeadlines}/${numMilestones} deadlines, ${data.bestMakespan?.toFixed(0)} days`;
            this.ui.updateOptimizationStatus('running', progressMsg);
            break;

          case 'improved':
            console.log('Optimal scheduler found improvement:', data);
            this.ui.updateOptimizationStatus('running',
              `${data.deadlinesMet}/${numMilestones} deadlines, ${data.makespan.toFixed(0)} days`);
            break;

          case 'complete':
            if (data.improved && data.schedule) {
              // Convert serialized dates back to Date objects
              this.optimalSchedule = data.schedule.map(task => ({
                ...task,
                startDate: task.startDate ? new Date(task.startDate) : null,
                endDate: task.endDate ? new Date(task.endDate) : null
              }));
              this.ui.updateOptimizationStatus('complete',
                `Final: ${data.deadlinesMet}/${numMilestones} deadlines, ${data.makespan.toFixed(0)} days`);
              this.ui.enableScheduleToggle(true);
            } else {
              this.ui.updateOptimizationStatus('complete', 'Greedy schedule is optimal');
            }
            break;
        }
      };

      this.optimalWorker.onerror = (error) => {
        console.error('Optimal scheduler error:', error);
        this.ui.updateOptimizationStatus('error', 'Optimization failed');
      };

      // Build graph edges for worker - use ALL bugs to capture full dependency chains
      // (not just filtered bugs, as dependencies may chain through non-Client bugs)
      const graphEdges = {};
      for (const [bugId, bug] of this.bugs) {
        graphEdges[bugId] = bug.dependsOn || [];
      }

      // Start optimization with milestones
      this.optimalWorker.postMessage({
        type: 'start',
        data: {
          bugs: sortedBugs,
          engineers: this.engineers,
          graph: graphEdges,
          milestones: milestones.map(m => ({
            name: m.name,
            bugId: m.bugId,
            deadline: m.deadline.toISOString(),
            freezeDate: m.freezeDate.toISOString()
          }))
        }
      });

    } catch (error) {
      console.error('Failed to start optimal scheduler:', error);
      this.ui.updateOptimizationStatus('error', 'Worker not supported');
    }
  }

  /**
   * Stop the optimal scheduler worker
   */
  stopOptimalScheduler() {
    if (this.optimalWorker) {
      this.optimalWorker.terminate();
      this.optimalWorker = null;
    }
    this.optimalSchedule = null;
  }

  /**
   * Calculate makespan (project end date) from schedule
   */
  calculateMakespan(schedule) {
    if (!schedule || schedule.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let maxEnd = today;
    for (const task of schedule) {
      if (task.endDate && task.endDate > maxEnd) {
        maxEnd = task.endDate;
      }
    }

    // Return days from today
    return (maxEnd - today) / (1000 * 60 * 60 * 24);
  }

  /**
   * Handle schedule type change (greedy vs optimal)
   */
  onScheduleTypeChange(type) {
    this.currentScheduleType = type;

    const schedule = type === 'optimal' && this.optimalSchedule
      ? this.optimalSchedule
      : this.greedySchedule;

    if (schedule) {
      this.gantt.render(schedule, this.graph);

      // Update milestone cards with new completion dates (respecting filter)
      const milestoneCompletions = this.calculateMilestoneCompletions(schedule);
      this.ui.renderMilestoneCards(this.getActiveMilestones(), milestoneCompletions);

      console.log(`Switched to ${type} schedule`);
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, starting Enterprise Planner...');
  const app = new EnterprisePlanner();
  app.init().catch(error => {
    console.error('Application initialization failed:', error);
    // Show error in UI (use global error container which is visible during loading)
    const globalErrors = document.getElementById('global-errors');
    if (globalErrors) {
      globalErrors.innerHTML = `
        <strong>Initialization Error:</strong> ${error.message}<br>
        <small>Check browser console for details (F12)</small>
      `;
      globalErrors.style.display = 'block';
    }
  });
});

export default EnterprisePlanner;
