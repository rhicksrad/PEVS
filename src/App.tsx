import { useEffect, useMemo, useState } from 'react';
import { formatIsoDate } from './lib/date';
import { fetchEvents, fetchSubcalendarLabels, type TeamupEvent } from './lib/teamupApi';
import { validateScheduleEvents } from './lib/scheduleValidation';
import { resolveInferredOwner } from './lib/ownerResolution';

type ScheduleCategory = 'shift' | 'teaching' | 'admin' | 'milestone';
type TeamMember = 'Aimee Brooks' | 'Ana Aghili' | 'Liz Thomovsky' | 'Paula Johnson';

export type ScheduleEvent = {
  id: string;
  externalId?: string;
  source?: 'teamup';
  date: string;
  endDate?: string;
  title: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  category: ScheduleCategory;
  context: string;
  person?: TeamMember;
  notes?: string;
  location?: string;
  calendarLabel?: string;
  calendarColor?: string;
};

type PersistedSchedulePayload = {
  version: number;
  events: ScheduleEvent[];
  source: 'teamup';
  updatedAt: string;
};

type CalendarKind = 'person' | 'context' | 'other';
type CalendarMeta = {
  label: string;
  color: string;
  kind: CalendarKind;
  person?: TeamMember;
  context?: string;
};

const STORAGE_KEY = 'annie-schedule-events-v1';
const CURRENT_SCHEMA_VERSION = 1;
const ANNIE_SOURCE_NAME: TeamMember = 'Ana Aghili';
const SCHEDULE_WINDOW_DAYS = 120;
const INITIAL_EVENT_LIMIT = 12;
const TEAM: TeamMember[] = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];
const PERSON_MARKER_PATTERN = /\(([^)]+)\)/;
const ALPHA_NUMERIC_PATTERN = /[^a-z0-9]+/g;
const PERSON_COLORS: Record<TeamMember, string> = {
  'Aimee Brooks': '#2563eb',
  'Ana Aghili': '#f97316',
  'Liz Thomovsky': '#dc2626',
  'Paula Johnson': '#38bdf8'
};

const DEFAULT_CALENDAR_COLOR = '#475569';
const KNOWN_CALENDARS: Record<string, Omit<CalendarMeta, 'label'>> = {
  'aimee brooks': { color: '#5b2c91', kind: 'person', person: 'Aimee Brooks' },
  'ana aghili': { color: '#f47a20', kind: 'person', person: 'Ana Aghili' },
  'liz thomovsky': { color: '#b91c1c', kind: 'person', person: 'Liz Thomovsky' },
  'paula johnson': { color: '#2d56b3', kind: 'person', person: 'Paula Johnson' },
  'general ecc service': { color: '#2e8b2f', kind: 'context', context: 'General ECC Service' },
  'ecc teaching': { color: '#eab308', kind: 'context', context: 'ECC Teaching' },
  'general events': { color: '#49b3a2', kind: 'context', context: 'General Events' },
  'ecc resident chief': { color: '#a63a8d', kind: 'other' }
};


const PERSON_ALIASES: Record<TeamMember, string[]> = {
  'Aimee Brooks': ['aimee brooks', 'aimee', 'brooks', 'abrooks', 'brooks, aimee', 'a brooks', 'ab'],
  'Ana Aghili': ['ana aghili', 'ana', 'aghili', 'aaghili', 'aghili, ana', 'a aghili', 'aa'],
  'Liz Thomovsky': ['liz thomovsky', 'liz', 'thomovsky', 'lthomovsky', 'thomovsky, liz', 'l thomovsky', 'lt'],
  'Paula Johnson': ['paula johnson', 'paula', 'johnson', 'pjohnson', 'johnson, paula', 'p johnson', 'pj']
};

const PERSON_ALIAS_MAP = Object.entries(PERSON_ALIASES).reduce<Record<string, TeamMember>>((map, [member, aliases]) => {
  aliases.forEach((alias) => {
    map[normalizeToken(alias)] = member as TeamMember;
  });
  return map;
}, {});
const LATE_SHIFT_PATTERN = /\b(late|evening|night)\b/i;
const EARLY_SHIFT_PATTERN = /\b(early|morning)\b/i;
const PM_SHIFT_PATTERN = /\bpm\b/i;
const AM_SHIFT_PATTERN = /\bam\b/i;
const TEACHING_CONTEXT_PATTERN = /\bteaching\b/i;
const GRADE_ASSIGNMENT_PATTERN = /^\s*grade assignment\s*[12]\b/i;
const LEADING_OWNER_TOKEN_PATTERN = /^\s*([a-z]{2,})\s*(?:[-:|]|\b)/i;

const toSortKey = (event: ScheduleEvent) => `${event.date}T${event.startTime ?? '99:99'}`;
const sortEvents = (events: ScheduleEvent[]) => [...events].sort((a, b) => toSortKey(a).localeCompare(toSortKey(b)));

function getPersonFromMarker(marker: string): TeamMember | undefined {
  const normalizedMarker = normalizeToken(marker);
  return PERSON_ALIAS_MAP[normalizedMarker];
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(ALPHA_NUMERIC_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

function inferOwnerFromText(...values: Array<unknown>): TeamMember | undefined {
  const normalizedHaystack = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeToken)
    .join(' ');
  if (!normalizedHaystack) return undefined;

  const byLongestAlias = Object.keys(PERSON_ALIAS_MAP).sort((a, b) => b.length - a.length);
  const matchedAlias = byLongestAlias.find((alias) => {
    const wrappedAlias = ` ${alias} `;
    const wrappedHaystack = ` ${normalizedHaystack} `;
    return wrappedHaystack.includes(wrappedAlias);
  });

  return matchedAlias ? PERSON_ALIAS_MAP[matchedAlias] : undefined;
}

function inferOwnerFromTeachingTitle(title: string, isTeachingEvent: boolean): TeamMember | undefined {
  if (!isTeachingEvent) return undefined;
  const tokenMatch = title.match(LEADING_OWNER_TOKEN_PATTERN);
  if (!tokenMatch) return undefined;
  return PERSON_ALIAS_MAP[normalizeToken(tokenMatch[1])];
}

function extractOwnerCandidates(eventRecord: Record<string, unknown>): TeamMember[] {
  const candidateTokens = new Set<string>();
  const collectedPeople = new Set<TeamMember>();
  const scalarOwnerKeys = ['owner', 'owner_name', 'who', 'organizer', 'organizer_name', 'created_by', 'updated_by'];
  const nestedOwnerHints = ['owner', 'owners', 'participant', 'participants', 'organizer', 'organizers', 'creator', 'updater', 'who'];
  const nestedNameKeys = ['name', 'full_name', 'display_name', 'title', 'label'];

  const appendStringValue = (value: unknown) => {
    if (typeof value !== 'string') return;
    const normalized = normalizeToken(value);
    if (!normalized) return;
    candidateTokens.add(normalized);
  };

  scalarOwnerKeys.forEach((key) => {
    appendStringValue(eventRecord[key]);
  });

  const visited = new Set<unknown>();
  const inspectNested = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null || visited.has(value)) return;
    if (Array.isArray(value)) {
      visited.add(value);
      value.forEach((entry) => inspectNested(entry, depth + 1));
      return;
    }

    if (typeof value === 'string') {
      appendStringValue(value);
      return;
    }

    if (typeof value !== 'object') return;
    visited.add(value);

    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, entry]) => {
      const normalizedKey = normalizeToken(key);
      if (nestedOwnerHints.some((hint) => normalizedKey.includes(hint))) {
        inspectNested(entry, depth + 1);
      }

      if (nestedNameKeys.includes(normalizedKey)) {
        appendStringValue(entry);
      }
    });
  };

  inspectNested(eventRecord);

  candidateTokens.forEach((token) => {
    const person = PERSON_ALIAS_MAP[token];
    if (person) collectedPeople.add(person);
  });

  return Array.from(collectedPeople);
}

function normalizeEvent(event: ScheduleEvent): ScheduleEvent {
  const markerMatch = event.title.match(PERSON_MARKER_PATTERN);
  const markerPerson = markerMatch ? getPersonFromMarker(markerMatch[1]) : undefined;
  const cleanedTitle = markerMatch ? event.title.replace(markerMatch[0], '').trim() : event.title;
  const person = event.person ? event.person : markerPerson;

  return {
    ...event,
    title: cleanedTitle,
    person
  };
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(prefixed) ? prefixed : undefined;
}

function toCalendarMeta(label: string, eventColor?: string): CalendarMeta {
  const normalizedLabel = label.trim();
  const known = KNOWN_CALENDARS[normalizedLabel.toLowerCase()];
  if (!known) {
    return {
      label: normalizedLabel,
      color: eventColor ?? DEFAULT_CALENDAR_COLOR,
      kind: 'other'
    };
  }

  return {
    label: normalizedLabel,
    color: known.color,
    kind: known.kind,
    person: known.person,
    context: known.context
  };
}

function normalizeLoadedEvents(events: ScheduleEvent[]) {
  return sortEvents(events.map(normalizeEvent));
}

const formatDisplayTime = (time?: string) => {
  if (!time) return 'All day';
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
};

function getWeekStartIso(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  const offset = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - offset);
  return formatIsoDate(parsed);
}

export function expandEventsForReporting(events: ScheduleEvent[]): ScheduleEvent[] {
  const groupedByWeek = events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
    const weekStart = getWeekStartIso(event.date);
    acc[weekStart] = [...(acc[weekStart] ?? []), event];
    return acc;
  }, {});

  const expanded: ScheduleEvent[] = [];
  Object.values(groupedByWeek).forEach((weekEvents) => {
    const activePeople = new Set<TeamMember>();
    weekEvents.forEach((event) => {
      if (event.context !== 'General Events' && event.person) {
        activePeople.add(event.person);
      }
    });

    weekEvents.forEach((event) => {
      if (event.context !== 'General Events' || event.person) {
        expanded.push(event);
        return;
      }

      TEAM.forEach((person) => {
        if (!activePeople.has(person)) return;
        expanded.push({ ...event, id: `${event.id}::${person}`, person });
      });
    });
  });

  return expanded;
}

function toLocalDateKey(value: string) {
  return parseDateTimeParts(value)?.date ?? null;
}

function toLocalTime(value?: string) {
  if (!value) return undefined;
  return parseDateTimeParts(value)?.time;
}

function parseDateTimeParts(value: string): { date: string; time?: string } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return {
      date: `${year}-${month}-${day}`,
      time: hour && minute ? `${hour}:${minute}` : undefined
    };
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (compactMatch) {
    const [, year, month, day, hour, minute] = compactMatch;
    return {
      date: `${year}-${month}-${day}`,
      time: hour && minute ? `${hour}:${minute}` : undefined
    };
  }

  return null;
}

export function convertTeamupEvents(teamupEvents: TeamupEvent[], subcalendarIdToLabel: Record<number, string> = {}): ScheduleEvent[] {
  const mapped: ScheduleEvent[] = [];
  const shouldDebugUnmatchedOwners = false && import.meta.env.DEV;

  teamupEvents.forEach((event) => {
    const eventRecord = event as Record<string, unknown>;
    const subcalendar = eventRecord.subcalendar as Record<string, unknown> | undefined;
    const rawLabel =
      (typeof eventRecord.subcalendar_name === 'string' && eventRecord.subcalendar_name) ||
      (typeof eventRecord.calendar_name === 'string' && eventRecord.calendar_name) ||
      (typeof subcalendar?.name === 'string' && subcalendar.name);
    const normalizedRawLabel = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    const rawColor =
      normalizeHexColor(eventRecord.subcalendar_color) ??
      normalizeHexColor(eventRecord.calendar_color) ??
      normalizeHexColor(subcalendar?.color);
    const referencedCalendarNames = new Set<string>();
    const referencedCalendarIds = new Set<number>();
    const appendCalendarName = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      referencedCalendarNames.add(value.trim());
    };
    const appendCalendarId = (value: unknown) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      referencedCalendarIds.add(value);
    };

    appendCalendarName(rawLabel);
    appendCalendarId(eventRecord.subcalendar_id);

    if (Array.isArray(eventRecord.subcalendar_ids)) {
      eventRecord.subcalendar_ids.forEach((id) => appendCalendarId(id));
    }

    if (Array.isArray(eventRecord.subcalendars)) {
      eventRecord.subcalendars.forEach((item) => {
        if (typeof item === 'string') appendCalendarName(item);
        if (item && typeof item === 'object') {
          appendCalendarName((item as Record<string, unknown>).name);
          appendCalendarName((item as Record<string, unknown>).title);
          appendCalendarId((item as Record<string, unknown>).id);
        }
      });
    }

    if (eventRecord.subcalendars && typeof eventRecord.subcalendars === 'object' && !Array.isArray(eventRecord.subcalendars)) {
      Object.values(eventRecord.subcalendars as Record<string, unknown>).forEach((item) => {
        if (typeof item === 'string') appendCalendarName(item);
        if (item && typeof item === 'object') {
          appendCalendarName((item as Record<string, unknown>).name);
          appendCalendarName((item as Record<string, unknown>).title);
          appendCalendarId((item as Record<string, unknown>).id);
        }
      });
    }

    const matchedByIdMetaCandidates = Array.from(referencedCalendarIds)
      .map((id) => subcalendarIdToLabel[id])
      .filter((label): label is string => Boolean(label))
      .map((label) => toCalendarMeta(label, rawColor));
    const matchedById = matchedByIdMetaCandidates.find((metaItem) => metaItem.person)?.label ?? matchedByIdMetaCandidates[0]?.label;

    const matchedByNameMetaCandidates = Array.from(referencedCalendarNames)
      .map((name) => toCalendarMeta(name, rawColor))
      .filter((metaItem) => KNOWN_CALENDARS[metaItem.label.toLowerCase()]);
    const matchedByName = matchedByNameMetaCandidates.find((metaItem) => metaItem.person) ?? matchedByNameMetaCandidates[0];

    const matchedLegend = matchedByName ?? (matchedById ? toCalendarMeta(matchedById, rawColor) : undefined);

    const ownerCandidates = extractOwnerCandidates(eventRecord);
    const isGradeAssignment = GRADE_ASSIGNMENT_PATTERN.test(event.title);
    const titleOrNotesSuggestTeaching = TEACHING_CONTEXT_PATTERN.test(event.title) || TEACHING_CONTEXT_PATTERN.test(event.notes ?? '');
    const isTeachingEvent = isGradeAssignment || titleOrNotesSuggestTeaching || (typeof rawLabel === 'string' && normalizeToken(rawLabel).includes('ecc teaching'));
    const fallbackPerson =
      (isGradeAssignment ? 'Ana Aghili' : undefined) ??
      inferOwnerFromTeachingTitle(event.title, isTeachingEvent) ??
      inferOwnerFromText(
      event.title,
      event.notes,
      rawLabel,
      eventRecord.owner,
      eventRecord.who,
      eventRecord.owner_name,
      eventRecord.organizer,
      eventRecord.organizer_name,
      eventRecord.created_by,
      eventRecord.updated_by
    );

    const inferredOwner = resolveInferredOwner<TeamMember>({
      structuredOwner: ownerCandidates[0],
      fallbackPerson,
      explicitCalendarPerson: matchedByName?.person,
      idDerivedPerson: matchedById ? toCalendarMeta(matchedById, rawColor).person : undefined,
      eventId: event.id,
      eventTitle: event.title
    });
    const personCalendar = inferredOwner ? toCalendarMeta(inferredOwner) : undefined;
    const titleHintLabel = /resident chief/i.test(event.title) || /resident chief/i.test(event.notes ?? '')
      ? 'ECC Resident Chief'
      : titleOrNotesSuggestTeaching
        ? 'ECC Teaching'
        : /service/i.test(event.title) || /service/i.test(event.notes ?? '')
          ? 'General ECC Service'
          : 'General Events';
    const meta = matchedLegend ?? (isTeachingEvent ? toCalendarMeta('ECC Teaching', rawColor) : personCalendar ?? toCalendarMeta(normalizedRawLabel || titleHintLabel, rawColor));
    const context = meta.context ?? 'General Events';
    const category: ScheduleCategory = isTeachingEvent || /grading|orientation/i.test(event.title)
      ? 'teaching'
      : /shift|coverage|service/i.test([event.title, event.notes, context].filter(Boolean).join(' '))
        ? 'shift'
        : event.all_day
          ? 'milestone'
          : 'admin';

    if (shouldDebugUnmatchedOwners && !inferredOwner) {
      console.debug('Teamup event owner unmatched', {
        id: event.id,
        title: event.title,
        keys: Object.keys(eventRecord),
        ownerCandidates
      });
    }

    const date = toLocalDateKey(event.start_dt);
    if (!date) return;

    mapped.push({
      id: String(event.id),
      externalId: event.remote_id,
      source: 'teamup',
      date,
      endDate: toLocalDateKey(event.end_dt) ?? date,
      title: event.title?.trim() || 'Untitled event',
      startTime: event.all_day ? undefined : toLocalTime(event.start_dt),
      endTime: event.all_day ? undefined : toLocalTime(event.end_dt),
      allDay: event.all_day,
      notes: event.notes,
      location: typeof event.location === 'string' ? event.location.trim() || undefined : undefined,
      category,
      context,
      person: inferredOwner,
      calendarLabel: meta.label,
      calendarColor: meta.color
    });
  });

  return normalizeLoadedEvents(mapped);
}

function getNextIsoDate(date: string) {
  const nextDate = new Date(`${date}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  return formatIsoDate(nextDate);
}

function isLateShiftEvent(event: ScheduleEvent) {
  const descriptor = [event.title, event.notes, event.context, event.calendarLabel].filter(Boolean).join(' ');
  if (LATE_SHIFT_PATTERN.test(descriptor) || PM_SHIFT_PATTERN.test(event.title)) {
    return true;
  }

  if (!event.startTime) {
    return false;
  }

  const [hours] = event.startTime.split(':').map(Number);
  return Number.isFinite(hours) && hours >= 15;
}

function isEarlyShiftEvent(event: ScheduleEvent) {
  const descriptor = [event.title, event.notes, event.context, event.calendarLabel].filter(Boolean).join(' ');
  if (EARLY_SHIFT_PATTERN.test(descriptor) || AM_SHIFT_PATTERN.test(event.title)) {
    return true;
  }

  if (!event.startTime) {
    return false;
  }

  const [hours] = event.startTime.split(':').map(Number);
  return Number.isFinite(hours) && hours <= 9;
}

export function getLateToEarlyShiftCounts(events: ScheduleEvent[]) {
  const lateShiftDaysByPerson = new Map<TeamMember, Set<string>>();
  const earlyShiftDaysByPerson = new Map<TeamMember, Set<string>>();

  events.forEach((event) => {
    if (!event.person) return;
    if (isLateShiftEvent(event)) {
      const lateDays = lateShiftDaysByPerson.get(event.person) ?? new Set<string>();
      lateDays.add(event.date);
      lateShiftDaysByPerson.set(event.person, lateDays);
    }

    if (isEarlyShiftEvent(event)) {
      const earlyDays = earlyShiftDaysByPerson.get(event.person) ?? new Set<string>();
      earlyDays.add(event.date);
      earlyShiftDaysByPerson.set(event.person, earlyDays);
    }
  });

  return TEAM.map((person) => {
    const lateDays = lateShiftDaysByPerson.get(person) ?? new Set<string>();
    const earlyDays = earlyShiftDaysByPerson.get(person) ?? new Set<string>();
    const value = Array.from(lateDays).filter((day) => earlyDays.has(getNextIsoDate(day))).length;

    return { label: person, value, color: PERSON_COLORS[person] };
  });
}

export function syncSelectedContexts(
  availableContexts: string[],
  selectedContexts: string[],
  hasCustomizedContextFilter: boolean
) {
  if (availableContexts.length === 0) {
    return [];
  }

  if (!hasCustomizedContextFilter) {
    return availableContexts;
  }

  const available = new Set(availableContexts);
  const retained = selectedContexts.filter((item) => available.has(item));
  return retained.length > 0 ? retained : availableContexts;
}
export function selectAnnieScheduleEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return normalizeLoadedEvents(events.filter((event) => event.person === ANNIE_SOURCE_NAME));
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function parseScheduleDate(date: string) {
  return new Date(date + 'T12:00:00');
}

function getTimeMinutes(time?: string) {
  if (!time) return undefined;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  return hours * 60 + minutes;
}

function formatLongDate(date: string) {
  return parseScheduleDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function formatCompactDate(date: string) {
  return parseScheduleDate(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

function formatDayHeading(date: string, today: string) {
  if (date === today) return 'Today';
  const tomorrow = new Date(parseScheduleDate(today));
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === formatIsoDate(tomorrow)) return 'Tomorrow';
  return parseScheduleDate(date).toLocaleDateString(undefined, { weekday: 'long' });
}

function getDayDistance(from: string, to: string) {
  const milliseconds = parseScheduleDate(to).getTime() - parseScheduleDate(from).getTime();
  return Math.round(milliseconds / (24 * 60 * 60 * 1000));
}

function getDisplayTitle(event: ScheduleEvent) {
  return event.title
    .replace(/^\s*AA\s*[-:|]\s*/i, '')
    .replace(/^\s*Ana Aghili\s*[-:|]\s*/i, '')
    .trim();
}

function getEventKind(event: ScheduleEvent) {
  if (event.category === 'teaching') return 'Teaching';
  if (event.category === 'shift') return 'Shift';
  if (event.category === 'milestone') return 'All day';
  return 'Schedule';
}

function getEventTime(event: ScheduleEvent) {
  if (event.allDay || !event.startTime) return 'All day';
  if (!event.endTime) return formatDisplayTime(event.startTime);
  return formatDisplayTime(event.startTime) + ' – ' + formatDisplayTime(event.endTime);
}

function isEventOnDate(event: ScheduleEvent, date: string) {
  return event.date <= date && (event.endDate ?? event.date) >= date;
}

function isCompletedToday(event: ScheduleEvent, today: string, currentMinutes: number) {
  if (!isEventOnDate(event, today) || event.allDay || !event.endTime) return false;
  const endMinutes = getTimeMinutes(event.endTime);
  return event.endDate === today && endMinutes !== undefined && endMinutes <= currentMinutes;
}

type ScheduleStatus = {
  eyebrow: string;
  headline: string;
  detail: string;
  tone: 'working' | 'later' | 'off';
};

function getScheduleStatus(events: ScheduleEvent[], today: string, currentMinutes: number): ScheduleStatus {
  const todayEvents = events.filter((event) => isEventOnDate(event, today));
  const currentEvent = todayEvents.find((event) => {
    if (event.allDay) return true;
    const start = getTimeMinutes(event.startTime);
    const end = getTimeMinutes(event.endTime);
    return start !== undefined && end !== undefined && start <= currentMinutes && currentMinutes < end;
  });

  if (currentEvent) {
    if (currentEvent.allDay) {
      return {
        eyebrow: 'On Annie’s schedule today',
        headline: getDisplayTitle(currentEvent),
        detail: 'This is an all-day item.',
        tone: 'working'
      };
    }

    return {
      eyebrow: 'Right now',
      headline: 'Annie is working',
      detail: getDisplayTitle(currentEvent) + ' until ' + formatDisplayTime(currentEvent.endTime) + '.',
      tone: 'working'
    };
  }

  const laterEvent = todayEvents.find((event) => {
    const start = getTimeMinutes(event.startTime);
    return start !== undefined && start > currentMinutes;
  });

  if (laterEvent) {
    return {
      eyebrow: 'Later today',
      headline: 'Annie works at ' + formatDisplayTime(laterEvent.startTime),
      detail: getDisplayTitle(laterEvent) + '.',
      tone: 'later'
    };
  }

  if (todayEvents.length > 0) {
    return {
      eyebrow: 'For the rest of today',
      headline: 'Annie is off',
      detail: 'Her scheduled work for today is finished.',
      tone: 'off'
    };
  }

  return {
    eyebrow: 'Today',
    headline: 'Annie is off',
    detail: 'There’s nothing else on her schedule today.',
    tone: 'off'
  };
}

function isFutureStart(event: ScheduleEvent, today: string, currentMinutes: number) {
  if (event.date > today) return true;
  if (event.date < today) return false;
  if (event.allDay) return false;
  const start = getTimeMinutes(event.startTime);
  return start !== undefined && start > currentMinutes;
}

function getNextEventDescription(event: ScheduleEvent, today: string) {
  const distance = getDayDistance(today, event.date);
  const when = distance === 0
    ? 'Later today'
    : distance === 1
      ? 'Tomorrow'
      : distance < 7
        ? 'In ' + distance + ' days'
        : formatCompactDate(event.date);

  return {
    when,
    title: getDisplayTitle(event),
    time: getEventTime(event)
  };
}

function readCachedSchedule(): PersistedSchedulePayload | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as PersistedSchedulePayload;
    if (parsed.version !== CURRENT_SCHEMA_VERSION || !Array.isArray(parsed.events)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function App() {
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const today = formatIsoDate(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const rangeStart = formatIsoDate(new Date());
    const rangeEnd = formatIsoDate(addDays(new Date(), SCHEDULE_WINDOW_DAYS));

    const loadSchedule = async () => {
      setIsLoading(true);
      try {
        const [fetchedEvents, subcalendarLabels] = await Promise.all([
          fetchEvents(rangeStart, rangeEnd),
          fetchSubcalendarLabels()
        ]);
        const annieEvents = selectAnnieScheduleEvents(convertTeamupEvents(fetchedEvents, subcalendarLabels));
        const validation = validateScheduleEvents(annieEvents);
        if (validation.issues.length > 0) {
          console.warn('Annie schedule validation issues', validation.issues);
        }
        if (isCancelled) return;

        const updatedAt = new Date();
        const payload: PersistedSchedulePayload = {
          version: CURRENT_SCHEMA_VERSION,
          events: annieEvents,
          source: 'teamup',
          updatedAt: updatedAt.toISOString()
        };

        setEvents(annieEvents);
        setLastUpdated(updatedAt);
        setLoadMessage('');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        if (isCancelled) return;
        const cached = readCachedSchedule();
        if (cached) {
          setEvents(cached.events);
          setLastUpdated(new Date(cached.updatedAt));
          setLoadMessage('Couldn’t refresh right now. Showing the last saved schedule.');
        } else {
          setEvents([]);
          setLoadMessage('Annie’s schedule isn’t available right now. Try refreshing in a moment.');
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    void loadSchedule();
    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  const activeEvents = useMemo(
    () => events.filter((event) => (event.endDate ?? event.date) >= today),
    [events, today]
  );
  const status = useMemo(
    () => getScheduleStatus(activeEvents, today, currentMinutes),
    [activeEvents, currentMinutes, today]
  );
  const nextEvent = useMemo(
    () => activeEvents.find((event) => isFutureStart(event, today, currentMinutes)),
    [activeEvents, currentMinutes, today]
  );
  const nextEventDescription = nextEvent ? getNextEventDescription(nextEvent, today) : undefined;
  const visibleEvents = showAll ? activeEvents : activeEvents.slice(0, INITIAL_EVENT_LIMIT);
  const groupedEvents = visibleEvents.reduce<Array<{ date: string; events: ScheduleEvent[] }>>((groups, event) => {
    const previous = groups[groups.length - 1];
    if (previous?.date === event.date) {
      previous.events.push(event);
    } else {
      groups.push({ date: event.date, events: [event] });
    }
    return groups;
  }, []);
  const scheduleEnd = formatIsoDate(addDays(parseScheduleDate(today), SCHEDULE_WINDOW_DAYS));

  return <main className="app-shell">
    <header className="masthead">
      <a className="brand" href="#top" aria-label="Annie’s schedule home">
        <span className="brand-mark" aria-hidden="true">A</span>
        <span>
          <strong>Just Annie</strong>
          <small>Live work schedule</small>
        </span>
      </a>
      <button
        className="refresh-button"
        type="button"
        onClick={() => {
          setNow(new Date());
          setShowAll(false);
          setRefreshKey((value) => value + 1);
        }}
        disabled={isLoading}
      >
        <span aria-hidden="true">↻</span>
        {isLoading ? 'Updating…' : 'Refresh'}
      </button>
    </header>

    {loadMessage && <div className="notice" role="status">{loadMessage}</div>}

    <section className={'status-card status-' + status.tone} id="top" aria-live="polite">
      <div className="status-copy">
        <p className="eyebrow">{status.eyebrow}</p>
        <h1>{isLoading && events.length === 0 ? 'Checking Annie’s schedule…' : status.headline}</h1>
        <p className="status-detail">
          {isLoading && events.length === 0 ? 'One moment while the latest schedule loads.' : status.detail}
        </p>
        <p className="today-date">{formatLongDate(today)}</p>
      </div>

      <div className="status-orbit" aria-hidden="true">
        <span className="orbit-ring" />
        <span className="orbit-dot" />
        <span className="status-monogram">A</span>
      </div>
    </section>

    <section className="answer-strip" aria-label="Next scheduled item">
      <div>
        <p className="eyebrow">Next up</p>
        {isLoading && events.length === 0
          ? <h2>Finding Annie’s next shift…</h2>
          : nextEventDescription
            ? <h2>{nextEventDescription.when}: {nextEventDescription.title}</h2>
            : <h2>No more scheduled items in this window</h2>}
      </div>
      {nextEventDescription && <p className="next-time">{nextEventDescription.time}</p>}
    </section>

    <section className="schedule-section" aria-labelledby="upcoming-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coming up</p>
          <h2 id="upcoming-heading">Annie’s schedule</h2>
        </div>
        <p className="range-note">{formatCompactDate(today)} – {formatCompactDate(scheduleEnd)}</p>
      </div>

      {isLoading && events.length === 0
        ? <div className="schedule-empty"><span className="loading-pulse" /><p>Loading the latest schedule…</p></div>
        : groupedEvents.length === 0
          ? <div className="schedule-empty"><span aria-hidden="true">☀</span><h3>Nothing scheduled</h3><p>Annie has no upcoming items in the next four months.</p></div>
          : <div className="timeline">{groupedEvents.map((group) => <article className="day-group" key={group.date}>
            <div className="date-block">
              <span>{formatDayHeading(group.date, today)}</span>
              <strong>{formatCompactDate(group.date)}</strong>
            </div>
            <div className="day-items">{group.events.map((event) => {
              const completed = isCompletedToday(event, today, currentMinutes);
              const isHappening = isEventOnDate(event, today) && !completed && (
                event.allDay || (
                  (getTimeMinutes(event.startTime) ?? Number.POSITIVE_INFINITY) <= currentMinutes &&
                  currentMinutes < (getTimeMinutes(event.endTime) ?? Number.NEGATIVE_INFINITY)
                )
              );
              const spansDays = event.endDate && event.endDate !== event.date;

              return <div className={'schedule-item category-' + event.category + (completed ? ' item-complete' : '')} key={event.id + '-' + event.date}>
                <div className="item-time">
                  <strong>{getEventTime(event)}</strong>
                  {spansDays && <span>Through {formatCompactDate(event.endDate as string)}</span>}
                </div>
                <div className="item-copy">
                  <div className="item-title-row">
                    <h3>{getDisplayTitle(event)}</h3>
                    {isHappening && <span className="now-badge">Now</span>}
                  </div>
                  <p>{getEventKind(event)}{event.location ? ' · ' + event.location : ''}</p>
                  {event.notes && <p className="item-notes">{event.notes}</p>}
                </div>
              </div>;
            })}</div>
          </article>)}</div>}

      {activeEvents.length > INITIAL_EVENT_LIMIT && <button className="show-more" type="button" onClick={() => setShowAll((value) => !value)}>
        {showAll ? 'Show the next few' : 'Show all ' + activeEvents.length + ' upcoming items'}
      </button>}
    </section>

    <footer className="app-footer">
      <span className="live-dot" aria-hidden="true" />
      {lastUpdated
        ? 'Schedule updated ' + lastUpdated.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : 'Connected to Annie’s live schedule'}
    </footer>
  </main>;
}

export default App;
