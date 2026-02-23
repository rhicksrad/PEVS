const WORKER_BASE = 'https://pevs.hicksrch.workers.dev';
const WORKER_TIMEZONE = 'America/Indiana/Indianapolis';

type TeamupSubcalendarConfigItem = {
  id: number;
  name: string;
  color?: string;
  person?: string;
};

type TeamupSubcalendarConfigResponse = {
  subcalendars?: TeamupSubcalendarConfigItem[];
};

const FALLBACK_SUBCALENDAR_LABELS: Record<number, string> = {
  432033: 'Aimee Brooks',
  432034: 'Liz Thomovsky',
  432049: 'Paula Johnson',
  2346358: 'Ana Aghili',
  2346351: 'ECC Teaching',
  432050: 'General ECC Service',
  6541026: 'General Events'
};

export interface TeamupEvent {
  id: string;
  series_id?: string;
  remote_id?: string;
  subcalendar_id?: number;
  subcalendar_ids?: number[];
  subcalendar_name?: string;
  calendar_name?: string;
  subcalendar?: {
    id?: number;
    name?: string;
    title?: string;
    color?: string;
    [key: string]: unknown;
  };
  title: string;
  notes?: string;
  location?: string;
  all_day: boolean;
  rrule?: string;
  rdate?: string[];
  tz?: string;
  start_dt: string;
  end_dt: string;
  creation_dt?: string;
  update_dt?: string;
  version?: string;
  readonly [key: string]: unknown;
}

type TeamupEventsResponse = {
  events?: TeamupEvent[];
};

export async function fetchEvents(startDate: string, endDate: string): Promise<TeamupEvent[]> {
  const query = new URLSearchParams({
    startDate,
    endDate,
    tz: WORKER_TIMEZONE
  });

  const response = await fetch(`${WORKER_BASE}/events?${query.toString()}`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unable to load events (${response.status}): ${body || response.statusText}`);
  }

  const payload = (await response.json()) as TeamupEventsResponse;
  if (!Array.isArray(payload.events)) {
    throw new Error('Worker response is missing a valid events array.');
  }

  return payload.events;
}

export async function fetchSubcalendarLabels(): Promise<Record<number, string>> {
  const response = await fetch(`${WORKER_BASE}/subcalendars`, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    return FALLBACK_SUBCALENDAR_LABELS;
  }

  const payload = (await response.json()) as TeamupSubcalendarConfigResponse;
  if (!Array.isArray(payload.subcalendars)) {
    return FALLBACK_SUBCALENDAR_LABELS;
  }

  const mapped = payload.subcalendars.reduce<Record<number, string>>((acc, item) => {
    if (typeof item.id !== 'number' || !Number.isFinite(item.id)) return acc;
    if (typeof item.name !== 'string' || !item.name.trim()) return acc;
    acc[item.id] = item.name.trim();
    return acc;
  }, {});

  return Object.keys(mapped).length > 0 ? mapped : FALLBACK_SUBCALENDAR_LABELS;
}
