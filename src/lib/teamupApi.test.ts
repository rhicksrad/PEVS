import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSubcalendarLabels } from './teamupApi';

describe('fetchSubcalendarLabels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges server labels with fallback labels so known ids always resolve', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        subcalendars: [
          { id: 999999, name: 'Visiting Clinician' }
        ]
      })
    }));

    const labels = await fetchSubcalendarLabels();

    expect(labels[999999]).toBe('Visiting Clinician');
    expect(labels[2346358]).toBe('Ana Aghili');
    expect(labels[432049]).toBe('Paula Johnson');
  });

  it('prefers live server labels for overlapping ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        subcalendars: [
          { id: 432049, name: 'Paula Johnson (Updated)' }
        ]
      })
    }));

    const labels = await fetchSubcalendarLabels();

    expect(labels[432049]).toBe('Paula Johnson (Updated)');
    expect(labels[432033]).toBe('Aimee Brooks');
  });
});
