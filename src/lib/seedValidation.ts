export type SeedEvent = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  person: string | null;
  category: 'shift' | 'teaching' | 'admin' | 'milestone';
  context: string;
};

const EXPECTED_MONTH_COUNTS: Record<string, number> = {
  '2026-02': 75,
  '2026-03': 60
};

export function validateSeedSchedule(events: SeedEvent[]) {
  const issues: string[] = [];
  const monthCounts = new Map<string, number>();
  const shiftKeys = new Set<string>();

  for (const event of events) {
    const monthKey = event.date.slice(0, 7);
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);

    if (event.category === 'shift' && !event.person) {
      issues.push(`Missing assignee for shift ${event.title} on ${event.date}`);
    }

    if (event.category === 'shift') {
      const shiftType = event.title.toLowerCase();
      const key = `${event.date}|${shiftType}`;
      if (shiftKeys.has(key)) {
        issues.push(`Duplicate shift type (${event.title}) on ${event.date}`);
      }
      shiftKeys.add(key);
    }
  }

  for (const [month, expected] of Object.entries(EXPECTED_MONTH_COUNTS)) {
    const actual = monthCounts.get(month) ?? 0;
    if (actual !== expected) {
      issues.push(`Expected ${expected} events for ${month}, found ${actual}`);
    }
  }

  if (issues.length) {
    console.warn('[starterSchedule] validation warnings:\n' + issues.map((issue) => `- ${issue}`).join('\n'));
  }
}
