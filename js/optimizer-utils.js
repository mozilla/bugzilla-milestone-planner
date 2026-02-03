/**
 * Optimizer utilities for scoring and working-day calculations.
 */

/**
 * Count working days between two dates (excluding weekends).
 */
export function countWorkingDays(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return 0;
  const current = new Date(startDate);
  let days = 0;
  while (current < endDate) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      days += 1;
    }
  }
  return days;
}

/**
 * Calculate makespan in working days from schedule end dates.
 */
export function calculateWorkingDaysMakespan(schedule, today = new Date()) {
  if (!schedule || schedule.length === 0) return 0;

  const start = new Date(today);
  start.setHours(0, 0, 0, 0);

  let maxEnd = start;
  for (const task of schedule) {
    if (task.endDate && task.endDate > maxEnd) {
      maxEnd = task.endDate;
    }
  }

  return countWorkingDays(start, maxEnd);
}

/**
 * Compute deadlines met and total lateness from milestone completions.
 */
export function computeScoreFromCompletions(completions, milestones, makespan) {
  let deadlinesMet = 0;
  let totalLateness = 0;

  for (const milestone of milestones) {
    const endDate = completions.get(String(milestone.bugId));
    if (!endDate) continue;
    if (endDate <= milestone.freezeDate) {
      deadlinesMet++;
    } else {
      const daysLate = Math.ceil((endDate - milestone.freezeDate) / (1000 * 60 * 60 * 24));
      totalLateness += daysLate;
    }
  }

  return { deadlinesMet, totalLateness, makespan };
}

/**
 * Compare two scores - returns true if a is better than b.
 */
export function isBetterScore(a, b) {
  if (!b) return true;
  if (a.deadlinesMet > b.deadlinesMet) return true;
  if (a.deadlinesMet < b.deadlinesMet) return false;
  if (a.totalLateness < b.totalLateness) return true;
  if (a.totalLateness > b.totalLateness) return false;
  return a.makespan < b.makespan;
}
