export type TeamupNormalizedEvent = {
  id: string;
  date: string;
  title: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

type TeamupEventDateTime = {
  date?: string;
  datetime?: string;
};

type TeamupApiEvent = {
  id?: string | number;
  title?: string;
  notes?: string;
  start_dt?: TeamupEventDateTime;
  end_dt?: TeamupEventDateTime;
  all_day?: boolean;
};

type TeamupApiResponse = {
  events?: TeamupApiEvent[];
};

const TEAMUP_API_BASE = 'https://api.teamup.com';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: string) {
  if (DATE_ONLY_PATTERN.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toTime(value?: string) {
  if (!value || DATE_ONLY_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(11, 16);
}

function normalizeTeamupEvent(event: TeamupApiEvent): TeamupNormalizedEvent | null {
  const title = typeof event.title === 'string' ? event.title.trim() : '';
  const rawStart = event.start_dt?.datetime ?? event.start_dt?.date;
  if (!title || !rawStart) return null;

  const date = toIsoDate(rawStart);
  if (!date) return null;

  const startTime = event.all_day ? undefined : toTime(event.start_dt?.datetime ?? event.start_dt?.date);
  const endTime = event.all_day ? undefined : toTime(event.end_dt?.datetime ?? event.end_dt?.date);

  return {
    id: String(event.id ?? `${title}-${date}-${startTime ?? 'all-day'}`),
    date,
    title,
    startTime,
    endTime,
    notes: typeof event.notes === 'string' ? event.notes : undefined
  };
}

export async function fetchTeamupEvents(rangeStart: string, rangeEnd: string): Promise<TeamupNormalizedEvent[]> {
  const calendarKey = import.meta.env.VITE_TEAMUP_CALENDAR_KEY;
  const apiToken = import.meta.env.VITE_TEAMUP_API_TOKEN;

  if (!calendarKey || !apiToken) {
    throw new Error('Missing Teamup credentials. Configure VITE_TEAMUP_CALENDAR_KEY and VITE_TEAMUP_API_TOKEN.');
  }

  const endpoint = new URL(`${TEAMUP_API_BASE}/${calendarKey}/events`);
  endpoint.searchParams.set('startDate', rangeStart);
  endpoint.searchParams.set('endDate', rangeEnd);

  const response = await fetch(endpoint, {
    headers: {
      'Teamup-Token': apiToken,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Teamup request failed (${response.status})`);
  }

  const payload = (await response.json()) as TeamupApiResponse;
  const events = Array.isArray(payload.events) ? payload.events : [];

  return events
    .map((event) => normalizeTeamupEvent(event))
    .filter((event): event is TeamupNormalizedEvent => event !== null);
}
