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
import { fetchTeamupEvents } from './lib/teamup';
import { validateScheduleEvents } from './lib/scheduleValidation';

type ScheduleCategory = 'shift' | 'teaching' | 'admin' | 'milestone';
type TeamMember = 'Aimee Brooks' | 'Ana Aghili' | 'Liz Thomovsky' | 'Paula Johnson';

type ScheduleEvent = {
  id: string;
  externalId?: string;
  source?: 'teamup';
  date: string;
  title: string;
  startTime?: string;
  endTime?: string;
  category: ScheduleCategory;
  context: string;
  person?: TeamMember;
  notes?: string;
};

type PersistedSchedulePayload = {
  version: number;
  events: ScheduleEvent[];
  source: 'teamup';
};

const STORAGE_KEY = 'pevs-schedule-events-v5';
const CURRENT_SCHEMA_VERSION = 6;
const DEFAULT_MONTH = new Date(2026, 1, 1);
const TEAM: TeamMember[] = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];
const PERSON_MARKER_PATTERN = /\(([^)]+)\)/;
const EVENT_CONTEXTS = ['General ECC Service', 'ECC Teaching', 'General Events'] as const;
type EventContext = (typeof EVENT_CONTEXTS)[number];
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
  const normalizedMarker = marker.trim().toLowerCase();
  return TEAM.find((member) => {
    const [firstName] = member.split(' ');
    return member.toLowerCase() === normalizedMarker || firstName.toLowerCase() === normalizedMarker;
  });
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

function convertTeamupEvents(teamupEvents: Awaited<ReturnType<typeof fetchTeamupEvents>>): ScheduleEvent[] {
  return normalizeLoadedEvents(teamupEvents);
}

function App() {
  const printableRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);
  const [selectedContexts, setSelectedContexts] = useState<EventContext[]>([...EVENT_CONTEXTS]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);

  useEffect(() => {
    let isCancelled = false;
    const monthGridDays = getCalendarGridDays(viewMonth);
    const rangeStart = formatIsoDate(monthGridDays[0]);
    const rangeEnd = formatIsoDate(monthGridDays[monthGridDays.length - 1]);

    const loadEvents = async () => {
      setIsLoadingEvents(true);
      try {
        const fetchedEvents = await fetchTeamupEvents(rangeStart, rangeEnd);
        const normalized = convertTeamupEvents(fetchedEvents);
        const validation = validateScheduleEvents(normalized);
        if (isCancelled) return;
        if (validation.issues.length) {
          console.warn('[scheduleValidation] Teamup normalization issues:\n' + validation.issues.map((issue) => `- ${issue}`).join('\n'));
        }
        setValidationIssues(validation.issues);
        setLoadError('');
        setEvents(normalized);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: CURRENT_SCHEMA_VERSION,
            events: normalized,
            source: 'teamup'
          } satisfies PersistedSchedulePayload)
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

    loadEvents();

    return () => {
      isCancelled = true;
    };
  }, [viewMonth]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const invalidShift = events.find((event) => event.category === 'shift' && !event.person);
    if (!invalidShift) return;

    const message = `Shift event missing person assignment: ${invalidShift.id} (${invalidShift.title} on ${invalidShift.date})`;
    console.error(message, invalidShift);
    throw new Error(message);
  }, [events]);

  const dayMap = useMemo(() => {
    return events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
      if (event.person && !selectedPeople.includes(event.person)) return acc;
      if (!selectedContexts.includes(event.context as EventContext)) return acc;
      acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
      return acc;
    }, {});
  }, [events, selectedPeople, selectedContexts]);

  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);

  const monthlyHours = useMemo(() => {
    const monthPrefix = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`;

    return TEAM.map((person) => {
      const hours = events
        .filter((event) => event.person === person && event.date.startsWith(monthPrefix) && selectedContexts.includes(event.context as EventContext))
        .reduce((total, event) => total + getEventHours(event), 0);
      return { person, hours };
    });
  }, [events, viewMonth, selectedContexts]);

  const togglePerson = (person: TeamMember) => {
    setSelectedPeople((current) => (current.includes(person) ? current.filter((item) => item !== person) : [...current, person]));
  };

  const toggleContext = (context: EventContext) => {
    setSelectedContexts((current) => (current.includes(context) ? current.filter((item) => item !== context) : [...current, context]));
  };

  const downloadDisplayedScreen = async () => {
    if (!printableRef.current || isExportingPdf) return;

    setIsExportingPdf(true);
    try {
      const canvas = await html2canvas(printableRef.current, {
        scale: window.devicePixelRatio > 1 ? 2 : 1,
        backgroundColor: '#111827',
        useCORS: true,
        scrollX: 0,
        scrollY: -window.scrollY
      });

      const image = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });

      pdf.addImage(image, 'PNG', 0, 0, canvas.width, canvas.height);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      pdf.save(`pevs-schedule-${timestamp}.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <main className="app-shell" ref={printableRef}>
      <header className="calendar-header">
        <div>
          <h1>{formatMonthYear(viewMonth)}</h1>
          <p className="subheading">Full-screen monthly schedule with person filters, color coding, and editable events.</p>
          <p className="subheading">{isLoadingEvents ? 'Loading Teamup events…' : 'Live Teamup data'}</p>
        </div>
        <div className="calendar-actions">
          <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>Prev</button>
          <button type="button" onClick={() => setViewMonth(DEFAULT_MONTH)}>Feb 2026</button>
          <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>Next</button>
          <button type="button" onClick={downloadDisplayedScreen} disabled={isExportingPdf}>{isExportingPdf ? 'Building PDF…' : 'Download PDF'}</button>
        </div>
      </header>

      <section className="toolbar">
        {validationIssues.length > 0 && (
          <div className="warning-banner" role="status">
            <strong>Schedule warnings:</strong> {validationIssues.length} issue(s) detected. Check the browser console for details.
          </div>
        )}
        {loadError && (
          <div className="warning-banner" role="status">
            <strong>Teamup unavailable:</strong> {loadError}
          </div>
        )}
        <div className="bubble-row">
          {TEAM.map((person) => {
            const active = selectedPeople.includes(person);
            return (
              <button
                key={person}
                type="button"
                className={['person-bubble', active ? 'is-active' : ''].join(' ').trim()}
                style={{ borderColor: PERSON_COLORS[person], color: PERSON_COLORS[person], background: active ? `${PERSON_COLORS[person]}33` : 'rgba(15, 23, 42, 0.85)' }}
                onClick={() => togglePerson(person)}
              >
                {person}
              </button>
            );
          })}
        </div>
        <div className="hours-panel">
          {monthlyHours.map(({ person, hours }) => (
            <p key={person}><span style={{ color: PERSON_COLORS[person] }}>●</span> {person}: <strong>{hours.toFixed(1)}h</strong></p>
          ))}
        </div>
        <div className="bubble-row">
          {EVENT_CONTEXTS.map((context) => {
            const active = selectedContexts.includes(context);
            return (
              <button
                key={context}
                type="button"
                className={['person-bubble', active ? 'is-active' : ''].join(' ').trim()}
                onClick={() => toggleContext(context)}
              >
                {context}
              </button>
            );
          })}
        </div>
      </section>

      <div className="weekday-row" role="presentation">
        {WEEKDAY_LABELS.map((weekday) => (
          <div key={weekday} className="weekday-cell">{weekday}</div>
        ))}
      </div>

      <section className="calendar-grid">
        {days.map((day) => {
          const iso = formatIsoDate(day);
          const isSelected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, viewMonth);
          const dayEvents = dayMap[iso] ?? [];

          return (
            <button
              key={iso}
              type="button"
              className={['day-cell', isSelected ? 'day-selected' : '', inMonth ? '' : 'day-outside-month'].join(' ').trim()}
              onClick={() => { setSelectedDate(day); }}
            >
              <span className="day-number">{day.getDate()}</span>
              <div className="day-events">
                {dayEvents.map((item) => (
                  <div
                    key={item.id}
                    className="event-chip"
                    style={{
                      borderLeftColor: getEventColor(item),
                      background: withAlpha(getEventColor(item), 0.22),
                      color: '#e2e8f0'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDate(day);
                    }}
                  >
                    <strong>{formatDisplayTime(item.startTime)}</strong> {item.title}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </section>

    </main>
  );
}

export default App;
