/**
 * Unit tests for dependency-graph.js
 * Run with: node --experimental-vm-modules test/unit/dependency-graph.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../js/dependency-graph.js';
import mockData from '../fixtures/mock-bugs.json' assert { type: 'json' };

describe('DependencyGraph', () => {
  let graph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('addNode', () => {
    it('should add a bug node to the graph', () => {
      const bug = {
        id: 123,
        summary: 'Test bug',
        dependsOn: []
      };

      graph.addNode(bug);

      expect(graph.getNode('123')).toEqual(bug);
      expect(graph.getNodes()).toHaveLength(1);
    });

    it('should add dependency edges correctly', () => {
      const parentBug = {
        id: 100,
        summary: 'Parent bug',
        dependsOn: []
      };
      const childBug = {
        id: 200,
        summary: 'Child bug',
        dependsOn: [100]
      };

      graph.addNode(parentBug);
      graph.addNode(childBug);

      expect(graph.getDependencies('200')).toContain('100');
      expect(graph.getDependents('100')).toContain('200');
    });
  });

  describe('buildFromBugs', () => {
    it('should build graph from bug map', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          status: bug.status,
          dependsOn: bug.depends_on,
          size: null,
          sizeEstimated: true
        });
      }

      graph.buildFromBugs(bugs);

      expect(graph.getNodes().length).toBe(mockData.bugs.length);
    });
  });

  describe('detectCycles', () => {
    it('should return empty array for acyclic graph', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          dependsOn: bug.depends_on
        });
      }

      graph.buildFromBugs(bugs);
      const cycles = graph.detectCycles();

      expect(cycles).toHaveLength(0);
    });

    it('should detect cycles in graph', () => {
      const cycleGraph = new DependencyGraph();

      for (const bug of mockData.cycle_bugs) {
        cycleGraph.addNode({
          id: bug.id,
          summary: bug.summary,
          dependsOn: bug.depends_on
        });
      }

      const cycles = cycleGraph.detectCycles();

      expect(cycles.length).toBeGreaterThan(0);
      // Cycle should contain both bug IDs
      const cycleIds = cycles[0];
      expect(cycleIds).toContain('9000001');
      expect(cycleIds).toContain('9000002');
    });

    it('should handle self-referencing cycle', () => {
      const selfRefGraph = new DependencyGraph();
      selfRefGraph.addNode({
        id: 1,
        summary: 'Self-referencing bug',
        dependsOn: [1]
      });

      const cycles = selfRefGraph.detectCycles();

      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('topologicalSort', () => {
    it('should return valid ordering for acyclic graph', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          dependsOn: bug.depends_on
        });
      }

      graph.buildFromBugs(bugs);
      const { sorted, valid, cycles } = graph.topologicalSort();

      expect(valid).toBe(true);
      expect(cycles).toHaveLength(0);
      expect(sorted.length).toBe(mockData.bugs.length);

      // Verify dependency ordering: 1000007 must come before 1000001
      const idx1000007 = sorted.indexOf('1000007');
      const idx1000001 = sorted.indexOf('1000001');
      expect(idx1000007).toBeLessThan(idx1000001);

      // Verify 1000007 must come before 1000003
      const idx1000003 = sorted.indexOf('1000003');
      expect(idx1000007).toBeLessThan(idx1000003);
    });

    it('should return invalid for cyclic graph', () => {
      const cycleGraph = new DependencyGraph();
      for (const bug of mockData.cycle_bugs) {
        cycleGraph.addNode({
          id: bug.id,
          summary: bug.summary,
          dependsOn: bug.depends_on
        });
      }

      const { sorted, valid, cycles } = cycleGraph.topologicalSort();

      expect(valid).toBe(false);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should handle empty graph', () => {
      const { sorted, valid, cycles } = graph.topologicalSort();

      expect(valid).toBe(true);
      expect(sorted).toHaveLength(0);
      expect(cycles).toHaveLength(0);
    });

    it('should handle single node', () => {
      graph.addNode({
        id: 1,
        summary: 'Single node',
        dependsOn: []
      });

      const { sorted, valid } = graph.topologicalSort();

      expect(valid).toBe(true);
      expect(sorted).toHaveLength(1);
      expect(sorted[0]).toBe('1');
    });
  });

  describe('findOrphanedDependencies', () => {
    it('should detect dependencies pointing to non-existent bugs', () => {
      for (const bug of mockData.orphan_bugs) {
        graph.addNode({
          id: bug.id,
          summary: bug.summary,
          dependsOn: bug.depends_on
        });
      }

      const orphaned = graph.findOrphanedDependencies();

      expect(orphaned.length).toBeGreaterThan(0);
      expect(orphaned[0].from).toBe('8000001');
      expect(orphaned[0].to).toBe('9999999');
    });

    it('should return empty array when all dependencies exist', () => {
      graph.addNode({ id: 1, summary: 'Bug 1', dependsOn: [] });
      graph.addNode({ id: 2, summary: 'Bug 2', dependsOn: [1] });

      const orphaned = graph.findOrphanedDependencies();

      expect(orphaned).toHaveLength(0);
    });
  });

  describe('findMissingAssignees', () => {
    it('should find bugs without assignees', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          assignee: bug.assigned_to,
          dependsOn: bug.depends_on
        });
      }

      graph.buildFromBugs(bugs);
      const missing = graph.findMissingAssignees();

      // Mock data has 2 bugs with null assignee: 1000005, 1000010
      expect(missing.length).toBe(2);
      const ids = missing.map(b => b.id);
      expect(ids).toContain(1000005);
      expect(ids).toContain(1000010);
    });

    it('should treat nobody@mozilla.org as missing', () => {
      graph.addNode({
        id: 1,
        summary: 'Bug with nobody',
        assignee: 'nobody@mozilla.org',
        dependsOn: []
      });

      const missing = graph.findMissingAssignees();

      expect(missing).toHaveLength(1);
    });
  });

  describe('findMissingSizes', () => {
    it('should find bugs without sizes', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        // Parse size from whiteboard
        const sizeMatch = bug.whiteboard.match(/\[size=(\d)\]/i);
        const size = sizeMatch ? parseInt(sizeMatch[1], 10) : null;

        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          size: size,
          dependsOn: bug.depends_on
        });
      }

      graph.buildFromBugs(bugs);
      const missing = graph.findMissingSizes();

      // Bug 1000005 has empty whiteboard
      expect(missing.length).toBeGreaterThanOrEqual(1);
      const ids = missing.map(b => b.id);
      expect(ids).toContain(1000005);
    });
  });

  describe('findDuplicateSummaries', () => {
    it('should find bugs with duplicate summaries', () => {
      graph.addNode({ id: 1, summary: 'Duplicate Title', dependsOn: [] });
      graph.addNode({ id: 2, summary: 'Duplicate Title', dependsOn: [] });
      graph.addNode({ id: 3, summary: 'Unique Title', dependsOn: [] });

      const duplicates = graph.findDuplicateSummaries();

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].summary).toBe('duplicate title');
      expect(duplicates[0].bugs).toHaveLength(2);
    });

    it('should be case-insensitive', () => {
      graph.addNode({ id: 1, summary: 'Test Bug', dependsOn: [] });
      graph.addNode({ id: 2, summary: 'TEST BUG', dependsOn: [] });

      const duplicates = graph.findDuplicateSummaries();

      expect(duplicates).toHaveLength(1);
    });

    it('should return empty array when no duplicates', () => {
      graph.addNode({ id: 1, summary: 'Bug A', dependsOn: [] });
      graph.addNode({ id: 2, summary: 'Bug B', dependsOn: [] });

      const duplicates = graph.findDuplicateSummaries();

      expect(duplicates).toHaveLength(0);
    });
  });

  describe('calculateCriticalPath', () => {
    it('should find longest path through graph', () => {
      // Create a simple linear dependency chain
      graph.addNode({ id: 1, summary: 'Start', dependsOn: [], size: 1 });
      graph.addNode({ id: 2, summary: 'Middle', dependsOn: [1], size: 2 });
      graph.addNode({ id: 3, summary: 'End', dependsOn: [2], size: 1 });

      const sizeMap = { '1': 1, '2': 5, '3': 1 };
      const criticalPath = graph.calculateCriticalPath(sizeMap);

      expect(criticalPath).toContain('1');
      expect(criticalPath).toContain('2');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const bugs = new Map();
      for (const bug of mockData.bugs) {
        const sizeMatch = bug.whiteboard.match(/\[size=(\d)\]/i);
        bugs.set(String(bug.id), {
          id: bug.id,
          summary: bug.summary,
          assignee: bug.assigned_to,
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
          dependsOn: bug.depends_on
        });
      }

      graph.buildFromBugs(bugs);
      const stats = graph.getStats();

      expect(stats.nodeCount).toBe(mockData.bugs.length);
      expect(stats.edgeCount).toBeGreaterThan(0);
      expect(typeof stats.orphanedDeps).toBe('number');
      expect(typeof stats.missingAssignees).toBe('number');
      expect(typeof stats.missingSizes).toBe('number');
    });
  });
});
