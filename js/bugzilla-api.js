/**
 * Bugzilla REST API client for browser-based fetching
 * Fetches bugs and their dependencies from bugzilla.mozilla.org
 */

const BUGZILLA_API_BASE = 'https://bugzilla.mozilla.org/rest';
const BATCH_SIZE = 100;

export class BugzillaAPI {
  constructor() {
    this.cache = new Map();
    this.fetchedCount = 0;
    this.totalDiscovered = 0;
    this.onProgress = null;
    this.onBugDiscovered = null;
  }

  /**
   * Set progress callback
   * @param {Function} callback - Called with {fetched, total, phase, message}
   */
  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  /**
   * Set bug discovered callback
   * @param {Function} callback - Called with bug object when discovered
   */
  setBugDiscoveredCallback(callback) {
    this.onBugDiscovered = callback;
  }

  /**
   * Report progress to callback
   */
  reportProgress(phase, message) {
    if (this.onProgress) {
      this.onProgress({
        fetched: this.fetchedCount,
        total: this.totalDiscovered,
        phase,
        message
      });
    }
  }

  /**
   * Fetch a single bug by ID
   * @param {number|string} bugId
   * @returns {Promise<Object>} Bug data
   */
  async fetchBug(bugId) {
    const id = String(bugId);
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    const url = `${BUGZILLA_API_BASE}/bug/${id}?include_fields=id,summary,status,resolution,assigned_to,depends_on,blocks,whiteboard,component,product,severity,keywords,target_milestone`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.bugs && data.bugs.length > 0) {
        const bug = this.processBug(data.bugs[0]);
        this.cache.set(id, bug);
        this.fetchedCount++;
        return bug;
      }
      throw new Error(`Bug ${bugId} not found`);
    } catch (error) {
      console.error(`Error fetching bug ${bugId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch multiple bugs in a single request
   * @param {Array<number|string>} bugIds
   * @returns {Promise<Array<Object>>} Array of bug data
   */
  async fetchBugs(bugIds) {
    if (bugIds.length === 0) return [];

    const uncachedIds = bugIds.filter(id => !this.cache.has(String(id)));

    if (uncachedIds.length === 0) {
      return bugIds.map(id => this.cache.get(String(id)));
    }

    const url = `${BUGZILLA_API_BASE}/bug?id=${uncachedIds.join(',')}&include_fields=id,summary,status,resolution,assigned_to,depends_on,blocks,whiteboard,component,product,severity,keywords,target_milestone`;

    console.log(`[BugzillaAPI] Fetching URL: ${url.substring(0, 100)}...`);

    try {
      const response = await fetch(url);
      console.log(`[BugzillaAPI] Response status: ${response.status}`);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[BugzillaAPI] Error response: ${text.substring(0, 200)}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[BugzillaAPI] Received ${data.bugs ? data.bugs.length : 0} bugs in response`);

      if (data.bugs) {
        for (const rawBug of data.bugs) {
          const bug = this.processBug(rawBug);
          this.cache.set(String(bug.id), bug);
          this.fetchedCount++;

          if (this.onBugDiscovered) {
            this.onBugDiscovered(bug);
          }
        }
      }

      // Handle faults (bugs that couldn't be retrieved)
      if (data.faults && data.faults.length > 0) {
        console.warn(`[BugzillaAPI] ${data.faults.length} faults reported:`, data.faults);
      }

      return bugIds.map(id => this.cache.get(String(id))).filter(Boolean);
    } catch (error) {
      console.error(`[BugzillaAPI] Error fetching bugs:`, error);
      throw error;
    }
  }

  /**
   * Process raw Bugzilla API response into normalized bug object
   */
  processBug(rawBug) {
    const size = this.extractSize(rawBug.whiteboard);
    const keywords = rawBug.keywords || [];
    const isMeta = this.isMeta(rawBug.whiteboard, keywords, rawBug.summary);

    return {
      id: rawBug.id,
      summary: rawBug.summary,
      status: rawBug.status,
      resolution: rawBug.resolution || null,
      assignee: rawBug.assigned_to ? rawBug.assigned_to : null,
      dependsOn: rawBug.depends_on || [],
      blocks: rawBug.blocks || [],
      whiteboard: rawBug.whiteboard || '',
      keywords: keywords,
      component: rawBug.component,
      product: rawBug.product,
      severity: rawBug.severity || 'N/A',
      targetMilestone: rawBug.target_milestone || null,
      size: size,
      sizeEstimated: size === null,
      isMeta: isMeta
    };
  }

  /**
   * Check if bug is a meta/tracking bug
   * Looks for "meta" in whiteboard, keywords, or title
   */
  isMeta(whiteboard, keywords, summary) {
    // Check whiteboard for [meta]
    if (whiteboard && whiteboard.toLowerCase().includes('[meta]')) {
      return true;
    }
    // Check keywords for "meta"
    if (keywords && keywords.some(k => k.toLowerCase() === 'meta')) {
      return true;
    }
    // Check title for [meta]
    if (summary && summary.toLowerCase().includes('[meta]')) {
      return true;
    }
    return false;
  }

  /**
   * Extract size from whiteboard - format [size=x] or [size=x.y] per SPEC.md
   * Supports fractional sizes like [size=3.5]
   */
  extractSize(whiteboard) {
    if (!whiteboard) return null;

    // Format: [size=x] or [size=x.y] (supports fractional)
    const match = whiteboard.match(/\[size=(\d+\.?\d*)\]/i);
    if (match) {
      const size = parseFloat(match[1]);
      if (size >= 1 && size <= 5) {
        return size;
      }
    }
    return null;
  }

  /**
   * Recursively fetch all dependencies starting from root bugs
   * @param {Array<number>} rootBugIds - Root bug IDs (milestones)
   * @returns {Promise<Map<string, Object>>} Map of all bugs by ID
   */
  async fetchAllDependencies(rootBugIds) {
    const allBugs = new Map();
    const toFetch = new Set(rootBugIds.map(String));
    const fetched = new Set();
    const failedIds = new Set();

    this.fetchedCount = 0;
    this.totalDiscovered = rootBugIds.length;

    console.log(`[BugzillaAPI] Starting fetch with milestones: ${rootBugIds.join(', ')}`);
    this.reportProgress('starting', `Starting with ${rootBugIds.length} milestone bugs...`);

    let iteration = 0;
    const MAX_ITERATIONS = 1000; // Safety limit

    while (toFetch.size > 0 && iteration < MAX_ITERATIONS) {
      iteration++;

      // Get next batch to fetch
      const batch = Array.from(toFetch).slice(0, BATCH_SIZE);
      batch.forEach(id => {
        toFetch.delete(id);
        fetched.add(id);
      });

      console.log(`[BugzillaAPI] Iteration ${iteration}: Fetching batch of ${batch.length} bugs: ${batch.slice(0, 5).join(', ')}${batch.length > 5 ? '...' : ''}`);
      this.reportProgress('fetching', `Fetching batch of ${batch.length} bugs...`);

      try {
        const bugs = await this.fetchBugs(batch);
        console.log(`[BugzillaAPI] Received ${bugs.length} bugs`);

        for (const bug of bugs) {
          if (!bug) continue;
          allBugs.set(String(bug.id), bug);

          // Add dependencies to fetch queue
          if (bug.dependsOn.length > 0) {
            console.log(`[BugzillaAPI] Bug ${bug.id} (${bug.product}) depends on: ${bug.dependsOn.join(', ')}`);
          }
          for (const depId of bug.dependsOn) {
            const depIdStr = String(depId);
            if (!fetched.has(depIdStr) && !toFetch.has(depIdStr) && !failedIds.has(depIdStr)) {
              toFetch.add(depIdStr);
              this.totalDiscovered++;
            }
          }
        }

        this.reportProgress('progress', `Fetched ${this.fetchedCount}/${this.totalDiscovered} bugs`);

        // Small delay to avoid rate limiting
        if (toFetch.size > 0) {
          await this.delay(100);
        }
      } catch (error) {
        console.error(`[BugzillaAPI] Error fetching batch:`, error);
        // Mark failed IDs so we don't retry them
        batch.forEach(id => failedIds.add(id));
        this.reportProgress('error', `Error: ${error.message}`);
        // Continue with remaining bugs
      }
    }

    if (iteration >= MAX_ITERATIONS) {
      console.warn(`[BugzillaAPI] Reached max iterations (${MAX_ITERATIONS}), stopping`);
    }

    console.log(`[BugzillaAPI] Complete: ${allBugs.size} bugs fetched, ${failedIds.size} failed`);
    this.reportProgress('complete', `Fetched ${allBugs.size} bugs (${failedIds.size} failed)`);
    return allBugs;
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get cached bug count
   */
  getCacheSize() {
    return this.cache.size;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.fetchedCount = 0;
    this.totalDiscovered = 0;
  }
}

export default BugzillaAPI;
