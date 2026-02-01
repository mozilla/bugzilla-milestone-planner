/**
 * Dependency Graph module
 * DAG construction, topological sort using Kahn's algorithm, and cycle detection
 */

export class DependencyGraph {
  constructor() {
    this.nodes = new Map(); // id -> bug data
    this.edges = new Map(); // id -> Set of dependency IDs (things this bug depends on)
    this.reverseEdges = new Map(); // id -> Set of IDs that depend on this bug
  }

  /**
   * Add a bug node to the graph
   * @param {Object} bug - Bug object with id, dependsOn, etc.
   */
  addNode(bug) {
    const id = String(bug.id);
    this.nodes.set(id, bug);

    if (!this.edges.has(id)) {
      this.edges.set(id, new Set());
    }
    if (!this.reverseEdges.has(id)) {
      this.reverseEdges.set(id, new Set());
    }

    // Add dependency edges
    for (const depId of bug.dependsOn) {
      const depIdStr = String(depId);
      this.edges.get(id).add(depIdStr);

      if (!this.reverseEdges.has(depIdStr)) {
        this.reverseEdges.set(depIdStr, new Set());
      }
      this.reverseEdges.get(depIdStr).add(id);
    }
  }

  /**
   * Build graph from a Map of bugs
   * @param {Map<string, Object>} bugs - Map of bug ID to bug object
   */
  buildFromBugs(bugs) {
    for (const bug of bugs.values()) {
      this.addNode(bug);
    }
  }

  /**
   * Get all nodes in the graph
   * @returns {Array<Object>} Array of bug objects
   */
  getNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * Get a specific node
   * @param {string} id - Bug ID
   * @returns {Object|undefined} Bug object
   */
  getNode(id) {
    return this.nodes.get(String(id));
  }

  /**
   * Get dependencies of a bug (bugs that must complete before this one)
   * @param {string} id - Bug ID
   * @returns {Array<string>} Array of dependency bug IDs
   */
  getDependencies(id) {
    const deps = this.edges.get(String(id));
    return deps ? Array.from(deps) : [];
  }

  /**
   * Get dependents of a bug (bugs that depend on this one)
   * @param {string} id - Bug ID
   * @returns {Array<string>} Array of dependent bug IDs
   */
  getDependents(id) {
    const deps = this.reverseEdges.get(String(id));
    return deps ? Array.from(deps) : [];
  }

  /**
   * Detect cycles in the graph using DFS
   * @returns {Array<Array<string>>} Array of cycles (each cycle is array of IDs)
   */
  detectCycles() {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const dependencies = this.edges.get(nodeId) || new Set();
      for (const depId of dependencies) {
        if (!this.nodes.has(depId)) {
          // Dependency not in graph (external or missing)
          continue;
        }

        if (!visited.has(depId)) {
          dfs(depId);
        } else if (recursionStack.has(depId)) {
          // Found a cycle
          const cycleStart = path.indexOf(depId);
          const cycle = path.slice(cycleStart).concat(depId);
          cycles.push(cycle);
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Topological sort using Kahn's algorithm
   * @returns {{sorted: Array<string>, valid: boolean, cycles: Array}} Sort result
   */
  topologicalSort() {
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      return { sorted: [], valid: false, cycles };
    }

    // Calculate in-degree for each node (only counting edges within the graph)
    const inDegree = new Map();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }

    for (const [nodeId, deps] of this.edges) {
      if (!this.nodes.has(nodeId)) continue;
      for (const depId of deps) {
        if (this.nodes.has(depId)) {
          // depId must complete before nodeId, so nodeId has an incoming edge
          const current = inDegree.get(nodeId) || 0;
          inDegree.set(nodeId, current + 1);
        }
      }
    }

    // Find all nodes with no dependencies (in-degree 0)
    const queue = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const sorted = [];

    while (queue.length > 0) {
      // Sort queue for deterministic order (by bug ID)
      queue.sort((a, b) => parseInt(a) - parseInt(b));
      const nodeId = queue.shift();
      sorted.push(nodeId);

      // For each node that depends on this one
      const dependents = this.reverseEdges.get(nodeId) || new Set();
      for (const depId of dependents) {
        if (!this.nodes.has(depId)) continue;
        const newDegree = inDegree.get(depId) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) {
          queue.push(depId);
        }
      }
    }

    // Verify all nodes were processed
    if (sorted.length !== this.nodes.size) {
      // This shouldn't happen if cycle detection is correct
      return { sorted, valid: false, cycles: [] };
    }

    return { sorted, valid: true, cycles: [] };
  }

  /**
   * Find orphaned dependencies (dependencies that point to non-existent bugs)
   * @returns {Array<{from: string, to: string}>} Array of orphaned dependency edges
   */
  findOrphanedDependencies() {
    const orphaned = [];

    for (const [nodeId, deps] of this.edges) {
      for (const depId of deps) {
        if (!this.nodes.has(depId)) {
          orphaned.push({ from: nodeId, to: depId });
        }
      }
    }

    return orphaned;
  }

  /**
   * Find bugs with no assignee
   * @returns {Array<Object>} Array of bugs without assignees
   */
  findMissingAssignees() {
    return Array.from(this.nodes.values()).filter(bug => {
      return !bug.assignee || bug.assignee === 'nobody@mozilla.org';
    });
  }

  /**
   * Find open bugs with missing sizes
   * @returns {Array<Object>} Array of open bugs without sizes
   */
  findMissingSizes() {
    return Array.from(this.nodes.values()).filter(bug => {
      // Skip resolved/verified bugs - they don't need size estimates
      if (bug.status === 'RESOLVED' || bug.status === 'VERIFIED') return false;
      return bug.size === null;
    });
  }

  /**
   * Find duplicate summaries
   * @returns {Array<{summary: string, bugs: Array<Object>}>} Duplicate groups
   */
  findDuplicateSummaries() {
    const summaryMap = new Map();

    for (const bug of this.nodes.values()) {
      const summary = bug.summary.toLowerCase().trim();
      if (!summaryMap.has(summary)) {
        summaryMap.set(summary, []);
      }
      summaryMap.get(summary).push(bug);
    }

    return Array.from(summaryMap.entries())
      .filter(([_, bugs]) => bugs.length > 1)
      .map(([summary, bugs]) => ({ summary, bugs }));
  }

  /**
   * Calculate the critical path (longest path through dependencies)
   * @param {Object} sizeMap - Map of bug ID to size/effort
   * @returns {Array<string>} Bug IDs in critical path
   */
  calculateCriticalPath(sizeMap = {}) {
    const { sorted, valid } = this.topologicalSort();
    if (!valid) return [];

    const distance = new Map();
    const predecessor = new Map();

    // Initialize distances
    for (const nodeId of sorted) {
      distance.set(nodeId, 0);
      predecessor.set(nodeId, null);
    }

    // Calculate longest path
    for (const nodeId of sorted) {
      const bug = this.nodes.get(nodeId);
      const weight = sizeMap[nodeId] || bug?.size || 1;
      const currentDist = distance.get(nodeId);

      const dependents = this.reverseEdges.get(nodeId) || new Set();
      for (const depId of dependents) {
        if (!this.nodes.has(depId)) continue;
        const newDist = currentDist + weight;
        if (newDist > distance.get(depId)) {
          distance.set(depId, newDist);
          predecessor.set(depId, nodeId);
        }
      }
    }

    // Find node with maximum distance (end of critical path)
    let maxDist = 0;
    let endNode = null;
    for (const [nodeId, dist] of distance) {
      if (dist > maxDist) {
        maxDist = dist;
        endNode = nodeId;
      }
    }

    // Reconstruct path
    const path = [];
    let current = endNode;
    while (current !== null) {
      path.unshift(current);
      current = predecessor.get(current);
    }

    return path;
  }

  /**
   * Get graph statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    let totalEdges = 0;
    for (const deps of this.edges.values()) {
      totalEdges += deps.size;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: totalEdges,
      orphanedDeps: this.findOrphanedDependencies().length,
      missingAssignees: this.findMissingAssignees().length,
      missingSizes: this.findMissingSizes().length,
      duplicateSummaries: this.findDuplicateSummaries().length
    };
  }
}

export default DependencyGraph;
