import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertTeamupEvents, expandEventsForReporting, getLateToEarlyShiftCounts, syncSelectedContexts } from './App';
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

  it('assigns ECC Teaching events by leading initials in title', () => {
    const event: TeamupEvent = {
      id: 'ecc-teaching-aa',
      title: 'AA - ECC Teaching Labs',
      notes: '',
      all_day: false,
      start_dt: '2026-02-03T09:00:00-05:00',
      end_dt: '2026-02-03T11:00:00-05:00'
    };

    const result = convertTeamupEvents([event]);

    expect(result).toHaveLength(1);
    expect(result[0].person).toBe('Ana Aghili');
    expect(result[0].context).toBe('ECC Teaching');
  });


  it('assigns Grade Assignment 1 and 2 items to Ana Aghili and treats them as ECC Teaching', () => {
    const result = convertTeamupEvents([
      {
        id: 'grade-assignment-1',
        title: 'Grade Assignment 1',
        notes: '',
        all_day: false,
        start_dt: '2026-02-04T09:00:00-05:00',
        end_dt: '2026-02-04T10:00:00-05:00'
      },
      {
        id: 'grade-assignment-2',
        title: 'Grade Assignment 2?',
        notes: '',
        all_day: false,
        start_dt: '2026-02-05T09:00:00-05:00',
        end_dt: '2026-02-05T10:00:00-05:00'
      }
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((event) => event.person)).toEqual(['Ana Aghili', 'Ana Aghili']);
    expect(result.map((event) => event.context)).toEqual(['ECC Teaching', 'ECC Teaching']);
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

  it('prefers person calendar when multiple subcalendar ids include both context and owner calendars', () => {
    const event: TeamupEvent = {
      id: 'mixed-subcalendar-ids',
      title: 'ED Coverage',
      notes: '',
      all_day: false,
      start_dt: '2026-03-10T08:00:00-05:00',
      end_dt: '2026-03-10T16:00:00-05:00',
      subcalendar_ids: [111111, 432049]
    };

    const result = convertTeamupEvents([event], {
      111111: 'General ECC Service',
      432049: 'Paula Johnson'
    });

    expect(result).toHaveLength(1);
    expect(result[0].person).toBe('Paula Johnson');
  });
});



describe('expandEventsForReporting', () => {
  it('assigns General Events to everyone with non-General-Events work in the same week', () => {
    const expanded = expandEventsForReporting([
      {
        id: 'shift-1',
        source: 'teamup',
        date: '2026-02-02',
        title: 'ED Shift',
        person: 'Paula Johnson',
        category: 'shift',
        context: 'General ECC Service'
      },
      {
        id: 'gen-1',
        source: 'teamup',
        date: '2026-02-03',
        title: 'Department Meeting',
        category: 'admin',
        context: 'General Events'
      }
    ]);

    const assignedPeople = expanded
      .filter((event) => event.id.startsWith('gen-1::'))
      .map((event) => event.person);

    expect(assignedPeople).toEqual(['Paula Johnson']);
  });

  it('does not assign General Events to team members on vacation that week', () => {
    const expanded = expandEventsForReporting([
      {
        id: 'teaching-1',
        source: 'teamup',
        date: '2026-02-10',
        title: 'AA - ECC Teaching Labs',
        person: 'Ana Aghili',
        category: 'teaching',
        context: 'ECC Teaching'
      },
      {
        id: 'gen-2',
        source: 'teamup',
        date: '2026-02-11',
        title: 'All-hands',
        category: 'admin',
        context: 'General Events'
      }
    ]);

    const assignedPeople = expanded
      .filter((event) => event.id.startsWith('gen-2::'))
      .map((event) => event.person);

    expect(assignedPeople).toEqual(['Ana Aghili']);
  });


  it('keeps General Events that already have a resolved owner', () => {
    const expanded = expandEventsForReporting([
      {
        id: 'owned-general',
        source: 'teamup',
        date: '2026-03-03',
        title: 'Day Shift',
        person: 'Paula Johnson',
        category: 'shift',
        context: 'General Events'
      }
    ]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe('owned-general');
    expect(expanded[0].person).toBe('Paula Johnson');
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

describe('syncSelectedContexts', () => {
  it('auto-selects all available contexts when the user has not customized the filter', () => {
    expect(syncSelectedContexts(['General ECC Service', 'ECC Teaching'], ['General ECC Service'], false)).toEqual([
      'General ECC Service',
      'ECC Teaching'
    ]);
  });

  it('retains the user selection when customized and still available', () => {
    expect(syncSelectedContexts(['General ECC Service', 'ECC Teaching'], ['General ECC Service'], true)).toEqual([
      'General ECC Service'
    ]);
  });

  it('falls back to all contexts when a customized selection no longer exists', () => {
    expect(syncSelectedContexts(['General ECC Service', 'ECC Teaching'], ['General Events'], true)).toEqual([
      'General ECC Service',
      'ECC Teaching'
    ]);
  });
});
