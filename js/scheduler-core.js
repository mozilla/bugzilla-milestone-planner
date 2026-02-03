/**
 * Shared scheduling utilities
 * Used by both the main scheduler and the web worker
 */

// Size to days mapping (fractional sizes interpolate)
export const SIZE_TO_DAYS = {
  1: 1,
  2: 5,
  3: 10,
  4: 20,
  5: 60
};

// Default size when not specified (2 weeks = 10 working days)
export const DEFAULT_SIZE = 3;
export const DEFAULT_DAYS = 10;

/**
 * Calculate days from size, supporting fractional sizes
 * @param {number} size - Size value (can be fractional like 3.5)
 * @returns {number} Days of effort
 */
export function calculateDaysFromSize(size) {
  // Integer sizes use the lookup table
  if (Number.isInteger(size) && SIZE_TO_DAYS[size]) {
    return SIZE_TO_DAYS[size];
  }

  // Fractional sizes: interpolate between adjacent values
  const lowerSize = Math.floor(size);
  const upperSize = Math.ceil(size);

  // Handle edge cases
  if (lowerSize < 1) return SIZE_TO_DAYS[1];
  if (upperSize > 5) return SIZE_TO_DAYS[5];
  if (lowerSize === upperSize) return SIZE_TO_DAYS[lowerSize] || DEFAULT_DAYS;

  const lowerDays = SIZE_TO_DAYS[lowerSize] || DEFAULT_DAYS;
  const upperDays = SIZE_TO_DAYS[upperSize] || DEFAULT_DAYS;
  const fraction = size - lowerSize;

  return Math.round(lowerDays + (upperDays - lowerDays) * fraction);
}

/**
 * Calculate effort in days for a task
 * @param {Object} bug - Bug object with size, isMeta properties
 * @param {Object} engineer - Engineer object with availability
 * @returns {{days: number, baseDays: number, sizeEstimated: boolean, isMeta?: boolean}}
 */
export function calculateEffort(bug, engineer) {
  // Meta bugs take 0 time (they're tracking bugs)
  if (bug.isMeta) {
    return {
      days: 0,
      baseDays: 0,
      sizeEstimated: false,
      isMeta: true
    };
  }

  // Get size from bug or use default (2 weeks)
  let size = bug.size;
  let sizeEstimated = bug.sizeEstimated || false;

  if (size === null || size === undefined) {
    size = DEFAULT_SIZE;
    sizeEstimated = true;
  }

  // Calculate base days, supporting fractional sizes via interpolation
  const baseDays = calculateDaysFromSize(size);

  // Apply availability factor (e.g., 0.2 = 20% time means 5x longer)
  const availabilityFactor = engineer.availability || 1.0;
  const adjustedDays = Math.ceil(baseDays / availabilityFactor);

  return {
    days: adjustedDays,
    baseDays,
    sizeEstimated
  };
}

/**
 * Add working days to a date (skip weekends)
 * @param {Date} startDate - Starting date
 * @param {number} days - Number of working days to add
 * @param {Object} engineer - Optional engineer with unavailability periods
 * @returns {Date} End date
 */
export function addWorkingDays(startDate, days, engineer = null) {
  if (days <= 0) return new Date(startDate);

  const result = new Date(startDate);
  let remaining = days;

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);

    // Skip weekends
    const dayOfWeek = result.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    // Skip engineer unavailability periods
    if (engineer && engineer.unavailability) {
      const dateStr = result.toISOString().split('T')[0];
      const isUnavailable = engineer.unavailability.some(period => {
        const start = new Date(period.start).toISOString().split('T')[0];
        const end = new Date(period.end).toISOString().split('T')[0];
        return dateStr >= start && dateStr <= end;
      });
      if (isUnavailable) continue;
    }

    remaining--;
  }

  return result;
}

/**
 * Normalize an assignee email
 * @param {string|null} assignee
 * @returns {string|null}
 */
export function normalizeAssigneeEmail(assignee) {
  if (!assignee || !assignee.includes('@')) return null;
  return assignee.trim().toLowerCase();
}

/**
 * Check if a bug is resolved/closed
 * @param {Object} bug - Bug object
 * @returns {boolean}
 */
export function isResolved(bug) {
  const resolvedStatuses = ['RESOLVED', 'VERIFIED', 'CLOSED'];
  return resolvedStatuses.includes(bug.status);
}
