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

    const url = `${BUGZILLA_API_BASE}/bug/${id}?include_fields=id,summary,status,resolution,assigned_to,depends_on,blocks,whiteboard,component,product`;

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

    const url = `${BUGZILLA_API_BASE}/bug?id=${uncachedIds.join(',')}&include_fields=id,summary,status,resolution,assigned_to,depends_on,blocks,whiteboard,component,product`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();

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

      return bugIds.map(id => this.cache.get(String(id))).filter(Boolean);
    } catch (error) {
      console.error(`Error fetching bugs:`, error);
      throw error;
    }
  }

  /**
   * Process raw Bugzilla API response into normalized bug object
   */
  processBug(rawBug) {
    const size = this.extractSize(rawBug.whiteboard);
    const language = this.extractLanguage(rawBug.whiteboard, rawBug.component);

    return {
      id: rawBug.id,
      summary: rawBug.summary,
      status: rawBug.status,
      resolution: rawBug.resolution || null,
      assignee: rawBug.assigned_to ? rawBug.assigned_to : null,
      dependsOn: rawBug.depends_on || [],
      blocks: rawBug.blocks || [],
      whiteboard: rawBug.whiteboard || '',
      component: rawBug.component,
      product: rawBug.product,
      size: size,
      sizeEstimated: size === null,
      language: language
    };
  }

  /**
   * Extract size from whiteboard - format [size=x] per SPEC.md
   */
  extractSize(whiteboard) {
    if (!whiteboard) return null;

    // Primary format from SPEC: [size=x]
    const match = whiteboard.match(/\[size=(\d)\]/i);
    if (match) {
      const size = parseInt(match[1], 10);
      if (size >= 1 && size <= 5) {
        return size;
      }
    }
    return null;
  }

  /**
   * Extract language from whiteboard or component
   */
  extractLanguage(whiteboard, component) {
    const text = `${whiteboard} ${component}`.toLowerCase();

    if (text.includes('rust')) return 'Rust';
    if (text.includes('c++') || text.includes('cpp')) return 'C++';
    if (text.includes('javascript') || text.includes('js') || text.includes('frontend')) return 'JavaScript';

    // Default based on component patterns
    if (component) {
      const comp = component.toLowerCase();
      if (comp.includes('ui') || comp.includes('frontend')) return 'JavaScript';
      if (comp.includes('core') || comp.includes('engine')) return 'C++';
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

    this.fetchedCount = 0;
    this.totalDiscovered = rootBugIds.length;

    this.reportProgress('starting', `Starting with ${rootBugIds.length} milestone bugs...`);

    while (toFetch.size > 0) {
      // Get next batch to fetch
      const batch = Array.from(toFetch).slice(0, BATCH_SIZE);
      batch.forEach(id => {
        toFetch.delete(id);
        fetched.add(id);
      });

      this.reportProgress('fetching', `Fetching batch of ${batch.length} bugs...`);

      try {
        const bugs = await this.fetchBugs(batch);

        for (const bug of bugs) {
          allBugs.set(String(bug.id), bug);

          // Add dependencies to fetch queue
          for (const depId of bug.dependsOn) {
            const depIdStr = String(depId);
            if (!fetched.has(depIdStr) && !toFetch.has(depIdStr)) {
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
        console.error('Error fetching batch:', error);
        this.reportProgress('error', `Error: ${error.message}`);
      }
    }

    this.reportProgress('complete', `Fetched all ${this.fetchedCount} bugs`);
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
