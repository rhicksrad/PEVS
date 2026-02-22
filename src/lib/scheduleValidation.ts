export type ScheduleValidationEvent = {
  id: string;
  date: string;
  title: string;
  category: string;
  startTime?: string;
  endTime?: string;
  person?: string;
  externalId?: string;
};

export type ScheduleValidationResult = {
  issues: string[];
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const makeDuplicateKey = (event: ScheduleValidationEvent) => {
  const identity = event.externalId ?? event.id;
  return `${identity}|${event.date}|${event.startTime ?? 'all-day'}|${event.endTime ?? 'all-day'}`;
};

export function validateScheduleEvents(events: ScheduleValidationEvent[]): ScheduleValidationResult {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (!event.date || !ISO_DATE_PATTERN.test(event.date)) {
      issues.push(`[${event.id}] Missing/invalid required field: date`);
    }

    if (!event.title?.trim()) {
      issues.push(`[${event.id}] Missing required field: title`);
    }

    if (!event.category?.trim()) {
      issues.push(`[${event.id}] Missing required field: category`);
    }

    if (event.category === 'shift' && !event.person?.trim()) {
      issues.push(`[${event.id}] Shift event missing required person`);
    }

    if (event.startTime && !TIME_PATTERN.test(event.startTime)) {
      issues.push(`[${event.id}] Invalid startTime (${event.startTime}), expected HH:MM`);
    }

    if (event.endTime && !TIME_PATTERN.test(event.endTime)) {
      issues.push(`[${event.id}] Invalid endTime (${event.endTime}), expected HH:MM`);
    }

    if (event.startTime && event.endTime && TIME_PATTERN.test(event.startTime) && TIME_PATTERN.test(event.endTime)) {
      if (toMinutes(event.endTime) <= toMinutes(event.startTime)) {
        issues.push(`[${event.id}] endTime (${event.endTime}) must be after startTime (${event.startTime})`);
      }
    }

    const duplicateKey = makeDuplicateKey(event);
    if (seen.has(duplicateKey)) {
      issues.push(`[${event.id}] Duplicate event key detected (${duplicateKey})`);
    }
    seen.add(duplicateKey);
  }

  return { issues };
}
