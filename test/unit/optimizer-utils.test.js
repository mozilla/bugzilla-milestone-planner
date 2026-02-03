import { describe, it, expect } from 'vitest';
import {
  countWorkingDays,
  calculateWorkingDaysMakespan,
  computeScoreFromCompletions,
  isBetterScore
} from '../../js/optimizer-utils.js';

describe('optimizer utils', () => {
  it('counts working days excluding weekends', () => {
    const start = new Date('2026-01-02'); // Fri
    const end = new Date('2026-01-06'); // Tue
    expect(countWorkingDays(start, end)).toBe(2); // Mon + Tue
  });

  it('calculates makespan in working days', () => {
    const schedule = [
      { endDate: new Date(2026, 0, 2) },
      { endDate: new Date(2026, 0, 5) } // Mon
    ];
    const today = new Date(2026, 0, 1); // Thu
    expect(calculateWorkingDaysMakespan(schedule, today)).toBe(2); // Fri + Mon
  });

  it('computes deadlines met and lateness from completions', () => {
    const milestones = [
      { bugId: 1, freezeDate: new Date('2026-02-10') },
      { bugId: 2, freezeDate: new Date('2026-02-10') }
    ];
    const completions = new Map([
      ['1', new Date('2026-02-09')],
      ['2', new Date('2026-02-12')]
    ]);
    const score = computeScoreFromCompletions(completions, milestones, 42);
    expect(score.deadlinesMet).toBe(1);
    expect(score.totalLateness).toBe(2);
    expect(score.makespan).toBe(42);
  });

  it('prefers higher deadlines, then lower lateness, then lower makespan', () => {
    const base = { deadlinesMet: 1, totalLateness: 10, makespan: 100 };
    expect(isBetterScore({ deadlinesMet: 2, totalLateness: 50, makespan: 200 }, base)).toBe(true);
    expect(isBetterScore({ deadlinesMet: 1, totalLateness: 5, makespan: 200 }, base)).toBe(true);
    expect(isBetterScore({ deadlinesMet: 1, totalLateness: 10, makespan: 90 }, base)).toBe(true);
    expect(isBetterScore({ deadlinesMet: 1, totalLateness: 11, makespan: 1 }, base)).toBe(false);
  });
});
