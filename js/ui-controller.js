/**
 * UI Controller module
 * DOM manipulation, progress display, and user interactions
 */

import { escapeHtml, formatLocalDate } from './utils.js';

export class UIController {
  constructor() {
    this.elements = {};
    this.milestoneStatus = new Map();
    this.loadingSteps = new Map();
  }

  /**
   * Initialize UI elements
   */
  init(milestones = []) {
    this.milestones = milestones;

    this.elements = {
      loadingPhase: document.getElementById('loading-phase'),
      loadedPhase: document.getElementById('loaded-phase'),
      progressBar: document.getElementById('progress-bar'),
      progressText: document.getElementById('progress-text'),
      progressStatus: document.getElementById('progress-status'),
      milestonesList: document.getElementById('milestones-list'),
      recentBugs: document.getElementById('recent-bugs'),
      ganttContainer: document.getElementById('gantt-container'),
      componentFilter: document.getElementById('component-filter'),
      ganttEmpty: document.getElementById('gantt-empty'),
      milestoneFilter: document.getElementById('milestone-filter'),
      severityFilter: document.getElementById('severity-filter'),
      scheduleTypeSelect: document.getElementById('schedule-type'),
      optimizationStatus: document.getElementById('optimization-status'),
      optimizationLog: document.getElementById('optimization-log'),
      refreshBtn: document.getElementById('refresh-btn'),
      statsContainer: document.getElementById('stats-container'),
      errorsContainer: document.getElementById('errors-container'),
      estimatedTable: document.getElementById('estimated-table'),
      risksTable: document.getElementById('risks-table'),
      missingSizesLink: document.getElementById('missing-sizes-bugzilla'),
      deadlineRisksLink: document.getElementById('deadline-risks-bugzilla'),
      milestoneMismatchesCard: document.getElementById('milestone-mismatches-card'),
      milestoneMismatchesTable: document.getElementById('milestone-mismatches-table'),
      milestoneMismatchesLink: document.getElementById('milestone-mismatches-bugzilla'),
      untriagedCard: document.getElementById('untriaged-card'),
      untriagedTable: document.getElementById('untriaged-table'),
      untriagedLink: document.getElementById('untriaged-bugzilla'),
      errorsMarkdown: document.getElementById('errors-markdown'),
      legend: document.getElementById('legend'),
      milestoneCards: document.getElementById('milestone-cards')
    };

    // Initialize milestone status
    for (const milestone of this.milestones) {
      this.milestoneStatus.set(milestone.bugId, {
        ...milestone,
        status: 'pending',
        depCount: 0
      });
    }

    this.renderMilestonesList();
  }

  /**
   * Show loading phase
   */
  showLoading() {
    if (this.elements.loadingPhase) {
      this.elements.loadingPhase.style.display = 'block';
    }
    if (this.elements.loadedPhase) {
      this.elements.loadedPhase.style.display = 'none';
    }
  }

  /**
   * Show loaded phase (Gantt chart)
   */
  showLoaded() {
    if (this.elements.loadingPhase) {
      this.elements.loadingPhase.style.display = 'none';
    }
    if (this.elements.loadedPhase) {
      this.elements.loadedPhase.style.display = 'block';
    }
  }

  /**
   * Update progress bar and text
   * @param {Object} progress - {fetched, total, phase, message}
   */
  updateProgress(progress) {
    const { fetched, total, phase, message } = progress;

    if (this.elements.progressBar) {
      const percent = total > 0 ? (fetched / total) * 100 : 0;
      this.elements.progressBar.style.width = `${percent}%`;
    }

    if (this.elements.progressText) {
      this.elements.progressText.textContent = `${fetched}/${total} bugs`;
    }

    if (this.elements.progressStatus) {
      this.elements.progressStatus.textContent = message;
    }
  }

  /**
   * Render milestones list with status indicators
   */
  renderMilestonesList() {
    if (!this.elements.milestonesList) return;

    let html = '';
    for (const [bugId, milestone] of this.milestoneStatus) {
      const statusIcon = this.getStatusIcon(milestone.status);
      const depText = milestone.depCount > 0 ? ` - ${milestone.depCount} dependencies` : '';

      html += `
        <div class="milestone-item milestone-${milestone.status}">
          <span class="milestone-icon">${statusIcon}</span>
          <span class="milestone-name">${milestone.name}</span>
          <span class="milestone-bug">(${bugId})</span>
          <span class="milestone-deps">${depText}</span>
        </div>
      `;
    }

    for (const [, step] of this.loadingSteps) {
      const statusIcon = this.getStatusIcon(step.status);
      const detail = step.detail || '';

      html += `
        <div class="milestone-item milestone-${step.status}">
          <span class="milestone-icon">${statusIcon}</span>
          <span class="milestone-name">${step.label}</span>
          <span class="milestone-deps">${detail}</span>
        </div>
      `;
    }

    this.elements.milestonesList.innerHTML = html;
  }

  /**
   * Get status icon for milestone
   */
  getStatusIcon(status) {
    switch (status) {
      case 'complete': return '\u2713'; // checkmark
      case 'fetching': return '\u25D0'; // half circle
      case 'pending': return '\u25CB'; // empty circle
      default: return '\u25CB';
    }
  }

  /**
   * Update milestone status
   * @param {number} bugId - Milestone bug ID
   * @param {string} status - 'pending', 'fetching', 'complete'
   * @param {number} depCount - Number of dependencies found
   */
  updateMilestoneStatus(bugId, status, depCount = 0) {
    const milestone = this.milestoneStatus.get(bugId);
    if (milestone) {
      milestone.status = status;
      milestone.depCount = depCount;
      this.renderMilestonesList();
    }
  }

  /**
   * Update an extra loading step shown below milestones
   * @param {string} id - Unique step identifier
   * @param {string} label - Display label
   * @param {string} status - 'pending', 'fetching', 'complete'
   * @param {string} [detail] - Optional detail text (e.g. count)
   */
  updateLoadingStep(id, label, status, detail = '') {
    this.loadingSteps.set(id, { label, status, detail });
    this.renderMilestonesList();
  }

  /**
   * Add recently discovered bug to the list
   * @param {Object} bug - Bug object
   */
  addRecentBug(bug) {
    if (!this.elements.recentBugs) return;

    const item = document.createElement('div');
    item.className = 'recent-bug-item';
    item.innerHTML = `
      <span class="bug-tree">\u2514\u2500</span>
      <span class="bug-id">${bug.id}:</span>
      <span class="bug-summary">"${escapeHtml(this.truncate(bug.summary, 50))}"</span>
    `;

    // Keep only last 5 items
    while (this.elements.recentBugs.children.length >= 5) {
      this.elements.recentBugs.removeChild(this.elements.recentBugs.firstChild);
    }

    this.elements.recentBugs.appendChild(item);
  }

  /**
   * Render milestone cards with estimated completion dates
   * @param {Array} milestones - Milestone definitions
   * @param {Map} estimatedCompletions - Map of bugId to estimated completion date
   */
  renderMilestoneCards(milestones, estimatedCompletions) {
    if (!this.elements.milestoneCards) return;

    let html = '';
    for (const milestone of milestones) {
      const estimated = estimatedCompletions.get(String(milestone.bugId));
      const deadlineStr = this.formatDateLong(milestone.deadline);
      const freezeStr = this.formatDateShort(milestone.freezeDate);

      let statusClass = '';
      let estimatedStr = 'Not scheduled';
      let statusIcon = '';

      if (estimated) {
        estimatedStr = this.formatDateLong(estimated);

        if (estimated <= milestone.freezeDate) {
          statusClass = 'milestone-on-track';
          statusIcon = '<span class="status-icon on-track">&#10003;</span>';
        } else if (estimated <= milestone.deadline) {
          statusClass = 'milestone-at-risk';
          statusIcon = '<span class="status-icon at-risk">&#9888;</span>';
        } else {
          statusClass = 'milestone-late';
          statusIcon = '<span class="status-icon late">&#10007;</span>';
        }
      }

      html += `
        <div class="milestone-card ${statusClass}">
          <h4>${milestone.name} ${statusIcon}</h4>
          <div class="deadline">Deadline: ${deadlineStr}</div>
          <div class="freeze">Feature Freeze: ${freezeStr}</div>
          <div class="estimated">Est. Completion: <strong>${estimatedStr}</strong></div>
        </div>
      `;
    }

    this.elements.milestoneCards.innerHTML = html;
  }

  /**
   * Format date as "Month Day, Year"
   */
  formatDateLong(date) {
    if (!date) return 'N/A';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Format date as "Mon Day"
   */
  formatDateShort(date) {
    if (!date) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Render schedule statistics
   * @param {Object} stats - Statistics from main.computeStats()
   */
  renderStats(stats) {
    if (!this.elements.statsContainer) return;

    // Build Bugzilla URLs for bug lists
    const bugzillaListUrl = (bugs) => this.buildBugzillaListUrl(
      (bugs || []).map(b => b?.id).filter(Boolean)
    );

    const totalUrl = bugzillaListUrl(stats.totalBugs);
    const completedUrl = bugzillaListUrl(stats.completedBugs);
    const openUrl = bugzillaListUrl(stats.openBugs);
    const estimatedUrl = bugzillaListUrl(stats.estimatedBugs);

    const linkOrSpan = (url, value) => {
      if (url) {
        return `<a href="${url}" target="_blank" class="stat-link">${value}</a>`;
      }
      return `<span>${value}</span>`;
    };

    const html = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${linkOrSpan(totalUrl, stats.totalBugs?.length || 0)}</div>
          <div class="stat-label">Total Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${linkOrSpan(completedUrl, stats.completedBugs?.length || 0)}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${linkOrSpan(openUrl, stats.openBugs?.length || 0)}</div>
          <div class="stat-label">Open</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${linkOrSpan(estimatedUrl, stats.estimatedBugs?.length || 0)}</div>
          <div class="stat-label">Estimated Sizes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.latestEnd ? this.formatDate(stats.latestEnd) : 'N/A'}</div>
          <div class="stat-label">Project End</div>
        </div>
      </div>
    `;

    this.elements.statsContainer.innerHTML = html;
  }

  buildBugzillaListUrl(bugIds) {
    if (!bugIds || bugIds.length === 0) return null;
    return `https://bugzilla.mozilla.org/buglist.cgi?bug_id=${bugIds.join(',')}`;
  }

  setBugzillaLink(linkEl, bugIds) {
    if (!linkEl) return;
    const url = this.buildBugzillaListUrl(bugIds);
    if (!url) {
      linkEl.removeAttribute('href');
      linkEl.classList.add('is-disabled');
      linkEl.setAttribute('aria-disabled', 'true');
      linkEl.setAttribute('tabindex', '-1');
      return;
    }

    linkEl.href = url;
    linkEl.classList.remove('is-disabled');
    linkEl.removeAttribute('aria-disabled');
    linkEl.removeAttribute('tabindex');
  }

  /**
   * Shared table renderer. Handles card show/hide, Bugzilla link, empty state,
   * and table HTML generation for all data tables.
   */
  _renderTable(tableEl, { card, cardDisplay = 'block', link, items, bugIds, columns, emptyMessage, rowClass }) {
    if (!tableEl) return;

    this.setBugzillaLink(link, bugIds);

    if (!items || items.length === 0) {
      if (card) card.style.display = 'none';
      tableEl.innerHTML = emptyMessage ? `<p>${emptyMessage}</p>` : '';
      return;
    }

    if (card) card.style.display = cardDisplay;

    let html = '<table><thead><tr>';
    for (const col of columns) html += `<th>${col.header}</th>`;
    html += '</tr></thead><tbody>';

    for (const item of items) {
      const cls = rowClass ? rowClass(item) : '';
      html += cls ? `<tr class="${cls}">` : '<tr>';
      for (const col of columns) html += `<td>${col.render(item)}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    tableEl.innerHTML = html;
  }

  _bugLink(id) {
    return `<a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${id}" target="_blank">${id}</a>`;
  }

  _titleCell(summary, maxLen = 50) {
    return `<span title="${this.escapeHtml(summary || '')}">${this.escapeHtml(this.truncate(summary || '', maxLen))}</span>`;
  }

  renderEstimatedTable(bugs) {
    this._renderTable(this.elements.estimatedTable, {
      link: this.elements.missingSizesLink,
      items: bugs,
      bugIds: (bugs || []).map(b => b?.id).filter(Boolean),
      emptyMessage: 'No estimated sizes',
      columns: [
        { header: 'Bug ID', render: b => this._bugLink(b.id) },
        { header: 'Summary', render: b => this._titleCell(b.summary, 60) }
      ]
    });
  }

  renderRisksTable(risks) {
    this._renderTable(this.elements.risksTable, {
      link: this.elements.deadlineRisksLink,
      items: risks,
      bugIds: (risks || []).map(r => r?.task?.bug?.id).filter(Boolean),
      emptyMessage: 'No deadline risks detected',
      rowClass: r => `risk-${r.type}`,
      columns: [
        { header: 'Bug ID', render: r => this._bugLink(r.task.bug.id) },
        { header: 'Title', render: r => this._titleCell(r.task.bug.summary) },
        { header: 'End Date', render: r => this.formatDate(r.task.endDate) },
        { header: 'Milestone', render: r => r.milestone.name },
        { header: 'Risk Type', render: r => r.type === 'overdue' ? 'Overdue' : r.type === 'freeze' ? 'After Freeze' : 'After Deadline' }
      ]
    });
  }

  renderMilestoneMismatchesTable(mismatches) {
    this._renderTable(this.elements.milestoneMismatchesTable, {
      card: this.elements.milestoneMismatchesCard,
      link: this.elements.milestoneMismatchesLink,
      items: mismatches,
      bugIds: (mismatches || []).map(m => m?.bug?.id).filter(Boolean),
      columns: [
        { header: 'Bug ID', render: m => this._bugLink(m.bug.id) },
        { header: 'Title', render: m => this._titleCell(m.bug.summary) },
        { header: 'Bugzilla Milestone', render: m => m.targetMilestone },
        { header: 'Dependency Milestone', render: m => m.dependencyMilestone || '(not connected)' }
      ]
    });
  }

  renderUntriagedTable(bugs) {
    this._renderTable(this.elements.untriagedTable, {
      card: this.elements.untriagedCard,
      cardDisplay: '',
      link: this.elements.untriagedLink,
      items: bugs,
      bugIds: (bugs || []).map(b => b?.id).filter(Boolean),
      columns: [
        { header: 'Bug ID', render: b => this._bugLink(b.id) },
        { header: 'Title', render: b => this._titleCell(b.summary) },
        { header: 'Assignee', render: b => this.escapeHtml(b.assignee && b.assignee !== 'nobody@mozilla.org' ? b.assignee.split('@')[0] : 'Unassigned') }
      ]
    });
  }

  /**
   * Render errors in markdown format
   * @param {Object} errors - Error detection results
   */
  renderErrorsMarkdown(errors) {
    if (!this.elements.errorsMarkdown) return;

    let markdown = '# ERRORS.md\n\n';
    markdown += `Generated: ${new Date().toISOString()}\n\n`;

    if (errors.cycles && errors.cycles.length > 0) {
      markdown += '## Dependency Cycles\n\n';
      for (const cycle of errors.cycles) {
        markdown += `- Cycle: ${cycle.join(' -> ')}\n`;
      }
      markdown += '\n';
    }

    if (errors.orphaned && errors.orphaned.length > 0) {
      markdown += '## Orphaned Dependencies\n\n';
      markdown += 'Dependencies pointing to non-existent bugs:\n\n';
      for (const orphan of errors.orphaned) {
        markdown += `- Bug ${orphan.from} depends on missing bug ${orphan.to}\n`;
      }
      markdown += '\n';
    }

    if (errors.duplicates && errors.duplicates.length > 0) {
      markdown += '## Duplicate Summaries\n\n';
      for (const dup of errors.duplicates) {
        markdown += `### "${dup.summary}"\n\n`;
        for (const bug of dup.bugs) {
          markdown += `- Bug ${bug.id}\n`;
        }
        markdown += '\n';
      }
    }

    if (errors.missingAssignees && errors.missingAssignees.length > 0) {
      markdown += '## Missing Assignees\n\n';
      for (const bug of errors.missingAssignees) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      markdown += '\n';
    }

    if (errors.unknownAssignees && errors.unknownAssignees.length > 0) {
      markdown += '## Unknown Assignees (not in engineer list)\n\n';
      for (const item of errors.unknownAssignees) {
        const assignee = item.assignee || 'Unknown';
        markdown += `- Bug ${item.bug.id}: ${item.bug.summary} (assignee: ${assignee})\n`;
      }
      markdown += '\n';
    }

    if (errors.missingSizes && errors.missingSizes.length > 0) {
      markdown += '## Missing Sizes\n\n';
      for (const bug of errors.missingSizes) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      markdown += '\n';
    }

    if (errors.untriaged && errors.untriaged.length > 0) {
      markdown += '## Untriaged Bugs (no severity)\n\n';
      for (const bug of errors.untriaged) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      markdown += '\n';
    }

    if (errors.milestoneMismatches && errors.milestoneMismatches.length > 0) {
      markdown += '## Milestone Mismatches\n\n';
      markdown += 'Bugs where Bugzilla milestone differs from dependency milestone:\n\n';
      for (const m of errors.milestoneMismatches) {
        const depMs = m.dependencyMilestone || '(not connected)';
        markdown += `- Bug ${m.bug.id}: ${m.bug.summary}\n`;
        markdown += `  Bugzilla says "${m.targetMilestone}", dependencies say "${depMs}"\n`;
      }
    }

    this.elements.errorsMarkdown.textContent = markdown;
  }

  getSeverityFilter() {
    return this.elements.severityFilter ? this.elements.severityFilter.value : 'S2';
  }

  getMilestoneFilter() {
    return this.elements.milestoneFilter ? this.elements.milestoneFilter.value : '';
  }

  getComponentFilter() {
    return this.elements.componentFilter ? this.elements.componentFilter.value : '';
  }

  showGanttEmpty(message) {
    if (!this.elements.ganttEmpty) return;
    this.elements.ganttEmpty.textContent = message;
    this.elements.ganttEmpty.style.display = 'block';
  }

  hideGanttEmpty() {
    if (!this.elements.ganttEmpty) return;
    this.elements.ganttEmpty.style.display = 'none';
  }

  /**
   * Populate the component filter dropdown with unique component names from the bug data.
   * @param {string[]} components - Sorted list of component names
   */
  populateComponentFilter(components) {
    if (!this.elements.componentFilter) return;
    const current = this.elements.componentFilter.value;
    this.elements.componentFilter.innerHTML = '<option value="">All</option>';
    for (const comp of components) {
      const opt = document.createElement('option');
      opt.value = comp;
      opt.textContent = comp;
      if (comp === current) opt.selected = true;
      this.elements.componentFilter.appendChild(opt);
    }
  }

  /**
   * Set up event listeners
   * @param {Object} callbacks - Event callbacks
   */
  setupEventListeners(callbacks) {
    if (this.elements.componentFilter && callbacks.onComponentFilter) {
      this.elements.componentFilter.addEventListener('change', (e) => {
        callbacks.onComponentFilter(e.target.value);
      });
    }

    if (this.elements.milestoneFilter && callbacks.onMilestoneFilter) {
      this.elements.milestoneFilter.addEventListener('change', (e) => {
        callbacks.onMilestoneFilter(e.target.value);
      });
    }

    if (this.elements.severityFilter && callbacks.onSeverityFilter) {
      this.elements.severityFilter.addEventListener('change', (e) => {
        callbacks.onSeverityFilter(e.target.value);
      });
    }

    if (this.elements.scheduleTypeSelect && callbacks.onScheduleTypeChange) {
      this.elements.scheduleTypeSelect.addEventListener('change', (e) => {
        callbacks.onScheduleTypeChange(e.target.value);
      });
    }

    if (this.elements.refreshBtn && callbacks.onRefresh) {
      this.elements.refreshBtn.addEventListener('click', () => {
        callbacks.onRefresh();
      });
    }
  }

  /**
   * Update optimization status display
   * @param {string} status - 'running', 'complete', 'error'
   * @param {string} message - Status message
   */
  updateOptimizationStatus(status, message) {
    if (!this.elements.optimizationStatus) return;

    let icon = '';
    let className = 'optimization-status';

    switch (status) {
      case 'running':
        icon = '<span class="spinner-small"></span>';
        className += ' status-running';
        break;
      case 'complete':
        icon = '\u2713';
        className += ' status-complete';
        break;
      case 'error':
        icon = '\u2717';
        className += ' status-error';
        break;
    }

    this.elements.optimizationStatus.className = className;
    this.elements.optimizationStatus.innerHTML = `${icon} ${message}`;
  }

  /**
   * Enable/disable the schedule type toggle
   * @param {boolean} enabled - Whether optimal schedule is available
   */
  enableScheduleToggle(enabled) {
    if (!this.elements.scheduleTypeSelect) return;

    const optimalOption = this.elements.scheduleTypeSelect.querySelector('option[value="optimal"]');
    if (optimalOption) {
      optimalOption.disabled = !enabled;
      if (enabled) {
        optimalOption.textContent = 'Optimized';
      }
    }
  }

  /**
   * Set the schedule type in the UI
   * @param {string} type - 'greedy', 'optimal', or 'exhaustive'
   */
  setScheduleType(type) {
    if (!this.elements.scheduleTypeSelect) return;
    this.elements.scheduleTypeSelect.value = type;
  }

  /**
   * Add entry to optimization log
   * @param {string} message - Log message
   * @param {string} type - 'improvement', 'deadline', 'status'
   */
  addOptimizationLogEntry(message, type = 'status') {
    if (!this.elements.optimizationLog) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;

    this.elements.optimizationLog.appendChild(entry);

    // Auto-scroll to bottom
    this.elements.optimizationLog.scrollTop = this.elements.optimizationLog.scrollHeight;
  }

  /**
   * Clear optimization log
   */
  clearOptimizationLog() {
    if (!this.elements.optimizationLog) return;
    this.elements.optimizationLog.innerHTML = '';
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    if (this.elements.errorsContainer) {
      this.elements.errorsContainer.innerHTML = `
        <div class="error-message">
          <strong>Error:</strong> ${message}
        </div>
      `;
      this.elements.errorsContainer.style.display = 'block';
    }
  }

  /**
   * Format date as YYYY-MM-DD
   */
  formatDate(date) {
    if (!date) return 'N/A';
    return formatLocalDate(date);
  }

  /**
   * Truncate string
   */
  truncate(str, maxLen) {
    if (!str) return '';
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(str) {
    return escapeHtml(str);
  }
}

export default UIController;
