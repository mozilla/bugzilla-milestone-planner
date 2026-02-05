# Enterprise Project Planner

## Overview

Single-page web app that fetches Mozilla Bugzilla data and visualizes project schedules as a Gantt chart. It builds a dependency graph from bug relationships, assigns tasks to engineers, and optimizes the schedule using a genetic algorithm in Web Workers.

## Commands

```bash
npm test              # Run unit tests (vitest)
npm run test:e2e      # Run E2E tests (playwright) - requires server running
npm run test:all      # Run both unit and E2E tests
npm run serve         # Start dev server on port 8080
```

E2E tests expect the server on port 8081 (see playwright.config.js).

## Architecture

### Core Files

- **js/main.js** - Application coordinator (`EnterpriseProjectPlanner` class)
  - Orchestrates data fetching, scheduling, and rendering
  - Manages filter state (severity, milestone)
  - Coordinates parallel GA workers
  - Handles exhaustive search mode

- **js/bugzilla-api.js** - Bugzilla REST API client
  - Fetches bug trees recursively from milestone root bugs
  - Extracts size from whiteboard `[size=X]` format

- **js/dependency-graph.js** - Graph operations
  - Builds adjacency lists from bug dependencies
  - Topological sort using Kahn's algorithm
  - Critical path calculation

- **js/scheduler.js** - Greedy scheduler
  - Milestone-aware: processes milestones in deadline order
  - Assigns bugs to engineer who can complete them earliest
  - Engineer availability cascades between milestones
  - Supports fractional sizes via interpolation

- **js/scheduler-core.js** - Shared scheduling utilities
  - `calculateEffort()` - size to days with availability scaling
  - `addWorkingDays()` - working day calculations (skips weekends)
  - `calculateDaysFromSize()` - fractional size interpolation
  - `isResolved()` - bug status checks

- **js/optimizer-utils.js** - Optimizer scoring utilities
  - `countWorkingDays()` - working days between dates
  - `calculateWorkingDaysMakespan()` - schedule makespan
  - `computeScoreFromCompletions()` - deadline scoring
  - `isBetterScore()` - score comparison (deadlines > lateness > makespan)

- **js/ga-scheduler-worker.js** - Genetic Algorithm optimizer (Web Worker)
  - Memetic GA with elitism and local search
  - Default: 40 population × 100 generations per worker
  - Exhaustive mode: 400 population × 300 generations
  - Tournament selection, two-point crossover, mutation
  - Precomputed caches for O(1) milestone/dependency lookups
  - Respects engineer unavailability periods

- **js/gantt-renderer.js** - Frappe Gantt wrapper
  - Contains `MILESTONES` constant with deadlines/freeze dates
  - Color codes tasks by status (estimated size, at-risk)
  - Engineer color-coded initials
  - Hover popups with task details

- **js/ui-controller.js** - DOM event handling
  - Filter dropdowns, view mode, export buttons
  - Optimization status and log display

### Data Files

- **data/engineers.json** - Team members with availability factors and unavailability periods

## Key Constants

### Milestones (in js/gantt-renderer.js)

| Name | Bug ID | Deadline | Feature Freeze |
|------|--------|----------|----------------|
| Foxfooding | 1980342 | Feb 23, 2026 | Feb 16, 2026 |
| Customer Pilot | 2012055 | Mar 30, 2026 | Mar 23, 2026 |
| MVP | 1980739 | Sep 15, 2026 | Sep 8, 2026 |

### Size to Days Mapping

| Size | Days |
|------|------|
| 1 | 1 |
| 2 | 5 |
| 3 | 10 |
| 4 | 20 |
| 5 | 60 |

**Fractional sizes** (e.g., `[size=2.5]`) are interpolated between integer values. For example, size 2.5 = round(5 + 0.5 × (10 - 5)) = 8 days.

**Default size** is 3 (10 days / 2 weeks) for bugs without a `[size=X]` whiteboard tag. These are listed in the "Missing Sizes" table.

**Meta bugs** take 0 days (tracking bugs). Detected by:
- `[meta]` in whiteboard
- `meta` keyword
- `[meta]` in bug title

### Availability Scaling

Engineer availability is a factor from 0.0 to 1.0. A task's duration is scaled by `1 / availability`. For example:
- Engineer with 100% availability: 5-day task takes 5 days
- Engineer with 33% availability: 5-day task takes ~15 days (5 / 0.33)

### GA Optimizer Configuration

The optimizer uses 2 parallel Web Workers (fixed, not based on CPU count—more workers cause browser contention).

| Mode | Population | Generations | Total Evaluations |
|------|------------|-------------|-------------------|
| Optimal | 160 | 100 | ~32,000 |
| Exhaustive | 400 | 300 | ~240,000 |

GA parameters per worker:
- Elite count: 4 (top 10% preserved)
- Tournament size: 3
- Crossover rate: 80%
- Mutation rate: 10%
- Local search: 10 swaps on best individual

Scoring priority: deadlines met > total lateness > makespan

## Filters

Filters are applied in this order:
1. **Resolved Filter**: Excludes bugs with status RESOLVED, VERIFIED, or CLOSED (milestone bugs always included)
2. **Component Filter**: Only bugs from "Client" component (milestone bugs always included)
3. **Severity Filter**: Dropdown - S1 only, S1-S2 (default), S1+S2+untriaged (includes bugs without severity), S1-S3, or All
4. **Milestone Filter**: Dropdown to show only bugs in a specific milestone's dependency tree (view-only, doesn't affect scheduling)

## Testing

Unit tests in `test/unit/` use Vitest. E2E tests in `test/e2e/` use Playwright.

### Test fixtures
- `test/fixtures/mock-bugs.json` - Synthetic data for unit tests
- `test/fixtures/live-snapshot.json` - Real Bugzilla data snapshot

### Unit test files
- `dependency-graph.test.js` - Graph operations
- `scheduler.test.js` - Greedy scheduler
- `optimizer-utils.test.js` - Scoring utilities
- `gantt-renderer-assignee.test.js` - Assignee display logic
- `main-optimizer.test.js` - Optimizer integration
- `snapshot.test.js` - Scheduler determinism with live data

### Capturing a new snapshot

To update the live snapshot from Bugzilla:

```bash
node scripts/capture-snapshot.js
```

This fetches the complete bug tree for all milestones and saves statistics.

### Benchmark scripts

```bash
node scripts/benchmark-ga.js           # GA performance benchmarks
node scripts/benchmark-optimizers.js   # Compare optimizer variants
node scripts/perf-test-scheduler.js    # Scheduler performance
```

## Common Issues

### "Optimization failed" error
Usually means the worker received malformed data. Check that:
1. `activeMilestones` is being passed correctly to the worker
2. Assignment format is consistent (objects vs numbers)

### Filters not taking effect
The app caches data. A hard refresh (Cmd+Shift+R) may be needed after code changes.

### Optimal schedule shows later dates than greedy
Fixed bugs:
1. Meta bugs (0 days) were incorrectly delayed by engineer availability - now they complete immediately when dependencies complete
2. Worker evaluated milestone completion using only the milestone bug's end time instead of max of ALL transitive dependencies
3. Worker compared working days to calendar days for deadline checks - now compares actual Date objects

## Deployment

Live demo: https://entplanner-cc8b9c69.pages.dev/

Deployed automatically via Cloudflare Pages on each push to main.

## External Dependencies

- **Frappe Gantt** - Loaded via CDN in index.html
- **Bugzilla REST API** - Mozilla's public API (no auth required for public bugs)
