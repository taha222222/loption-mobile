// Pure tracking, date and reminder helpers. Server behaviour (RLS, triggers,
// streaks, scheduling) is tested in supabase/tests/run_v1_nutrition.sh.
import { addDays, dateRange, localDate } from '../src/nutrition/dates';
import { inQuietHours, reminderTimesProblem, shiftTime } from '../src/nutrition/reminders';
import {
  chartMax,
  daysToMilestone,
  describeDay,
  formatServings,
  progressShare,
  remainingKcal,
  toDaySummaries,
  toStreak,
  trackingErrorMessage,
} from '../src/nutrition/tracking';
import { notificationTarget } from '../src/navigation/notificationLinks';

describe('local dates and time zones', () => {
  const instant = new Date('2026-10-28T23:30:00Z');

  it('uses the local calendar day of the given zone', () => {
    expect(localDate('Africa/Casablanca', instant)).toBe('2026-10-29'); // UTC+1
    expect(localDate('America/New_York', instant)).toBe('2026-10-28'); // UTC-4
    expect(localDate('Pacific/Kiritimati', instant)).toBe('2026-10-29'); // UTC+14
    expect(localDate('Pacific/Pago_Pago', new Date('2026-10-29T10:00:00Z'))).toBe('2026-10-28'); // UTC-11
  });

  it('falls back to UTC for an unknown zone instead of guessing', () => {
    expect(localDate('Mars/Olympus', instant)).toBe('2026-10-28');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(dateRange('2026-10-27', '2026-10-29')).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(dateRange('2026-10-29', '2026-10-27')).toEqual([]);
  });
});

describe('daily summaries', () => {
  const rows = [
    { local_date: '2026-10-27', entry_count: 2, consumed_kcal: 1350, has_log: true, target_kcal: 2200, target_source: 'snapshot' },
    { local_date: '2026-10-28', entry_count: 0, consumed_kcal: null, has_log: false, target_kcal: null, target_source: null },
  ];

  it('keeps a day without entries as "no log" (null), never 0, and fills days the server omitted', () => {
    const days = toDaySummaries(rows, '2026-10-26', '2026-10-28');
    expect(days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(days[0]).toMatchObject({ hasLog: false, consumedKcal: null, targetKcal: null });
    expect(days[1]).toMatchObject({ hasLog: true, consumedKcal: 1350, targetKcal: 2200, entryCount: 2 });
    expect(days[2]).toMatchObject({ hasLog: false, consumedKcal: null });
    expect(describeDay(days[2])).toBe('aucun repas enregistré');
    expect(describeDay(days[1])).toBe('1350 kcal consommées, objectif 2200 kcal');
  });

  it('computes remaining calories and progress from real values only', () => {
    expect(remainingKcal(2200, 1350)).toBe(850);
    expect(remainingKcal(2200, null)).toBe(2200);
    expect(remainingKcal(2000, 2300)).toBe(-300);
    expect(remainingKcal(null, 1350)).toBeNull();
    expect(progressShare(2200, 1100)).toBe(0.5);
    expect(progressShare(2200, 5000)).toBe(1);
    expect(progressShare(null, 1100)).toBe(0);
    expect(progressShare(2200, null)).toBe(0);
  });

  it('scales the chart to the largest logged or target value', () => {
    expect(chartMax(toDaySummaries(rows, '2026-10-27', '2026-10-28'))).toBe(2500);
    expect(chartMax(toDaySummaries([], '2026-10-27', '2026-10-28'))).toBe(500);
  });
});

describe('streak display', () => {
  it('maps the server streak and the distance to the next milestone', () => {
    const s = toStreak({ current_streak: 5, longest_streak: 9, last_logged_date: '2026-10-28', today_logged: true, next_milestone: 7 });
    expect(s).toEqual({ current: 5, longest: 9, lastLoggedDate: '2026-10-28', todayLogged: true, nextMilestone: 7 });
    expect(daysToMilestone(s)).toBe(2);
    expect(toStreak(null)).toMatchObject({ current: 0, longest: 0, nextMilestone: 7 });
  });
});

describe('messages and formatting', () => {
  it('explains refused logs without inventing anything', () => {
    expect(trackingErrorMessage({ code: '22023', message: 'this meal has no reliable calorie value' })).toMatch(/valeur calorique fiable/);
    expect(trackingErrorMessage({ code: '22023', message: 'meals can be logged for today and the previous 6 days only' })).toMatch(/6 jours/);
    expect(trackingErrorMessage({ code: '22023', message: 'more servings logged than were ordered' })).toMatch(/portions/);
    expect(trackingErrorMessage({ code: '23514', message: 'check' })).toMatch(/Quantité/);
    expect(trackingErrorMessage(null)).toMatch(/connexion/);
  });

  it('formats servings in French', () => {
    expect(formatServings(1)).toBe('1 portion');
    expect(formatServings(1.5)).toBe('1,5 portions');
    expect(formatServings(0.25)).toBe('0,25 portion');
    expect(formatServings(2)).toBe('2 portions');
  });
});

describe('reminder times and quiet hours', () => {
  it('moves times in 15-minute steps and wraps at midnight', () => {
    expect(shiftTime('12:00', 15)).toBe('12:15');
    expect(shiftTime('23:50', 15)).toBe('00:05');
    expect(shiftTime('00:05', -15)).toBe('23:50');
  });

  it('applies quiet hours across midnight like the server', () => {
    expect(inQuietHours('23:30', '22:00', '08:00')).toBe(true);
    expect(inQuietHours('07:59', '22:00', '08:00')).toBe(true);
    expect(inQuietHours('08:00', '22:00', '08:00')).toBe(false);
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('13:00', '10:00', '10:00')).toBe(false);
  });

  it('flags a reminder scheduled inside quiet hours', () => {
    const base = { daily_time: '12:00', progress_time: '16:00', evening_time: '20:30', quiet_start: '22:00', quiet_end: '08:00' };
    expect(reminderTimesProblem(base)).toBeNull();
    expect(reminderTimesProblem({ ...base, evening_time: '22:30' })).toMatch(/rappel du soir/);
  });
});

describe('notification deep links', () => {
  it('opens only known screens, never a URL from the payload', () => {
    expect(notificationTarget({ screen: 'nutrition', url: 'loption://nutrition' })).toBe('/(app)/nutrition');
    expect(notificationTarget({ screen: 'admin' })).toBeNull();
    expect(notificationTarget({ url: 'https://evil.example' })).toBeNull();
    expect(notificationTarget({ screen: 'constructor' })).toBeNull();
    expect(notificationTarget(null)).toBeNull();
  });
});
