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

const STORAGE_KEY = 'pevs-schedule-events-v3';
const DEFAULT_MONTH = new Date(2026, 1, 1);
const TEAM: TeamMember[] = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];
const PERSON_COLORS: Record<TeamMember, string> = {
  'Aimee Brooks': '#ec4899',
  'Ana Aghili': '#3b82f6',
  'Liz Thomovsky': '#10b981',
  'Paula Johnson': '#f97316'
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

function hoursBetween(start?: string, end?: string) {
  if (!start || !end) return 0;
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const total = endH * 60 + endM - (startH * 60 + startM);
  return total > 0 ? total / 60 : 0;
}

function generateBaseSchedule(): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (let day = 1; day <= 28; day += 1) {
    const date = formatIsoDate(new Date(2026, 1, day));
    const weekDay = new Date(2026, 1, day).getDay();
    const primary = TEAM[(day - 1) % TEAM.length];
    const support = TEAM[day % TEAM.length];

    events.push({
      id: `day-shift-${date}`,
      date,
      title: 'Day Shift',
      startTime: '08:00',
      endTime: '18:00',
      category: 'shift',
      context: 'General ECC Service',
      person: primary
    });

    if (weekDay >= 1 && weekDay <= 5) {
      events.push({
        id: `late-shift-${date}`,
        date,
        title: 'Late shift',
        startTime: '14:00',
        endTime: '22:00',
        category: 'shift',
        context: 'General ECC Service',
        person: support
      });
    }
  }

  return sortEvents(events);
}

function readInitialEvents(): ScheduleEvent[] {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return generateBaseSchedule();

  try {
    const parsed = JSON.parse(saved) as ScheduleEvent[];
    return parsed.length ? sortEvents(parsed) : generateBaseSchedule();
  } catch {
    return generateBaseSchedule();
  }
}

function App() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => readInitialEvents());
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [activeEventId, setActiveEventId] = useState<string>('');
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  const dayMap = useMemo(() => {
    return events.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
      if (event.person && !selectedPeople.includes(event.person)) return acc;
      acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
      return acc;
    }, {});
  }, [events, selectedPeople]);

  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);
  const selectedIsoDate = formatIsoDate(selectedDate);
  const selectedEvents = dayMap[selectedIsoDate] ?? [];
  const activeEvent = events.find((event) => event.id === activeEventId);

  const monthlyHours = useMemo(() => {
    return TEAM.map((person) => {
      const hours = events
        .filter((event) => event.person === person && event.category === 'shift' && event.date.startsWith('2026-02'))
        .reduce((total, event) => total + hoursBetween(event.startTime, event.endTime), 0);
      return { person, hours };
    });
  }, [events]);

  const togglePerson = (person: TeamMember) => {
    setSelectedPeople((current) => (current.includes(person) ? current.filter((item) => item !== person) : [...current, person]));
  };

  const onSaveEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const updated: ScheduleEvent = {
      id: activeEvent?.id ?? makeId(String(formData.get('title')), String(formData.get('date')), String(formData.get('startTime')) || undefined),
      title: String(formData.get('title')),
      date: String(formData.get('date')),
      startTime: String(formData.get('startTime')) || undefined,
      endTime: String(formData.get('endTime')) || undefined,
      category: String(formData.get('category')) as ScheduleCategory,
      context: String(formData.get('context')),
      person: (String(formData.get('person')) || undefined) as TeamMember | undefined,
      notes: String(formData.get('notes')) || undefined
    };

    if (!updated.title || !updated.date) return;

    if (activeEvent) {
      setEvents(sortEvents(events.map((item) => (item.id === activeEvent.id ? { ...updated, id: makeId(updated.title, updated.date, updated.startTime) } : item))));
    } else {
      setEvents(sortEvents([...events, { ...updated, id: makeId(updated.title, updated.date, updated.startTime) }]));
    }

    setActiveEventId('');
    event.currentTarget.reset();
  };

  return (
    <main className="app-shell">
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
                style={{ borderColor: PERSON_COLORS[person], color: PERSON_COLORS[person], background: active ? `${PERSON_COLORS[person]}22` : '#fff' }}
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
                      borderLeftColor: item.person ? PERSON_COLORS[item.person] : '#6366f1',
                      background: item.person ? withAlpha(PERSON_COLORS[item.person], 0.18) : '#eef2ff',
                      color: item.person ? '#1f2937' : '#312e81'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDate(day);
                      setActiveEventId(item.id);
                    }}
                  >
                    <strong>{item.startTime ?? 'All day'}</strong> {item.title} {item.person ? `(${item.person.split(' ')[0]})` : ''}
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
