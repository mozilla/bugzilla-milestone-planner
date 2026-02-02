# Enterprise Project Planner Specification v2

This is an updated specification reflecting simplifications made to the original design.

## Source Data

### Bugzilla

Bugzilla is the main repository for project information. The app fetches bugs and their dependency trees via the REST API.

API documentation:
- https://bugzilla.readthedocs.io/en/stable/api/index.html
- https://wiki.mozilla.org/Bugzilla:REST_API

### Project Milestones

| Name | Deadline | Master Bug |
|------|----------|------------|
| Foxfooding | February 23, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=1980342 |
| Customer Pilot | March 30, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=2012055 |
| MVP | September 15, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=1980739 |

Feature freeze is 1 week before each deadline for QA, so development should finish before freeze.

## Task Size

Found in Bugzilla whiteboard, format `[size=X]` where X is:

| Score | Engineer Time |
|-------|---------------|
| 1 | 1 day |
| 2 | 1 week (5 days) |
| 3 | 2 weeks (10 days) |
| 4 | 4 weeks (20 days) |
| 5 | 12 weeks (60 days) |

### Fractional Sizes

Fractional sizes like `[size=2.5]` or `[size=3.5]` are supported. Days are calculated by linear interpolation between integer values:

```
days = ceil(lower_days + fraction × (upper_days - lower_days))
```

Example: size 2.5 → ceil(5 + 0.5 × (10 - 5)) = 8 days

### Default Size

Bugs without a `[size=X]` whiteboard tag default to **size 3 (2 weeks)**. These are listed in a "Missing Sizes" table in the output with their bug titles, so users can add proper estimates.

### Meta Bugs

Tracking bugs (detected by `[meta]` in whiteboard, `meta` keyword, or `[meta]` in title) take **0 days** and don't consume engineer time. They complete when all their dependencies complete.

## Engineering Availability

### Team Members

- Janika Neuberger
- Alexandre Lissy
- Gian-Carlo Pascutto
- Jonathan Mendez
- Dave Townsend (20% availability)

### Availability Factor

Each engineer has an availability factor (0.0-1.0). Task duration is scaled inversely:

```
actual_days = base_days / availability
```

Example: A 5-day task for an engineer with 20% availability takes 25 working days.

### Unavailability Periods

Engineers can have unavailability periods (holidays, PTO) specified as date ranges. Tasks cannot be scheduled during these periods.

## Required Output

### Gantt Chart

A visual timeline showing:
- All tasks with their scheduled start and end dates
- Task dependencies (tasks wait for their blockers)
- Milestone deadlines as vertical markers
- Color coding for:
  - **Normal tasks** - properly sized
  - **Estimated tasks** - missing size (defaulting to 2 weeks)
  - **At-risk tasks** - scheduled past their milestone deadline

Note: Resolved/closed bugs are filtered out and don't appear in the Gantt chart (milestone bugs are always included regardless of status).

### Scheduling Algorithm

1. **Greedy schedule** - Generated immediately on page load
   - Processes milestones in deadline order (Foxfooding → Customer Pilot → MVP)
   - For each milestone, assigns tasks to the engineer who can complete them earliest
   - Respects dependency order (topological sort)

2. **Optimal schedule** - Computed in background via Web Worker
   - Uses branch-and-bound for small task sets (≤10 tasks)
   - Uses simulated annealing for larger sets
   - Optimizes for: (1) deadlines met, (2) minimum makespan

### Tables

1. **Missing Sizes** - Lists all bugs defaulting to 2-week estimates, with bug ID and title
2. **Deadline Risks** - Lists tasks that may miss their milestone deadline

### Milestone Cards

Summary cards showing for each milestone:
- Total bugs and completed count
- Days until deadline
- Risk assessment (on track / at risk)

### Inconsistencies

Any detected issues (dependency cycles, duplicate bugs, etc.) are output to ERRORS.md format in the UI.

## Data Files

### data/engineers.json

```json
{
  "engineers": [
    {
      "id": "janika",
      "name": "Janika Neuberger",
      "availability": 1.0,
      "unavailability": []
    },
    {
      "id": "dave",
      "name": "Dave Townsend",
      "availability": 0.2,
      "unavailability": []
    }
  ]
}
```
