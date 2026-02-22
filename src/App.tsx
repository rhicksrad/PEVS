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

const STORAGE_KEY = 'pevs-schedule-events-v5';
const DEFAULT_MONTH = new Date(2026, 1, 1);
const TEAM: TeamMember[] = ['Aimee Brooks', 'Ana Aghili', 'Liz Thomovsky', 'Paula Johnson'];
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
  const events: ScheduleEvent[] = [];

  const supplementalEvents: Omit<ScheduleEvent, 'id'>[] = [
    { date: '2026-02-02', title: 'Resp distress', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Liz Thomovsky' },
    { date: '2026-02-03', title: 'ICU midblocks', category: 'admin', context: 'General Events' },
    { date: '2026-02-03', title: 'Grade assignment 1?', startTime: '08:30', category: 'admin', context: 'General Events' },
    { date: '2026-02-04', title: 'Repro ER', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Liz Thomovsky' },
    { date: '2026-02-05', title: 'Resident Review', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-09', title: 'Arrhythmia', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Aimee Brooks' },
    { date: '2026-02-11', title: 'Neonatal ER', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Ana Aghili' },
    { date: '2026-02-12', title: 'Journal club', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-13', title: 'ICU grades', category: 'admin', context: 'General Events' },
    { date: '2026-02-16', title: 'Block 14', category: 'milestone', context: 'General Events' },
    { date: '2026-02-17', title: 'Thermal ER', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Paula Johnson' },
    { date: '2026-02-18', title: 'Intern rounds oxy/vent', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-19', title: 'A&I pneumo wrap up', startTime: '13:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-19', title: 'Bleeding', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Paula Johnson' },
    { date: '2026-02-19', title: 'ECC Grading', startTime: '17:00', category: 'admin', context: 'General Events' },
    { date: '2026-02-20', title: 'Money talks lecture', startTime: '08:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-20', title: 'Resident Review', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-20', title: 'ECC retreat', startTime: '17:00', category: 'admin', context: 'General Events' },
    { date: '2026-02-21', title: 'ECC midblocks', category: 'admin', context: 'General Events' },
    { date: '2026-02-23', title: 'Endocrine ER', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Aimee Brooks' },
    { date: '2026-02-23', title: 'ICU midblocks', category: 'admin', context: 'General Events' },
    { date: '2026-02-24', title: 'SVECCS ICU rounds', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-25', title: 'CHF', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Ana Aghili' },
    { date: '2026-02-26', title: 'Journal club', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-26', title: 'Prerecorded lecture to residents', startTime: '17:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-02-27', title: 'Grade assignment 2?', startTime: '09:00', category: 'admin', context: 'General Events' },
    { date: '2026-02-28', title: 'SVECCS POCUS lab', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-03-02', title: 'Shock rounds', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Aimee Brooks' },
    { date: '2026-03-05', title: 'Resident review', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-03-11', title: 'ECC grading block 15', startTime: '17:00', category: 'admin', context: 'General Events' },
    { date: '2026-03-16', title: 'Trauma case conference', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Ana Aghili' },
    { date: '2026-03-20', title: 'ICU midblocks', category: 'admin', context: 'General Events' },
    { date: '2026-03-24', title: 'Ventilator lab', startTime: '08:00', category: 'teaching', context: 'ECC Teaching', person: 'Liz Thomovsky' },
    { date: '2026-03-28', title: 'ECC retreat planning', startTime: '10:00', category: 'admin', context: 'General Events' },
    { date: '2026-04-01', title: 'Sepsis rounds', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Paula Johnson' },
    { date: '2026-04-06', title: 'Resident review', startTime: '09:30', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-04-09', title: 'Intern rounds', startTime: '08:00', category: 'teaching', context: 'ECC Teaching' },
    { date: '2026-04-14', title: 'ICU grades due', category: 'admin', context: 'General Events' },
    { date: '2026-04-17', title: 'ECC case wrap-up', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Aimee Brooks' },
    { date: '2026-04-22', title: 'Simulation lab', startTime: '13:30', category: 'teaching', context: 'ECC Teaching', person: 'Ana Aghili' },
    { date: '2026-04-29', title: 'End-of-month review', startTime: '16:00', category: 'admin', context: 'General Events' }
  ];

  const addShiftBlocksForMonth = (year: number, monthIndex: number) => {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateValue = new Date(year, monthIndex, day);
      const date = formatIsoDate(dateValue);
      const weekDay = dateValue.getDay();

      const dayPerson = TEAM[(day - 1) % TEAM.length];
      const nightPerson = TEAM[day % TEAM.length];

      events.push({
        id: `day-shift-${date}`,
        date,
        title: 'Day Shift',
        startTime: '08:00',
        endTime: '18:00',
        category: 'shift',
        context: 'General ECC Service',
        person: dayPerson
      });

      if (weekDay >= 1 && weekDay <= 5) {
        events.push({
          id: `late-shift-${date}`,
          date,
          title: 'Night Shift',
          startTime: '14:00',
          endTime: '22:00',
          category: 'shift',
          context: 'General ECC Service',
          person: nightPerson
        });
      }
    }
  };

  addShiftBlocksForMonth(2026, 1);
  addShiftBlocksForMonth(2026, 2);
  addShiftBlocksForMonth(2026, 3);

  supplementalEvents.forEach((event) => {
    events.push({ ...event, id: makeId(event.title, event.date, event.startTime) });
  });

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
  const printableRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>(() => readInitialEvents());
  const [viewMonth, setViewMonth] = useState(DEFAULT_MONTH);
  const [selectedDate, setSelectedDate] = useState<Date>(DEFAULT_MONTH);
  const [activeEventId, setActiveEventId] = useState<string>('');
  const [selectedPeople, setSelectedPeople] = useState<TeamMember[]>([...TEAM]);
  const [selectedContexts, setSelectedContexts] = useState<EventContext[]>([...EVENT_CONTEXTS]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
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
                    <strong>{formatDisplayTime(item.startTime)}</strong> {item.title} {item.person ? `(${item.person.split(' ')[0]})` : ''}
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
