/**
 * Gantt Chart Renderer using Frappe Gantt
 * Color coding, milestone markers, and dependency visualization
 */

// Milestones from SPEC.md
const MILESTONES = [
  {
    name: 'Foxfooding',
    bugId: 1980342,
    deadline: new Date('2025-02-23'),
    freezeDate: new Date('2025-02-16')
  },
  {
    name: 'Customer Pilot',
    bugId: 2012055,
    deadline: new Date('2025-03-30'),
    freezeDate: new Date('2025-03-23')
  },
  {
    name: 'MVP',
    bugId: 1980739,
    deadline: new Date('2025-09-15'),
    freezeDate: new Date('2025-09-08')
  }
];

export class GanttRenderer {
  constructor(containerId) {
    this.containerId = containerId;
    this.gantt = null;
    this.tasks = [];
    this.viewMode = 'Week';
  }

  /**
   * Convert scheduled tasks to Frappe Gantt format
   * @param {Array<Object>} scheduledTasks - Tasks from scheduler
   * @param {DependencyGraph} graph - Dependency graph for relationships
   * @returns {Array<Object>} Frappe Gantt task format
   */
  convertToGanttTasks(scheduledTasks, graph) {
    this.tasks = [];

    for (const task of scheduledTasks) {
      if (task.completed) {
        // Include completed tasks with a marker
        this.tasks.push({
          id: String(task.bug.id),
          name: `#${task.bug.id}: ${this.truncate(task.bug.summary, 40)}`,
          start: this.formatDate(new Date()),
          end: this.formatDate(new Date()),
          progress: 100,
          custom_class: 'gantt-completed',
          dependencies: ''
        });
        continue;
      }

      if (!task.startDate || !task.endDate) continue;

      // Determine custom class based on task properties
      let customClass = 'gantt-normal';

      if (task.effort && task.effort.sizeEstimated) {
        customClass = 'gantt-estimated';
      }

      if (task.effort && task.effort.skillRank === 3) {
        customClass = 'gantt-skill-mismatch';
      }

      // Check if at risk for deadline
      const atRisk = this.isAtRisk(task);
      if (atRisk) {
        customClass = 'gantt-at-risk';
      }

      // Build dependencies string
      const deps = graph.getDependencies(String(task.bug.id));
      const validDeps = deps.filter(depId => {
        return scheduledTasks.some(t => String(t.bug.id) === depId && !t.completed);
      });

      this.tasks.push({
        id: String(task.bug.id),
        name: `#${task.bug.id}: ${this.truncate(task.bug.summary, 40)}`,
        start: this.formatDate(task.startDate),
        end: this.formatDate(task.endDate),
        progress: 0,
        custom_class: customClass,
        dependencies: validDeps.join(', '),
        // Store extra data for tooltips
        _engineer: task.engineer ? task.engineer.name : 'Unassigned',
        _effort: task.effort ? task.effort.days : 0,
        _size: task.bug.size,
        _sizeEstimated: task.effort ? task.effort.sizeEstimated : false,
        _language: task.bug.language,
        _skillRank: task.effort ? task.effort.skillRank : null
      });
    }

    return this.tasks;
  }

  /**
   * Check if task is at risk for any milestone
   */
  isAtRisk(task) {
    if (!task.endDate) return false;

    for (const milestone of MILESTONES) {
      if (task.endDate > milestone.freezeDate) {
        return true;
      }
    }
    return false;
  }

  /**
   * Render the Gantt chart
   * @param {Array<Object>} scheduledTasks - Tasks from scheduler
   * @param {DependencyGraph} graph - Dependency graph
   */
  render(scheduledTasks, graph) {
    const ganttTasks = this.convertToGanttTasks(scheduledTasks, graph);

    if (ganttTasks.length === 0) {
      document.getElementById(this.containerId).innerHTML =
        '<p class="no-tasks">No tasks to display</p>';
      return;
    }

    // Check if Frappe Gantt is loaded
    if (typeof Gantt === 'undefined') {
      console.error('Frappe Gantt library not loaded');
      document.getElementById(this.containerId).innerHTML =
        '<p class="error">Gantt library not loaded</p>';
      return;
    }

    this.gantt = new Gantt(`#${this.containerId}`, ganttTasks, {
      view_mode: this.viewMode,
      date_format: 'YYYY-MM-DD',
      popup_trigger: 'click',
      custom_popup_html: (task) => this.createPopup(task),
      on_click: (task) => this.onTaskClick(task),
      on_date_change: (task, start, end) => this.onDateChange(task, start, end),
      on_view_change: (mode) => this.onViewChange(mode)
    });

    // Add milestone markers
    this.addMilestoneMarkers();
  }

  /**
   * Create custom popup HTML for task
   */
  createPopup(task) {
    const engineer = task._engineer || 'Unassigned';
    const effort = task._effort || '?';
    const size = task._size || '?';
    const sizeNote = task._sizeEstimated ? ' (estimated)' : '';
    const language = task._language || 'Unknown';
    const skillInfo = task._skillRank ? this.getSkillInfo(task._skillRank) : '';

    return `
      <div class="gantt-popup">
        <h4>${task.name}</h4>
        <div class="popup-details">
          <p><strong>Engineer:</strong> ${engineer}</p>
          <p><strong>Effort:</strong> ${effort} days</p>
          <p><strong>Size:</strong> ${size}${sizeNote}</p>
          <p><strong>Language:</strong> ${language}</p>
          ${skillInfo ? `<p><strong>Skill Match:</strong> ${skillInfo}</p>` : ''}
          <p><strong>Start:</strong> ${task.start}</p>
          <p><strong>End:</strong> ${task.end}</p>
        </div>
        <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${task.id}"
           target="_blank" class="popup-link">View in Bugzilla</a>
      </div>
    `;
  }

  /**
   * Get skill match description
   */
  getSkillInfo(skillRank) {
    switch (skillRank) {
      case 1: return 'Primary skill';
      case 2: return 'Secondary skill (+25%)';
      case 3: return 'Tertiary skill (+50%)';
      default: return '';
    }
  }

  /**
   * Handle task click
   */
  onTaskClick(task) {
    console.log('Task clicked:', task.id);
  }

  /**
   * Handle date change (if editing enabled)
   */
  onDateChange(task, start, end) {
    console.log('Date changed:', task.id, start, end);
  }

  /**
   * Handle view mode change
   */
  onViewChange(mode) {
    this.viewMode = mode;
  }

  /**
   * Add milestone deadline markers to the chart
   */
  addMilestoneMarkers() {
    const svg = document.querySelector(`#${this.containerId} svg`);
    if (!svg) return;

    // Get the chart dimensions
    const chartGroup = svg.querySelector('.grid');
    if (!chartGroup) return;

    for (const milestone of MILESTONES) {
      // Add freeze date line (dashed)
      this.addDateLine(svg, milestone.freezeDate, 'milestone-freeze',
        `${milestone.name} Freeze`);

      // Add deadline line (solid)
      this.addDateLine(svg, milestone.deadline, 'milestone-deadline',
        `${milestone.name} Deadline`);
    }
  }

  /**
   * Add a vertical date line to the chart
   */
  addDateLine(svg, date, className, label) {
    // This is a simplified implementation
    // Full implementation would calculate exact x position based on date
    // For now, we rely on CSS styling of milestone markers
  }

  /**
   * Set view mode
   * @param {string} mode - 'Day', 'Week', 'Month', 'Quarter', 'Year'
   */
  setViewMode(mode) {
    this.viewMode = mode;
    if (this.gantt) {
      this.gantt.change_view_mode(mode);
    }
  }

  /**
   * Format date as YYYY-MM-DD
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Truncate string with ellipsis
   */
  truncate(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Get milestones info
   */
  getMilestones() {
    return MILESTONES;
  }

  /**
   * Destroy the Gantt chart
   */
  destroy() {
    if (this.gantt) {
      // Frappe Gantt doesn't have a destroy method, clear container
      document.getElementById(this.containerId).innerHTML = '';
      this.gantt = null;
    }
  }
}

export { MILESTONES };
export default GanttRenderer;
