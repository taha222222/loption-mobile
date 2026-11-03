// Android step-counter readings -> daily totals (pure logic). The native
// sensor itself is not exercised here (device testing, see
// docs/v1/ACTIVITY_TRACKING_AND_DAILY_DASHBOARD.md).
import { dailySteps, intervals, sameBoot, segmentSteps, type CounterSnapshot } from '../src/activity/stepCounter';

const TZ = 'Africa/Casablanca'; // UTC+1 all year
const at = (iso: string) => new Date(iso).getTime();
// A reading on boot 7, booted at 2026-11-01T00:00Z.
const BOOT = at('2026-11-01T00:00:00Z');
const snap = (iso: string, value: number, boot = 7, bootAt = BOOT): CounterSnapshot => ({
  value,
  wallTimeMs: at(iso),
  bootCount: boot,
  elapsedMs: at(iso) - bootAt,
});

describe('daily steps from counter readings', () => {
  it('sums increases within a local day and keeps the measured window', () => {
    const days = dailySteps([snap('2026-11-02T08:00:00Z', 1000), snap('2026-11-02T12:00:00Z', 4000), snap('2026-11-02T20:00:00Z', 6500)], TZ);
    expect(days).toEqual([
      { date: '2026-11-02', steps: 5500, measuredFrom: '2026-11-02T08:00:00.000Z', measuredTo: '2026-11-02T20:00:00.000Z', gaps: 0 },
    ]);
  });

  it('a measured zero is 0, a day without readings is absent (no data)', () => {
    const days = dailySteps([snap('2026-11-02T08:00:00Z', 1000), snap('2026-11-02T09:00:00Z', 1000)], TZ);
    expect(days).toHaveLength(1);
    expect(days[0].steps).toBe(0);
    expect(dailySteps([snap('2026-11-02T08:00:00Z', 1000)], TZ)).toEqual([]);
  });

  it('ignores input order and duplicate readings', () => {
    const a = snap('2026-11-02T08:00:00Z', 1000);
    const b = snap('2026-11-02T10:00:00Z', 3000);
    expect(dailySteps([b, a, b], TZ)[0].steps).toBe(2000);
  });

  it('after a reboot counts only the steps the new boot measured', () => {
    const bootAt = at('2026-11-02T11:00:00Z');
    const days = dailySteps(
      [snap('2026-11-02T08:00:00Z', 50_000), snap('2026-11-02T12:00:00Z', 300, 8, bootAt), snap('2026-11-02T14:00:00Z', 1300, 8, bootAt)],
      TZ
    );
    expect(days[0].steps).toBe(1300); // steps between 08:00 and the reboot are unknown, not invented
    expect(days[0].gaps).toBe(1);
  });

  it('detects a reboot without a boot counter from the boot instant', () => {
    const a = { ...snap('2026-11-02T08:00:00Z', 9000), bootCount: -1 };
    const b = { ...snap('2026-11-02T12:00:00Z', 200, 8, at('2026-11-02T11:00:00Z')), bootCount: -1 };
    expect(sameBoot(a, b)).toBe(false);
    expect(sameBoot(a, { ...snap('2026-11-02T09:00:00Z', 9500), bootCount: -1 })).toBe(true);
  });

  it('a counter reset without reboot counts at most the new value', () => {
    const days = dailySteps([snap('2026-11-02T08:00:00Z', 8000), snap('2026-11-02T09:00:00Z', 500)], TZ);
    expect(days[0]).toMatchObject({ steps: 500, gaps: 1 });
  });

  it('splits a short interval across midnight by time', () => {
    // 22:30 -> 00:30 local (21:30Z -> 23:30Z), 1200 steps: 1h30 on the 2nd, 30 min on the 3rd.
    const days = dailySteps([snap('2026-11-02T21:30:00Z', 1000), snap('2026-11-02T23:30:00Z', 2200)], TZ);
    expect(days.map((d) => [d.date, d.steps])).toEqual([
      ['2026-11-02', 900],
      ['2026-11-03', 300],
    ]);
    expect(days[1].measuredFrom).toBe('2026-11-02T23:00:00.000Z'); // local midnight
  });

  it('leaves out a long interval across midnight instead of guessing', () => {
    const days = dailySteps(
      [snap('2026-11-02T09:00:00Z', 0), snap('2026-11-02T18:00:00Z', 5000), snap('2026-11-03T09:00:00Z', 9000), snap('2026-11-03T10:00:00Z', 9500)],
      TZ
    );
    expect(days.map((d) => [d.date, d.steps, d.gaps])).toEqual([
      ['2026-11-02', 5000, 1],
      ['2026-11-03', 500, 1],
    ]);
  });

  it('drops an impossible rate (sensor glitch)', () => {
    const { list, dropped } = intervals([snap('2026-11-02T08:00:00Z', 0), snap('2026-11-02T08:01:00Z', 10_000)]);
    expect(list).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it('handles a 25-hour day (end of summer time in Paris)', () => {
    // 2026-10-25 lasts 25 h in Europe/Paris: 22:00Z on the 24th to 23:00Z on the 25th.
    const days = dailySteps(
      [snap('2026-10-24T22:30:00Z', 0, 3, at('2026-10-20T00:00:00Z')), snap('2026-10-25T22:30:00Z', 10_000, 3, at('2026-10-20T00:00:00Z'))],
      'Europe/Paris'
    );
    expect(days).toEqual([{ date: '2026-10-25', steps: 10000, measuredFrom: '2026-10-24T22:30:00.000Z', measuredTo: '2026-10-25T22:30:00.000Z', gaps: 0 }]);
  });
});

describe('workout segment steps', () => {
  it('is the counter increase within one boot, null across a reboot or reset', () => {
    expect(segmentSteps(snap('2026-11-02T08:00:00Z', 100), snap('2026-11-02T08:30:00Z', 3100))).toBe(3000);
    expect(segmentSteps(snap('2026-11-02T08:00:00Z', 100), snap('2026-11-02T08:30:00Z', 50))).toBeNull();
    expect(segmentSteps(snap('2026-11-02T08:00:00Z', 100), snap('2026-11-02T08:30:00Z', 900, 8, at('2026-11-02T08:10:00Z')))).toBeNull();
    expect(segmentSteps(null, snap('2026-11-02T08:30:00Z', 900))).toBeNull();
  });
});
