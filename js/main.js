/**
 * Enterprise Project Planner - Main Application
 * Coordinates all modules and handles application lifecycle
 */

import { BugzillaAPI } from './bugzilla-api.js';
import { DependencyGraph } from './dependency-graph.js';
import { Scheduler } from './scheduler.js';
import { GanttRenderer, MILESTONES } from './gantt-renderer.js';
import { UIController } from './ui-controller.js';
import {
  calculateWorkingDaysMakespan,
  computeScoreFromCompletions,
  isBetterScore
} from './optimizer-utils.js';

class EnterprisePlanner {
  constructor() {
    this.api = new BugzillaAPI();
    this.graph = new DependencyGraph();
    this.scheduler = null;
    this.gantt = new GanttRenderer('gantt-chart');
    this.ui = new UIController();

    this.engineers = [];
    this.bugs = new Map();

    // Optimal scheduler (parallel workers)
    this.optimalWorkers = [];
    this.workerResults = [];
    this.greedySchedule = null;
    this.optimalSchedule = null;
    this.displaySchedule = null;
    this.currentScheduleType = 'greedy';
    this.fullScheduleErrors = [];
    this.fullScheduleRisks = [];
    this.greedyScore = null;
    this.exhaustiveEndTime = null;
    this.exhaustiveBestScore = null;
    this.exhaustiveBestSchedule = null;
    this.exhaustiveWorkerStates = new Map();
    this.exhaustiveStartTime = null;

    // Parallel SA configuration
    const availableCores = navigator.hardwareConcurrency || 4;
    this.numWorkers = Math.min(Math.max(availableCores - 1, 1), 12);
    this.iterationsPerWorker = 10000; // Max iterations per worker

    // Filters
    this.severityFilter = 'S2';
    this.milestoneFilter = '';
    this.sortedBugs = [];
    this.lastFilteredBugs = [];
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

      // Apply filters (severity affects scheduling, milestone is view-only)
      let filteredBugs = this.filterResolvedBugs(this.sortedBugs);
      filteredBugs = this.filterBugsByComponent(filteredBugs);
      filteredBugs = this.filterBugsBySeverity(filteredBugs);
      this.lastFilteredBugs = filteredBugs;
      console.log(`Sorted ${this.sortedBugs.length} bugs, ${filteredBugs.length} after filters (excluding resolved, Client only)`);

      // Schedule tasks for all milestones
      console.log('Scheduling tasks...');
      this.scheduler = new Scheduler(this.engineers, MILESTONES);
      const schedule = this.scheduler.scheduleTasks(filteredBugs, this.graph);
      console.log(`Scheduled ${schedule.length} tasks`);

      // Store full schedule and risks
      this.greedySchedule = schedule;
      this.greedyScore = this.computeScheduleScore(schedule, MILESTONES);
      const unknownAssignees = this.collectUnknownAssignees();
      this.fullScheduleErrors = { ...errors, unknownAssignees };
      this.fullScheduleRisks = this.scheduler.checkDeadlineRisks(MILESTONES);

      // Render UI with milestone filter applied to view
      this.ui.showLoaded();
      this.rerenderWithMilestoneFilter();

      // Start optimal scheduler in background (for all milestones)
      this.startOptimalScheduler(filteredBugs, MILESTONES);

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
    const milestoneMismatches = this.findMilestoneMismatches();

    // Only include untriaged bugs if that filter is enabled
    const untriaged = this.severityFilter === 'S2+untriaged'
      ? this.graph.findUntriagedBugs()
      : [];

    return {
      cycles,
      orphaned,
      duplicates,
      missingAssignees,
      missingSizes,
      milestoneMismatches,
      untriaged
    };
  }

  /**
   * Find bugs where the Bugzilla target_milestone doesn't match
   * the milestone determined by dependency relationships
   */
  findMilestoneMismatches() {
    const mismatches = [];

    // Map target_milestone values to our milestone names
    // Adjust this mapping based on actual Bugzilla values
    const milestoneNameMap = {
      'foxfooding': 'Foxfooding',
      'customer pilot': 'Customer Pilot',
      'customerpilot': 'Customer Pilot',
      'mvp': 'MVP',
      '---': null  // Not set
    };

    // Build a map of bug ID -> dependency milestone (same logic as scheduler)
    const bugToDependencyMilestone = new Map();
    const sortedMilestones = [...MILESTONES].sort((a, b) =>
      a.deadline.getTime() - b.deadline.getTime()
    );

    for (const [bugId, bug] of this.bugs) {
      for (const milestone of sortedMilestones) {
        const milestoneId = String(milestone.bugId);
        if (bugId === milestoneId || this.isDependencyOf(bugId, milestoneId)) {
          bugToDependencyMilestone.set(bugId, milestone);
          break;
        }
      }
    }

    // Check each bug for mismatches
    for (const [bugId, bug] of this.bugs) {
      if (!bug.targetMilestone || bug.targetMilestone === '---') continue;

      const normalizedTarget = bug.targetMilestone.toLowerCase().trim();
      const mappedMilestone = milestoneNameMap[normalizedTarget];

      // Skip if we don't recognize the milestone value
      if (mappedMilestone === undefined) continue;

      const depMilestone = bugToDependencyMilestone.get(bugId);

      // Mismatch if: has a target milestone set, but connected to a different one
      if (mappedMilestone && depMilestone && depMilestone.name !== mappedMilestone) {
        mismatches.push({
          bug,
          targetMilestone: mappedMilestone,
          dependencyMilestone: depMilestone.name
        });
      }
      // Also flag if: has a target milestone set, but not connected to any milestone
      else if (mappedMilestone && !depMilestone) {
        mismatches.push({
          bug,
          targetMilestone: mappedMilestone,
          dependencyMilestone: null
        });
      }
    }

    return mismatches;
  }

  /**
   * Check if bugId is a (transitive) dependency of targetId
   */
  isDependencyOf(bugId, targetId) {
    const visited = new Set();
    const queue = [targetId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const bug = this.bugs.get(current);
      if (!bug) continue;

      for (const depId of bug.dependsOn || []) {
        if (String(depId) === String(bugId)) return true;
        if (!visited.has(String(depId))) {
          queue.push(String(depId));
        }
      }
    }
    return false;
  }

  /**
   * Render all results
   */
  renderResults(schedule, errors, risks, activeMilestones = MILESTONES) {
    // Render Gantt chart
    this.gantt.render(schedule, this.graph, this.engineers);

    // Render milestone cards with estimated completions (only active milestones)
    const milestoneCompletions = this.calculateMilestoneCompletions(schedule);
    this.ui.renderMilestoneCards(activeMilestones, milestoneCompletions);

    // Render statistics - compute from all bugs, not just filtered
    const stats = this.computeStats();
    this.ui.renderStats(stats);

    // Render tables
    const estimatedBugs = schedule
      .filter(t => t.effort && t.effort.sizeEstimated)
      .map(t => t.bug);
    this.ui.renderEstimatedTable(estimatedBugs);
    this.ui.renderRisksTable(risks);
    this.ui.renderMilestoneMismatchesTable(errors.milestoneMismatches);
    this.ui.renderUntriagedTable(errors.untriaged);

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
   * Milestone filter handler - only changes the view, doesn't recompute schedule
   */
  onMilestoneFilter(bugId) {
    console.log('Milestone filter changed to:', bugId || 'all');
    this.milestoneFilter = bugId;
    if (this.greedySchedule && this.greedySchedule.length > 0) {
      this.rerenderWithMilestoneFilter();
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
   * Compute stats from all bugs (not just filtered/scheduled)
   * Total and Completed include resolved bugs, Open is what's being scheduled
   */
  computeStats() {
    const resolvedStatuses = ['RESOLVED', 'VERIFIED', 'CLOSED'];

    // Get all bugs with component and severity filters (but NOT resolved filter)
    let allBugs = this.filterBugsByComponent(this.sortedBugs);
    allBugs = this.filterBugsBySeverity(allBugs);

    // Exclude milestone bugs from stats (they're tracking bugs, not work)
    const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
    allBugs = allBugs.filter(bug => !milestoneBugIds.has(String(bug.id)));

    // Split into completed vs open
    const completedBugs = allBugs.filter(bug => resolvedStatuses.includes(bug.status));
    const openBugs = allBugs.filter(bug => !resolvedStatuses.includes(bug.status));

    // Get estimated size bugs from the current schedule
    const schedule = (this.currentScheduleType === 'optimal' || this.currentScheduleType === 'exhaustive') && this.optimalSchedule
      ? this.optimalSchedule
      : this.greedySchedule;
    const estimatedBugs = schedule
      ? schedule.filter(t => t.effort && t.effort.sizeEstimated).map(t => t.bug)
      : [];

    // Get project end date from scheduler
    const schedulerStats = this.scheduler ? this.scheduler.getStats() : {};

    return {
      totalBugs: allBugs,
      completedBugs,
      openBugs,
      estimatedBugs,
      latestEnd: schedulerStats.latestEnd
    };
  }

  /**
   * Build optimizer engineer list, including external placeholders for unknown assignees.
   */
  buildOptimizerEngineers(bugs) {
    const baseEngineers = this.engineers.map(e => ({ ...e, isExternal: false }));
    const knownEmails = new Set(
      baseEngineers
        .map(e => e.email && e.email.toLowerCase())
        .filter(Boolean)
    );

    const externals = new Map();
    for (const bug of bugs || []) {
      if (!bug.assignee || bug.assignee === 'nobody@mozilla.org') continue;
      const email = bug.assignee.toLowerCase();
      if (knownEmails.has(email)) continue;
      if (!externals.has(email)) {
        externals.set(email, {
          id: `external:${email}`,
          name: 'External',
          email,
          availability: 1.0,
          unavailability: [],
          isExternal: true
        });
      }
    }

    return [...baseEngineers, ...externals.values()];
  }

  /**
   * Re-schedule with current severity filter (recomputes schedule)
   */
  rescheduleWithFilter() {
    this.stopOptimalScheduler();
    let filteredBugs = this.filterResolvedBugs(this.sortedBugs);
    filteredBugs = this.filterBugsByComponent(filteredBugs);
    filteredBugs = this.filterBugsBySeverity(filteredBugs);
    this.lastFilteredBugs = filteredBugs;
    // Note: milestone filter is view-only, doesn't affect scheduling
    console.log(`Re-scheduling: ${filteredBugs.length} bugs (excluding resolved, Client only)`);

    this.scheduler = new Scheduler(this.engineers, MILESTONES);
    const schedule = this.scheduler.scheduleTasks(filteredBugs, this.graph);
    this.greedySchedule = schedule;
    if (this.currentScheduleType === 'greedy' || !this.displaySchedule) {
      this.displaySchedule = this.greedySchedule;
    }
    this.greedyScore = this.computeScheduleScore(schedule, MILESTONES);
    const unknownAssignees = this.collectUnknownAssignees();
    this.fullScheduleErrors = { ...this.detectErrors(), unknownAssignees };
    this.fullScheduleRisks = this.scheduler.checkDeadlineRisks(MILESTONES);

    // Render with current milestone filter
    this.rerenderWithMilestoneFilter();

    if (filteredBugs.length > 0) {
      this.startOptimalScheduler(filteredBugs, MILESTONES);
    }
  }

  /**
   * Re-render with milestone filter (view-only, no recomputation)
   */
  rerenderWithMilestoneFilter() {
    const activeMilestones = this.getActiveMilestones();
    const filteredSchedule = this.filterScheduleByMilestone(this.greedySchedule);
    const filteredRisks = this.filterRisksByMilestone(this.fullScheduleRisks);

    this.renderResults(filteredSchedule, this.fullScheduleErrors, filteredRisks, activeMilestones);
  }

  /**
   * Collect unknown assignee warnings from the scheduler
   */
  collectUnknownAssignees() {
    if (!this.scheduler || !this.scheduler.warnings) return [];
    const unknowns = this.scheduler.warnings.filter(w => w.type === 'unknown_assignee');
    return unknowns.map(w => ({
      bug: w.bug,
      assignee: w.bug ? w.bug.assignee : null
    }));
  }

  /**
   * Filter schedule to show only tasks for selected milestone
   */
  filterScheduleByMilestone(schedule) {
    if (!this.milestoneFilter || !schedule) return schedule;
    const deps = this.getAllDependencies(this.milestoneFilter);
    deps.add(this.milestoneFilter);
    return schedule.filter(task => deps.has(String(task.bug.id)));
  }

  /**
   * Filter risks to show only those for selected milestone
   */
  filterRisksByMilestone(risks) {
    if (!this.milestoneFilter || !risks) return risks;
    return risks.filter(risk =>
      String(risk.milestone.bugId) === this.milestoneFilter
    );
  }

  /**
   * Compute schedule score using worker-compatible rules.
   */
  computeScheduleScore(schedule, milestones = MILESTONES) {
    if (!schedule || schedule.length === 0) {
      return { deadlinesMet: 0, totalLateness: Number.POSITIVE_INFINITY, makespan: Number.POSITIVE_INFINITY };
    }

    const completions = this.calculateMilestoneCompletions(schedule);
    let deadlinesMet = 0;
    let totalLateness = 0;

    for (const milestone of milestones) {
      const endDate = completions.get(String(milestone.bugId));
      if (!endDate) continue;
      if (endDate <= milestone.freezeDate) {
        deadlinesMet++;
      } else {
        const daysLate = Math.ceil((endDate - milestone.freezeDate) / (1000 * 60 * 60 * 24));
        totalLateness += daysLate;
      }
    }

    const makespan = calculateWorkingDaysMakespan(schedule);
    return computeScoreFromCompletions(completions, milestones, makespan);
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
   * Start the optimal scheduler with parallel workers
   */
  startOptimalScheduler(sortedBugs, milestones = MILESTONES, options = {}) {
    // Stop any existing workers
    this.stopOptimalScheduler({
      preserveExhaustive: options.preserveExhaustive,
      preserveOptimal: options.preserveOptimal
    });

    const numMilestones = milestones.length;
    const totalIterations = this.numWorkers * this.iterationsPerWorker;
    const mode = options.mode || 'optimal';
    this.optimizerMode = mode;

    const exhaustiveSplit = mode === 'exhaustive'
      ? Math.max(1, Math.round(this.numWorkers * 0.75))
      : 0;

    const isExhaustiveResume = mode === 'exhaustive' && options.preserveExhaustive && this.exhaustiveStartTime;
    if (!isExhaustiveResume) {
      this.ui.updateOptimizationStatus('running', `Starting ${this.numWorkers} parallel workers...`);
      this.ui.clearOptimizationLog();
      this.ui.addOptimizationLogEntry(
        `Using ${this.numWorkers} CPU cores, ${this.iterationsPerWorker.toLocaleString()} iterations each (${totalIterations.toLocaleString()} total)`,
        'status'
      );
    }

    this.optimizationStartTime = performance.now();
    if (!isExhaustiveResume) {
      this.bestLoggedScore = null;
      this.bestLoggedMilestones = new Set();
    }
    this.lastProgressUpdate = 0;

    // Build graph edges for workers
    const graphEdges = {};
    for (const [bugId, bug] of this.bugs) {
      graphEdges[bugId] = bug.dependsOn || [];
    }

    const workerEngineers = this.buildOptimizerEngineers(sortedBugs);
    const workerData = {
      bugs: sortedBugs,
      engineers: workerEngineers,
      graph: graphEdges,
      iterations: this.iterationsPerWorker,
      milestones: milestones.map(m => ({
        name: m.name,
        bugId: m.bugId,
        deadline: m.deadline.toISOString(),
        freezeDate: m.freezeDate.toISOString()
      }))
    };

    this.workerResults = [];
    let completedWorkers = 0;
    let globalBest = mode === 'exhaustive' && this.exhaustiveBestScore
      ? { ...this.exhaustiveBestScore }
      : { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };

    try {
      for (let i = 0; i < this.numWorkers; i++) {
        const worker = new Worker('./js/optimal-scheduler-worker.js', { type: 'module' });
        if (mode === 'exhaustive' && !this.exhaustiveWorkerStates.has(i)) {
          const strategy = i < exhaustiveSplit ? 'continuous' : 'reheat';
          this.exhaustiveWorkerStates.set(i, { strategy, lastAssignment: null, lastTemperature: null });
        }

        worker.onmessage = (e) => {
          const { type, workerId, ...data } = e.data;

          switch (type) {
            case 'log':
              // Don't forward individual worker logs to UI
              console.log(`[Worker ${workerId}]`, data.message);
              break;

            case 'progress':
              {
                const now = performance.now();
                if (now - this.lastProgressUpdate >= 10000) {
                  const elapsedSec = (now - this.optimizationStartTime) / 1000;
                  const totalIterationsNow = this.numWorkers * this.iterationsPerWorker;
                  const itersPerSec = Math.round(totalIterationsNow / Math.max(elapsedSec, 0.1));
                  const itersPerSecText = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(itersPerSec);

                  if (this.optimizerMode === 'exhaustive') {
                    const wallNow = Date.now();
                    const remainingSec = this.exhaustiveEndTime
                      ? Math.max(0, Math.ceil((this.exhaustiveEndTime - wallNow) / 1000))
                      : null;
                    const remainingText = remainingSec !== null
                      ? `${remainingSec}s remaining`
                      : `${elapsedSec.toFixed(0)}s elapsed`;
                    this.ui.updateOptimizationStatus(
                      'running',
                      `${remainingText} | ${this.numWorkers} workers | ${itersPerSecText} iter/sec`
                    );
                  } else {
                    this.ui.updateOptimizationStatus(
                      'running',
                      `${completedWorkers}/${this.numWorkers} done | ${itersPerSecText} iter/sec`
                    );
                  }

                  this.lastProgressUpdate = now;
                }
              }
              break;

            case 'improved': {
              const totalLateness = Array.isArray(data.deadlineDetails)
                ? data.deadlineDetails.reduce((sum, detail) => sum + (detail.daysLate || 0), 0)
                : Number.POSITIVE_INFINITY;
              const candidateScore = {
                deadlinesMet: data.deadlinesMet,
                totalLateness,
                makespan: data.makespan
              };

              const previousBest = { ...globalBest };
              const isNewGlobalBest = isBetterScore(candidateScore, globalBest);
              if (isNewGlobalBest) {
                globalBest = candidateScore;
              }

              const beatsGreedy = this.greedyScore && isBetterScore(candidateScore, this.greedyScore);
              const allowLogging = beatsGreedy;

              if (isNewGlobalBest && allowLogging) {
                const loggedBest = this.bestLoggedScore;
                const isNewDeadline = candidateScore.deadlinesMet > (loggedBest?.deadlinesMet ?? -1);
                const sameDeadlines = loggedBest
                  ? candidateScore.deadlinesMet === loggedBest.deadlinesMet
                  : true;
                const isLatenessBetter = loggedBest
                  ? candidateScore.totalLateness < loggedBest.totalLateness
                  : true;
                const isLatenessSame = loggedBest
                  ? candidateScore.totalLateness === loggedBest.totalLateness
                  : true;
                const isMakespanBetter = loggedBest
                  ? candidateScore.makespan < loggedBest.makespan
                  : true;

                if (isNewDeadline || (sameDeadlines && (isLatenessBetter || (isLatenessSame && isMakespanBetter)))) {
                  const metNames = data.deadlineDetails
                    ?.filter(d => d.met)
                    .map(d => d.name)
                    .filter(Boolean) || [];
                  const hasNewMilestone = metNames.some(name => !this.bestLoggedMilestones.has(name));
                  const isDeadlineAnnouncement = isNewDeadline && hasNewMilestone;
                  const logType = isDeadlineAnnouncement ? 'deadline' : 'improvement';
                  const workerLabel = (() => {
                    if (mode !== 'exhaustive') return `Worker ${workerId}`;
                    const state = this.exhaustiveWorkerStates.get(workerId);
                    const strategy = state?.strategy === 'reheat' ? 'reheat' : 'continuous';
                    return `Worker ${workerId} (${strategy})`;
                  })();
                  let message;
                  if (isDeadlineAnnouncement) {
                    const metNamesText = metNames.join(', ');
                    message = `${workerLabel}: NEW DEADLINE MET! Now ${data.deadlinesMet}/${numMilestones} (${metNamesText}). Makespan: ${data.makespan.toFixed(0)} days`;
                  } else if (isLatenessBetter && !isMakespanBetter) {
                    const previousLateness = Number.isFinite(loggedBest?.totalLateness)
                      ? loggedBest.totalLateness.toFixed(0)
                      : '?';
                    message = `${workerLabel}: Improved lateness: ${candidateScore.totalLateness.toFixed(0)} days late (was ${previousLateness}). Makespan: ${data.makespan.toFixed(0)} days. Deadlines: ${data.deadlinesMet}/${numMilestones}`;
                  } else {
                    message = `${workerLabel}: Improved makespan: ${data.makespan.toFixed(0)} days (lateness ${candidateScore.totalLateness.toFixed(0)}). Deadlines: ${data.deadlinesMet}/${numMilestones}`;
                  }
                  this.ui.addOptimizationLogEntry(message, logType);
                  this.bestLoggedScore = candidateScore;
                  if (isNewDeadline) {
                    for (const name of metNames) {
                      this.bestLoggedMilestones.add(name);
                    }
                  }
                }

                // Update milestone cards with current best estimates
                if (data.deadlineDetails) {
                  const completions = new Map();
                  for (const detail of data.deadlineDetails) {
                    const milestone = milestones.find(m => m.name === detail.name);
                    if (milestone && detail.endDate) {
                      completions.set(String(milestone.bugId), new Date(detail.endDate));
                    }
                  }
                  this.ui.renderMilestoneCards(this.getActiveMilestones(), completions);
                }
              }
              break;
            }

            case 'complete':
              completedWorkers++;
              if (data.improved && data.schedule) {
                const totalLateness = Number.isFinite(data.totalLateness)
                  ? data.totalLateness
                  : Number.POSITIVE_INFINITY;
                if (!Number.isFinite(data.totalLateness)) {
                  console.warn(`Worker ${workerId} missing totalLateness; treating as Infinity.`);
                }

                this.workerResults.push({
                  workerId,
                  schedule: data.schedule,
                  deadlinesMet: data.deadlinesMet,
                  totalLateness,
                  makespan: data.makespan,
                  bestFoundAtIteration: data.bestFoundAtIteration || 0,
                  totalIterations: data.iterations || this.iterationsPerWorker
                });
              }

              if (mode === 'exhaustive') {
                const state = this.exhaustiveWorkerStates.get(workerId);
                if (state) {
                  state.lastAssignment = Array.isArray(data.bestAssignment) ? data.bestAssignment : state.lastAssignment;
                  state.lastTemperature = Number.isFinite(data.finalTemperature) ? data.finalTemperature : state.lastTemperature;
                }
              }

              this.ui.updateOptimizationStatus('running',
                `${completedWorkers}/${this.numWorkers} workers complete...`);

              // All workers done - pick best result
              if (completedWorkers === this.numWorkers) {
                this.finalizeOptimalSchedule(numMilestones);
              }
              break;
          }
        };

        worker.onerror = (error) => {
          console.error(`Worker ${i} error:`, error);
          completedWorkers++;
          if (completedWorkers === this.numWorkers) {
            this.finalizeOptimalSchedule(numMilestones);
          }
        };

        this.optimalWorkers.push(worker);

        // Start worker with its ID
        const startData = { ...workerData, id: i };
        if (mode === 'exhaustive') {
          const state = this.exhaustiveWorkerStates.get(i);
          if (state?.lastAssignment) {
            startData.startAssignment = state.lastAssignment;
          }
          if (state?.strategy === 'continuous' && Number.isFinite(state?.lastTemperature)) {
            startData.startTemperature = state.lastTemperature;
          }
          if (state?.strategy === 'reheat') {
            startData.reheat = true;
          }
        }

        worker.postMessage({
          type: 'start',
          data: startData
        });
      }

    } catch (error) {
      console.error('Failed to start optimal scheduler:', error);
      this.ui.updateOptimizationStatus('error', 'Workers not supported');
    }
  }

  /**
   * Pick the best result from all workers
   */
  finalizeOptimalSchedule(numMilestones) {
    const elapsedMs = performance.now() - this.optimizationStartTime;
    const elapsedSec = elapsedMs / 1000;
    const totalIterations = this.numWorkers * this.iterationsPerWorker;
    const itersPerSec = Math.round(totalIterations / elapsedSec);

    if (this.workerResults.length === 0) {
      this.ui.updateOptimizationStatus('complete', 'Greedy schedule is optimal');
      this.ui.addOptimizationLogEntry(
        `Completed in ${elapsedSec.toFixed(1)}s (${itersPerSec.toLocaleString()} iter/sec)`,
        'status'
      );
      return;
    }

    // Sort by deadlines met (desc), then lateness (asc), then makespan (asc)
    // This matches the worker's scoring: deadlines >> lateness >> makespan
    this.workerResults.sort((a, b) => {
      if (b.deadlinesMet !== a.deadlinesMet) return b.deadlinesMet - a.deadlinesMet;
      const aLateness = Number.isFinite(a.totalLateness) ? a.totalLateness : Number.POSITIVE_INFINITY;
      const bLateness = Number.isFinite(b.totalLateness) ? b.totalLateness : Number.POSITIVE_INFINITY;
      if (aLateness !== bLateness) return aLateness - bLateness;
      return a.makespan - b.makespan;
    });

    const best = this.workerResults[0];
    const bestScore = {
      deadlinesMet: best.deadlinesMet,
      totalLateness: best.totalLateness,
      makespan: best.makespan
    };
    const beatsGreedy = this.greedyScore && isBetterScore(bestScore, this.greedyScore);
    const convergencePct = best.totalIterations > 0
      ? ((best.bestFoundAtIteration / best.totalIterations) * 100).toFixed(0)
      : 0;
    console.log(`Best result from worker ${best.workerId}: ${best.deadlinesMet}/${numMilestones} deadlines, ${best.makespan} days (found at iteration ${best.bestFoundAtIteration}/${best.totalIterations}, ${convergencePct}%)`);

    if (this.optimizerMode === 'exhaustive') {
      if (!this.exhaustiveBestScore || isBetterScore(bestScore, this.exhaustiveBestScore)) {
        this.exhaustiveBestScore = bestScore;
        this.exhaustiveBestSchedule = best.schedule;
      }

      const now = Date.now();
      if (!this.exhaustiveStartTime) {
        this.exhaustiveStartTime = now;
      }
      const timeRemaining = this.exhaustiveEndTime ? this.exhaustiveEndTime - now : 0;
      if (bestScore.deadlinesMet < numMilestones && timeRemaining > 0) {
        this.ui.updateOptimizationStatus(
          'running',
          `Exhaustive running... ${Math.ceil(timeRemaining / 1000)}s remaining`
        );
        this.startOptimalScheduler(this.lastFilteredBugs, MILESTONES, { mode: 'exhaustive', preserveExhaustive: true });
        return;
      }

      if (!beatsGreedy) {
        this.optimalSchedule = null;
        this.ui.addOptimizationLogEntry(
          'Exhaustive search did not beat greedy. Keeping greedy schedule.',
          'status'
        );
        this.ui.updateOptimizationStatus('complete', 'Greedy schedule is optimal');
        this.ui.enableScheduleToggle(false);
        return;
      }

      const bestExhaustive = this.exhaustiveBestScore || bestScore;
      const bestSchedule = this.exhaustiveBestSchedule || best.schedule;
      this.optimalSchedule = bestSchedule.map(task => ({
        ...task,
        startDate: task.startDate ? new Date(task.startDate) : null,
        endDate: task.endDate ? new Date(task.endDate) : null
      }));
      if (this.currentScheduleType === 'optimal' || this.currentScheduleType === 'exhaustive') {
        this.displaySchedule = this.optimalSchedule;
      }

      const exhaustiveElapsedSec = this.exhaustiveStartTime
        ? (Date.now() - this.exhaustiveStartTime) / 1000
        : elapsedSec;
      this.ui.addOptimizationLogEntry(
        `Exhaustive completed in ${exhaustiveElapsedSec.toFixed(1)}s.`,
        'status'
      );
      this.ui.updateOptimizationStatus(
        'complete',
        `Exhaustive best: ${bestExhaustive.deadlinesMet}/${numMilestones} deadlines`
      );
      this.ui.enableScheduleToggle(true);

      if (this.currentScheduleType === 'exhaustive') {
        this.switchToOptimalSchedule();
      }
      return;
    }

    if (!beatsGreedy) {
      this.optimalSchedule = null;
      this.ui.addOptimizationLogEntry(
        'Optimal schedule did not beat greedy. Keeping greedy schedule.',
        'status'
      );
      this.ui.updateOptimizationStatus('complete', 'Greedy schedule is optimal');
      this.ui.enableScheduleToggle(false);
      return;
    }

    // Convert serialized dates back to Date objects
    this.optimalSchedule = best.schedule.map(task => ({
      ...task,
      startDate: task.startDate ? new Date(task.startDate) : null,
      endDate: task.endDate ? new Date(task.endDate) : null
    }));
    if (this.currentScheduleType === 'optimal' || this.currentScheduleType === 'exhaustive') {
      this.displaySchedule = this.optimalSchedule;
    }

    this.ui.addOptimizationLogEntry(
      `Completed in ${elapsedSec.toFixed(1)}s. Best found at ${convergencePct}% of iterations.`,
      'status'
    );
    this.ui.updateOptimizationStatus('complete',
      `Best of ${this.numWorkers}: ${best.deadlinesMet}/${numMilestones} deadlines, ${best.makespan.toFixed(0)} days`);
    this.ui.enableScheduleToggle(true);

    // Auto-switch to optimal schedule (but not if user is interacting with popup)
    this.switchToOptimalSchedule();
  }

  /**
   * Switch to optimal schedule, deferring if popup is active
   */
  switchToOptimalSchedule() {
    if (this.gantt.isPopupActive()) {
      // Defer switch until popup interaction is done
      setTimeout(() => this.switchToOptimalSchedule(), 500);
      return;
    }
    this.onScheduleTypeChange('optimal');
  }

  /**
   * Stop all optimal scheduler workers
   */
  stopOptimalScheduler(options = {}) {
    for (const worker of this.optimalWorkers) {
      worker.terminate();
    }
    this.optimalWorkers = [];
    this.workerResults = [];
    if (!options.preserveOptimal) {
      this.optimalSchedule = null;
    }
    this.optimizerMode = 'optimal';
    if (!options.preserveExhaustive) {
      this.exhaustiveEndTime = null;
      this.exhaustiveBestScore = null;
      this.exhaustiveBestSchedule = null;
      this.exhaustiveWorkerStates = new Map();
      this.exhaustiveStartTime = null;
    }
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
    this.ui.setScheduleType(type);

    let fullSchedule;
    if (type === 'greedy') {
      fullSchedule = this.greedySchedule;
      if (fullSchedule) this.displaySchedule = fullSchedule;
    } else if (this.optimalSchedule) {
      fullSchedule = this.optimalSchedule;
      this.displaySchedule = fullSchedule;
    } else if (this.displaySchedule) {
      fullSchedule = this.displaySchedule;
    } else {
      fullSchedule = this.greedySchedule;
      if (fullSchedule) this.displaySchedule = fullSchedule;
    }

    if (fullSchedule) {
      // Apply milestone filter to view
      const schedule = this.filterScheduleByMilestone(fullSchedule);
      this.gantt.render(schedule, this.graph, this.engineers);

      // Update milestone cards with new completion dates (respecting filter)
      const milestoneCompletions = this.calculateMilestoneCompletions(fullSchedule);
      this.ui.renderMilestoneCards(this.getActiveMilestones(), milestoneCompletions);

      console.log(`Switched to ${type} schedule`);
    }

    if (type === 'exhaustive') {
      const filteredBugs = this.lastFilteredBugs.length > 0
        ? this.lastFilteredBugs
        : this.filterBugsBySeverity(this.filterBugsByComponent(this.filterResolvedBugs(this.sortedBugs)));

      this.exhaustiveEndTime = Date.now() + 60 * 1000;
      this.exhaustiveBestScore = this.greedyScore;
      this.exhaustiveBestSchedule = null;
      this.exhaustiveWorkerStates = new Map();
      this.exhaustiveStartTime = Date.now();
      this.startOptimalScheduler(filteredBugs, MILESTONES, {
        mode: 'exhaustive',
        preserveExhaustive: true,
        preserveOptimal: true
      });
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
