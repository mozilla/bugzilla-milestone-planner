/**
 * Gantt Chart Renderer using Frappe Gantt
 * Color coding, milestone markers, and dependency visualization
 */

// Distinct colors for engineers (colorblind-friendly palette)
const ENGINEER_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#be185d', // pink
  '#4f46e5', // indigo
  '#ca8a04', // yellow
];

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
    this.engineerColorMap = new Map(); // Maps engineer name to color
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

    // Zoom buttons
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => this.handleZoom('in'));
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => this.handleZoom('out'));
    }
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
      // Skip milestone bugs - they're tracking bugs shown in milestone cards, not actual work
      const isMilestoneBug = MILESTONES.some(m => String(m.bugId) === String(task.bug.id));
      if (isMilestoneBug) continue;

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

      // Check if at risk for deadline
      const atRisk = this.isAtRisk(task);
      if (atRisk) {
        customClass = 'gantt-at-risk';
      }

      // Determine if scheduler assigned engineer (vs original Bugzilla assignee)
      const originalAssignee = task.bug.assignee;
      const scheduledEngineer = task.engineer ? task.engineer.name : null;
      const isSchedulerAssigned = !originalAssignee || originalAssignee === 'nobody@mozilla.org';

      // Add scheduler-assigned class for visual distinction
      if (isSchedulerAssigned && !atRisk) {
        customClass += ' gantt-scheduler-assigned';
      }

      // Build dependencies string
      const deps = graph.getDependencies(String(task.bug.id));
      const validDeps = deps.filter(depId => {
        return scheduledTasks.some(t => String(t.bug.id) === depId && !t.completed);
      });

      // Format engineer display - show initials for compact display (skip for meta bugs)
      const isMeta = task.bug.isMeta || (task.effort && task.effort.isMeta);
      let engineerSuffix = '';
      if (!isMeta) {
        const engineerInitials = scheduledEngineer ? this.getInitials(scheduledEngineer) : '?';
        engineerSuffix = isSchedulerAssigned ? ` [${engineerInitials}]` : ` (${engineerInitials})`;
      }

      this.tasks.push({
        id: String(task.bug.id),
        name: `#${task.bug.id}: ${this.truncate(task.bug.summary, 35)}${engineerSuffix}`,
        start: this.formatDate(task.startDate),
        end: this.formatDate(task.endDate),
        progress: 0,
        custom_class: customClass,
        dependencies: validDeps.join(', '),
        // Store extra data for tooltips
        _engineer: scheduledEngineer || 'Unassigned',
        _originalAssignee: originalAssignee,
        _isSchedulerAssigned: isSchedulerAssigned,
        _effort: task.effort ? task.effort.days : 0,
        _size: task.bug.size,
        _sizeEstimated: task.effort ? task.effort.sizeEstimated : false,
        _isMeta: isMeta,
        _milestone: task.milestone ? task.milestone.name : null,
        _engineerColor: this.getEngineerColor(scheduledEngineer)
      });
    }

    return this.tasks;
  }

  /**
   * Check if task is at risk for its milestone
   * Only marks at-risk if task ends after its own milestone's freeze date
   */
  isAtRisk(task) {
    if (!task.endDate) return false;

    // If task has a specific milestone, check against that milestone's freeze date
    if (task.milestone) {
      return task.endDate > task.milestone.freezeDate;
    }

    // Tasks without a milestone are not at risk (they're not blocking any deadline)
    return false;
  }

  /**
   * Render the Gantt chart
   * @param {Array<Object>} scheduledTasks - Tasks from scheduler
   * @param {DependencyGraph} graph - Dependency graph
   */
  render(scheduledTasks, graph) {
    const ganttTasks = this.convertToGanttTasks(scheduledTasks, graph);

    // Clean up previous render to avoid nested containers
    if (this._interactionCleanup) {
      this._interactionCleanup();
      this._interactionCleanup = null;
    }

    // Frappe Gantt wraps #gantt-chart in .gantt-container on first render.
    // On re-render, it nests another .gantt-container inside, breaking scrolling.
    // Fix: remove .gantt-container and recreate #gantt-chart in the parent.
    const existingContainer = document.querySelector('.gantt-container');
    if (existingContainer) {
      const parent = existingContainer.parentElement;
      existingContainer.remove();
      // Recreate the target SVG element that Frappe Gantt expects
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = this.containerId;
      parent.appendChild(svg);
    }

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

    // Apply engineer colors to task bars
    this.applyEngineerColors();

    // Update the legend with engineer colors
    this.updateEngineerLegend();

    // Add hover and drag interactions after Gantt renders
    setTimeout(() => this.setupInteractions(), 200);

    // Scroll to show the earliest task start date
    this.scrollToDate(this.earliestTaskDate);
  }

  /**
   * Set up hover popups and drag-to-scroll after Gantt renders
   */
  setupInteractions() {
    // Frappe Gantt creates .gantt-container and puts the SVG inside it
    // The .gantt-container is the scrollable element
    const scrollContainer = document.querySelector('.gantt-container');
    if (!scrollContainer) return;

    // Clean up previous listeners
    if (this._interactionCleanup) {
      this._interactionCleanup();
    }

    // --- Hover popup support ---
    // Bars are inside .gantt-container, not outerContainer
    const bars = scrollContainer.querySelectorAll('.bar-wrapper');
    const hoverHandlers = [];

    // Track if mouse is over bar or popup to prevent premature hiding
    let isOverBar = false;
    let isOverPopup = false;
    let hideTimeout = null;

    const maybeHidePopup = () => {
      // Small delay to allow mouse to move from bar to popup
      hideTimeout = setTimeout(() => {
        if (!isOverBar && !isOverPopup && this.gantt) {
          this.gantt.hide_popup();
        }
      }, 100);
    };

    const cancelHide = () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    };

    // Add handlers to the popup to keep it visible when hovered
    const setupPopupHandlers = () => {
      const popup = document.querySelector('.popup-wrapper');
      if (popup && !popup._hoverHandlersAttached) {
        popup._hoverHandlersAttached = true;
        popup.addEventListener('mouseenter', () => {
          isOverPopup = true;
          cancelHide();
        });
        popup.addEventListener('mouseleave', () => {
          isOverPopup = false;
          maybeHidePopup();
        });
      }
    };

    bars.forEach(bar => {
      const onEnter = (e) => {
        isOverBar = true;
        cancelHide();

        // Trigger Frappe Gantt's popup
        const taskId = bar.getAttribute('data-id');
        const task = this.tasks.find(t => t.id === taskId);
        // Use the bar-group as target (includes both rect and label)
        // This ensures popup stays visible when hovering over label text
        const barGroup = bar.querySelector('.bar-group');
        if (task && this.gantt && barGroup) {
          this.gantt.show_popup({
            target_element: barGroup,
            title: task.name,
            subtitle: `${task.start} - ${task.end}`,
            task: task
          });

          // Reposition popup if it's cut off at the bottom
          requestAnimationFrame(() => {
            const popup = document.querySelector('.popup-wrapper');
            if (popup) {
              setupPopupHandlers();

              const popupRect = popup.getBoundingClientRect();
              const viewportHeight = window.innerHeight;

              // If popup extends below viewport, move it above the bar
              if (popupRect.bottom > viewportHeight - 10) {
                const barRect = barGroup.getBoundingClientRect();
                const popupHeight = popupRect.height;

                // Switch to fixed positioning for viewport-relative placement
                popup.style.position = 'fixed';
                popup.style.top = `${barRect.top - popupHeight - 10}px`;
                popup.style.left = `${barRect.left}px`;

                // Flip the pointer arrow
                const pointer = popup.querySelector('.pointer');
                if (pointer) {
                  pointer.style.borderTopColor = 'transparent';
                  pointer.style.borderBottomColor = 'var(--bg-primary)';
                  pointer.style.top = 'auto';
                  pointer.style.bottom = '-10px';
                  pointer.style.transform = 'rotate(180deg)';
                }
              }
            }
          });
        }
      };

      const onLeave = () => {
        isOverBar = false;
        maybeHidePopup();
      };

      bar.addEventListener('mouseenter', onEnter);
      bar.addEventListener('mouseleave', onLeave);
      hoverHandlers.push({ bar, onEnter, onLeave });
    });

    // --- Drag-to-scroll support ---
    // Target the .gantt-container which is the actual scrollable element
    let isDragging = false;
    let startX = 0;
    let scrollLeft = 0;

    const onMouseDown = (e) => {
      // Only start drag if NOT clicking on a bar
      if (e.target.closest('.bar-wrapper')) return;

      isDragging = true;
      scrollContainer.style.cursor = 'grabbing';
      startX = e.clientX;
      scrollLeft = scrollContainer.scrollLeft;
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        scrollContainer.style.cursor = 'grab';
      }
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const walk = startX - e.clientX;
      scrollContainer.scrollLeft = scrollLeft + walk;
    };

    scrollContainer.style.cursor = 'grab';
    scrollContainer.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousemove', onMouseMove);

    // Store cleanup function
    this._interactionCleanup = () => {
      hoverHandlers.forEach(({ bar, onEnter, onLeave }) => {
        bar.removeEventListener('mouseenter', onEnter);
        bar.removeEventListener('mouseleave', onLeave);
      });
      scrollContainer.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousemove', onMouseMove);
      scrollContainer.style.cursor = '';
    };
  }

  /**
   * Update the legend to show engineer color assignments
   */
  updateEngineerLegend() {
    const legend = document.getElementById('legend');
    if (!legend) return;

    // Remove any existing engineer legend items
    const existingEngineerItems = legend.querySelectorAll('.legend-item-engineer');
    existingEngineerItems.forEach(item => item.remove());

    // Add a separator if there are engineers
    if (this.engineerColorMap.size === 0) return;

    // Add engineer color items
    for (const [engineer, color] of this.engineerColorMap) {
      const item = document.createElement('div');
      item.className = 'legend-item legend-item-engineer';
      item.innerHTML = `
        <div class="legend-color" style="background: ${color};"></div>
        <span>${engineer}</span>
      `;
      legend.appendChild(item);
    }
  }

  /**
   * Apply engineer-specific colors to the initials indicator in task labels
   */
  applyEngineerColors() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Wait for SVG to be fully rendered
    setTimeout(() => {
      for (const task of this.tasks) {
        if (!task._engineerColor) continue;

        // Skip meta bugs - they don't need engineer assignments
        if (task._isMeta) continue;

        // Find the bar wrapper for this task
        const barWrapper = container.querySelector(`.bar-wrapper[data-id="${task.id}"]`);
        if (!barWrapper) continue;

        // Find the label text element
        const label = barWrapper.querySelector('.bar-label');
        if (!label) continue;

        const text = label.textContent;
        // Match the engineer suffix: (XX) or [XX] at the end
        const match = text.match(/^(.*)(\s*[\[(][A-Z?]+[\])])$/);
        if (!match) continue;

        const mainText = match[1];
        const initialsText = match[2];
        const isSchedulerAssigned = task._isSchedulerAssigned;

        // Clear the label and add tspans
        label.textContent = '';

        const mainSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        mainSpan.textContent = mainText;

        const initialsSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        initialsSpan.setAttribute('fill', task._engineerColor);

        if (isSchedulerAssigned) {
          // Scheduler-assigned: italic, with arrow indicator
          initialsSpan.textContent = ' →' + initialsText.trim();
          initialsSpan.setAttribute('font-style', 'italic');
        } else {
          // Bugzilla-assigned: bold
          initialsSpan.textContent = initialsText;
          initialsSpan.setAttribute('font-weight', 'bold');
        }

        label.appendChild(mainSpan);
        label.appendChild(initialsSpan);
      }
    }, 100);
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
    const sizeNote = task._sizeEstimated ? ' (est.)' : '';
    const isMeta = task._isMeta;
    const isSchedulerAssigned = task._isSchedulerAssigned;
    const assignmentNote = isSchedulerAssigned ? ' (scheduler assigned)' : '';

    // For meta bugs, don't show size/effort
    const sizeEffortLine = isMeta
      ? '<p><em>Meta/tracking bug</em></p>'
      : `<p><strong>Size/Effort:</strong> ${size}${sizeNote} (${effort} days)</p>`;

    return `
      <div class="gantt-popup">
        <h4>${task.name}</h4>
        <div class="popup-details">
          <p><strong>Engineer:</strong> ${engineer}${assignmentNote}</p>
          ${sizeEffortLine}
          <p><strong>Start:</strong> ${task.start}</p>
          <p><strong>End:</strong> ${task.end}</p>
        </div>
        <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${task.id}"
           target="_blank" class="popup-link">View in Bugzilla</a>
      </div>
    `;
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
   * Get initials from a name
   */
  getInitials(name) {
    if (!name) return '?';
    return name.split(' ')
      .map(part => part.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2);
  }

  /**
   * Get consistent color for an engineer
   */
  getEngineerColor(engineerName) {
    if (!engineerName) return '#999';

    if (!this.engineerColorMap.has(engineerName)) {
      const colorIndex = this.engineerColorMap.size % ENGINEER_COLORS.length;
      this.engineerColorMap.set(engineerName, ENGINEER_COLORS[colorIndex]);
    }
    return this.engineerColorMap.get(engineerName);
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
    // Clean up interaction handlers
    if (this._interactionCleanup) {
      this._interactionCleanup();
      this._interactionCleanup = null;
    }

    if (this.gantt) {
      // Frappe Gantt doesn't have a destroy method, clear container
      document.getElementById(this.containerId).innerHTML = '';
      this.gantt = null;
    }
  }
}

export { MILESTONES };
export default GanttRenderer;
