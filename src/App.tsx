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
import { fetchEvents, type TeamupEvent } from './lib/teamupApi';
import { validateScheduleEvents } from './lib/scheduleValidation';

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
const DEFAULT_MONTH = new Date(2026, 1, 1);
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
  'Aimee Brooks': ['aimee brooks', 'aimee', 'brooks', 'abrooks', 'brooks, aimee', 'a brooks'],
  'Ana Aghili': ['ana aghili', 'ana', 'aghili', 'aaghili', 'aghili, ana', 'a aghili'],
  'Liz Thomovsky': ['liz thomovsky', 'liz', 'thomovsky', 'lthomovsky', 'thomovsky, liz', 'l thomovsky'],
  'Paula Johnson': ['paula johnson', 'paula', 'johnson', 'pjohnson', 'johnson, paula', 'p johnson']
};

const PERSON_ALIAS_MAP = Object.entries(PERSON_ALIASES).reduce<Record<string, TeamMember>>((map, [member, aliases]) => {
  aliases.forEach((alias) => {
    map[normalizeToken(alias)] = member as TeamMember;
  });
  return map;
}, {});

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
    color: eventColor ?? known.color,
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
  if (event.person) return PERSON_COLORS[event.person];
  if (event.calendarColor) return event.calendarColor;
  return CATEGORY_COLORS[event.category];
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

function toLocalDateKey(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTime(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function convertTeamupEvents(teamupEvents: TeamupEvent[]): ScheduleEvent[] {
  const mapped: ScheduleEvent[] = [];
  const shouldDebugUnmatchedOwners = false && import.meta.env.DEV;

  teamupEvents.forEach((event) => {
    const date = event.all_day ? event.start_dt.slice(0, 10) : toLocalDateKey(event.start_dt);
    if (!date) return;

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
    const meta = toCalendarMeta(normalizedRawLabel || 'General Events', rawColor);
    const ownerCandidates = extractOwnerCandidates(eventRecord);
    const inferredOwner =
      meta.person ??
      ownerCandidates[0] ??
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
    const context = meta.context ?? (normalizedRawLabel || 'General Events');

    if (shouldDebugUnmatchedOwners && !inferredOwner) {
      console.debug('Teamup event owner unmatched', {
        id: event.id,
        title: event.title,
        keys: Object.keys(eventRecord),
        ownerCandidates
      });
    }

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

function BarChart({ data }: { data: NamedValue[] }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return <div className="chart-list">{data.map((item) => <div key={item.label} className="chart-row"><span>{item.label}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(item.value / maxValue) * 100}%`, background: item.color ?? '#60a5fa' }} /></div><strong>{item.value.toFixed(1)}</strong></div>)}</div>;
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

  return <><svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="hours over time line chart"><polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" /></svg><div className="chart-inline-labels"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div></>;
}

function App() {
  const printableRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);
  const [selectedContexts, setSelectedContexts] = useState<string[]>([...EVENT_CONTEXTS]);
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [view, setView] = useState<AppView>('calendar');

  const monthGridDays = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);
  const insightDefaultStart = formatIsoDate(monthGridDays[0]);
  const insightDefaultEnd = formatIsoDate(monthGridDays[monthGridDays.length - 1]);
  const [insightRangeStart, setInsightRangeStart] = useState(insightDefaultStart);
  const [insightRangeEnd, setInsightRangeEnd] = useState(insightDefaultEnd);

  useEffect(() => {
    setInsightRangeStart(insightDefaultStart);
    setInsightRangeEnd(insightDefaultEnd);
  }, [insightDefaultStart, insightDefaultEnd]);

  useEffect(() => {
    let isCancelled = false;
    const monthStart = formatIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
    const monthEnd = formatIsoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));

    const loadMonthEvents = async () => {
      setIsLoadingEvents(true);
      try {
        const fetchedEvents = await fetchEvents(monthStart, monthEnd);
        const normalized = convertTeamupEvents(fetchedEvents);
        const validation = validateScheduleEvents(normalized);
        if (isCancelled) return;
        setValidationIssues(validation.issues);
        setLoadError('');
        setEvents(normalized);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: CURRENT_SCHEMA_VERSION, events: normalized, source: 'teamup' } satisfies PersistedSchedulePayload)
        );
      } catch (error) {
        if (isCancelled) return;
        setValidationIssues([]);
        setEvents([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load Teamup data.');
      } finally {
        if (!isCancelled) setIsLoadingEvents(false);
      }
    };

    loadMonthEvents();

    return () => {
      isCancelled = true;
    };
  }, [viewMonth]);

  const calendarLegend = useMemo(() => {
    const legendMap = new Map<string, CalendarMeta>();
    events.forEach((event) => {
      const label = event.calendarLabel ?? event.context;
      if (!label) return;
      if (legendMap.has(label)) return;
      legendMap.set(label, toCalendarMeta(label, event.calendarColor));
    });

    return Array.from(legendMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [events]);

  const availableContexts = useMemo(() => {
    const knownContexts = new Set<string>(EVENT_CONTEXTS);
    return [
      ...EVENT_CONTEXTS,
      ...Array.from(new Set(events.map((event) => event.context).filter((context) => !knownContexts.has(context)))).sort((a, b) => a.localeCompare(b))
    ];
  }, [events]);

  useEffect(() => {
    if (availableContexts.length === 0) {
      setSelectedContexts([]);
      return;
    }

    setSelectedContexts((current) => {
      const available = new Set(availableContexts);
      const retained = current.filter((item) => available.has(item));
      if (retained.length > 0) return retained;
      return availableContexts;
    });
  }, [availableContexts]);

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
    if (calendarLabel && selectedCalendars.length > 0 && !selectedCalendars.includes(calendarLabel)) return false;
    if (event.person && !selectedPeople.includes(event.person)) return false;
    return selectedContexts.includes(event.context);
  }), [events, selectedCalendars, selectedPeople, selectedContexts]);

  const dayMap = useMemo(() => filteredEvents.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
    acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
    return acc;
  }, {}), [filteredEvents]);

  const selectedDateEvents = dayMap[formatIsoDate(selectedDate)] ?? [];
  const days = monthGridDays;

  const insightEvents = useMemo(() => filteredEvents.filter((event) => event.date >= insightRangeStart && event.date <= insightRangeEnd), [filteredEvents, insightRangeStart, insightRangeEnd]);
  const insightDays = useMemo(() => getDateRange(insightRangeStart, insightRangeEnd), [insightRangeStart, insightRangeEnd]);

  const insights = useMemo(() => {
    const hoursByPerson = TEAM.map((person) => ({ label: person, value: insightEvents.filter((event) => event.person === person).reduce((sum, event) => sum + getEventHours(event), 0), color: PERSON_COLORS[person] }));
    const hoursByDay = insightDays.map((day) => ({ label: day.slice(5), value: insightEvents.filter((event) => event.date === day).reduce((sum, event) => sum + getEventHours(event), 0) }));
    const weekdayHours = WEEKDAY_LABELS.map((dayName, index) => ({ label: dayName, value: insightEvents.filter((event) => new Date(`${event.date}T00:00:00`).getDay() === (index + 1) % 7).reduce((sum, event) => sum + getEventHours(event), 0) }));
    const monthMap = new Map<string, number>();
    insightEvents.forEach((event) => monthMap.set(event.date.slice(0, 7), (monthMap.get(event.date.slice(0, 7)) ?? 0) + getEventHours(event)));
    const monthRanking = Array.from(monthMap.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    const dayTotals = new Map<string, number>();
    insightEvents.forEach((event) => dayTotals.set(event.date, (dayTotals.get(event.date) ?? 0) + getEventHours(event)));
    const topHeavyDays = Array.from(dayTotals.entries()).map(([label, value]) => ({ label: label.slice(5), value })).sort((a, b) => b.value - a.value).slice(0, 8);
    const workDayStreaks = TEAM.map((person) => {
      let maxStreak = 0; let current = 0;
      insightDays.forEach((day) => { const hasWork = insightEvents.some((event) => event.person === person && event.date === day); current = hasWork ? current + 1 : 0; maxStreak = Math.max(maxStreak, current); });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });
    const dayOffStreaks = TEAM.map((person) => {
      let maxStreak = 0; let current = 0;
      insightDays.forEach((day) => { const hasWork = insightEvents.some((event) => event.person === person && event.date === day); current = hasWork ? 0 : current + 1; maxStreak = Math.max(maxStreak, current); });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });
    const startHourBuckets = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: insightEvents.filter((event) => event.startTime?.startsWith(String(hour).padStart(2, '0'))).length })).filter((bucket) => bucket.value > 0);
    const overtimeCounts = TEAM.map((person) => {
      const personalDailyMap = new Map<string, number>();
      insightEvents.filter((event) => event.person === person).forEach((event) => personalDailyMap.set(event.date, (personalDailyMap.get(event.date) ?? 0) + getEventHours(event)));
      const count = Array.from(personalDailyMap.values()).filter((hours) => hours > 8).length;
      return { label: person, value: count, color: PERSON_COLORS[person] };
    });
    const weekdayWeekend = [
      { label: 'Weekday', value: insightEvents.filter((event) => { const day = new Date(`${event.date}T00:00:00`).getDay(); return day > 0 && day < 6; }).reduce((sum, event) => sum + getEventHours(event), 0), color: '#60a5fa' },
      { label: 'Weekend', value: insightEvents.filter((event) => { const day = new Date(`${event.date}T00:00:00`).getDay(); return day === 0 || day === 6; }).reduce((sum, event) => sum + getEventHours(event), 0), color: '#f97316' }
    ];
    return { hoursByPerson, hoursByDay, weekdayHours, monthRanking, topHeavyDays, workDayStreaks, dayOffStreaks, startHourBuckets, overtimeCounts, weekdayWeekend };
  }, [insightEvents, insightDays]);

  const togglePerson = (person: TeamMember) => setSelectedPeople((current) => (current.includes(person) ? current.filter((item) => item !== person) : [...current, person]));
  const toggleContext = (context: string) => setSelectedContexts((current) => (current.includes(context) ? current.filter((item) => item !== context) : [...current, context]));
  const toggleCalendar = (label: string) => setSelectedCalendars((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));

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
    <header className="calendar-header">
      <div><h1>{view === 'calendar' ? formatMonthYear(viewMonth) : 'Schedule Insights'}</h1><p className="subheading">{isLoadingEvents ? 'Loading Teamup events…' : 'Live Teamup data via worker proxy'}</p></div>
      <div className="calendar-actions">
        <button type="button" className={view === 'calendar' ? 'tab-active' : ''} onClick={() => setView('calendar')}>Calendar</button>
        <button type="button" className={view === 'insights' ? 'tab-active' : ''} onClick={() => setView('insights')}>Insights</button>
        {view === 'calendar' && <><button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>Prev</button><button type="button" onClick={() => setViewMonth(DEFAULT_MONTH)}>Feb 2026</button><button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>Next</button></>}
        <button type="button" onClick={downloadDisplayedScreen} disabled={isExportingPdf}>{isExportingPdf ? 'Building PDF…' : 'Download PDF'}</button>
      </div>
    </header>

    <section className="toolbar">
      {validationIssues.length > 0 && <div className="warning-banner" role="status"><strong>Schedule warnings:</strong> {validationIssues.length} issue(s) detected. Resolve owner mapping for Teamup events when applicable.{validationIssues.length > 0 && <ul>{validationIssues.slice(0, 3).map((issue) => <li key={issue}>{issue}</li>)}{validationIssues.length > 3 && <li>+{validationIssues.length - 3} more issue(s) in console.</li>}</ul>}</div>}
      {loadError && <div className="warning-banner" role="status"><strong>Unable to load events:</strong> {loadError}</div>}
      <div className="bubble-row">{calendarLegend.map((calendar) => { const active = selectedCalendars.includes(calendar.label); return <button key={calendar.label} type="button" className={['person-bubble', active ? 'is-active' : ''].join(' ').trim()} style={{ borderColor: calendar.color, color: calendar.color, background: active ? `${calendar.color}33` : 'rgba(15, 23, 42, 0.85)' }} onClick={() => toggleCalendar(calendar.label)}>{calendar.label}</button>; })}</div>
      <div className="bubble-row">{TEAM.map((person) => { const active = selectedPeople.includes(person); return <button key={person} type="button" className={['person-bubble', active ? 'is-active' : ''].join(' ').trim()} style={{ borderColor: PERSON_COLORS[person], color: PERSON_COLORS[person], background: active ? `${PERSON_COLORS[person]}33` : 'rgba(15, 23, 42, 0.85)' }} onClick={() => togglePerson(person)}>{person}</button>; })}</div>
      <div className="bubble-row">{availableContexts.map((context) => { const active = selectedContexts.includes(context); return <button key={context} type="button" className={['person-bubble', active ? 'is-active' : ''].join(' ').trim()} onClick={() => toggleContext(context)}>{context}</button>; })}</div>
    </section>

    {view === 'calendar' ? <>
      <div className="weekday-row" role="presentation">{WEEKDAY_LABELS.map((weekday) => <div key={weekday} className="weekday-cell">{weekday}</div>)}</div>
      <section className="calendar-layout">
        <section className="calendar-grid">{days.map((day) => {
          const iso = formatIsoDate(day);
          const isSelected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, viewMonth);
          const dayEvents = dayMap[iso] ?? [];
          return <button key={iso} type="button" className={['day-cell', isSelected ? 'day-selected' : '', inMonth ? '' : 'day-outside-month'].join(' ').trim()} onClick={() => setSelectedDate(day)}>
            <span className="day-number">{day.getDate()}</span>
            {dayEvents.length > 0 && <div className="day-event-stack">{dayEvents.slice(0, 5).map((item) => <span key={item.id} className="day-event-pill" style={{ background: getEventColor(item) }}>{item.allDay ? item.title : `${formatDisplayTime(item.startTime).replace(' AM', 'a').replace(' PM', 'p')} ${item.title}`}</span>)}{dayEvents.length > 5 && <span className="day-event-more">+{dayEvents.length - 5} more</span>}</div>}
          </button>;
        })}</section>
        <aside className="day-sidebar">
          <h2>{formatIsoDate(selectedDate)}</h2>
          {selectedDateEvents.length === 0 ? <p className="chart-empty">No events for this day.</p> : <div className="day-events">{selectedDateEvents.map((item) => <div key={item.id} className="event-chip" style={{ borderLeftColor: getEventColor(item), background: withAlpha(getEventColor(item), 0.22), color: '#e2e8f0' }}><strong>{item.allDay ? 'All day' : formatDisplayTime(item.startTime)}</strong> {item.title}</div>)}</div>}
        </aside>
      </section>
    </> : <section className="insights-shell"><div className="insight-range"><label>Start<input type="date" value={insightRangeStart} onChange={(event) => setInsightRangeStart(event.target.value)} max={insightRangeEnd} /></label><label>End<input type="date" value={insightRangeEnd} onChange={(event) => setInsightRangeEnd(event.target.value)} min={insightRangeStart} /></label></div><div className="insight-grid"><article className="insight-card"><h3>1) Hours Over Time</h3><LineChart data={insights.hoursByDay} /></article><article className="insight-card"><h3>2) Hours by Doctor</h3><BarChart data={insights.hoursByPerson} /></article><article className="insight-card"><h3>3) Weekday vs Weekend Hours</h3><BarChart data={insights.weekdayWeekend} /></article><article className="insight-card"><h3>4) Most Hours per Month Ranking</h3><BarChart data={insights.monthRanking} /></article><article className="insight-card"><h3>5) Consecutive Workday Max</h3><BarChart data={insights.workDayStreaks} /></article><article className="insight-card"><h3>6) Consecutive Days Off Max</h3><BarChart data={insights.dayOffStreaks} /></article><article className="insight-card"><h3>7) Start Time Distribution</h3><BarChart data={insights.startHourBuckets} /></article><article className="insight-card"><h3>8) Hours by Day of Week</h3><BarChart data={insights.weekdayHours} /></article><article className="insight-card"><h3>9) Overtime Days (&gt;8h)</h3><BarChart data={insights.overtimeCounts} /></article><article className="insight-card"><h3>10) Highest Load Days</h3><BarChart data={insights.topHeavyDays} /></article></div></section>}
  </main>;
}

export default App;
