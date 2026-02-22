import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  WEEKDAY_LABELS,
  formatIsoDate,
  formatMonthYear,
  getCalendarGridDays,
  isSameDay,
  isSameMonth
} from './lib/date';

type ScheduleCategory = 'shift' | 'teaching' | 'admin' | 'milestone';

type ScheduleEvent = {
  id: string;
  date: string;
  title: string;
  startTime?: string;
  category: ScheduleCategory;
  context: string;
};

type AssistantResult = {
  message: string;
  changed: boolean;
  events: ScheduleEvent[];
};

const STORAGE_KEY = 'pevs-schedule-events-v2';
const DEFAULT_MONTH = new Date(2026, 1, 1);
const ROLE_LABELS = ['ECC Resident Chief', 'ECC Teaching', 'General ECC Service'];
const TEAM = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];

const toSortKey = (event: ScheduleEvent) => `${event.date}T${event.startTime ?? '99:99'}`;
const sortEvents = (events: ScheduleEvent[]) => [...events].sort((a, b) => toSortKey(a).localeCompare(toSortKey(b)));

const makeId = (title: string, date: string, startTime?: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}-${startTime ?? 'all-day'}`;

function generateBaseSchedule(): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (let day = 1; day <= 28; day += 1) {
    const date = formatIsoDate(new Date(2026, 1, day));
    const weekDay = new Date(2026, 1, day).getDay();

    events.push({ id: `day-shift-${date}`, date, title: 'Day Shift', startTime: '08:00', category: 'shift', context: 'General ECC Service' });

    if (weekDay >= 1 && weekDay <= 5) {
      events.push({ id: `late-shift-${date}`, date, title: 'Late shift', startTime: '14:00', category: 'shift', context: 'General ECC Service' });
    }
  }

  const additionalItems: Array<Omit<ScheduleEvent, 'id'>> = [
    { date: '2026-02-02', title: 'Resp distress -LT', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-03', title: 'ICU midblocks', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-03', title: 'Grade assignment 1?', startTime: '08:30', category: 'milestone', context: 'ECC Teaching' },
    { date: '2026-02-04', title: 'Repro ER-LT', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-05', title: 'Resident Review', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-09', title: 'Arrhthmia -AB', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-11', title: 'Neonatal ER -AA', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-12', title: 'Journal club', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-13', title: 'ICU grades', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-15', title: 'Block 14', category: 'milestone', context: 'General Events' },
    { date: '2026-02-16', title: 'Thermal ER - PJ', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-17', title: 'Intern rounds oxy/vent', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-18', title: 'A&I pneumo wrap up', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-18', title: 'Bleeding-PJ', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-18', title: 'ECC Grading', startTime: '17:00', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-19', title: 'Money talks lecture', startTime: '08:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-19', title: 'Resident Review', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-19', title: 'ECC retreat', startTime: '17:00', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-21', title: 'ECC midblocks', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-23', title: 'Endocrine ER -AB', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-24', title: 'ICU midblocks', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-24', title: 'SVECCS ICU rounds', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-25', title: 'CHF -AA', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-26', title: 'Journal club', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-26', title: 'Prerecorded lecture to residents', startTime: '17:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-27', title: 'Grade assignment 2?', startTime: '09:00', category: 'milestone', context: 'ECC Teaching' },
    { date: '2026-02-28', title: 'SVECCS POCUS lab', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' }
  ];

  additionalItems.forEach((event) => events.push({ ...event, id: makeId(event.title, event.date, event.startTime) }));

  return sortEvents(events);
}

function encodeEventsToHash(events: ScheduleEvent[]) {
  const payload = btoa(encodeURIComponent(JSON.stringify(events)));
  return `schedule=${payload}`;
}

function decodeEventsFromHash(hash: string): ScheduleEvent[] | null {
  const payload = new URLSearchParams(hash.replace(/^#/, '')).get('schedule');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(payload))) as ScheduleEvent[];
    return parsed;
  } catch {
    return null;
  }
}

function readInitialEvents(): ScheduleEvent[] {
  const fromHash = decodeEventsFromHash(window.location.hash);
  if (fromHash?.length) return sortEvents(fromHash);

  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return generateBaseSchedule();

  try {
    const parsed = JSON.parse(saved) as ScheduleEvent[];
    return parsed.length ? sortEvents(parsed) : generateBaseSchedule();
  } catch {
    return generateBaseSchedule();
  }
}

function applyAssistantCommand(command: string, currentEvents: ScheduleEvent[]): AssistantResult {
  const trimmed = command.trim();

  const addMatch = trimmed.match(/^add\s+(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+([0-2]?\d:[0-5]\d))?\s*(shift|teaching|admin|milestone)?$/i);
  if (addMatch) {
    const [, title, date, startTime, categoryRaw] = addMatch;
    const category = (categoryRaw?.toLowerCase() as ScheduleCategory | undefined) ?? 'admin';
    const newEvent: ScheduleEvent = {
      id: makeId(title, date, startTime),
      date,
      title,
      startTime,
      category,
      context: category === 'shift' ? 'General ECC Service' : 'ECC Teaching'
    };

    return {
      changed: true,
      events: sortEvents([...currentEvents, newEvent]),
      message: `Added “${title}” on ${date}${startTime ? ` at ${startTime}` : ''}.`
    };
  }

  const removeMatch = trimmed.match(/^remove\s+(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})$/i);
  if (removeMatch) {
    const [, title, date] = removeMatch;
    const remaining = currentEvents.filter((event) => !(event.date === date && event.title.toLowerCase() === title.toLowerCase()));

    if (remaining.length === currentEvents.length) {
      return { changed: false, events: currentEvents, message: `No event found for “${title}” on ${date}.` };
    }

    return { changed: true, events: remaining, message: `Removed “${title}” on ${date}.` };
  }

  return {
    changed: false,
    events: currentEvents,
    message: 'Command format: “add <title> on YYYY-MM-DD [at HH:MM] [shift|teaching|admin|milestone]” or “remove <title> on YYYY-MM-DD”.'
  };
}

function App() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => readInitialEvents());
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [command, setCommand] = useState('');
  const [assistantMessage, setAssistantMessage] = useState('Share link lets anyone create, edit, and move shifts.');
  const [activeEventId, setActiveEventId] = useState<string>('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    window.history.replaceState(null, '', `#${encodeEventsToHash(events)}`);
  }, [events]);

  const dayMap = useMemo(() => {
    return events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
      acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
      return acc;
    }, {});
  }, [events]);

  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);
  const selectedIsoDate = formatIsoDate(selectedDate);
  const selectedEvents = dayMap[selectedIsoDate] ?? [];
  const activeEvent = events.find((event) => event.id === activeEventId);

  const onSubmitCommand = (event: FormEvent) => {
    event.preventDefault();
    const result = applyAssistantCommand(command, events);
    setAssistantMessage(result.message);
    if (result.changed) setEvents(result.events);
    setCommand('');
  };

  const onMoveEvent = (eventId: string, date: string) => {
    setEvents(sortEvents(events.map((event) => (event.id === eventId ? { ...event, date, id: makeId(event.title, date, event.startTime) } : event))));
    setAssistantMessage('Event moved.');
  };

  const onSaveEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const updated: ScheduleEvent = {
      id: activeEvent?.id ?? makeId(String(formData.get('title')), String(formData.get('date')), String(formData.get('startTime')) || undefined),
      title: String(formData.get('title')),
      date: String(formData.get('date')),
      startTime: String(formData.get('startTime')) || undefined,
      category: String(formData.get('category')) as ScheduleCategory,
      context: String(formData.get('context'))
    };

    if (!updated.title || !updated.date) return;

    if (activeEvent) {
      setEvents(sortEvents(events.map((item) => (item.id === activeEvent.id ? { ...updated, id: makeId(updated.title, updated.date, updated.startTime) } : item))));
      setAssistantMessage('Event updated.');
    } else {
      setEvents(sortEvents([...events, { ...updated, id: makeId(updated.title, updated.date, updated.startTime) }]));
      setAssistantMessage('Event created.');
    }

    setActiveEventId('');
    event.currentTarget.reset();
  };

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setAssistantMessage('Editable link copied. Anyone with this link can change the schedule.');
  };

  return (
    <main className="app-shell">
      <section className="calendar-panel" aria-label="ECC scheduling calendar">
        <header className="calendar-header">
          <div>
            <h1>{formatMonthYear(viewMonth)}</h1>
            <p className="subheading">Live editable planner synced into URL for link sharing.</p>
          </div>
          <div className="calendar-actions">
            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>Prev</button>
            <button type="button" onClick={() => setViewMonth(DEFAULT_MONTH)}>Feb 2026</button>
            <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>Next</button>
          </div>
        </header>

        <div className="legend-box">
          <strong>Role labels:</strong> {ROLE_LABELS.join(' • ')}
          <br />
          <strong>Primary team:</strong> {TEAM.join(', ')}
          <br />
          <button type="button" onClick={copyShareLink}>Copy editable link</button>
        </div>

        <div className="weekday-row" role="presentation">
          {WEEKDAY_LABELS.map((weekday) => (
            <div key={weekday} className="weekday-cell">{weekday}</div>
          ))}
        </div>

        <div className="calendar-grid">
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
                onClick={() => setSelectedDate(day)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const eventId = event.dataTransfer.getData('text/event-id');
                  if (eventId) onMoveEvent(eventId, iso);
                }}
              >
                <span>{day.getDate()}</span>
                <small>{dayEvents.length ? `${dayEvents.length} items` : ''}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="details-panel">
        <h2>{selectedIsoDate}</h2>
        {selectedEvents.length === 0 ? (
          <p>No events on this day.</p>
        ) : (
          <ul className="event-list">
            {selectedEvents.map((event) => (
              <li key={event.id} draggable onDragStart={(dragEvent) => dragEvent.dataTransfer.setData('text/event-id', event.id)}>
                <span>
                  <strong>{event.startTime ?? 'All day'}</strong> — {event.title}
                </span>
                <small>{event.category} • {event.context}</small>
                <button type="button" onClick={() => setActiveEventId(event.id)}>Edit</button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSaveEvent} className="assistant-form">
          <label htmlFor="title">{activeEvent ? 'Edit event' : 'Create event'}</label>
          <input id="title" name="title" defaultValue={activeEvent?.title ?? ''} placeholder="Event title" required />
          <input name="date" type="date" defaultValue={activeEvent?.date ?? selectedIsoDate} required />
          <input name="startTime" type="time" defaultValue={activeEvent?.startTime ?? ''} />
          <input name="context" defaultValue={activeEvent?.context ?? 'General ECC Service'} placeholder="Context" required />
          <select name="category" defaultValue={activeEvent?.category ?? 'shift'}>
            <option value="shift">shift</option>
            <option value="teaching">teaching</option>
            <option value="admin">admin</option>
            <option value="milestone">milestone</option>
          </select>
          <button type="submit">{activeEvent ? 'Save changes' : 'Create event'}</button>
        </form>

        <form onSubmit={onSubmitCommand} className="assistant-form">
          <label htmlFor="assistant-command">Quick command</label>
          <input
            id="assistant-command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="add Resident Review on 2026-03-03 at 09:30 teaching"
          />
          <button type="submit">Apply</button>
          <p className="assistant-message">{assistantMessage}</p>
        </form>
      </section>
    </main>
  );
}

export default App;
