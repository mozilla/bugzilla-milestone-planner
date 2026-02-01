/**
 * Gantt Chart Renderer using Frappe Gantt
 * Color coding, milestone markers, and dependency visualization
 */

// Milestones from SPEC.md
const MILESTONES = [
  {
    name: 'Foxfooding',
    bugId: 1980342,
    deadline: new Date('2026-02-23'),
    freezeDate: new Date('2026-02-16')
  },
  {
    name: 'Customer Pilot',
    bugId: 2012055,
    deadline: new Date('2026-03-30'),
    freezeDate: new Date('2026-03-23')
  },
  {
    name: 'MVP',
    bugId: 1980739,
    deadline: new Date('2026-09-15'),
    freezeDate: new Date('2026-09-08')
  }
];

export class GanttRenderer {
  constructor(containerId) {
    this.containerId = containerId;
    this.gantt = null;
    this.tasks = [];
    this.viewMode = 'Week';
    // Valid Frappe Gantt modes: 'Quarter Day', 'Half Day', 'Day', 'Week', 'Month', 'Year'
    this.viewModes = ['Day', 'Week', 'Month', 'Year'];
    this.zoomTimeout = null;
    this.earliestTaskDate = null;
    this.setupZoomHandler();
  }

  /**
   * Set up trackpad/mouse wheel zoom handler
   */
  setupZoomHandler() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Trackpad pinch zoom
    container.addEventListener('wheel', (e) => {
      // Detect pinch zoom (ctrlKey is set for trackpad pinch gestures)
      if (e.ctrlKey) {
        e.preventDefault();
        this.handleZoom(e.deltaY > 0 ? 'out' : 'in');
      }
    }, { passive: false });

    // Keyboard zoom (+/- keys) when hovering over chart
    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.handleZoom('in');
      } else if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.handleZoom('out');
      }
    });
  }

  /**
   * Handle zoom in/out
   */
  handleZoom(direction) {
    // Debounce zoom changes
    if (this.zoomTimeout) return;

    this.zoomTimeout = setTimeout(() => {
      this.zoomTimeout = null;
    }, 150);

    const currentIndex = this.viewModes.indexOf(this.viewMode);

    if (direction === 'in') {
      // Zoom in - more detail (Day)
      if (currentIndex > 0) {
        this.setViewMode(this.viewModes[currentIndex - 1]);
        this.updateViewModeSelect();
      }
    } else {
      // Zoom out - less detail (Quarter)
      if (currentIndex < this.viewModes.length - 1) {
        this.setViewMode(this.viewModes[currentIndex + 1]);
        this.updateViewModeSelect();
      }
    }
  }

  /**
   * Update the view mode dropdown to match current zoom level
   */
  updateViewModeSelect() {
    const select = document.getElementById('view-mode');
    if (select) {
      select.value = this.viewMode;
    }
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

    // Find the earliest start date for scrolling
    const startDates = ganttTasks
      .filter(t => t.progress < 100)
      .map(t => new Date(t.start))
      .filter(d => !isNaN(d));
    this.earliestTaskDate = startDates.length > 0
      ? new Date(Math.min(...startDates))
      : new Date();

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

    // Scroll to show the earliest task start date
    this.scrollToDate(this.earliestTaskDate);
  }

  /**
   * Scroll the Gantt chart to show a specific date
   */
  scrollToDate(date) {
    setTimeout(() => {
      const container = document.getElementById(this.containerId);
      if (!container) return;

      const svg = container.querySelector('svg');
      if (!svg) return;

      // Get the date columns to calculate position
      const dateTexts = svg.querySelectorAll('.lower-text');
      if (dateTexts.length === 0) return;

      // Find approximate column width based on view mode
      const columnWidths = {
        'Day': 38,
        'Week': 140,
        'Month': 120,
        'Year': 120
      };
      const columnWidth = columnWidths[this.viewMode] || 140;

      // Calculate days from gantt start to target date
      // Frappe Gantt adds ~1 month padding, so account for that
      const ganttStart = this.gantt.gantt_start;
      if (!ganttStart) return;

      const daysDiff = Math.floor((date - ganttStart) / (1000 * 60 * 60 * 24));

      // Calculate scroll position based on view mode
      let scrollX = 0;
      if (this.viewMode === 'Day') {
        scrollX = daysDiff * columnWidth;
      } else if (this.viewMode === 'Week') {
        scrollX = (daysDiff / 7) * columnWidth;
      } else if (this.viewMode === 'Month') {
        scrollX = (daysDiff / 30) * columnWidth;
      } else if (this.viewMode === 'Year') {
        scrollX = (daysDiff / 365) * columnWidth;
      }

      // Scroll with a small offset to show some context before the date
      container.scrollLeft = Math.max(0, scrollX - columnWidth);
    }, 100);
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
   * @param {string} mode - 'Day', 'Week', 'Month', 'Year' (valid Frappe Gantt modes)
   */
  setViewMode(mode) {
    this.viewMode = mode;
    if (this.gantt) {
      this.gantt.change_view_mode(mode);
      // Re-scroll to earliest task after view change
      if (this.earliestTaskDate) {
        this.scrollToDate(this.earliestTaskDate);
      }
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
