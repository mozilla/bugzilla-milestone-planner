# Job Scheduling: Problem Analysis and Algorithms

## The Underlying Problem

The Enterprise Project Planner solves a variant of the **Resource-Constrained Project Scheduling Problem (RCPSP)**, which is a generalization of the classic **Job Shop Scheduling Problem**.

### Problem Definition

Given:
- A set of **tasks** (bugs) with:
  - Estimated duration (size 1-5 mapped to days)
  - Required skill/language (JavaScript, Rust, C++)
  - Dependency constraints (task A must complete before task B)
- A set of **resources** (engineers) with:
  - Skill proficiency ordering (primary, secondary, tertiary)
  - Availability constraints (holidays, part-time)
- **Deadlines** (milestone freeze dates)

Find: An assignment of tasks to engineers and start times that:
1. Respects all dependency constraints
2. Respects resource availability (one task per engineer at a time)
3. **Maximizes deadlines met** (primary objective)
4. **Minimizes project makespan** (secondary objective)

### Complexity

This problem is **NP-hard**. Specifically:
- Even the simpler Job Shop Problem (JSP) is NP-hard
- Adding precedence constraints makes it RCPSP, also NP-hard
- Adding skill-based effort modifiers adds another dimension
- Multi-objective optimization (deadlines + makespan) compounds difficulty

For `n` tasks and `m` engineers, the search space is `O(m^n)` possible assignments, each requiring `O(n²)` time to evaluate due to dependency resolution.

## Algorithms Implemented

### 1. Greedy Algorithm (Fast, Approximate)

**Time Complexity:** O(n² × m)

**Approach:**
1. Topologically sort tasks by dependencies
2. For each task in order:
   - Find the engineer who can complete it earliest
   - Consider skill match (prefer primary skill)
   - Assign task to best available engineer

**Pros:**
- Very fast, runs in milliseconds
- Produces reasonable schedules
- Deterministic

**Cons:**
- No global optimization
- May miss deadline-meeting solutions that require non-obvious assignments
- Cannot backtrack from locally optimal but globally suboptimal choices

### 2. Branch and Bound (Exact, Exponential)

**Time Complexity:** O(m^n) worst case, often much better with pruning

**Approach:**
1. Recursively try all engineer assignments
2. Prune branches that cannot improve on best known solution
3. Prioritize by deadlines met, then makespan

**Pruning strategies:**
- If current partial solution already exceeds best makespan (when all deadlines met), prune
- Try engineers in order of expected completion time for better pruning

**Used when:** ≤ 10-12 unassigned tasks

**Pros:**
- Guaranteed optimal solution
- Pruning makes it practical for small instances

**Cons:**
- Exponential worst case
- Not suitable for large task sets

### 3. Simulated Annealing (Approximate, Probabilistic)

**Time Complexity:** O(iterations × n²)

**Approach:**
1. Start with skill-biased random assignment
2. Iteratively make small changes (reassign one task)
3. Accept improvements always
4. Accept worse solutions with probability `e^(-Δ/T)` where T decreases over time
5. Track best solution found

**Parameters:**
- Initial temperature: 1000
- Cooling rate: 0.99995
- Iterations: 100,000

**Scoring function:**
```
score = deadlines_met × 10000 - makespan
```
This heavily weights deadline compliance over makespan reduction.

**Pros:**
- Can escape local optima
- Works for any problem size
- Often finds near-optimal solutions

**Cons:**
- No optimality guarantee
- Requires parameter tuning
- Results vary between runs

## State of the Art Approaches

### Exact Methods

1. **Integer Linear Programming (ILP)**
   - Model as binary variables for task-engineer-timeslot assignments
   - Use solvers like CPLEX, Gurobi, or open-source CBC
   - Can prove optimality or provide bounds
   - Practical for up to ~50-100 tasks with good formulations

2. **Constraint Programming (CP)**
   - Natural fit for scheduling constraints
   - Solvers like Google OR-Tools, IBM CP Optimizer
   - Specialized propagation for precedence and resource constraints
   - Often faster than ILP for scheduling

3. **Dynamic Programming**
   - Requires special problem structure
   - Pseudo-polynomial for some variants
   - Not directly applicable to general RCPSP

### Metaheuristics

1. **Genetic Algorithms (GA)**
   - Encode solutions as permutations or priority lists
   - Crossover and mutation operators
   - Good for exploring diverse solutions

2. **Tabu Search**
   - Local search with memory of recent moves
   - Prevents cycling back to recent solutions
   - Often outperforms SA for scheduling

3. **Ant Colony Optimization (ACO)**
   - Probabilistic construction based on pheromone trails
   - Good for problems with strong local structure

4. **Hybrid Methods**
   - Combine metaheuristics with local search
   - Use LP relaxations to guide search
   - Often achieve best practical results

### Machine Learning Approaches

1. **Reinforcement Learning**
   - Train agents to make scheduling decisions
   - Can learn problem-specific heuristics
   - Active research area

2. **Graph Neural Networks**
   - Encode task dependencies as graphs
   - Learn to predict good assignments
   - Promising for generalization

## Why We Use Greedy + SA

For this application:

1. **Interactive UI requirement**: Users need immediate feedback, greedy provides instant results

2. **Background optimization**: SA can progressively improve while user reviews greedy solution

3. **Problem size**: Bugzilla dependency graphs can have 50-200 tasks, too large for B&B

4. **Deadline priority**: Our scoring function prioritizes meeting deadlines, which SA handles well through its probabilistic acceptance

5. **No solver dependencies**: Runs entirely in browser JavaScript without external solvers

## Potential Improvements

1. **Implement Tabu Search**: Often better than SA for scheduling
2. **Add constraint propagation**: Reduce search space before optimization
3. **Parallel SA**: Run multiple SA instances with different parameters
4. **Learn from history**: Use past schedules to warm-start optimization
5. **LP relaxation bounds**: Compute lower bounds to measure solution quality

## References

- Brucker, P. "Scheduling Algorithms" (2007)
- Kolisch, R. & Hartmann, S. "Experimental investigation of heuristics for RCPSP" (2006)
- Błażewicz, J. et al. "Handbook on Scheduling" (2007)
- Pinedo, M. "Scheduling: Theory, Algorithms, and Systems" (2016)
