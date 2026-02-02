# Enterprise Project Planner

A single-page web app that visualizes Mozilla Bugzilla project schedules as interactive Gantt charts.

**Live Demo:** https://entplanner-cc8b9c69.pages.dev/

## Features

- Fetches bug data from Mozilla Bugzilla REST API
- Builds dependency graphs from bug relationships
- Supports multiple scheduling algorithms:
  - **Greedy**: Fast, processes milestones in deadline order
  - **Optimal**: Uses simulated annealing to minimize project completion time
- Interactive Gantt chart with drag-to-scroll and hover tooltips
- Filters by severity, milestone, and component
- Highlights deadline risks and missing size estimates
- Exports schedule data as JSON

## Quick Start

```bash
npm install
npm run serve
```

Then open http://localhost:8080

## Testing

```bash
npm test           # Unit tests (vitest)
npm run test:e2e   # E2E tests (playwright, requires server on port 8081)
npm run test:all   # Both
```

## Documentation

See [CLAUDE.md](CLAUDE.md) for architecture details, key constants, and common issues.
