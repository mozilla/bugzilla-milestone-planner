# Job Scheduling Algorithm

This document describes the genetic algorithm (GA) used to optimize project schedules.

## Problem Definition

Given:
- **Tasks** (bugs) with durations and dependency constraints
- **Engineers** with availability factors and unavailability periods
- **Milestones** with freeze date deadlines

Find an assignment of tasks to engineers that:
1. Maximizes deadlines met (primary)
2. Minimizes total lateness (secondary)
3. Minimizes makespan (tertiary)

This is a variant of the Resource-Constrained Project Scheduling Problem (RCPSP), which is NP-hard.

## Algorithm Overview

We use a **Memetic Genetic Algorithm**—a GA enhanced with local search on elite individuals.

### Two-Phase Approach

1. **Greedy Schedule** (instant): Provides immediate feedback
2. **GA Optimization** (background): Searches for better solutions using parallel Web Workers

## Greedy Algorithm

**Time Complexity:** O(n² × m) where n=tasks, m=engineers

```
for each milestone in deadline order:
    for each task in topological order:
        assign to engineer who can complete it earliest
        (respecting locked Bugzilla assignments)
```

Key insight: Processing milestones by deadline ensures earlier deadlines get priority for engineer time.

## Genetic Algorithm

### Representation

Each **individual** is an array of engineer indices, one per task:
```
[2, 0, 1, 2, 0, ...]  // task 0 → engineer 2, task 1 → engineer 0, etc.
```

Locked tasks (with Bugzilla assignees) are fixed and excluded from genetic operations.

### Population

- **Size**: 40 per worker (160 total with 2 workers)
- **Initialization**: Random engineer assignments for unlocked tasks
- **Exhaustive mode**: 400 per worker for deeper search

### Selection: Tournament

```
function tournamentSelect(population, k=3):
    pick k random individuals
    return the one with best fitness
```

Tournament selection provides good selection pressure while maintaining diversity.

### Crossover: Two-Point

```
function crossover(parent1, parent2):
    pick two random crossover points
    swap genes between points (unlocked tasks only)
    return two children
```

- **Rate**: 80%
- Only operates on unlocked task positions

### Mutation

```
function mutate(individual):
    for each unlocked task:
        with 10% probability:
            reassign to random engineer
```

Mutation rate of 10% balances exploration with preservation of good solutions.

### Elitism

The top 4 individuals (10%) survive unchanged to the next generation, preserving the best solutions found.

### Local Search (Memetic)

Applied only to the single best individual each generation:

```
function localSearch(individual, swaps=10):
    for i in 1..swaps:
        pick random unlocked task
        try random different engineer
        if better: keep change
    return improved individual
```

This intensifies search around promising solutions without excessive computation.

## Fitness Function

### Score Computation

```
function evaluateSchedule(assignment):
    compute end times respecting dependencies
    for each milestone:
        if completion <= freezeDate:
            deadlinesMet++
        else:
            totalLateness += daysLate
    makespan = max(all end times)
    return {deadlinesMet, totalLateness, makespan}
```

### Score Comparison (Lexicographic)

```
function isBetter(a, b):
    if a.deadlinesMet > b.deadlinesMet: return true
    if a.deadlinesMet < b.deadlinesMet: return false
    if a.totalLateness < b.totalLateness: return true
    if a.totalLateness > b.totalLateness: return false
    return a.makespan < b.makespan
```

Priority: deadlines >> lateness >> makespan

## Schedule Evaluation

### End Time Computation

For each task in milestone-priority order:
1. Find earliest start (max of dependency end times)
2. If engineer is busy, wait until available
3. Skip unavailability periods
4. Add working days (skip weekends)
5. Record end time

**Critical**: Tasks are processed in milestone order so earlier deadlines get scheduling priority.

### Precomputed Caches

To achieve fast evaluation (~1000 schedules/second):

- **Bug-to-milestone map**: Which milestone each task belongs to
- **Task ID index**: O(1) lookup by bug ID
- **Milestone dependencies**: Precomputed transitive closure
- **Unavailability ranges**: Converted to working-day indices

## Parallel Execution

### Worker Configuration

- **2 workers** (fixed, not CPU-count based—more causes browser contention)
- Each worker runs independent GA with different random seed
- Best result across all workers is selected

### Communication

```
Main Thread → Worker: {bugs, engineers, graph, milestones, generations}
Worker → Main Thread: {type: 'improved', deadlinesMet, makespan, ...}
Worker → Main Thread: {type: 'complete', schedule, bestAssignment}
```

## Exhaustive Mode

When standard optimization isn't enough, exhaustive mode runs for 20 seconds:

| Parameter | Standard | Exhaustive |
|-----------|----------|------------|
| Population | 40 | 400 |
| Generations | 100 | 300 |
| Rounds | 1 | Multiple |

### Seeding Strategy

After each round, top 5 assignments seed the next round's population:
- Half the workers get seeded populations (exploitation)
- Half start fresh (exploration)

This balances intensification around good solutions with diversification to escape local optima.

## Parameters Summary

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Population size | 40 | Balance diversity vs evaluation cost |
| Generations | 100 | Sufficient convergence for most cases |
| Elite count | 4 | Preserve top 10% |
| Tournament size | 3 | Good selection pressure |
| Crossover rate | 80% | High recombination |
| Mutation rate | 10% | Moderate exploration |
| Local search swaps | 10 | Light intensification |
| Workers | 2 | Browser parallelism sweet spot |

## Performance

Typical results on ~30 tasks, 5 engineers, 3 milestones:

| Metric | Greedy | GA (2 workers) |
|--------|--------|----------------|
| Runtime | 2ms | ~2-3s |
| Deadlines met | 2/3 | 3/3 |
| Reliability | 100% | ~93% |

The GA reliably finds schedules meeting all deadlines when mathematically possible.

## References

- Holland, J. "Genetic Algorithms" (1975)
- Moscato, P. "Memetic Algorithms" (1989)
- Kolisch, R. & Hartmann, S. "Experimental investigation of heuristics for RCPSP" (2006)
