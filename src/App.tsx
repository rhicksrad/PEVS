import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  WEEKDAY_LABELS,
  formatIsoDate,
  formatMonthYear,
  getCalendarGridDays,
  isSameDay,
  isSameMonth
} from './lib/date';
import { fetchEvents, fetchSubcalendarLabels, type TeamupEvent } from './lib/teamupApi';
import { validateScheduleEvents } from './lib/scheduleValidation';
import { resolveInferredOwner } from './lib/ownerResolution';

type ScheduleCategory = 'shift' | 'teaching' | 'admin' | 'milestone';
type TeamMember = 'Aimee Brooks' | 'Ana Aghili' | 'Liz Thomovsky' | 'Paula Johnson';
type AppView = 'calendar' | 'insights';

type ScheduleEvent = {
  id: string;
  externalId?: string;
  source?: 'teamup';
  date: string;
  title: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  category: ScheduleCategory;
  context: string;
  person?: TeamMember;
  notes?: string;
  calendarLabel?: string;
  calendarColor?: string;
};

type PersistedSchedulePayload = {
  version: number;
  events: ScheduleEvent[];
  source: 'teamup';
};

type NamedValue = { label: string; value: number; color?: string };
type CalendarKind = 'person' | 'context' | 'other';
type CalendarMeta = {
  label: string;
  color: string;
  kind: CalendarKind;
  person?: TeamMember;
  context?: string;
};

const STORAGE_KEY = 'pevs-schedule-events-v5';
const CURRENT_SCHEMA_VERSION = 6;
const TODAY = new Date();
const DEFAULT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
const TEAM: TeamMember[] = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];
const PERSON_MARKER_PATTERN = /\(([^)]+)\)/;
const ALPHA_NUMERIC_PATTERN = /[^a-z0-9]+/g;
const EVENT_CONTEXTS = ['General ECC Service', 'ECC Teaching', 'General Events'] as const;
const PERSON_COLORS: Record<TeamMember, string> = {
  'Aimee Brooks': '#2563eb',
  'Ana Aghili': '#f97316',
  'Liz Thomovsky': '#dc2626',
  'Paula Johnson': '#38bdf8'
};

const CATEGORY_COLORS: Record<ScheduleCategory, string> = {
  shift: '#a78bfa',
  teaching: '#22c55e',
  admin: '#facc15',
  milestone: '#f43f5e'
};

const DEFAULT_CALENDAR_COLOR = '#475569';
const LEGEND_CALENDARS: CalendarMeta[] = [
  { label: 'Aimee Brooks', color: '#5b2c91', kind: 'person', person: 'Aimee Brooks' },
  { label: 'Ana Aghili', color: '#f47a20', kind: 'person', person: 'Ana Aghili' },
  { label: 'ECC Resident Chief', color: '#a63a8d', kind: 'other' },
  { label: 'ECC Teaching', color: '#eab308', kind: 'context', context: 'ECC Teaching' },
  { label: 'General ECC Service', color: '#2e8b2f', kind: 'context', context: 'General ECC Service' },
  { label: 'General Events', color: '#49b3a2', kind: 'context', context: 'General Events' },
  { label: 'Liz Thomovsky', color: '#b91c1c', kind: 'person', person: 'Liz Thomovsky' },
  { label: 'Paula Johnson', color: '#2d56b3', kind: 'person', person: 'Paula Johnson' }
];

const FILTER_COLORS: Record<string, string> = LEGEND_CALENDARS.reduce((map, item) => {
  map[item.label] = item.color;
  return map;
}, {} as Record<string, string>);

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

const withAlpha = (hex: string, alpha: number) => {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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

function getEventColor(event: ScheduleEvent) {
  if (event.calendarColor) return event.calendarColor;
  if (event.person) return PERSON_COLORS[event.person];
  return CATEGORY_COLORS[event.category];
}

function getEventBackground(event: ScheduleEvent) {
  const baseColor = getEventColor(event);
  if (event.context === 'ECC Teaching' && event.person) {
    const personColor = PERSON_COLORS[event.person];
    return `repeating-linear-gradient(135deg, ${withAlpha(baseColor, 0.9)} 0 8px, ${withAlpha(personColor, 0.9)} 8px 16px)`;
  }

  return baseColor;
}

function getEventTextColor(event: ScheduleEvent) {
  return getHexTextColor(getEventColor(event));
}

function getHexTextColor(colorHex: string) {
  const color = colorHex.replace('#', '');
  const r = Number.parseInt(color.slice(0, 2), 16);
  const g = Number.parseInt(color.slice(2, 4), 16);
  const b = Number.parseInt(color.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#f8fafc';
}

function getApiEventColor(event: TeamupEvent, subcalendarLabelMap: Record<number, string>) {
  const eventRecord = event as Record<string, unknown>;
  const nestedSubcalendar = eventRecord.subcalendar as Record<string, unknown> | undefined;
  const explicitColor =
    normalizeHexColor(nestedSubcalendar?.color) ??
    normalizeHexColor(eventRecord.subcalendar_color) ??
    normalizeHexColor(eventRecord.calendar_color);
  if (explicitColor) return explicitColor;

  const subcalendarName =
    (typeof event.subcalendar_name === 'string' && event.subcalendar_name.trim()) ||
    (typeof event.calendar_name === 'string' && event.calendar_name.trim()) ||
    (typeof nestedSubcalendar?.name === 'string' && nestedSubcalendar.name.trim()) ||
    (typeof nestedSubcalendar?.title === 'string' && nestedSubcalendar.title.trim()) ||
    (event.subcalendar_id ? subcalendarLabelMap[event.subcalendar_id] : undefined);

  return subcalendarName ? toCalendarMeta(subcalendarName).color : DEFAULT_CALENDAR_COLOR;
}

function hoursBetween(start?: string, end?: string) {
  if (!start || !end) return 0;
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const total = endH * 60 + endM - (startH * 60 + startM);
  return total > 0 ? total / 60 : 0;
}

function getEventHours(event: ScheduleEvent) {
  if (event.startTime && event.endTime) {
    return hoursBetween(event.startTime, event.endTime);
  }

  if (event.category === 'shift') {
    return 8;
  }

  return event.startTime ? 1 : 0;
}

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
      title: event.title?.trim() || 'Untitled event',
      startTime: event.all_day ? undefined : toLocalTime(event.start_dt),
      endTime: event.all_day ? undefined : toLocalTime(event.end_dt),
      allDay: event.all_day,
      notes: event.notes,
      category: 'admin',
      context,
      person: inferredOwner,
      calendarLabel: meta.label,
      calendarColor: meta.color
    });
  });

  return normalizeLoadedEvents(mapped);
}

function getDateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const finish = new Date(`${end}T00:00:00`);
  while (cursor <= finish) {
    dates.push(formatIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

function BarChart({ data }: { data: NamedValue[] }) {
  if (data.length === 0) return <p className="chart-empty">No data for the selected range.</p>;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return <div className="chart-list">{data.map((item) => {
    const ratio = (item.value / maxValue) * 100;
    return <div key={item.label} className="chart-row"><span className="chart-row-label">{item.label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${ratio}%`, background: item.color ?? '#60a5fa' }} /></div><strong>{item.value.toFixed(1)}</strong></div>;
  })}</div>;
}

function LineChart({ data }: { data: NamedValue[] }) {
  if (data.length === 0) return <p className="chart-empty">No data for the selected range.</p>;
  const width = 440;
  const height = 140;
  const padding = 14;
  const max = Math.max(...data.map((item) => item.value), 1);
  const points = data.map((item, index) => {
    const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (item.value / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return <><svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="hours over time line chart"><defs><linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#a78bfa" /></linearGradient></defs><polyline points={points} fill="none" stroke="url(#lineGlow)" strokeWidth="3.5" strokeLinecap="round" /><polyline points={`${points} ${width - padding},${height - padding} ${padding},${height - padding}`} fill="url(#lineGlow)" opacity="0.15" /></svg><div className="chart-inline-labels"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div></>;
}

function App() {
  const printableRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [apiEvents, setApiEvents] = useState<TeamupEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [subcalendarLabels, setSubcalendarLabels] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string>('');
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);
  const [selectedContexts, setSelectedContexts] = useState<string[]>([...EVENT_CONTEXTS]);
  const [hasCustomizedContextFilter, setHasCustomizedContextFilter] = useState(false);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [view, setView] = useState<AppView>('calendar');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const monthGridDays = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);

  useEffect(() => {
    setSelectedDate((current) => (isSameMonth(current, viewMonth)
      ? current
      : new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)));
  }, [viewMonth]);
  const insightDefaultStart = formatIsoDate(monthGridDays[0]);
  const insightDefaultEnd = formatIsoDate(monthGridDays[monthGridDays.length - 1]);
  const [insightRangeStart, setInsightRangeStart] = useState(insightDefaultStart);
  const [insightRangeEnd, setInsightRangeEnd] = useState(insightDefaultEnd);
  const [appliedInsightRangeStart, setAppliedInsightRangeStart] = useState(insightDefaultStart);
  const [appliedInsightRangeEnd, setAppliedInsightRangeEnd] = useState(insightDefaultEnd);
  const [safeInsightRangeStart, safeInsightRangeEnd] = useMemo(() => {
    if (!insightRangeStart) return [insightDefaultStart, insightDefaultEnd] as const;
    if (!insightRangeEnd) return [insightRangeStart, insightRangeStart] as const;
    return insightRangeStart <= insightRangeEnd
      ? [insightRangeStart, insightRangeEnd] as const
      : [insightRangeEnd, insightRangeStart] as const;
  }, [insightDefaultEnd, insightDefaultStart, insightRangeEnd, insightRangeStart]);
  const [safeAppliedInsightRangeStart, safeAppliedInsightRangeEnd] = useMemo(() => {
    if (!appliedInsightRangeStart) return [insightDefaultStart, insightDefaultEnd] as const;
    if (!appliedInsightRangeEnd) return [appliedInsightRangeStart, appliedInsightRangeStart] as const;
    return appliedInsightRangeStart <= appliedInsightRangeEnd
      ? [appliedInsightRangeStart, appliedInsightRangeEnd] as const
      : [appliedInsightRangeEnd, appliedInsightRangeStart] as const;
  }, [appliedInsightRangeEnd, appliedInsightRangeStart, insightDefaultEnd, insightDefaultStart]);

  useEffect(() => {
    let isCancelled = false;
    const monthStart = formatIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
    const monthEnd = formatIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));
    const rangeStart = view === 'insights' ? safeAppliedInsightRangeStart : monthStart;
    const rangeEnd = view === 'insights' ? safeAppliedInsightRangeEnd : monthEnd;

    const loadEvents = async () => {
      setIsLoadingEvents(true);
      try {
        const [fetchedEvents, fetchedSubcalendarLabels] = await Promise.all([
          fetchEvents(rangeStart, rangeEnd),
          fetchSubcalendarLabels()
        ]);
        const normalized = convertTeamupEvents(fetchedEvents, fetchedSubcalendarLabels);
        const validation = validateScheduleEvents(normalized);
        if (isCancelled) return;
        setValidationIssues(validation.issues);
        setLoadError('');
        setApiEvents(fetchedEvents);
        setSubcalendarLabels(fetchedSubcalendarLabels);
        setEvents(normalized);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: CURRENT_SCHEMA_VERSION, events: normalized, source: 'teamup' } satisfies PersistedSchedulePayload)
        );
      } catch (error) {
        if (isCancelled) return;
        setValidationIssues([]);
        setApiEvents([]);
        setEvents([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load Teamup data.');
      } finally {
        if (!isCancelled) setIsLoadingEvents(false);
      }
    };

    loadEvents();

    return () => {
      isCancelled = true;
    };
  }, [view, viewMonth, safeAppliedInsightRangeStart, safeAppliedInsightRangeEnd]);

  const calendarLegend = useMemo(() => LEGEND_CALENDARS, []);
  const filterableCalendarLabels = useMemo(() => new Set(calendarLegend.map((item) => item.label)), [calendarLegend]);

  const availableContexts = useMemo(() => {
    const knownContexts = new Set<string>(EVENT_CONTEXTS);
    return [
      ...EVENT_CONTEXTS,
      ...Array.from(new Set(events.map((event) => event.context).filter((context) => !knownContexts.has(context)))).sort((a, b) => a.localeCompare(b))
    ];
  }, [events]);

  useEffect(() => {
    setSelectedContexts((current) => syncSelectedContexts(availableContexts, current, hasCustomizedContextFilter));
  }, [availableContexts, hasCustomizedContextFilter]);

  useEffect(() => {
    if (calendarLegend.length === 0) {
      setSelectedCalendars([]);
      return;
    }

    setSelectedCalendars((current) => {
      const available = new Set(calendarLegend.map((item) => item.label));
      const retained = current.filter((item) => available.has(item));
      if (retained.length > 0) return retained;
      return calendarLegend.map((item) => item.label);
    });
  }, [calendarLegend]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const calendarLabel = event.calendarLabel ?? event.context;
    if (calendarLabel && filterableCalendarLabels.has(calendarLabel) && selectedCalendars.length > 0 && !selectedCalendars.includes(calendarLabel)) return false;
    if (event.person && !selectedPeople.includes(event.person)) return false;
    return selectedContexts.includes(event.context);
  }), [events, filterableCalendarLabels, selectedCalendars, selectedPeople, selectedContexts]);

  const dayMap = useMemo(() => filteredEvents.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
    acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
    return acc;
  }, {}), [filteredEvents]);

  const selectedDateApiEvents = useMemo(() => {
    const selectedIsoDate = formatIsoDate(selectedDate);
    return [...apiEvents]
      .filter((event) => toLocalDateKey(event.start_dt) === selectedIsoDate)
      .sort((a, b) => (toLocalTime(a.start_dt) ?? '99:99').localeCompare(toLocalTime(b.start_dt) ?? '99:99'));
  }, [apiEvents, selectedDate]);
  const days = monthGridDays;

  const monthIsoPrefix = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthFilteredEvents = useMemo(
    () => filteredEvents.filter((event) => event.date.startsWith(monthIsoPrefix)),
    [filteredEvents, monthIsoPrefix]
  );
  const totalVisibleHours = useMemo(
    () => monthFilteredEvents.reduce((sum, event) => sum + getEventHours(event), 0),
    [monthFilteredEvents]
  );
  const busiestDay = useMemo(() => {
    const totals = monthFilteredEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.date] = (acc[event.date] ?? 0) + getEventHours(event);
      return acc;
    }, {});
    const [date, hours] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] ?? [];
    return date && typeof hours === 'number' ? { date, hours } : undefined;
  }, [monthFilteredEvents]);

  const insightEvents = useMemo(
    () => filteredEvents.filter((event) => event.date >= safeAppliedInsightRangeStart && event.date <= safeAppliedInsightRangeEnd),
    [filteredEvents, safeAppliedInsightRangeStart, safeAppliedInsightRangeEnd]
  );
  const insightDays = useMemo(
    () => getDateRange(safeAppliedInsightRangeStart, safeAppliedInsightRangeEnd),
    [safeAppliedInsightRangeStart, safeAppliedInsightRangeEnd]
  );

  const hasPendingInsightRange =
    safeInsightRangeStart !== safeAppliedInsightRangeStart || safeInsightRangeEnd !== safeAppliedInsightRangeEnd;

  const insights = useMemo(() => {
    const weeksInRange = Math.max(1, new Set(insightDays.map(getWeekStartIso)).size);
    const reportingEvents = expandEventsForReporting(insightEvents);
    const hoursByPerson = TEAM.map((person) => ({ label: person, value: reportingEvents.filter((event) => event.person === person).reduce((sum, event) => sum + getEventHours(event), 0), color: PERSON_COLORS[person] }));
    const averageHoursPerWeekByPerson = hoursByPerson.map((personHours) => ({ ...personHours, value: Number((personHours.value / weeksInRange).toFixed(2)) }));
    const hoursByDayMap = insightEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.date] = (acc[event.date] ?? 0) + getEventHours(event);
      return acc;
    }, {});
    const hoursByDay = insightDays.map((day) => ({ label: day.slice(5), value: hoursByDayMap[day] ?? 0 }));
    const weekdayHours = WEEKDAY_LABELS.map((dayName, index) => ({ label: dayName, value: insightEvents.filter((event) => new Date(`${event.date}T00:00:00`).getDay() === (index + 1) % 7).reduce((sum, event) => sum + getEventHours(event), 0) }));
    const monthMap = new Map<string, number>();
    insightEvents.forEach((event) => monthMap.set(event.date.slice(0, 7), (monthMap.get(event.date.slice(0, 7)) ?? 0) + getEventHours(event)));
    const monthRanking = (Array.from(monthMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8));
    if (monthRanking.length === 0) {
      monthRanking.push({ label: safeAppliedInsightRangeStart.slice(0, 7), value: 0 });
    }
    const lateToEarlyShiftCounts = getLateToEarlyShiftCounts(insightEvents);
    const workDayStreaks = TEAM.map((person) => {
      let maxStreak = 0; let current = 0;
      insightDays.forEach((day) => { const hasWork = reportingEvents.some((event) => event.person === person && event.date === day); current = hasWork ? current + 1 : 0; maxStreak = Math.max(maxStreak, current); });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });
    const dayOffStreaks = TEAM.map((person) => {
      let maxStreak = 0; let current = 0;
      insightDays.forEach((day) => { const hasWork = reportingEvents.some((event) => event.person === person && event.date === day); current = hasWork ? 0 : current + 1; maxStreak = Math.max(maxStreak, current); });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });
    const startHourBuckets = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: insightEvents.filter((event) => event.startTime?.startsWith(String(hour).padStart(2, '0'))).length }));
    const overtimeCounts = TEAM.map((person) => {
      const personalDailyMap = new Map<string, number>();
      reportingEvents.filter((event) => event.person === person).forEach((event) => personalDailyMap.set(event.date, (personalDailyMap.get(event.date) ?? 0) + getEventHours(event)));
      const count = Array.from(personalDailyMap.values()).filter((hours) => hours > 8).length;
      return { label: person, value: count, color: PERSON_COLORS[person] };
    });
    const weekdayWeekend = [
      { label: 'Weekday', value: insightEvents.filter((event) => { const day = new Date(`${event.date}T00:00:00`).getDay(); return day > 0 && day < 6; }).reduce((sum, event) => sum + getEventHours(event), 0), color: '#60a5fa' },
      { label: 'Weekend', value: insightEvents.filter((event) => { const day = new Date(`${event.date}T00:00:00`).getDay(); return day === 0 || day === 6; }).reduce((sum, event) => sum + getEventHours(event), 0), color: '#f97316' }
    ];
    return { hoursByPerson, averageHoursPerWeekByPerson, hoursByDay, weekdayHours, monthRanking, lateToEarlyShiftCounts, workDayStreaks, dayOffStreaks, startHourBuckets, overtimeCounts, weekdayWeekend };
  }, [insightEvents, insightDays]);

  const insightTotalHours = useMemo(
    () => insightEvents.reduce((sum, event) => sum + getEventHours(event), 0),
    [insightEvents]
  );
  const insightBusiestDay = useMemo(() => {
    const totals = insightEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.date] = (acc[event.date] ?? 0) + getEventHours(event);
      return acc;
    }, {});
    const [date, hours] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] ?? [];
    return date && typeof hours === 'number' ? { date, hours } : undefined;
  }, [insightEvents]);

  const visibleEventCount = view === 'insights' ? insightEvents.length : monthFilteredEvents.length;
  const visibleHours = view === 'insights' ? insightTotalHours : totalVisibleHours;
  const visibleBusiestDay = view === 'insights' ? insightBusiestDay : busiestDay;

  const togglePerson = (person: TeamMember) => setSelectedPeople((current) => (current.includes(person) ? current.filter((item) => item !== person) : [...current, person]));
  const toggleCalendar = (label: string) => setSelectedCalendars((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));
  const toggleContext = (context: string) => {
    setHasCustomizedContextFilter(true);
    setSelectedContexts((current) => (current.includes(context) ? current.filter((item) => item !== context) : [...current, context]));
  };
  const jumpToToday = () => {
    const today = new Date();
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };
  const resetFilters = () => {
    setSelectedPeople([...TEAM]);
    setHasCustomizedContextFilter(false);
    setSelectedContexts([...availableContexts]);
    setSelectedCalendars(calendarLegend.map((item) => item.label));
  };

  const downloadDisplayedScreen = async () => {
    if (!printableRef.current || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const canvas = await html2canvas(printableRef.current, { scale: window.devicePixelRatio > 1 ? 2 : 1, backgroundColor: '#111827', useCORS: true, scrollX: 0, scrollY: -window.scrollY });
      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(image, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`pevs-schedule-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`);
    } finally { setIsExportingPdf(false); }
  };

  return <main className="app-shell" ref={printableRef}>
    <section className="top-bar">
      <header className="calendar-header">
        <div className="header-title-wrap"><h1>{view === 'calendar' ? formatMonthYear(viewMonth) : 'Schedule Insights'}</h1>{view === 'calendar' && <div className="month-nav-actions"><button type="button" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>Prev</button><button type="button" onClick={jumpToToday}>Today</button><button type="button" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>Next</button></div>}</div>
        <div className="calendar-actions">
          <button type="button" className={view === 'calendar' ? 'tab-active' : ''} onClick={() => setView('calendar')}>Calendar</button>
          <button type="button" className={view === 'insights' ? 'tab-active' : ''} onClick={() => setView('insights')}>Insights</button>
          <div className="filters-menu">
            <button type="button" className={isFiltersOpen ? 'tab-active' : ''} onClick={() => setIsFiltersOpen((current) => !current)}>Filters</button>
            {isFiltersOpen && <><button type="button" className="filters-backdrop" aria-label="Close filters" onClick={() => setIsFiltersOpen(false)} /><div className="filters-overlay" role="dialog" aria-label="Filters">
              <div className="filters-overlay-header">
                <strong>Filters</strong>
                <button type="button" onClick={resetFilters}>Reset filters</button>
              </div>

              {calendarLegend.length > 0 && <fieldset className="filters-group"><legend>Calendars</legend><div className="filters-options">{calendarLegend.map((calendar) => {
                const active = selectedCalendars.includes(calendar.label);
                return <label key={calendar.label} className="filter-checkbox"><input type="checkbox" checked={active} onChange={() => toggleCalendar(calendar.label)} /><span className="filter-swatch" style={{ background: calendar.color }} />{calendar.label}</label>;
              })}</div></fieldset>}

              <fieldset className="filters-group"><legend>Team</legend><div className="filters-options">{TEAM.map((person) => {
                const active = selectedPeople.includes(person);
                const color = FILTER_COLORS[person] ?? PERSON_COLORS[person];
                return <label key={person} className="filter-checkbox"><input type="checkbox" checked={active} onChange={() => togglePerson(person)} /><span className="filter-swatch" style={{ background: color }} />{person}</label>;
              })}</div></fieldset>

              <fieldset className="filters-group"><legend>Shifts</legend><div className="filters-options">{availableContexts.map((context) => {
                const active = selectedContexts.includes(context);
                const color = FILTER_COLORS[context] ?? '#64748b';
                return <label key={context} className="filter-checkbox"><input type="checkbox" checked={active} onChange={() => toggleContext(context)} /><span className="filter-swatch" style={{ background: color }} />{context}</label>;
              })}</div></fieldset>
            </div></>}
          </div>
          <button type="button" onClick={downloadDisplayedScreen} disabled={isExportingPdf}>{isExportingPdf ? 'Building PDF…' : 'Download PDF'}</button>
        </div>
      </header>

      <section className="toolbar compact-toolbar">
        {validationIssues.length > 0 && <div className="warning-banner" role="status"><strong>Schedule warnings:</strong> {validationIssues.length} issue(s) detected. Resolve owner mapping for Teamup events when applicable.{validationIssues.length > 0 && <ul>{validationIssues.slice(0, 3).map((issue) => <li key={issue}>{issue}</li>)}{validationIssues.length > 3 && <li>+{validationIssues.length - 3} more issue(s) in console.</li>}</ul>}</div>}
        {loadError && <div className="warning-banner" role="status"><strong>Unable to load events:</strong> {loadError}</div>}

      </section>
    </section>

    {view === 'calendar' ? <>
      <section className="calendar-layout">
        <section className="calendar-main">
          <div className="weekday-row" role="presentation">{WEEKDAY_LABELS.map((weekday) => <div key={weekday} className="weekday-cell">{weekday}</div>)}</div>
          <section className="calendar-grid">{days.map((day) => {
          const iso = formatIsoDate(day);
          const isSelected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, viewMonth);
          const dayEvents = dayMap[iso] ?? [];
          return <button key={iso} type="button" className={['day-cell', isSelected ? 'day-selected' : '', inMonth ? '' : 'day-outside-month'].join(' ').trim()} onClick={() => setSelectedDate(day)}>
            <span className="day-number">{day.getDate()}</span>
            {dayEvents.length > 0 && <div className="day-event-stack">{dayEvents.slice(0, 5).map((item) => <span key={`${item.id}-${item.date}-${item.startTime ?? 'all-day'}`} className="day-event-pill" style={{ background: getEventBackground(item), color: getEventTextColor(item), textShadow: '0 1px 1px rgba(2, 6, 23, 0.55), 0 0 0.5px rgba(2, 6, 23, 0.95)' }}>{item.allDay ? item.title : `${formatDisplayTime(item.startTime).replace(' AM', 'a').replace(' PM', 'p')} ${item.title}`}</span>)}{dayEvents.length > 5 && <span className="day-event-more">+{dayEvents.length - 5} more</span>}</div>}
          </button>;
        })}</section>
        </section>
        <div className="calendar-sidebar">
          <aside className="day-sidebar">
            <h2>{formatIsoDate(selectedDate)}</h2>
            {selectedDateApiEvents.length === 0 ? <p className="chart-empty">No events from API for this day.</p> : <div className="day-events">{selectedDateApiEvents.map((item) => {
            const apiStartTime = toLocalTime(item.start_dt);
            const apiEndTime = toLocalTime(item.end_dt);
            const apiEventTime = item.all_day ? 'All day' : `${formatDisplayTime(apiStartTime)} - ${formatDisplayTime(apiEndTime)}`;
            const durationHours = item.all_day ? undefined : hoursBetween(apiStartTime, apiEndTime);
            const trimmedSubcalendarName = typeof item.subcalendar_name === 'string' ? item.subcalendar_name.trim() : '';
            const mappedSubcalendarLabel = item.subcalendar_id ? subcalendarLabels[item.subcalendar_id] : undefined;
            const resolvedSubcalendarLabel = trimmedSubcalendarName || mappedSubcalendarLabel || (item.subcalendar_id ? `subcalendar ${item.subcalendar_id}` : '');
            const subcalendarText = resolvedSubcalendarLabel ? ` • ${resolvedSubcalendarLabel}` : '';
            const locationText = typeof item.location === 'string' && item.location.trim() ? item.location.trim() : undefined;
            const recurrenceText = typeof item.rrule === 'string' && item.rrule.trim() ? item.rrule.trim() : undefined;
            const timezoneText = typeof item.tz === 'string' && item.tz.trim() ? item.tz.trim() : undefined;
            const notesText = typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : undefined;
            const eventColor = getApiEventColor(item, subcalendarLabels);
            const eventTextColor = getHexTextColor(eventColor);
            return <div key={`${item.id}-${item.start_dt}-sidebar`} className="event-chip" style={{ borderLeftColor: eventColor, background: withAlpha(eventColor, 0.22), color: eventTextColor }}><strong>{apiEventTime}</strong> {item.title}<br /><small>ID {item.id}{subcalendarText}</small>{durationHours !== undefined && <><br /><small>Duration {durationHours.toFixed(2)}h</small></>}{locationText && <><br /><small>Location {locationText}</small></>}{timezoneText && <><br /><small>TZ {timezoneText}</small></>}{recurrenceText && <><br /><small>Rule {recurrenceText}</small></>}{notesText && <><br /><small>Notes {notesText}</small></>}</div>;
            })}</div>}
          </aside>

          {calendarLegend.length > 0 && <aside className="calendar-legend" aria-label="Calendar legend">
            <h3>Legend</h3>
            <div className="calendar-legend-list">{calendarLegend.map((calendar) => <div key={`${calendar.label}-legend`} className="calendar-legend-item"><span className="filter-swatch" style={{ background: calendar.color }} />{calendar.label}</div>)}</div>
          </aside>}
        </div>
      </section>
    </> : <section className="insights-shell">
      <div className="insights-hero">
        <div>
          <p className="insights-kicker">Pulse Dashboard</p>
          <h2>Team performance insights</h2>
          <p className="insights-subtitle">Track workload balance, streaks, and peak-demand patterns with live Teamup data.</p>
          <p className="insights-subtitle">Showing {safeAppliedInsightRangeStart} to {safeAppliedInsightRangeEnd}{hasPendingInsightRange ? ` (pending ${safeInsightRangeStart} to ${safeInsightRangeEnd})` : ''}.</p>
        </div>
        <div className="insight-range">
          <label>Start<input type="date" value={insightRangeStart} onChange={(event) => setInsightRangeStart(event.target.value)} max={insightRangeEnd} /></label>
          <label>End<input type="date" value={insightRangeEnd} onChange={(event) => setInsightRangeEnd(event.target.value)} min={insightRangeStart} /></label>
          <button type="button" onClick={() => {
            setAppliedInsightRangeStart(safeInsightRangeStart);
            setAppliedInsightRangeEnd(safeInsightRangeEnd);
          }} disabled={!hasPendingInsightRange || isLoadingEvents}>
            {isLoadingEvents ? 'Loading…' : hasPendingInsightRange ? 'Load insights' : 'Loaded'}
          </button>
        </div>
      </div>
      <section className="stats-strip" aria-label="Quick summary">
        <article className="stat-card"><span>Total visible events</span><strong>{visibleEventCount}</strong></article>
        <article className="stat-card"><span>Scheduled hours</span><strong>{visibleHours.toFixed(1)}h</strong></article>
        <article className="stat-card"><span>Team members selected</span><strong>{selectedPeople.length}/{TEAM.length}</strong></article>
        <article className="stat-card"><span>Busiest day</span><strong>{visibleBusiestDay ? `${visibleBusiestDay.date} • ${visibleBusiestDay.hours.toFixed(1)}h` : 'No events'}</strong></article>
      </section>
      <div className="insight-grid">
        <article className="insight-card insight-card-feature"><h3>Hours Over Time</h3><LineChart data={insights.hoursByDay} /></article>
        <article className="insight-card"><h3>Average Hours per Week by Doctor</h3><BarChart data={insights.averageHoursPerWeekByPerson} /></article>
        <article className="insight-card"><h3>Weekday vs Weekend Hours</h3><BarChart data={insights.weekdayWeekend} /></article>
        <article className="insight-card"><h3>Most Hours per Month Ranking</h3><BarChart data={insights.monthRanking} /></article>
        <article className="insight-card"><h3>Consecutive Workday Max</h3><BarChart data={insights.workDayStreaks} /></article>
        <article className="insight-card"><h3>Consecutive Days Off Max</h3><BarChart data={insights.dayOffStreaks} /></article>
        <article className="insight-card"><h3>Start Time Distribution</h3><BarChart data={insights.startHourBuckets} /></article>
        <article className="insight-card"><h3>Hours by Day of Week</h3><BarChart data={insights.weekdayHours} /></article>
        <article className="insight-card"><h3>Overtime Days (&gt;8h)</h3><BarChart data={insights.overtimeCounts} /></article>
        <article className="insight-card"><h3>Late → Early Turnarounds</h3><BarChart data={insights.lateToEarlyShiftCounts} /></article>
      </div>
    </section>}
    <footer className="app-footer">{isLoadingEvents ? 'Loading Teamup events…' : 'Live Teamup data via worker proxy'}</footer>
  </main>;
}

export default App;
