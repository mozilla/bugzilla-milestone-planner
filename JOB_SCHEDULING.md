# Job Scheduling: Problem Analysis and Algorithms

## The Underlying Problem

The Enterprise Project Planner solves a variant of the **Resource-Constrained Project Scheduling Problem (RCPSP)**, which is a generalization of the classic **Job Shop Scheduling Problem**.

### Problem Definition (Simplified)

Given:
- A set of **tasks** (bugs) with:
  - Estimated duration (size 1-5 mapped to days, supports fractional sizes)
  - Dependency constraints (task A must complete before task B)
- A set of **resources** (engineers) with:
  - Availability factor (0.0-1.0, e.g., 0.2 = 20% time)
  - Unavailability periods (holidays, PTO)
- **Deadlines** (milestone freeze dates)
- **Milestones** organized hierarchically (Foxfooding → Customer Pilot → MVP)

Find: An assignment of tasks to engineers and start times that:
1. Respects all dependency constraints
2. Respects resource availability (one task per engineer at a time)
3. **Maximizes deadlines met** (primary objective)
4. **Minimizes project makespan** (secondary objective)

### Complexity

This problem is **NP-hard**. Specifically:
- Even the simpler Job Shop Problem (JSP) is NP-hard
- Adding precedence constraints makes it RCPSP, also NP-hard
- Multi-objective optimization (deadlines + makespan) compounds difficulty

For `n` tasks and `m` engineers, the search space is `O(m^n)` possible assignments, each requiring `O(n²)` time to evaluate due to dependency resolution.

## Algorithms Implemented

### 1. Greedy Algorithm (Fast, Approximate)

**Time Complexity:** O(n² × m)

**Approach:**
1. Assign tasks to milestones based on dependency chains
2. Process milestones in deadline order (Foxfooding first, then Customer Pilot, then MVP)
3. For each milestone's tasks in topological order:
   - Find the engineer who can complete it earliest
   - Assign task to that engineer
4. Process remaining (unassigned) tasks last

**Milestone-Aware Scheduling:**
This is a key insight: by processing earlier milestones first, we ensure their tasks get priority for engineer time. Engineer availability then "cascades" to later milestones. This prevents a Customer Pilot task from blocking a Foxfooding task when deadlines are tight.

**Pros:**
- Very fast, runs in milliseconds
- Produces reasonable schedules
- Deterministic
- Naturally prioritizes earlier deadlines

**Cons:**
- No global optimization within a milestone
- May miss solutions that require non-obvious task ordering

### 2. Branch and Bound (Exact, Exponential)

**Time Complexity:** O(m^n) worst case, often much better with pruning

**Approach:**
1. Process tasks in milestone order (same as greedy)
2. Recursively try all engineer assignments
3. Prune branches that cannot improve on best known solution
4. Prioritize by deadlines met, then makespan

**Pruning strategies:**
- If current partial solution already exceeds best makespan (when all deadlines met), prune
- Try engineers in order of expected completion time for better pruning

**Used when:** ≤ 10 unassigned tasks

**Pros:**
- Guaranteed optimal solution
- Pruning makes it practical for small instances

**Cons:**
- Exponential worst case
- Not suitable for large task sets

### 3. Simulated Annealing (Approximate, Probabilistic)

**Time Complexity:** O(iterations × n²)

**Approach:**
1. Start with random assignment
2. Process tasks in milestone order when evaluating (critical fix!)
3. Iteratively make small changes (reassign one task to different engineer)
4. Accept improvements always
5. Accept worse solutions with probability `e^(-Δ/T)` where T decreases over time
6. Track best solution found

**Parameters:**
- Initial temperature: 1000
- Cooling rate: 0.99995
- Iterations: 100,000

**Scoring function:**
```
score = deadlines_met × 10000 - makespan
```
This heavily weights deadline compliance over makespan reduction.

**Critical Implementation Detail:**
The SA must process tasks in milestone order when computing end times, just like the greedy algorithm. Without this, SA produces worse schedules than greedy because later-milestone tasks can "steal" engineer time from earlier-milestone tasks.

**Pros:**
- Can escape local optima
- Works for any problem size
- Often finds near-optimal solutions

**Cons:**
- No optimality guarantee
- Requires parameter tuning
- Results vary between runs

## Lessons Learned

### 1. Milestone Ordering is Critical

The most important scheduling insight: process tasks by milestone deadline order. This ensures:
- Foxfooding tasks complete before Customer Pilot tasks begin consuming engineer time
- Natural prioritization without explicit priority scores
- Both greedy and SA produce comparable results

### 2. Meta Bugs Need Special Handling

Tracking bugs ([meta] in whiteboard/keywords/summary) should:
- Take 0 days effort
- Not consume engineer availability
- Complete exactly when their dependencies complete
- Not appear in the Gantt chart (they're tracking artifacts, not work)

### 3. Date Comparisons Must Be Consistent

When checking deadlines:
- Always compare actual Date objects, not working days vs calendar days
- The scheduler uses working days internally, but deadline comparison must convert to actual dates
- Mixing units causes subtle bugs where tasks appear to meet deadlines but actually miss them

### 4. Dependency Graphs Must Be Complete

When building the dependency map for the optimizer:
- Include ALL bugs, not just filtered bugs
- Dependencies may chain through bugs that don't pass filters
- Incomplete graphs cause incorrect scheduling

### 5. Availability Scaling is Multiplicative

For an engineer with 20% availability:
- A 5-day task takes 25 working days (5 / 0.2)
- This represents actual calendar time until completion
- Part-time engineers effectively have lower throughput

## Experimental Results (Feb 2026)

Tested on real Bugzilla snapshot: 30 tasks, 5 engineers, 3 milestones.

### Greedy vs SA Comparison

| Metric | Greedy | SA (100k iter) |
|--------|--------|----------------|
| Runtime | 2ms | 18s |
| Deadlines met | 2/3 | 3/3 |
| Makespan | 40 days | 38 days |

Greedy misses the Foxfooding deadline by 3 days. SA consistently finds a schedule meeting all deadlines.

### SA Optimization Experiments

Tested potential improvements with 10 runs each:

| Configuration | 3/3 Rate | Avg Runtime | Avg Iterations |
|---------------|----------|-------------|----------------|
| Random init, no early term | **100%** | 17.9s | 100k |
| Random init, 10k early term | 80% | 3.8s | 21k |
| Random init, 5k early term | 40% | 1.7s | 9k |
| Greedy init, no early term | **100%** | 17.9s | 100k |
| Greedy init, 10k early term | 60% | 2.6s | 14k |

### Key Findings

1. **Greedy initialization is counterproductive with early termination**: The greedy solution is a local optimum. SA starting from greedy has trouble escaping it, achieving only 60% reliability with 10k early termination vs 80% for random init.

2. **Early termination at 10k iterations**: Good tradeoff—5x speedup (18s → 4s) with 80% reliability. For 100% reliability, full 100k iterations are needed.

3. **Parallel runs don't help**: 5 runs of 20k iterations (100k total) performed the same as 1 run of 100k. The problem size is small enough that a single long run explores adequately.

4. **Random initialization preferred**: Despite intuition, random starts outperform greedy initialization when combined with early termination.

### Recommendations

- **For production (UI worker)**: Keep 100k iterations with random init for 100% reliability
- **For testing**: Use 10k early termination threshold for faster feedback
- **Don't use greedy init**: It creates a local optimum trap

## Potential Improvements

### Near-term
1. ~~**Parallel SA**: Run multiple SA instances with different random seeds~~ *Tested: No benefit for this problem size*
2. **Early termination**: Stop SA if no improvement for N iterations — *Tested: 10k threshold gives 80% reliability with 5x speedup*
3. ~~**Better initial solution**: Use greedy result as SA starting point~~ *Tested: Actually harmful—greedy is a local optimum trap*

### Medium-term
1. **Implement Tabu Search**: Often better than SA for scheduling
2. **Add constraint propagation**: Reduce search space before optimization
3. **Learn from history**: Use past schedules to warm-start optimization

### Long-term
1. **LP relaxation bounds**: Compute lower bounds to measure solution quality
2. **Hybrid methods**: Combine metaheuristics with local search
3. **Constraint Programming**: Use OR-Tools for more sophisticated solving

## State of the Art

For production systems with similar requirements:
- Google OR-Tools CP-SAT solver handles precedence-constrained scheduling well
- Gurobi/CPLEX for ILP formulations with optimality guarantees
- OptaPlanner for Java-based constraint optimization

Our browser-based approach trades solution quality for deployment simplicity (no solver dependencies, runs in client-side JavaScript).

## References

- Brucker, P. "Scheduling Algorithms" (2007)
- Kolisch, R. & Hartmann, S. "Experimental investigation of heuristics for RCPSP" (2006)
- Błażewicz, J. et al. "Handbook on Scheduling" (2007)
- Pinedo, M. "Scheduling: Theory, Algorithms, and Systems" (2016)
