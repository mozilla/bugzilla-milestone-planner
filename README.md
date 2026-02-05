# Enterprise Project Planner

A single-page web app that visualizes Mozilla Bugzilla project schedules as interactive Gantt charts.

**Live Demo:** https://entplanner-cc8b9c69.pages.dev/

## Features

- Fetches bug data from Mozilla Bugzilla REST API
- Builds dependency graphs from bug relationships
- Two scheduling modes:
  - **Greedy**: Instant, processes milestones in deadline order
  - **Optimized**: Genetic algorithm with parallel Web Workers
  - **Exhaustive**: Extended 20-second search for difficult schedules
- Interactive Gantt chart with drag-to-scroll and hover tooltips
- Filters by severity, milestone, and component
- Highlights deadline risks and missing size estimates
- Color-coded engineer assignments
- Real-time optimization progress log

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

- [CLAUDE.md](CLAUDE.md) - Developer guide: architecture, constants, common issues
- [SPEC.md](SPEC.md) - Product specification: features, algorithms, data formats
- [JOB_SCHEDULING.md](JOB_SCHEDULING.md) - Algorithm deep dive: GA implementation details
