import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertTeamupEvents, getLateToEarlyShiftCounts } from './App';
import type { TeamupEvent } from './lib/teamupApi';

describe('convertTeamupEvents owner resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns and prefers explicit calendar name over stale subcalendar-id mapping for Late shift', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event: TeamupEvent = {
      id: 'late-shift-conflict',
      title: 'Late shift',
      notes: '',
      all_day: false,
      start_dt: '2026-02-01T17:00:00-05:00',
      end_dt: '2026-02-01T21:00:00-05:00',
      subcalendar_id: 432034,
      subcalendar_name: 'Paula Johnson'
    };

    const result = convertTeamupEvents([event], { 432034: 'Liz Thomovsky' });

    expect(result).toHaveLength(1);
    expect(result[0].person).toBe('Paula Johnson');
    expect(warn).toHaveBeenCalledWith(
      'Teamup event owner conflict: subcalendar-id mapping disagrees with explicit owner signal',
      expect.objectContaining({
        id: 'late-shift-conflict',
        title: 'Late shift',
        idDerivedPerson: 'Liz Thomovsky',
        explicitSignalPerson: 'Paula Johnson'
      })
    );
  });

  it('warns when owner is inferred only from subcalendar_id without owner/who fields', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event: TeamupEvent = {
      id: 'late-shift-id-only',
      title: 'Late shift',
      all_day: false,
      start_dt: '2026-02-02T17:00:00-05:00',
      end_dt: '2026-02-02T21:00:00-05:00',
      subcalendar_id: 432049
    };

    const result = convertTeamupEvents([event], { 432049: 'Paula Johnson' });

    expect(result).toHaveLength(1);
    expect(result[0].person).toBe('Paula Johnson');
    expect(warn).toHaveBeenCalledWith(
      'Teamup event owner inferred from subcalendar-id mapping only; verify Teamup subcalendar metadata',
      expect.objectContaining({
        id: 'late-shift-id-only',
        title: 'Late shift',
        idDerivedPerson: 'Paula Johnson'
      })
    );
  });
});


describe('getLateToEarlyShiftCounts', () => {
  it('counts turnarounds when shifts are marked as PM then AM on next day', () => {
    const counts = getLateToEarlyShiftCounts([
      {
        id: 'evt-1',
        source: 'teamup',
        date: '2026-02-01',
        title: 'ED PM Shift',
        person: 'Paula Johnson',
        category: 'shift',
        context: 'General ECC Service'
      },
      {
        id: 'evt-2',
        source: 'teamup',
        date: '2026-02-02',
        title: 'ED AM Shift',
        person: 'Paula Johnson',
        category: 'shift',
        context: 'General ECC Service'
      }
    ]);

    expect(counts.find((item) => item.label === 'Paula Johnson')?.value).toBe(1);
  });

  it('counts turnarounds when shift hints exist in notes/context even without early/late in title', () => {
    const counts = getLateToEarlyShiftCounts([
      {
        id: 'evt-3',
        source: 'teamup',
        date: '2026-02-05',
        title: 'ECC service',
        notes: 'Evening coverage',
        person: 'Liz Thomovsky',
        category: 'shift',
        context: 'General ECC Service'
      },
      {
        id: 'evt-4',
        source: 'teamup',
        date: '2026-02-06',
        title: 'ECC service',
        notes: 'Morning coverage',
        person: 'Liz Thomovsky',
        category: 'shift',
        context: 'General ECC Service'
      }
    ]);

    expect(counts.find((item) => item.label === 'Liz Thomovsky')?.value).toBe(1);
  });

  it('counts turnarounds using shift start times when title does not contain AM/PM hints', () => {
    const counts = getLateToEarlyShiftCounts([
      {
        id: 'evt-5',
        source: 'teamup',
        date: '2026-02-10',
        title: 'ECC coverage',
        startTime: '17:00',
        endTime: '23:00',
        person: 'Aimee Brooks',
        category: 'shift',
        context: 'General ECC Service'
      },
      {
        id: 'evt-6',
        source: 'teamup',
        date: '2026-02-11',
        title: 'ECC coverage',
        startTime: '07:00',
        endTime: '13:00',
        person: 'Aimee Brooks',
        category: 'shift',
        context: 'General ECC Service'
      }
    ]);

    expect(counts.find((item) => item.label === 'Aimee Brooks')?.value).toBe(1);
  });
});
