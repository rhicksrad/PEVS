import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertTeamupEvents } from './App';
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
