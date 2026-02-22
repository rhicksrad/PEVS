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
  startTime: string;
  category: ScheduleCategory;
  context: string;
};

type AssistantResult = {
  message: string;
  changed: boolean;
  events: ScheduleEvent[];
};

const STORAGE_KEY = 'pevs-schedule-events-v1';
const DEFAULT_MONTH = new Date(2026, 1, 1);
const ROLE_LABELS = ['ECC Resident Chief', 'ECC Teaching', 'General ECC Service'];
const TEAM = ['Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];

function generateBaseSchedule(): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (let day = 1; day <= 28; day += 1) {
    const date = formatIsoDate(new Date(2026, 1, day));
    const weekDay = new Date(2026, 1, day).getDay();

    events.push({
      id: `day-shift-${date}`,
      date,
      title: 'Day Shift',
      startTime: '08:00',
      category: 'shift',
      context: 'General ECC Service'
    });

    if (weekDay >= 1 && weekDay <= 5) {
      events.push({
        id: `late-shift-${date}`,
        date,
        title: 'Late Shift',
        startTime: '14:00',
        category: 'shift',
        context: 'General ECC Service'
      });
    }
  }

  const teachingDays = [2, 4, 9, 11, 13, 16, 18, 23, 25];
  const teachingTopics = [
    'Resp distress',
    'Repro ER',
    'Arrhythmia',
    'Neonatal ER',
    'Thermal ER',
    'A&I pneumo wrap up',
    'Bleeding',
    'Endocrine ER',
    'CHF'
  ];

  teachingDays.forEach((day, index) => {
    const date = formatIsoDate(new Date(2026, 1, day));
    events.push({
      id: `teaching-${date}`,
      date,
      title: teachingTopics[index],
      startTime: '13:30',
      category: 'teaching',
      context: 'ECC Teaching'
    });
  });

  const additionalItems: Array<Omit<ScheduleEvent, 'id'>> = [
    { date: '2026-02-03', title: 'Resident Review', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-10', title: 'Journal Club', startTime: '09:30', category: 'teaching', context: 'ECC Resident Chief' },
    { date: '2026-02-17', title: 'ICU midblocks', startTime: '09:30', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-24', title: 'ECC midblocks', startTime: '09:30', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-05', title: 'Grade assignment 1?', startTime: '08:30', category: 'milestone', context: 'ECC Teaching' },
    { date: '2026-02-19', title: 'Grade assignment 2?', startTime: '08:30', category: 'milestone', context: 'ECC Teaching' },
    { date: '2026-02-12', title: 'Assignment workshop', startTime: '09:00', category: 'milestone', context: 'ECC Teaching' },
    { date: '2026-02-06', title: 'ECC Grading', startTime: '17:00', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-20', title: 'ECC retreat', startTime: '17:00', category: 'admin', context: 'General ECC Service' },
    { date: '2026-02-08', title: 'SVECCS ICU rounds', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-22', title: 'SVECCS POCUS lab', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' }
  ];

  additionalItems.forEach((event) => {
    events.push({
      ...event,
      id: `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${event.date}-${event.startTime}`
    });
  });

  return events.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
}

function readInitialEvents(): ScheduleEvent[] {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return generateBaseSchedule();
  }

  try {
    const parsed = JSON.parse(saved) as ScheduleEvent[];
    return parsed.length ? parsed : generateBaseSchedule();
  } catch {
    return generateBaseSchedule();
  }
}

function applyAssistantCommand(command: string, currentEvents: ScheduleEvent[]): AssistantResult {
  const trimmed = command.trim();

  const addMatch = trimmed.match(/^add\s+(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})\s+at\s+([0-2]?\d:[0-5]\d)\s*(shift|teaching|admin|milestone)?$/i);
  if (addMatch) {
    const [, title, date, startTime, categoryRaw] = addMatch;
    const category = (categoryRaw?.toLowerCase() as ScheduleCategory | undefined) ?? 'admin';
    const newEvent: ScheduleEvent = {
      id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${date}-${startTime}`,
      date,
      title,
      startTime,
      category,
      context: category === 'shift' ? 'General ECC Service' : 'ECC Teaching'
    };

    return {
      changed: true,
      events: [...currentEvents, newEvent].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)),
      message: `Added “${title}” on ${date} at ${startTime}.`
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
    message: 'Command format: “add <title> on YYYY-MM-DD at HH:MM [shift|teaching|admin|milestone]” or “remove <title> on YYYY-MM-DD”.'
  };
}

function App() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => readInitialEvents());
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [command, setCommand] = useState('');
  const [assistantMessage, setAssistantMessage] = useState('Use quick commands to add/remove events.');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  const dayMap = useMemo(() => {
    return events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
      acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => a.startTime.localeCompare(b.startTime));
      return acc;
    }, {});
  }, [events]);

  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);
  const selectedIsoDate = formatIsoDate(selectedDate);
  const selectedEvents = dayMap[selectedIsoDate] ?? [];

  const onSubmitCommand = (event: FormEvent) => {
    event.preventDefault();
    const result = applyAssistantCommand(command, events);
    setAssistantMessage(result.message);
    if (result.changed) {
      setEvents(result.events);
    }
    setCommand('');
  };

  return (
    <main className="app-shell">
      <section className="calendar-panel" aria-label="ECC scheduling calendar">
        <header className="calendar-header">
          <div>
            <h1>{formatMonthYear(viewMonth)}</h1>
            <p className="subheading">Integrated shift + teaching planner for future scheduling updates.</p>
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
              <li key={event.id}>
                <span>
                  <strong>{event.startTime}</strong> — {event.title}
                </span>
                <small>{event.category} • {event.context}</small>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmitCommand} className="assistant-form">
          <label htmlFor="assistant-command">Scheduling assistant command</label>
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
