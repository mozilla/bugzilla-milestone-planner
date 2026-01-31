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
    this.taskLanguages = {};
    this.sizeEstimates = {};
    this.bugs = new Map();

    // Optimal scheduler
    this.optimalWorker = null;
    this.greedySchedule = null;
    this.optimalSchedule = null;
    this.currentScheduleType = 'greedy';
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

      // Load task-language mappings
      const langRes = await fetch('./data/task-languages.json');
      const langData = await langRes.json();
      this.taskLanguages = langData.mappings || {};
      console.log(`Loaded ${Object.keys(this.taskLanguages).length} language mappings`);

      // Load size estimates
      const sizeRes = await fetch('./data/size-estimates.json');
      const sizeData = await sizeRes.json();
      this.sizeEstimates = sizeData.estimates || {};
      console.log(`Loaded ${Object.keys(this.sizeEstimates).length} size estimates`);

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

      // Get sorted bugs
      const sortedBugs = sorted.map(id => this.bugs.get(id)).filter(Boolean);
      console.log(`Sorted ${sortedBugs.length} bugs for scheduling`);

      // Schedule tasks
      console.log('Scheduling tasks...');
      this.scheduler = new Scheduler(this.engineers, MILESTONES);
      const schedule = this.scheduler.scheduleTasks(
        sortedBugs,
        this.graph,
        this.sizeEstimates,
        this.taskLanguages
      );
      console.log(`Scheduled ${schedule.length} tasks`);

      // Check deadline risks
      const risks = this.scheduler.checkDeadlineRisks(MILESTONES);

      // Store greedy schedule
      this.greedySchedule = schedule;

      // Render UI
      this.ui.showLoaded();
      this.renderResults(schedule, errors, risks);

      // Start optimal scheduler in background
      this.startOptimalScheduler(sortedBugs);

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
  renderResults(schedule, errors, risks) {
    // Render Gantt chart
    this.gantt.render(schedule, this.graph);

    // Render statistics
    const stats = this.scheduler.getStats();
    this.ui.renderStats(stats);

    // Render tables
    const estimatedBugs = schedule
      .filter(t => t.effort && t.effort.sizeEstimated)
      .map(t => t.bug);
    this.ui.renderEstimatedTable(estimatedBugs);

    this.ui.renderMismatchTable(this.scheduler.warnings);
    this.ui.renderRisksTable(risks);

    // Render errors markdown
    this.ui.renderErrorsMarkdown(errors);

    // Log summary
    console.log('Schedule stats:', stats);
    console.log('Errors:', errors);
    console.log('Risks:', risks.length);
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
    // TODO: Filter Gantt chart to show only tasks for selected milestone
    console.log('Filter by milestone:', bugId);
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
  startOptimalScheduler(sortedBugs) {
    // Stop any existing worker
    this.stopOptimalScheduler();

    // Calculate greedy makespan for comparison
    const greedyMakespan = this.calculateMakespan(this.greedySchedule);

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
              ? `Iter ${data.iteration.toLocaleString()}: ${data.bestDeadlines}/3 deadlines, ${data.bestMakespan?.toFixed(0)} days`
              : `Explored ${data.explored.toLocaleString()} nodes: ${data.bestDeadlines}/3 deadlines, ${data.bestMakespan?.toFixed(0)} days`;
            this.ui.updateOptimizationStatus('running', progressMsg);
            break;

          case 'improved':
            console.log('Optimal scheduler found improvement:', data);
            this.ui.updateOptimizationStatus('running',
              `${data.deadlinesMet}/3 deadlines, ${data.makespan.toFixed(0)} days`);
            break;

          case 'complete':
            if (data.improved && data.schedule) {
              this.optimalSchedule = data.schedule;
              this.ui.updateOptimizationStatus('complete',
                `Final: ${data.deadlinesMet}/3 deadlines, ${data.makespan.toFixed(0)} days`);
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

      // Build graph edges for worker
      const graphEdges = {};
      for (const bug of sortedBugs) {
        graphEdges[bug.id] = bug.dependsOn || [];
      }

      // Start optimization
      this.optimalWorker.postMessage({
        type: 'start',
        data: {
          bugs: sortedBugs,
          engineers: this.engineers,
          graph: graphEdges,
          sizeEstimates: this.sizeEstimates,
          taskLanguages: this.taskLanguages,
          greedyMakespan
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

      // Recalculate risks for the selected schedule
      // Note: would need to rebuild scheduler state for accurate risks
      console.log(`Switched to ${type} schedule`);
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new EnterprisePlanner();
  app.init().catch(error => {
    console.error('Application initialization failed:', error);
  });
});

export default EnterprisePlanner;
