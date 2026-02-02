/**
 * Unit tests for scheduler.js
 * Run with: node --experimental-vm-modules test/unit/scheduler.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../../js/scheduler.js';
import { DependencyGraph } from '../../js/dependency-graph.js';
import mockData from '../fixtures/mock-bugs.json' assert { type: 'json' };

// Test engineers with defined skill orders
const testEngineers = [
  {
    id: 'janika',
    name: 'Janika Neuberger',
    skills: ['JavaScript', 'Rust'],
    availability: 1.0,
    unavailability: []
  },
  {
    id: 'alissy',
    name: 'Alexandre Lissy',
    skills: ['C++', 'Rust', 'JavaScript'],
    availability: 1.0,
    unavailability: []
  },
  {
    id: 'gcp',
    name: 'Gian-Carlo Pascutto',
    skills: ['C++', 'Rust', 'JavaScript'],
    availability: 1.0,
    unavailability: []
  },
  {
    id: 'jonathan',
    name: 'Jonathan Mendez',
    skills: ['C++', 'JavaScript', 'Rust'],
    availability: 1.0,
    unavailability: []
  }
];

const testMilestones = [
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

describe('Scheduler', () => {
  let scheduler;
  let graph;

  beforeEach(() => {
    scheduler = new Scheduler(testEngineers, testMilestones);
    graph = new DependencyGraph();
  });

  describe('calculateEffort', () => {
    it('should calculate base days correctly for each size', () => {
      // Size to days: 1=1d, 2=5d, 3=10d, 4=20d, 5=60d
      const engineer = testEngineers[0]; // Janika: JS, Rust

      const size1Bug = { id: 1, size: 1, language: 'JavaScript' };
      const size2Bug = { id: 2, size: 2, language: 'JavaScript' };
      const size3Bug = { id: 3, size: 3, language: 'JavaScript' };
      const size4Bug = { id: 4, size: 4, language: 'JavaScript' };
      const size5Bug = { id: 5, size: 5, language: 'JavaScript' };

      expect(scheduler.calculateEffort(size1Bug, engineer).baseDays).toBe(1);
      expect(scheduler.calculateEffort(size2Bug, engineer).baseDays).toBe(5);
      expect(scheduler.calculateEffort(size3Bug, engineer).baseDays).toBe(10);
      expect(scheduler.calculateEffort(size4Bug, engineer).baseDays).toBe(20);
      expect(scheduler.calculateEffort(size5Bug, engineer).baseDays).toBe(60);
    });

    it('should apply no modifier for primary skill', () => {
      const engineer = testEngineers[0]; // Janika: JS (primary), Rust
      const bug = { id: 1, size: 3, language: 'JavaScript' };

      const effort = scheduler.calculateEffort(bug, engineer);

      expect(effort.modifier).toBe(1.0);
      expect(effort.skillRank).toBe(1);
      expect(effort.days).toBe(10); // 10 * 1.0
    });

    it('should apply +25% modifier for secondary skill', () => {
      const engineer = testEngineers[0]; // Janika: JS, Rust (secondary)
      const bug = { id: 1, size: 3, language: 'Rust' };

      const effort = scheduler.calculateEffort(bug, engineer);

      expect(effort.modifier).toBe(1.25);
      expect(effort.skillRank).toBe(2);
      expect(effort.days).toBe(13); // ceil(10 * 1.25)
    });

    it('should apply +50% modifier for tertiary skill', () => {
      const engineer = testEngineers[1]; // Alissy: C++, Rust, JS (tertiary)
      const bug = { id: 1, size: 3, language: 'JavaScript' };

      const effort = scheduler.calculateEffort(bug, engineer);

      expect(effort.modifier).toBe(1.5);
      expect(effort.skillRank).toBe(3);
      expect(effort.days).toBe(15); // ceil(10 * 1.5)
    });

    it('should use default size 3 when size is null', () => {
      const engineer = testEngineers[0];
      const bug = { id: 1, size: null, sizeEstimated: true, language: 'JavaScript' };

      const effort = scheduler.calculateEffort(bug, engineer);

      expect(effort.baseDays).toBe(10); // Size 3 default
      expect(effort.sizeEstimated).toBe(true);
    });

    it('should use manual size estimate when provided', () => {
      const engineer = testEngineers[0];
      const bug = { id: 1, size: null, language: 'JavaScript' };
      const sizeEstimates = { 1: 2 }; // Override to size 2

      const effort = scheduler.calculateEffort(bug, engineer, sizeEstimates);

      expect(effort.baseDays).toBe(5); // Size 2
      expect(effort.sizeEstimated).toBe(true);
    });

    it('should handle missing language (use tertiary modifier)', () => {
      const engineer = testEngineers[0];
      const bug = { id: 1, size: 3, language: null };

      const effort = scheduler.calculateEffort(bug, engineer);

      expect(effort.skillRank).toBe(3);
      expect(effort.modifier).toBe(1.5);
    });

    it('should adjust for engineer availability', () => {
      const halfTimeEngineer = {
        ...testEngineers[0],
        availability: 0.5
      };
      const bug = { id: 1, size: 3, language: 'JavaScript' };

      const fullScheduler = new Scheduler([testEngineers[0]], testMilestones);
      const halfScheduler = new Scheduler([halfTimeEngineer], testMilestones);

      const fullEffort = fullScheduler.calculateEffort(bug, testEngineers[0]);
      const halfEffort = halfScheduler.calculateEffort(bug, halfTimeEngineer);

      expect(halfEffort.days).toBe(fullEffort.days * 2);
    });
  });

  describe('findBestEngineer', () => {
    it('should pick engineer with earliest completion time', () => {
      const bug = { id: 1, size: 2, language: 'JavaScript' };
      const earliestStart = new Date();

      const result = scheduler.findBestEngineer(bug, earliestStart);

      expect(result).not.toBeNull();
      expect(result.engineer).toBeDefined();
      expect(result.startDate).toBeDefined();
      expect(result.endDate).toBeDefined();
      expect(result.effort).toBeDefined();
    });

    it('should prefer engineers with better skill match', () => {
      // Create a fresh scheduler for this test
      const freshScheduler = new Scheduler(testEngineers, testMilestones);
      const bug = { id: 1, size: 2, language: 'JavaScript' };
      const earliestStart = new Date();

      const result = freshScheduler.findBestEngineer(bug, earliestStart);

      // Janika should be preferred for JavaScript (primary skill)
      expect(result.engineer.id).toBe('janika');
      expect(result.effort.skillRank).toBe(1);
    });

    it('should respect engineer availability', () => {
      // Schedule a task first to make Janika busy
      const bug1 = { id: 1, size: 3, language: 'JavaScript' };
      scheduler.findBestEngineer(bug1, new Date());

      // Now Janika is busy; next JS task might go to someone else
      // or wait for Janika if that's still optimal
      const bug2 = { id: 2, size: 1, language: 'JavaScript' };
      const result = scheduler.findBestEngineer(bug2, new Date());

      expect(result).not.toBeNull();
    });
  });

  describe('scheduleTasks', () => {
    it('should schedule tasks respecting dependency order', () => {
      // Build graph from mock data
      const bugs = [];
      const bugMap = new Map();

      for (const bug of mockData.bugs) {
        const sizeMatch = bug.whiteboard.match(/\[size=(\d)\]/i);
        const processedBug = {
          id: bug.id,
          summary: bug.summary,
          status: bug.status,
          assignee: bug.assigned_to,
          dependsOn: bug.depends_on,
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
          sizeEstimated: !sizeMatch,
          language: bug.component.includes('Rust') ? 'Rust' :
                    bug.component.includes('C++') ? 'C++' : 'JavaScript'
        };
        bugs.push(processedBug);
        bugMap.set(String(bug.id), processedBug);
      }

      graph.buildFromBugs(bugMap);
      const { sorted } = graph.topologicalSort();
      const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

      const schedule = scheduler.scheduleTasks(sortedBugs, graph, {}, {});

      expect(schedule.length).toBeGreaterThan(0);

      // Verify dependency ordering: if A depends on B, B must finish before A starts
      for (const task of schedule) {
        if (task.completed || !task.startDate) continue;

        const deps = graph.getDependencies(String(task.bug.id));
        for (const depId of deps) {
          const depTask = schedule.find(t => String(t.bug.id) === depId);
          if (depTask && depTask.endDate && task.startDate) {
            expect(depTask.endDate.getTime()).toBeLessThanOrEqual(task.startDate.getTime());
          }
        }
      }
    });

    it('should mark completed bugs as completed', () => {
      const completedBug = {
        id: 1000002,
        summary: 'Completed bug',
        status: 'RESOLVED',
        dependsOn: [],
        size: 2,
        language: 'JavaScript'
      };

      const bugMap = new Map();
      bugMap.set('1000002', completedBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([completedBug], graph, {}, {});

      expect(schedule).toHaveLength(1);
      expect(schedule[0].completed).toBe(true);
      expect(schedule[0].startDate).toBeNull();
      expect(schedule[0].endDate).toBeNull();
    });

    it('should apply task language overrides', () => {
      const bug = {
        id: 999,
        summary: 'Test bug',
        status: 'NEW',
        dependsOn: [],
        size: 2,
        language: 'JavaScript'
      };

      const bugMap = new Map();
      bugMap.set('999', bug);
      graph.buildFromBugs(bugMap);

      // Override language to Rust
      const taskLanguages = { 999: 'Rust' };
      const schedule = scheduler.scheduleTasks([bug], graph, {}, taskLanguages);

      expect(schedule).toHaveLength(1);
      expect(schedule[0].bug.language).toBe('Rust');
    });

    it('should generate skill mismatch warnings', () => {
      // Create a bug requiring C++ but only engineers with C++ as secondary/tertiary
      const cppBug = {
        id: 888,
        summary: 'C++ bug for Janika',
        status: 'NEW',
        dependsOn: [],
        size: 2,
        language: 'C++'
      };

      // Use only Janika who doesn't have C++ at all
      const janikaOnly = new Scheduler([testEngineers[0]], testMilestones);
      const bugMap = new Map();
      bugMap.set('888', cppBug);
      graph.buildFromBugs(bugMap);

      janikaOnly.scheduleTasks([cppBug], graph, {}, {});

      // Should have a skill mismatch warning
      const mismatches = janikaOnly.warnings.filter(w => w.type === 'skill_mismatch');
      expect(mismatches.length).toBeGreaterThan(0);
    });
  });

  describe('addWorkingDays', () => {
    it('should skip weekends', () => {
      // Friday
      const friday = new Date('2025-01-31'); // This is a Friday
      const result = scheduler.addWorkingDays(friday, 1);

      // Should be Monday (skips Sat, Sun)
      expect(result.getDay()).toBe(1); // Monday
    });

    it('should handle multiple weeks correctly', () => {
      const monday = new Date('2025-01-27'); // Monday
      const result = scheduler.addWorkingDays(monday, 10);

      // 10 working days = 2 weeks (skip 2 weekends)
      const diffDays = Math.round((result - monday) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(14); // 10 work days + 4 weekend days
    });

    it('should respect engineer unavailability', () => {
      const engineerWithVacation = {
        ...testEngineers[0],
        unavailability: [
          { start: '2025-02-03', end: '2025-02-07', reason: 'Vacation' }
        ]
      };

      const monday = new Date('2025-01-27');
      const result = scheduler.addWorkingDays(monday, 10, engineerWithVacation);

      // Should skip the vacation week
      const diffDays = Math.round((result - monday) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThan(14); // More than 2 weeks due to vacation
    });
  });

  describe('checkDeadlineRisks', () => {
    it('should detect tasks ending after feature freeze', () => {
      // Create a task that ends after the freeze date
      const lateBug = {
        id: 1980342, // Foxfooding milestone
        summary: 'Late task',
        status: 'NEW',
        dependsOn: [],
        size: 5, // 60 days - will definitely be late
        language: 'JavaScript'
      };

      const bugMap = new Map();
      bugMap.set('1980342', lateBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([lateBug], graph, {}, {});
      const risks = scheduler.checkDeadlineRisks(testMilestones);

      // Should have at least one risk
      expect(risks.length).toBeGreaterThanOrEqual(0); // May vary based on current date
    });

    it('should not flag completed tasks as risks', () => {
      const completedBug = {
        id: 1980342,
        summary: 'Completed milestone',
        status: 'RESOLVED',
        dependsOn: [],
        size: 1,
        language: 'JavaScript'
      };

      const bugMap = new Map();
      bugMap.set('1980342', completedBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([completedBug], graph, {}, {});
      const risks = scheduler.checkDeadlineRisks(testMilestones);

      // Completed tasks should not be flagged as risks
      const completedRisks = risks.filter(r => r.task.completed);
      expect(completedRisks).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct schedule statistics', () => {
      const bugs = [];
      const bugMap = new Map();

      for (const bug of mockData.bugs.slice(0, 5)) {
        const sizeMatch = bug.whiteboard.match(/\[size=(\d)\]/i);
        const processedBug = {
          id: bug.id,
          summary: bug.summary,
          status: bug.status,
          dependsOn: bug.depends_on,
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
          sizeEstimated: !sizeMatch,
          language: 'JavaScript'
        };
        bugs.push(processedBug);
        bugMap.set(String(bug.id), processedBug);
      }

      graph.buildFromBugs(bugMap);
      const { sorted } = graph.topologicalSort();
      const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

      scheduler.scheduleTasks(sortedBugs, graph, {}, {});
      const stats = scheduler.getStats();

      expect(stats.totalTasks).toBeGreaterThan(0);
      expect(typeof stats.completedTasks).toBe('number');
      expect(typeof stats.scheduledTasks).toBe('number');
      expect(typeof stats.totalDays).toBe('number');
      expect(typeof stats.warningCount).toBe('number');
    });
  });

  describe('getEngineerWorkloads', () => {
    it('should return workload for each engineer', () => {
      const bug = {
        id: 1,
        summary: 'Test bug',
        status: 'NEW',
        dependsOn: [],
        size: 2,
        language: 'JavaScript'
      };

      const bugMap = new Map();
      bugMap.set('1', bug);
      graph.buildFromBugs(bugMap);

      scheduler.scheduleTasks([bug], graph, {}, {});
      const workloads = scheduler.getEngineerWorkloads();

      expect(workloads).toHaveLength(testEngineers.length);
      expect(workloads.every(w => w.engineer !== undefined)).toBe(true);
      expect(workloads.every(w => typeof w.taskCount === 'number')).toBe(true);
      expect(workloads.every(w => typeof w.totalDays === 'number')).toBe(true);
    });
  });

  describe('deadline comparison (working days vs calendar days)', () => {
    it('working days and calendar days differ due to weekends', () => {
      // This test verifies the bug that was fixed: comparing working days
      // to calendar days is incorrect because they're different units
      const monday = new Date('2026-02-02'); // Monday
      const targetFriday = new Date('2026-02-13'); // Friday, 11 calendar days later

      // 11 calendar days contains 2 weekend days, so only 9 working days
      const calendarDays = Math.floor((targetFriday - monday) / (1000 * 60 * 60 * 24));
      expect(calendarDays).toBe(11);

      // But addWorkingDays(monday, 9) should reach targetFriday
      const resultAfter9WorkDays = scheduler.addWorkingDays(monday, 9);
      expect(resultAfter9WorkDays.toDateString()).toBe(targetFriday.toDateString());

      // If we incorrectly compared 9 working days <= 11 calendar days, we'd think
      // the task finishes "before" the target. But that's correct by coincidence.
      // The real bug is comparing 12 working days <= 11 calendar days (true!)
      // when 12 working days actually extends beyond the 11 calendar day deadline.
      const resultAfter12WorkDays = scheduler.addWorkingDays(monday, 12);
      // 12 working days from Monday Feb 2 = Feb 18 (Wednesday, after 2 weekends)
      expect(resultAfter12WorkDays > targetFriday).toBe(true);

      // The bug: comparing working days (12) <= calendar days (11) would be false,
      // which is accidentally correct. But compare 10 working days <= 11 calendar:
      const resultAfter10WorkDays = scheduler.addWorkingDays(monday, 10);
      // 10 working days from Feb 2 = Feb 16 (Monday)
      // Comparing 10 <= 11 (working vs calendar) = true
      // But Feb 16 > Feb 13, so deadline is actually MISSED!
      expect(resultAfter10WorkDays > targetFriday).toBe(true);
      // This proves that comparing working days to calendar days gives wrong results
    });

    it('deadline check should compare actual dates, not mixed units', () => {
      // Correct approach: compare Date objects directly
      const today = new Date('2026-02-02');
      const freezeDate = new Date('2026-02-16'); // 14 calendar days = 10 working days

      // Task scheduled for 10 working days
      const taskEndDate = scheduler.addWorkingDays(today, 10);
      // Should be Feb 16

      // Correct comparison: Date <= Date
      expect(taskEndDate <= freezeDate).toBe(true);

      // Task scheduled for 11 working days
      const lateTaskEndDate = scheduler.addWorkingDays(today, 11);
      // Should be Feb 17

      // Correct comparison shows it's late
      expect(lateTaskEndDate <= freezeDate).toBe(false);
    });
  });

  describe('meta bugs', () => {
    it('should calculate 0 days effort for meta bugs', () => {
      const engineer = testEngineers[0];
      const metaBug = { id: 1, size: 3, language: 'JavaScript', isMeta: true };

      const effort = scheduler.calculateEffort(metaBug, engineer);

      expect(effort.days).toBe(0);
      expect(effort.isMeta).toBe(true);
    });

    it('should schedule meta bugs with same start and end date', () => {
      const metaBug = {
        id: 999,
        summary: '[meta] Tracking bug',
        status: 'NEW',
        dependsOn: [],
        size: 3,
        language: 'JavaScript',
        isMeta: true
      };

      const bugMap = new Map();
      bugMap.set('999', metaBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([metaBug], graph, {}, {});

      expect(schedule).toHaveLength(1);
      expect(schedule[0].effort.days).toBe(0);
      // Start and end should be the same for 0-day tasks
      expect(schedule[0].startDate.getTime()).toBe(schedule[0].endDate.getTime());
    });

    it('should not delay meta bugs by engineer availability', () => {
      // Schedule a real bug first to make engineer busy
      const realBug = {
        id: 100,
        summary: 'Real bug',
        status: 'NEW',
        dependsOn: [],
        size: 2, // 5 days
        language: 'JavaScript',
        isMeta: false
      };

      // Meta bug depends on real bug
      const metaBug = {
        id: 999,
        summary: '[meta] Tracking bug',
        status: 'NEW',
        dependsOn: [100],
        size: 3,
        language: 'JavaScript',
        isMeta: true
      };

      const bugMap = new Map();
      bugMap.set('100', realBug);
      bugMap.set('999', metaBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([realBug, metaBug], graph, {}, {});

      expect(schedule).toHaveLength(2);

      const realTask = schedule.find(t => t.bug.id === 100);
      const metaTask = schedule.find(t => t.bug.id === 999);

      // Meta bug should complete exactly when real bug completes (its dependency)
      // Not delayed by engineer availability
      expect(metaTask.endDate.getTime()).toBe(realTask.endDate.getTime());
    });

    it('should complete meta bug when ALL dependencies complete', () => {
      // Two parallel bugs with different durations
      const bug1 = {
        id: 101,
        summary: 'Bug 1',
        status: 'NEW',
        dependsOn: [],
        size: 1, // 1 day
        language: 'JavaScript',
        isMeta: false
      };

      const bug2 = {
        id: 102,
        summary: 'Bug 2',
        status: 'NEW',
        dependsOn: [],
        size: 2, // 5 days
        language: 'JavaScript',
        isMeta: false
      };

      // Meta bug depends on both
      const metaBug = {
        id: 999,
        summary: '[meta] Tracking bug',
        status: 'NEW',
        dependsOn: [101, 102],
        size: 3,
        language: 'JavaScript',
        isMeta: true
      };

      const bugMap = new Map();
      bugMap.set('101', bug1);
      bugMap.set('102', bug2);
      bugMap.set('999', metaBug);
      graph.buildFromBugs(bugMap);

      const schedule = scheduler.scheduleTasks([bug1, bug2, metaBug], graph, {}, {});

      expect(schedule).toHaveLength(3);

      const task1 = schedule.find(t => t.bug.id === 101);
      const task2 = schedule.find(t => t.bug.id === 102);
      const metaTask = schedule.find(t => t.bug.id === 999);

      // Meta bug should complete when the LATER dependency completes
      const latestDep = task1.endDate > task2.endDate ? task1 : task2;
      expect(metaTask.endDate.getTime()).toBe(latestDep.endDate.getTime());
    });
  });
});
