/**
 * Tests that process the live Bugzilla snapshot to verify
 * scheduling algorithms produce sensible, stable results.
 *
 * To update the snapshot: node scripts/capture-snapshot.js
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Scheduler } from '../../js/scheduler.js';
import { DependencyGraph } from '../../js/dependency-graph.js';
import snapshot from '../fixtures/live-snapshot.json' assert { type: 'json' };
import engineersData from '../../data/engineers.json' assert { type: 'json' };

// Milestones with proper Date objects (matching gantt-renderer.js)
const MILESTONES = [
  {
    name: 'Foxfooding Alpha',
    bugId: 1980342,
    deadline: new Date('2026-03-02'),
    freezeDate: new Date('2026-02-23')
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

const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];
const milestoneBugIds = MILESTONES.map(m => m.bugId);

describe('Snapshot Processing', () => {
  let bugs;
  let bugMap;
  let graph;
  let sortedBugs;
  let filteredBugs;

  beforeAll(() => {
    // Load bugs from snapshot
    bugs = snapshot.bugs;
    bugMap = new Map();
    for (const bug of bugs) {
      bugMap.set(String(bug.id), bug);
    }

    // Build dependency graph
    graph = new DependencyGraph();
    graph.buildFromBugs(bugMap);

    // Topological sort
    const { sorted } = graph.topologicalSort();
    sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

    // Apply filters (same as main.js)
    filteredBugs = sortedBugs
      // Filter resolved bugs (keep milestones)
      .filter(bug =>
        milestoneBugIds.includes(bug.id) ||
        !RESOLVED_STATUSES.includes(bug.status)
      )
      // Filter to Client component (keep milestones)
      .filter(bug =>
        milestoneBugIds.includes(bug.id) ||
        bug.component === 'Client'
      )
      // Default severity filter: S1-S2
      .filter(bug => {
        if (milestoneBugIds.includes(bug.id)) return true;
        const sev = bug.severity || 'N/A';
        return sev === 'S1' || sev === 'S2';
      });
  });

  describe('Bug count verification', () => {
    it('should match snapshot total bug count', () => {
      expect(bugs.length).toBe(snapshot.stats.totalBugs);
    });

    it('should match resolved bug count', () => {
      const resolved = bugs.filter(b => RESOLVED_STATUSES.includes(b.status));
      expect(resolved.length).toBe(snapshot.stats.resolvedBugs);
    });

    it('should match unresolved bug count', () => {
      const unresolved = bugs.filter(b => !RESOLVED_STATUSES.includes(b.status));
      expect(unresolved.length).toBe(snapshot.stats.unresolvedBugs);
    });

    it('should match Client component bug count', () => {
      const clientBugs = bugs.filter(b => b.component === 'Client');
      expect(clientBugs.length).toBe(snapshot.stats.clientBugs);
    });

    it('should match meta bug count', () => {
      const metaBugs = bugs.filter(b => b.isMeta);
      expect(metaBugs.length).toBe(snapshot.stats.metaBugs);
    });

    it('should match bugs with/without size counts', () => {
      const withSize = bugs.filter(b => b.size !== null);
      const withoutSize = bugs.filter(b => b.size === null);
      expect(withSize.length).toBe(snapshot.stats.bugsWithSize);
      expect(withoutSize.length).toBe(snapshot.stats.bugsWithoutSize);
    });

    it('should have all milestone bugs present', () => {
      for (const milestone of MILESTONES) {
        const bug = bugMap.get(String(milestone.bugId));
        expect(bug).toBeDefined();
        expect(bug.id).toBe(milestone.bugId);
      }
    });
  });

  describe('Dependency graph integrity', () => {
    it('should have no orphaned dependencies (missing bugs)', () => {
      let orphanCount = 0;
      for (const bug of bugs) {
        for (const depId of bug.dependsOn) {
          if (!bugMap.has(String(depId))) {
            orphanCount++;
          }
        }
      }
      // Some orphans may exist (external dependencies), but flag if many
      expect(orphanCount).toBeLessThan(bugs.length * 0.1);
    });

    it('should produce a valid topological sort', () => {
      const { valid, sorted } = graph.topologicalSort();
      expect(valid).toBe(true);
      expect(sorted.length).toBeGreaterThan(0);
    });

    it('sorted bugs should respect dependency order', () => {
      const positionMap = new Map();
      sortedBugs.forEach((bug, idx) => positionMap.set(String(bug.id), idx));

      for (const bug of sortedBugs) {
        const bugPos = positionMap.get(String(bug.id));
        for (const depId of bug.dependsOn) {
          const depPos = positionMap.get(String(depId));
          if (depPos !== undefined) {
            // Dependencies should come before the bug
            expect(depPos).toBeLessThan(bugPos);
          }
        }
      }
    });
  });

  describe('Greedy scheduler determinism', () => {
    it('should produce identical results on multiple runs', () => {
      const engineers = engineersData.engineers;

      // Run scheduler twice
      const scheduler1 = new Scheduler(engineers, MILESTONES);
      const schedule1 = scheduler1.scheduleTasks(filteredBugs, graph);

      const scheduler2 = new Scheduler(engineers, MILESTONES);
      const schedule2 = scheduler2.scheduleTasks(filteredBugs, graph);

      // Results should be identical
      expect(schedule1.length).toBe(schedule2.length);

      for (let i = 0; i < schedule1.length; i++) {
        const task1 = schedule1[i];
        const task2 = schedule2[i];

        expect(task1.bug.id).toBe(task2.bug.id);
        expect(task1.completed).toBe(task2.completed);

        if (task1.startDate && task2.startDate) {
          expect(task1.startDate.getTime()).toBe(task2.startDate.getTime());
        }
        if (task1.endDate && task2.endDate) {
          expect(task1.endDate.getTime()).toBe(task2.endDate.getTime());
        }
        if (task1.engineer && task2.engineer) {
          expect(task1.engineer.id).toBe(task2.engineer.id);
        }
      }
    });

    it('should schedule all filtered bugs', () => {
      const engineers = engineersData.engineers;
      const scheduler = new Scheduler(engineers, MILESTONES);
      const schedule = scheduler.scheduleTasks(filteredBugs, graph);

      // All bugs should be scheduled (completed or with dates)
      expect(schedule.length).toBe(filteredBugs.length);
    });

    it('should respect dependency constraints in schedule', () => {
      const engineers = engineersData.engineers;
      const scheduler = new Scheduler(engineers, MILESTONES);
      const schedule = scheduler.scheduleTasks(filteredBugs, graph);

      const endDateMap = new Map();
      for (const task of schedule) {
        if (task.endDate) {
          endDateMap.set(String(task.bug.id), task.endDate);
        }
      }

      for (const task of schedule) {
        if (task.completed || !task.startDate) continue;

        const deps = graph.getDependencies(String(task.bug.id));
        for (const depId of deps) {
          const depEndDate = endDateMap.get(depId);
          if (depEndDate) {
            expect(depEndDate.getTime()).toBeLessThanOrEqual(task.startDate.getTime());
          }
        }
      }
    });
  });

  describe('Schedule sanity checks', () => {
    let schedule;
    let stats;

    beforeAll(() => {
      const engineers = engineersData.engineers;
      const scheduler = new Scheduler(engineers, MILESTONES);
      schedule = scheduler.scheduleTasks(filteredBugs, graph);
      stats = scheduler.getStats();
    });

    it('should have reasonable total days', () => {
      // Total effort should be positive and not absurdly large
      expect(stats.totalDays).toBeGreaterThan(0);
      expect(stats.totalDays).toBeLessThan(10000); // Sanity check
    });

    it('should have start dates before end dates', () => {
      for (const task of schedule) {
        if (task.startDate && task.endDate) {
          expect(task.startDate.getTime()).toBeLessThanOrEqual(task.endDate.getTime());
        }
      }
    });

    it('should have all scheduled dates in the future or today', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const task of schedule) {
        if (task.startDate) {
          expect(task.startDate.getTime()).toBeGreaterThanOrEqual(today.getTime());
        }
      }
    });

    it('meta bugs should have zero duration', () => {
      for (const task of schedule) {
        if (task.bug.isMeta && task.effort) {
          expect(task.effort.days).toBe(0);
        }
      }
    });

    it('completed bugs should have no dates', () => {
      for (const task of schedule) {
        if (task.completed) {
          expect(task.startDate).toBeNull();
          expect(task.endDate).toBeNull();
        }
      }
    });
  });

  describe('Filter combinations', () => {
    it('S1-only filter should have fewer bugs than S1-S2', () => {
      const s1Only = sortedBugs
        .filter(bug =>
          milestoneBugIds.includes(bug.id) ||
          !RESOLVED_STATUSES.includes(bug.status)
        )
        .filter(bug =>
          milestoneBugIds.includes(bug.id) ||
          bug.component === 'Client'
        )
        .filter(bug => {
          if (milestoneBugIds.includes(bug.id)) return true;
          return bug.severity === 'S1';
        });

      expect(s1Only.length).toBeLessThanOrEqual(filteredBugs.length);
    });

    it('S1-S2+untriaged filter should have more bugs than S1-S2', () => {
      const withUntriaged = sortedBugs
        .filter(bug =>
          milestoneBugIds.includes(bug.id) ||
          !RESOLVED_STATUSES.includes(bug.status)
        )
        .filter(bug =>
          milestoneBugIds.includes(bug.id) ||
          bug.component === 'Client'
        )
        .filter(bug => {
          if (milestoneBugIds.includes(bug.id)) return true;
          const sev = bug.severity || 'N/A';
          return sev === 'S1' || sev === 'S2' || sev === 'N/A' || sev === '--';
        });

      expect(withUntriaged.length).toBeGreaterThanOrEqual(filteredBugs.length);
    });
  });

  describe('Severity breakdown verification', () => {
    it('should have consistent severity counts among filtered bugs', () => {
      // Count severity in our filtered set
      const severityCounts = {};
      for (const bug of filteredBugs) {
        if (milestoneBugIds.includes(bug.id)) continue; // Skip milestones
        const sev = bug.severity || 'N/A';
        severityCounts[sev] = (severityCounts[sev] || 0) + 1;
      }

      // With S1-S2 filter, we should only have S1 and S2
      const severities = Object.keys(severityCounts);
      for (const sev of severities) {
        expect(['S1', 'S2'].includes(sev)).toBe(true);
      }
    });
  });
});

describe('Scheduler statistics consistency', () => {
  it('totalTasks should equal completedTasks + scheduledTasks', () => {
    const engineers = engineersData.engineers;

    // Apply filters
    const bugMap = new Map();
    for (const bug of snapshot.bugs) {
      bugMap.set(String(bug.id), bug);
    }

    const graph = new DependencyGraph();
    graph.buildFromBugs(bugMap);
    const { sorted } = graph.topologicalSort();
    const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

    const filteredBugs = sortedBugs
      .filter(bug =>
        milestoneBugIds.includes(bug.id) ||
        !RESOLVED_STATUSES.includes(bug.status)
      )
      .filter(bug =>
        milestoneBugIds.includes(bug.id) ||
        bug.component === 'Client'
      )
      .filter(bug => {
        if (milestoneBugIds.includes(bug.id)) return true;
        const sev = bug.severity || 'N/A';
        return sev === 'S1' || sev === 'S2';
      });

    const scheduler = new Scheduler(engineers, MILESTONES);
    scheduler.scheduleTasks(filteredBugs, graph);
    const stats = scheduler.getStats();

    expect(stats.totalTasks).toBe(stats.completedTasks + stats.scheduledTasks);
  });
});
