# Enterprise Project Planner Specification

## Source Data

### Bugzilla

Bugzilla is the main repository for project information. The app fetches bugs and their dependency trees via the REST API.

API documentation:
- https://bugzilla.readthedocs.io/en/stable/api/index.html
- https://wiki.mozilla.org/Bugzilla:REST_API

### Project Milestones

| Name | Deadline | Feature Freeze | Master Bug |
|------|----------|----------------|------------|
| Foxfooding Alpha | March 2, 2026 | February 23, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=1980342 |
| Customer Pilot | March 30, 2026 | March 23, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=2012055 |
| MVP | September 15, 2026 | September 8, 2026 | https://bugzilla.mozilla.org/show_bug.cgi?id=1980739 |

Feature freeze is 1 week before each deadline for QA, so development should finish before freeze.

## Task Size

Found in Bugzilla whiteboard, format `[size=X]` where X is:

| Score | Engineer Time | Working Days |
|-------|---------------|--------------|
| 1 | 1 day | 1 |
| 2 | 1 week | 5 |
| 3 | 2 weeks | 10 |
| 4 | 4 weeks | 20 |
| 5 | 12 weeks | 60 |

### Fractional Sizes

Fractional sizes like `[size=2.5]` or `[size=3.5]` are supported. Days are calculated by linear interpolation between integer values:

```
days = round(lower_days + fraction × (upper_days - lower_days))
```

Example: size 2.5 → round(5 + 0.5 × (10 - 5)) = 8 days

### Default Size

Bugs without a `[size=X]` whiteboard tag default to **size 3 (2 weeks / 10 working days)**. These are listed in a "Missing Sizes" table in the output.

### Meta Bugs

Tracking bugs (detected by `[meta]` in whiteboard, `meta` keyword, or `[meta]` in title) take **0 days** and don't consume engineer time. They complete immediately when all their dependencies complete.

## Engineering Availability

### Team Members

| Name | Availability | Notes |
|------|--------------|-------|
| Janika Neuberger | 100% | |
| Alexandre Lissy | 100% | |
| Gian-Carlo Pascutto | 100% | |
| Jonathan Mendez | 100% | |
| Dave Townsend | 33% | Part-time on project |
| Victor Lopez Garcia | 100% | Unavailable until April 2026 |

### Availability Factor

Each engineer has an availability factor (0.0-1.0). Task duration is scaled inversely:

```
actual_days = base_days / availability
```

Example: A 5-day task for an engineer with 33% availability takes ~15 working days.

### Unavailability Periods

Engineers can have unavailability periods (holidays, PTO) specified as date ranges in `data/engineers.json`. Tasks cannot be scheduled during these periods—the scheduler skips over them.

### Locked Assignments

If a bug has an assignee in Bugzilla that matches a known engineer's email, that assignment is "locked"—the optimizer will not reassign it. This respects explicit team decisions about who should work on what.

External assignees (emails not in the engineer roster) are tracked separately and displayed as "External" in the UI.

## Scheduling Algorithm

### Greedy Schedule (Instant)

Generated immediately on page load:
1. Process milestones in deadline order (Foxfooding Alpha → Customer Pilot → MVP)
2. For each milestone, topologically sort its dependencies
3. Assign each task to the engineer who can complete it earliest
4. Respect locked assignments (Bugzilla assignees)

### Optimized Schedule (Background)

Computed via parallel Web Workers using a Genetic Algorithm. Scoring priority:
1. Deadlines met (maximize)
2. Total lateness (minimize)
3. Makespan (minimize)

### Exhaustive Mode

Extended 20-second search with larger population and multiple rounds for difficult schedules.

See [JOB_SCHEDULING.md](JOB_SCHEDULING.md) for algorithm details.

## Required Output

### Gantt Chart

A visual timeline showing:
- All tasks with their scheduled start and end dates
- Task dependencies (tasks wait for their blockers)
- Milestone deadlines and freeze dates
- Color coding for:
  - **Normal tasks** - properly sized, assigned by scheduler
  - **Estimated tasks** - missing size (defaulting to 2 weeks)
  - **At-risk tasks** - scheduled past their milestone's freeze date
- Engineer initials with color coding:
  - `(XX)` - Bugzilla assignee (bold)
  - `→[XX]` - Scheduler assigned (italic)

Note: Resolved/closed bugs are filtered out and don't appear in the Gantt chart (milestone bugs are always included regardless of status).

### Milestone Cards

Summary cards showing for each milestone:
- Total bugs and completed count
- Estimated completion date
- Days until deadline vs estimated completion
- Risk assessment (on track / at risk)

### Tables

1. **Missing Sizes** - Lists all bugs defaulting to 2-week estimates
2. **Deadline Risks** - Lists tasks that may miss their milestone freeze date
3. **Milestone Mismatches** - Bugs where Bugzilla target_milestone differs from dependency-based milestone
4. **Untriaged Bugs** - Bugs without severity (when S2+untriaged filter is active)

### Optimization Log

Real-time log showing:
- Worker progress and improvements
- Deadline achievements ("NEW DEADLINE MET!")
- Makespan improvements
- Completion status and timing

## Filters

Applied in order:
1. **Resolved Filter** - Exclude RESOLVED/VERIFIED/CLOSED (milestone bugs exempt)
2. **Component Filter** - Only "Client" component bugs (milestone bugs exempt)
3. **Severity Filter** - S1, S1-S2 (default), S1+S2+untriaged, S1-S3, or All
4. **Milestone Filter** - View-only filter to show single milestone's dependency tree

## Data Files

### data/engineers.json

```json
{
  "engineers": [
    {
      "id": "janika",
      "name": "Janika Neuberger",
      "email": "jneuberger@mozilla.com",
      "availability": 1.0,
      "unavailability": []
    },
    {
      "id": "dave",
      "name": "Dave Townsend",
      "email": "dtownsend@mozilla.com",
      "availability": 0.33,
      "unavailability": []
    },
    {
      "id": "vlg",
      "name": "Victor Lopez Garcia",
      "email": "tbd@mozilla.com",
      "availability": 1.0,
      "unavailability": [
        {"start": "2026-01-01", "end": "2026-04-01", "reason": "Not available yet"}
      ]
    }
  ]
}
```
