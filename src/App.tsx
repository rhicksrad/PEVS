import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import starterSchedule from './data/starterSchedule.json';
import { validateSeedSchedule, type SeedEvent } from './lib/seedValidation';

type ScheduleCategory = 'shift' | 'teaching' | 'admin' | 'milestone';
type TeamMember = 'Aimee Brooks' | 'Ana Aghili' | 'Liz Thomovsky' | 'Paula Johnson';

type ScheduleEvent = {
  id: string;
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
};

const STORAGE_KEY = 'pevs-schedule-events-v5';
const LEGACY_STORAGE_KEY = 'pevs-schedule-events-v4';
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

const makeId = (title: string, date: string, startTime?: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}-${startTime ?? 'all-day'}`;

const isTeamMember = (value: string): value is TeamMember => TEAM.includes(value as TeamMember);

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
  const person = event.person && isTeamMember(event.person) ? event.person : markerPerson;

  return {
    ...event,
    title: cleanedTitle,
    person
  };
}

function normalizeLoadedEvents(events: ScheduleEvent[]) {
  return sortEvents(events.map(normalizeEvent));
}

const EVENT_CATEGORY_SET = new Set<ScheduleCategory>(['shift', 'teaching', 'admin', 'milestone']);
const EVENT_CONTEXT_SET = new Set<string>(EVENT_CONTEXTS);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function generateBaseSchedule(): ScheduleEvent[] {
  const seedEvents = starterSchedule as SeedEvent[];

  if (import.meta.env.DEV) {
    validateSeedSchedule(seedEvents);
  }

  return normalizeLoadedEvents(
    seedEvents.map((event) => ({
      id: makeId(event.title, event.date, event.startTime ?? undefined),
      date: event.date,
      title: event.title,
      startTime: event.startTime ?? undefined,
      endTime: event.endTime ?? undefined,
      category: event.category as ScheduleCategory,
      context: event.context,
      person: (event.person ?? undefined) as TeamMember | undefined
    }))
  );
}

function makePersistedPayload(events: ScheduleEvent[]): PersistedSchedulePayload {
  return {
    version: CURRENT_SCHEMA_VERSION,
    events: normalizeLoadedEvents(events)
  };
}

function isPayloadShape(value: unknown): value is PersistedSchedulePayload {
  if (!value || typeof value !== 'object') return false;
  const maybePayload = value as PersistedSchedulePayload;
  return typeof maybePayload.version === 'number' && Array.isArray(maybePayload.events);
}

function findCanonicalMatch(event: Partial<ScheduleEvent>, canonicalEvents: ScheduleEvent[]) {
  const normalizedTitle = typeof event.title === 'string' ? event.title.trim().toLowerCase() : '';
  return canonicalEvents.find((candidate) => {
    if (event.id && candidate.id === event.id) return true;
    const candidateTitle = candidate.title.trim().toLowerCase();
    return candidate.date === event.date && candidateTitle === normalizedTitle && candidate.startTime === event.startTime;
  });
}

function sanitizeStoredEvents(rawEvents: unknown[], canonicalEvents: ScheduleEvent[]): ScheduleEvent[] | null {
  const sanitized: ScheduleEvent[] = [];
  const seenIds = new Set<string>();

  for (const entry of rawEvents) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Partial<ScheduleEvent>;
    const canonical = findCanonicalMatch(item, canonicalEvents);
    const category = typeof item.category === 'string' && EVENT_CATEGORY_SET.has(item.category as ScheduleCategory)
      ? (item.category as ScheduleCategory)
      : canonical?.category;
    const date = typeof item.date === 'string' && DATE_PATTERN.test(item.date) ? item.date : canonical?.date;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : canonical?.title;
    const context = typeof item.context === 'string' && EVENT_CONTEXT_SET.has(item.context)
      ? item.context
      : canonical?.context;
    const startTime = typeof item.startTime === 'string' && TIME_PATTERN.test(item.startTime) ? item.startTime : canonical?.startTime;
    const endTime = typeof item.endTime === 'string' && TIME_PATTERN.test(item.endTime) ? item.endTime : canonical?.endTime;
    const inferredFromMarker = typeof title === 'string' ? getPersonFromMarker(title.match(PERSON_MARKER_PATTERN)?.[1] ?? '') : undefined;
    const person = typeof item.person === 'string' && isTeamMember(item.person)
      ? item.person
      : canonical?.person ?? inferredFromMarker;

    if (!category || !date || !title || !context) return null;
    if (category === 'shift' && !person) return null;

    const id = typeof item.id === 'string' && item.id.trim() ? item.id : makeId(title, date, startTime);
    if (seenIds.has(id)) return null;

    seenIds.add(id);
    sanitized.push(
      normalizeEvent({
        id,
        date,
        title,
        startTime,
        endTime,
        category,
        context,
        person,
        notes: typeof item.notes === 'string' ? item.notes : undefined
      })
    );
  }

  return sanitized;
}

function migratePersistedPayload(rawValue: unknown, canonicalEvents: ScheduleEvent[]): PersistedSchedulePayload | null {
  const rawPayload = Array.isArray(rawValue) ? { version: 4, events: rawValue } : rawValue;
  if (!isPayloadShape(rawPayload)) return null;

  const sanitizedEvents = sanitizeStoredEvents(rawPayload.events, canonicalEvents);
  if (!sanitizedEvents || !sanitizedEvents.length) return null;

  return {
    version: CURRENT_SCHEMA_VERSION,
    events: normalizeLoadedEvents(sanitizedEvents)
  };
}

function readInitialEvents(): ScheduleEvent[] {
  const canonicalEvents = generateBaseSchedule();
  const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makePersistedPayload(canonicalEvents)));
    return canonicalEvents;
  }

  try {
    const parsed = JSON.parse(saved) as unknown;
    const migrated = migratePersistedPayload(parsed, canonicalEvents) ?? makePersistedPayload(canonicalEvents);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return migrated.events;
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makePersistedPayload(canonicalEvents)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return canonicalEvents;
  }
}

function App() {
  const printableRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>(() => readInitialEvents());
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [activeEventId, setActiveEventId] = useState<string>('');
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);
  const [selectedContexts, setSelectedContexts] = useState<EventContext[]>([...EVENT_CONTEXTS]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const invalidShift = events.find((event) => event.category === 'shift' && !event.person);
    if (!invalidShift) return;

    const message = `Shift event missing person assignment: ${invalidShift.id} (${invalidShift.title} on ${invalidShift.date})`;
    console.error(message, invalidShift);
    throw new Error(message);
  }, [events]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makePersistedPayload(events)));
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
  const selectedIsoDate = formatIsoDate(selectedDate);
  const selectedEvents = dayMap[selectedIsoDate] ?? [];
  const activeEvent = events.find((event) => event.id === activeEventId);

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

  const onSaveEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const updated = normalizeEvent({
      id: activeEvent?.id ?? makeId(String(formData.get('title')), String(formData.get('date')), String(formData.get('startTime')) || undefined),
      title: String(formData.get('title')),
      date: String(formData.get('date')),
      startTime: String(formData.get('startTime')) || undefined,
      endTime: String(formData.get('endTime')) || undefined,
      category: String(formData.get('category')) as ScheduleCategory,
      context: String(formData.get('context')),
      person: (() => {
        const rawPerson = String(formData.get('person')) || undefined;
        return rawPerson && isTeamMember(rawPerson) ? rawPerson : undefined;
      })(),
      notes: String(formData.get('notes')) || undefined
    });

    if (!updated.title || !updated.date) return;
    if (updated.category === 'shift' && !updated.person) return;

    if (activeEvent) {
      setEvents(sortEvents(events.map((item) => (item.id === activeEvent.id ? { ...updated, id: makeId(updated.title, updated.date, updated.startTime) } : item))));
    } else {
      setEvents(sortEvents([...events, { ...updated, id: makeId(updated.title, updated.date, updated.startTime) }]));
    }

    setActiveEventId('');
    event.currentTarget.reset();
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
        </div>
        <div className="calendar-actions">
          <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>Prev</button>
          <button type="button" onClick={() => setViewMonth(DEFAULT_MONTH)}>Feb 2026</button>
          <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>Next</button>
          <button type="button" onClick={() => { setActiveEventId('new'); setSelectedDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)); }}>+ New event</button>
          <button type="button" onClick={downloadDisplayedScreen} disabled={isExportingPdf}>{isExportingPdf ? 'Building PDF…' : 'Download PDF'}</button>
        </div>
      </header>

      <section className="toolbar">
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
              onClick={() => { setSelectedDate(day); setActiveEventId('new'); }}
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
                      setActiveEventId(item.id);
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

      {activeEventId && (
        <aside className="event-modal">
          <div className="modal-card">
            <h2>{activeEvent ? 'Edit event' : 'Create event'}</h2>
            <p>{selectedIsoDate} · {selectedEvents.length} item(s)</p>
            <form onSubmit={onSaveEvent} className="assistant-form">
              <input name="title" defaultValue={activeEvent?.title ?? ''} placeholder="Event title" required />
              <input name="date" type="date" defaultValue={activeEvent?.date ?? selectedIsoDate} required />
              <div className="time-row">
                <input name="startTime" type="time" defaultValue={activeEvent?.startTime ?? ''} />
                <input name="endTime" type="time" defaultValue={activeEvent?.endTime ?? ''} />
              </div>
              <select name="person" defaultValue={activeEvent?.person ?? ''}>
                <option value="">Unassigned</option>
                {TEAM.map((person) => <option key={person} value={person}>{person}</option>)}
              </select>
              <input name="context" defaultValue={activeEvent?.context ?? 'General ECC Service'} placeholder="Context" required />
              <textarea name="notes" defaultValue={activeEvent?.notes ?? ''} placeholder="Notes / details" rows={3} />
              <select name="category" defaultValue={activeEvent?.category ?? 'shift'}>
                <option value="shift">shift</option>
                <option value="teaching">teaching</option>
                <option value="admin">admin</option>
                <option value="milestone">milestone</option>
              </select>
              <div className="modal-actions">
                <button type="submit">Save event</button>
                <button type="button" onClick={() => setActiveEventId('')}>Close</button>
              </div>
            </form>
          </div>
        </aside>
      )}
    </main>
  );
}

export default App;
