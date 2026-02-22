const WORKER_BASE = 'https://pevs.hicksrch.workers.dev';
const WORKER_TIMEZONE = 'America/Indiana/Indianapolis';

export interface TeamupEvent {
  id: string;
  series_id?: string;
  remote_id?: string;
  subcalendar_id?: number;
  subcalendar_ids?: number[];
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
