import { describe, expect, it, vi } from 'vitest';

import { resolveInferredOwner } from './ownerResolution';

describe('resolveInferredOwner', () => {
  it('prefers subcalendar person over text/alias fallback when structured owner is absent', () => {
    const result = resolveInferredOwner({
      matchedLegendPerson: 'Paula Johnson',
      fallbackPerson: 'Liz Thomovsky',
      warn: vi.fn()
    });

    expect(result).toBe('Paula Johnson');
  });


  it('warns when subcalendar and text fallback conflict without structured owner', () => {
    const warn = vi.fn();

    const result = resolveInferredOwner({
      matchedLegendPerson: 'Paula Johnson',
      fallbackPerson: 'Liz Thomovsky',
      eventId: 'evt-456',
      eventTitle: 'Follow-up shift',
      warn
    });

    expect(result).toBe('Paula Johnson');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Teamup event owner conflict: using subcalendar owner over text inference',
      expect.objectContaining({
        id: 'evt-456',
        title: 'Follow-up shift',
        matchedLegendPerson: 'Paula Johnson',
        fallbackPerson: 'Liz Thomovsky'
      })
    );
  });
  it('prefers structured owner over text fallback and emits warning on conflict', () => {
    const warn = vi.fn();

    const result = resolveInferredOwner({
      structuredOwner: 'Paula Johnson',
      fallbackPerson: 'Liz Thomovsky',
      matchedLegendPerson: 'Paula Johnson',
      eventId: 'evt-123',
      eventTitle: 'Coverage shift',
      warn
    });

    expect(result).toBe('Paula Johnson');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Teamup event owner conflict: using structured owner over text inference',
      expect.objectContaining({
        id: 'evt-123',
        title: 'Coverage shift',
        structuredOwner: 'Paula Johnson',
        fallbackPerson: 'Liz Thomovsky'
      })
    );
  });

  it('falls back to subcalendar person when no explicit owner hints are present', () => {
    const result = resolveInferredOwner({
      matchedLegendPerson: 'Paula Johnson'
    });

    expect(result).toBe('Paula Johnson');
  });

  it('returns undefined for non-person calendars without owner hints', () => {
    const result = resolveInferredOwner({
      matchedLegendPerson: undefined,
      structuredOwner: undefined,
      fallbackPerson: undefined
    });

    expect(result).toBeUndefined();
  });
});
