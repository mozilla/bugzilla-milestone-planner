# Enterprise Project Planner

## Overview

Single-page web app that fetches Mozilla Bugzilla data and visualizes project schedules as a Gantt chart. It builds a dependency graph from bug relationships, assigns tasks to engineers based on skills, and optimizes the schedule using simulated annealing in a Web Worker.

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
  - Assigns bugs to engineers by skill match
  - Engineer availability cascades between milestones

- **js/optimal-scheduler-worker.js** - Background optimizer
  - Branch-and-bound + simulated annealing
  - Posts progress updates to main thread
  - Receives filtered milestones from main thread

- **js/gantt-renderer.js** - Frappe Gantt wrapper
  - Contains `MILESTONES` constant with deadlines/freeze dates
  - Color codes tasks by status (estimated, at-risk, skill mismatch)

- **js/ui-controller.js** - DOM event handling
  - Filter dropdowns, view mode, export buttons

### Data Files

- **data/engineers.json** - Team members with skills and availability
- **data/size-estimates.json** - Size estimates for bugs missing whiteboard tags
- **data/task-languages.json** - Language mapping for bugs

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

Meta bugs take 0 days (tracking bugs). Detected by:
- `[meta]` in whiteboard
- `meta` keyword
- `[meta]` in bug title

### Skill Penalty

- Primary skill: 1x effort
- Secondary skill: 1.25x effort
- Tertiary skill: 1.5x effort

## Filters

Filters are applied in this order:
1. **Resolved Filter**: Excludes bugs with status RESOLVED, VERIFIED, or CLOSED (milestone bugs always included)
2. **Component Filter**: Only bugs from "Client" component (milestone bugs always included)
3. **Severity Filter**: Dropdown - S1 only, S1-S2 (default), S1-S3, or All (includes bugs without severity)
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

## External Dependencies

- **Frappe Gantt** - Loaded via CDN in index.html
- **Bugzilla REST API** - Mozilla's public API (no auth required for public bugs)
