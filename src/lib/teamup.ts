export type TeamupMappedEvent = {
  id: string;
  externalId: string;
  source: 'teamup';
  date: string;
  title: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  category: 'admin';
  context: 'General Events';
  person?: 'Aimee Brooks' | 'Ana Aghili' | 'Liz Thomovsky' | 'Paula Johnson';
};

type ParsedIcsEvent = {
  uid?: string;
  summary?: string;
  description?: string;
  dtstart?: string;
  dtend?: string;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DISPLAY_MARKER_PATTERN = /\(([^)]+)\)/;
const TEAM_MEMBERS = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'] as const;

type TeamMember = (typeof TEAM_MEMBERS)[number];

const makeId = (title: string, date: string, startTime?: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}-${startTime ?? 'all-day'}`;

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

function getPersonFromMarker(marker: string): TeamMember | undefined {
  const normalizedMarker = marker.trim().toLowerCase();
  return TEAM_MEMBERS.find((member) => {
    const [firstName] = member.split(' ');
    return member.toLowerCase() === normalizedMarker || firstName.toLowerCase() === normalizedMarker;
  });
}

function stripDisplayMarkers(title: string) {
  return title.replace(DISPLAY_MARKER_PATTERN, '').trim();
}

function normalizeIcsDateTime(raw?: string) {
  if (!raw) return undefined;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  const compact = raw.replace('Z', '').replace(/[-:]/g, '');
  if (/^\d{8}T\d{6}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`;
  }

  return raw;
}

function unfoldIcsLines(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, '\n').split('\n');
  const unfolded: string[] = [];

  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function decodeIcsText(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parsePublicIcsEvents(ics: string): ParsedIcsEvent[] {
  const lines = unfoldIcsLines(ics);
  const events: ParsedIcsEvent[] = [];
  let current: ParsedIcsEvent | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const rawKey = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    const key = rawKey.split(';')[0].toUpperCase();

    if (key === 'UID') current.uid = value;
    if (key === 'SUMMARY') current.summary = decodeIcsText(value);
    if (key === 'DESCRIPTION') current.description = decodeIcsText(value);
    if (key === 'DTSTART') current.dtstart = normalizeIcsDateTime(value);
    if (key === 'DTEND') current.dtend = normalizeIcsDateTime(value);
  }

  return events;
}


function buildExplicitTeamupEndpoint(template: string | undefined, calendarKey: string) {
  const value = template?.trim();
  if (!value) return undefined;

  if (value.includes('{calendarKey}')) {
    return value.split('{calendarKey}').join(encodeURIComponent(calendarKey));
  }

  return value;
}
function mapIcsEventToScheduleEvent(event: ParsedIcsEvent): TeamupMappedEvent | null {
  const rawTitle = typeof event.summary === 'string' ? event.summary.trim() : '';
  if (!rawTitle || !event.dtstart) return null;

  const date = toIsoDate(event.dtstart);
  if (!date) return null;

  const markerMatch = rawTitle.match(DISPLAY_MARKER_PATTERN);
  const person = markerMatch ? getPersonFromMarker(markerMatch[1]) : undefined;
  const title = stripDisplayMarkers(rawTitle);
  const startTime = toTime(event.dtstart);
  const endTime = toTime(event.dtend);
  const externalId = event.uid ?? makeId(title, date, startTime);

  return {
    id: makeId(title, date, startTime),
    externalId,
    source: 'teamup',
    date,
    title,
    startTime,
    endTime,
    notes: event.description,
    category: 'admin',
    context: 'General Events',
    person
  };
}

export async function fetchTeamupEvents(rangeStart: string, rangeEnd: string): Promise<TeamupMappedEvent[]> {
  const calendarKey = import.meta.env.VITE_TEAMUP_CALENDAR_KEY ?? 'ks109ec178962cdfa7';
  const basePath = import.meta.env.BASE_URL || '/';
  const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const endpoint = `${normalizedBasePath}api/teamup/feed/${calendarKey}/0.ics`;
  const directEndpoint = `https://ics.teamup.com/feed/${calendarKey}/0.ics`;
  const explicitEndpoint = buildExplicitTeamupEndpoint(
    import.meta.env.VITE_TEAMUP_ICS_URL ?? '/api/teamup/feed/{calendarKey}/0.ics',
    calendarKey
  );
  const endpoints = [explicitEndpoint, endpoint, directEndpoint]
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate, index, list) => list.indexOf(candidate) === index);

  let payload = '';
  let lastError = 'Unknown error';

  for (const candidate of endpoints) {
    try {
      const response = await fetch(candidate, {
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1'
        }
      });

      if (!response.ok) {
        lastError = `Teamup ICS request failed (${response.status})`;
        if (response.status === 404) continue;
        throw new Error(lastError);
      }

      payload = await response.text();
      if (!payload.includes('BEGIN:VCALENDAR')) {
        lastError = 'Teamup ICS response was not a calendar payload.';
        continue;
      }

      lastError = '';
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Teamup ICS request failed.';
      continue;
    }
  }

  if (!payload || lastError) {
    throw new Error(lastError || 'Teamup ICS request failed.');
  }

  const rangeStartTime = new Date(`${rangeStart}T00:00:00Z`).getTime();
  const rangeEndTime = new Date(`${rangeEnd}T23:59:59Z`).getTime();

  return parsePublicIcsEvents(payload)
    .map((event) => mapIcsEventToScheduleEvent(event))
    .filter((event): event is TeamupMappedEvent => event !== null)
    .filter((event) => {
      const eventTime = new Date(`${event.date}T00:00:00Z`).getTime();
      return eventTime >= rangeStartTime && eventTime <= rangeEndTime;
    });
}
