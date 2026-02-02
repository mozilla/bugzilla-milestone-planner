# Enterprise Project Planner

## Overview

Single-page web app that fetches Mozilla Bugzilla data and visualizes project schedules as a Gantt chart. It builds a dependency graph from bug relationships, assigns tasks to engineers, and optimizes the schedule using simulated annealing in a Web Worker.

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
  - Starts/stops the optimization Web Worker

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

- **js/optimal-scheduler-worker.js** - Background optimizer
  - Branch-and-bound + simulated annealing
  - Posts progress updates to main thread
  - Receives filtered milestones from main thread

- **js/gantt-renderer.js** - Frappe Gantt wrapper
  - Contains `MILESTONES` constant with deadlines/freeze dates
  - Color codes tasks by status (estimated size, at-risk)

- **js/ui-controller.js** - DOM event handling
  - Filter dropdowns, view mode, export buttons

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

**Fractional sizes** (e.g., `[size=2.5]`) are interpolated between integer values. For example, size 2.5 = ceil(5 + 0.5 × (10 - 5)) = 8 days.

**Default size** is 3 (10 days / 2 weeks) for bugs without a `[size=X]` whiteboard tag. These are listed in the "Missing Sizes" table.

**Meta bugs** take 0 days (tracking bugs). Detected by:
- `[meta]` in whiteboard
- `meta` keyword
- `[meta]` in bug title

### Availability Scaling

Engineer availability is a factor from 0.0 to 1.0. A task's duration is scaled by `1 / availability`. For example:
- Engineer with 100% availability: 5-day task takes 5 days
- Engineer with 20% availability: 5-day task takes 25 days (5 / 0.2)

## Filters

Filters are applied in this order:
1. **Resolved Filter**: Excludes bugs with status RESOLVED, VERIFIED, or CLOSED (milestone bugs always included)
2. **Component Filter**: Only bugs from "Client" component (milestone bugs always included)
3. **Severity Filter**: Dropdown - S1 only, S1-S2 (default), S1+S2+untriaged (includes bugs without severity), S1-S3, or All
4. **Milestone Filter**: Dropdown to show only bugs in a specific milestone's dependency tree

## Testing

Unit tests in `test/unit/` use Vitest. E2E tests in `test/e2e/` use Playwright.

Test fixtures in `test/fixtures/mock-bugs.json`.

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

## External Dependencies

- **Frappe Gantt** - Loaded via CDN in index.html
- **Bugzilla REST API** - Mozilla's public API (no auth required for public bugs)
