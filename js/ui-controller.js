/**
 * UI Controller module
 * DOM manipulation, progress display, and user interactions
 */

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
      viewModeSelect: document.getElementById('view-mode'),
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
      <span class="bug-summary">"${this.truncate(bug.summary, 50)}"</span>
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
   * Render estimated sizes table
   * @param {Array<Object>} bugs - Bugs with estimated sizes
   */
  renderEstimatedTable(bugs) {
    if (!this.elements.estimatedTable) return;

    this.setBugzillaLink(
      this.elements.missingSizesLink,
      (bugs || []).map(b => b?.id).filter(Boolean)
    );

    if (bugs.length === 0) {
      this.elements.estimatedTable.innerHTML = '<p>No estimated sizes</p>';
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Bug ID</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const bug of bugs.slice(0, 20)) {
      html += `
        <tr>
          <td><a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${bug.id}" target="_blank">${bug.id}</a></td>
          <td title="${this.escapeHtml(bug.summary)}">${this.escapeHtml(this.truncate(bug.summary, 60))}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';

    if (bugs.length > 20) {
      html += `<p class="table-note">...and ${bugs.length - 20} more</p>`;
    }

    this.elements.estimatedTable.innerHTML = html;
  }

  /**
   * Render deadline risks table
   * @param {Array<Object>} risks - Deadline risk items
   */
  renderRisksTable(risks) {
    if (!this.elements.risksTable) return;

    this.setBugzillaLink(
      this.elements.deadlineRisksLink,
      (risks || []).map(risk => risk?.task?.bug?.id).filter(Boolean)
    );

    if (risks.length === 0) {
      this.elements.risksTable.innerHTML = '<p>No deadline risks detected</p>';
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Bug ID</th>
            <th>Title</th>
            <th>End Date</th>
            <th>Milestone</th>
            <th>Risk Type</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const risk of risks.slice(0, 20)) {
      const title = this.truncate(risk.task.bug.summary || '', 50);
      html += `
        <tr class="risk-${risk.type}">
          <td><a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${risk.task.bug.id}" target="_blank">${risk.task.bug.id}</a></td>
          <td title="${this.escapeHtml(risk.task.bug.summary || '')}">${this.escapeHtml(title)}</td>
          <td>${this.formatDate(risk.task.endDate)}</td>
          <td>${risk.milestone.name}</td>
          <td>${risk.type === 'freeze' ? 'After Freeze' : 'After Deadline'}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    this.elements.risksTable.innerHTML = html;
  }

  /**
   * Render milestone mismatches table
   * @param {Array<Object>} mismatches - Bugs with milestone inconsistencies
   */
  renderMilestoneMismatchesTable(mismatches) {
    if (!this.elements.milestoneMismatchesTable || !this.elements.milestoneMismatchesCard) return;

    // Hide the card if no mismatches
    if (!mismatches || mismatches.length === 0) {
      this.elements.milestoneMismatchesCard.style.display = 'none';
      this.setBugzillaLink(this.elements.milestoneMismatchesLink, []);
      return;
    }

    this.elements.milestoneMismatchesCard.style.display = 'block';
    this.setBugzillaLink(
      this.elements.milestoneMismatchesLink,
      mismatches.map(mismatch => mismatch?.bug?.id).filter(Boolean)
    );

    let html = `
      <table>
        <thead>
          <tr>
            <th>Bug ID</th>
            <th>Title</th>
            <th>Bugzilla Milestone</th>
            <th>Dependency Milestone</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const mismatch of mismatches.slice(0, 20)) {
      const title = this.truncate(mismatch.bug.summary || '', 50);
      const depMilestone = mismatch.dependencyMilestone || '(not connected)';
      html += `
        <tr>
          <td><a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${mismatch.bug.id}" target="_blank">${mismatch.bug.id}</a></td>
          <td title="${this.escapeHtml(mismatch.bug.summary || '')}">${this.escapeHtml(title)}</td>
          <td>${mismatch.targetMilestone}</td>
          <td>${depMilestone}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    if (mismatches.length > 20) {
      html += `<p class="table-note">Showing 20 of ${mismatches.length} mismatches</p>`;
    }
    this.elements.milestoneMismatchesTable.innerHTML = html;
  }

  /**
   * Render untriaged bugs table
   * @param {Array<Object>} bugs - Untriaged bugs (no severity set)
   */
  renderUntriagedTable(bugs) {
    if (!this.elements.untriagedTable || !this.elements.untriagedCard) return;

    // Hide the card if no untriaged bugs
    if (!bugs || bugs.length === 0) {
      this.elements.untriagedCard.style.display = 'none';
      this.setBugzillaLink(this.elements.untriagedLink, []);
      return;
    }

    // Show the card
    this.elements.untriagedCard.style.display = '';
    this.setBugzillaLink(
      this.elements.untriagedLink,
      bugs.map(bug => bug?.id).filter(Boolean)
    );

    let html = `
      <table>
        <thead>
          <tr>
            <th>Bug ID</th>
            <th>Title</th>
            <th>Assignee</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const bug of bugs.slice(0, 20)) {
      const title = this.truncate(bug.summary || '', 50);
      const assignee = bug.assignee && bug.assignee !== 'nobody@mozilla.org'
        ? bug.assignee.split('@')[0]
        : 'Unassigned';
      html += `
        <tr>
          <td><a href="https://bugzilla.mozilla.org/show_bug.cgi?id=${bug.id}" target="_blank">${bug.id}</a></td>
          <td title="${this.escapeHtml(bug.summary || '')}">${this.escapeHtml(title)}</td>
          <td>${this.escapeHtml(assignee)}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';

    if (bugs.length > 20) {
      html += `<p class="table-note">...and ${bugs.length - 20} more</p>`;
    }

    this.elements.untriagedTable.innerHTML = html;
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
      for (const bug of errors.missingAssignees.slice(0, 50)) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      if (errors.missingAssignees.length > 50) {
        markdown += `\n...and ${errors.missingAssignees.length - 50} more\n`;
      }
      markdown += '\n';
    }

    if (errors.unknownAssignees && errors.unknownAssignees.length > 0) {
      markdown += '## Unknown Assignees (not in engineer list)\n\n';
      for (const item of errors.unknownAssignees.slice(0, 50)) {
        const assignee = item.assignee || 'Unknown';
        markdown += `- Bug ${item.bug.id}: ${item.bug.summary} (assignee: ${assignee})\n`;
      }
      if (errors.unknownAssignees.length > 50) {
        markdown += `\n...and ${errors.unknownAssignees.length - 50} more\n`;
      }
      markdown += '\n';
    }

    if (errors.missingSizes && errors.missingSizes.length > 0) {
      markdown += '## Missing Sizes\n\n';
      for (const bug of errors.missingSizes.slice(0, 50)) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      if (errors.missingSizes.length > 50) {
        markdown += `\n...and ${errors.missingSizes.length - 50} more\n`;
      }
      markdown += '\n';
    }

    if (errors.untriaged && errors.untriaged.length > 0) {
      markdown += '## Untriaged Bugs (no severity)\n\n';
      for (const bug of errors.untriaged.slice(0, 50)) {
        markdown += `- Bug ${bug.id}: ${bug.summary}\n`;
      }
      if (errors.untriaged.length > 50) {
        markdown += `\n...and ${errors.untriaged.length - 50} more\n`;
      }
      markdown += '\n';
    }

    if (errors.milestoneMismatches && errors.milestoneMismatches.length > 0) {
      markdown += '## Milestone Mismatches\n\n';
      markdown += 'Bugs where Bugzilla milestone differs from dependency milestone:\n\n';
      for (const m of errors.milestoneMismatches.slice(0, 50)) {
        const depMs = m.dependencyMilestone || '(not connected)';
        markdown += `- Bug ${m.bug.id}: ${m.bug.summary}\n`;
        markdown += `  Bugzilla says "${m.targetMilestone}", dependencies say "${depMs}"\n`;
      }
      if (errors.milestoneMismatches.length > 50) {
        markdown += `\n...and ${errors.milestoneMismatches.length - 50} more\n`;
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

  /**
   * Set up event listeners
   * @param {Object} callbacks - Event callbacks
   */
  setupEventListeners(callbacks) {
    if (this.elements.viewModeSelect && callbacks.onViewModeChange) {
      this.elements.viewModeSelect.addEventListener('change', (e) => {
        callbacks.onViewModeChange(e.target.value);
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
    return date.toISOString().split('T')[0];
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
   * Escape HTML special characters using DOM
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export default UIController;
