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
type AppView = 'calendar' | 'insights';

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

type NamedValue = { label: string; value: number; color?: string };

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

function getDateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function BarChart({ data }: { data: NamedValue[] }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="chart-list">
      {data.map((item) => (
        <div key={item.label} className="chart-row">
          <span>{item.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(item.value / maxValue) * 100}%`, background: item.color ?? '#60a5fa' }} />
          </div>
          <strong>{item.value.toFixed(1)}</strong>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }: { data: NamedValue[] }) {
  if (data.length === 0) {
    return <p className="chart-empty">No data for the selected range.</p>;
  }

  const width = 440;
  const height = 140;
  const padding = 14;
  const max = Math.max(...data.map((item) => item.value), 1);
  const points = data
    .map((item, index) => {
      const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - (item.value / max) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="hours over time line chart">
        <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="chart-inline-labels">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </>
  );
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
    const monthStart = formatIsoDate(monthGridDays[0]);
    const monthEnd = formatIsoDate(monthGridDays[monthGridDays.length - 1]);
    const rangeStart = monthStart < insightRangeStart ? monthStart : insightRangeStart;
    const rangeEnd = monthEnd > insightRangeEnd ? monthEnd : insightRangeEnd;

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
  }, [monthGridDays, insightRangeStart, insightRangeEnd]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const invalidShift = events.find((event) => event.category === 'shift' && !event.person);
    if (!invalidShift) return;

    const message = `Shift event missing person assignment: ${invalidShift.id} (${invalidShift.title} on ${invalidShift.date})`;
    console.error(message, invalidShift);
    throw new Error(message);
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (event.person && !selectedPeople.includes(event.person)) return false;
      return selectedContexts.includes(event.context as EventContext);
    });
  }, [events, selectedPeople, selectedContexts]);

  const dayMap = useMemo(() => {
    return filteredEvents.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
      acc[event.date] = [...(acc[event.date] ?? []), event].sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
      return acc;
    }, {});
  }, [filteredEvents]);

  const days = monthGridDays;

  const insightEvents = useMemo(
    () => filteredEvents.filter((event) => event.date >= insightRangeStart && event.date <= insightRangeEnd),
    [filteredEvents, insightRangeStart, insightRangeEnd]
  );

  const insightDays = useMemo(() => getDateRange(insightRangeStart, insightRangeEnd), [insightRangeStart, insightRangeEnd]);

  const insights = useMemo(() => {
    const hoursByPerson = TEAM.map((person) => ({
      label: person,
      value: insightEvents.filter((event) => event.person === person).reduce((sum, event) => sum + getEventHours(event), 0),
      color: PERSON_COLORS[person]
    }));

    const hoursByDay = insightDays.map((day) => ({
      label: day.slice(5),
      value: insightEvents.filter((event) => event.date === day).reduce((sum, event) => sum + getEventHours(event), 0)
    }));

    const weekdayHours = WEEKDAY_LABELS.map((dayName, index) => ({
      label: dayName,
      value: insightEvents
        .filter((event) => {
          const day = new Date(`${event.date}T00:00:00Z`).getUTCDay();
          return day === (index + 1) % 7;
        })
        .reduce((sum, event) => sum + getEventHours(event), 0)
    }));

    const monthMap = new Map<string, number>();
    insightEvents.forEach((event) => {
      const month = event.date.slice(0, 7);
      monthMap.set(month, (monthMap.get(month) ?? 0) + getEventHours(event));
    });
    const monthRanking = Array.from(monthMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const dayTotals = new Map<string, number>();
    insightEvents.forEach((event) => {
      dayTotals.set(event.date, (dayTotals.get(event.date) ?? 0) + getEventHours(event));
    });

    const topHeavyDays = Array.from(dayTotals.entries())
      .map(([label, value]) => ({ label: label.slice(5), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const workDayStreaks = TEAM.map((person) => {
      let maxStreak = 0;
      let current = 0;
      insightDays.forEach((day) => {
        const hasWork = insightEvents.some((event) => event.person === person && event.date === day);
        current = hasWork ? current + 1 : 0;
        maxStreak = Math.max(maxStreak, current);
      });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });

    const dayOffStreaks = TEAM.map((person) => {
      let maxStreak = 0;
      let current = 0;
      insightDays.forEach((day) => {
        const hasWork = insightEvents.some((event) => event.person === person && event.date === day);
        current = hasWork ? 0 : current + 1;
        maxStreak = Math.max(maxStreak, current);
      });
      return { label: person, value: maxStreak, color: PERSON_COLORS[person] };
    });

    const startHourBuckets = Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      value: insightEvents.filter((event) => event.startTime?.startsWith(String(hour).padStart(2, '0'))).length
    })).filter((bucket) => bucket.value > 0);

    const overtimeCounts = TEAM.map((person) => {
      const personalDailyMap = new Map<string, number>();
      insightEvents
        .filter((event) => event.person === person)
        .forEach((event) => {
          personalDailyMap.set(event.date, (personalDailyMap.get(event.date) ?? 0) + getEventHours(event));
        });
      const count = Array.from(personalDailyMap.values()).filter((hours) => hours > 8).length;
      return { label: person, value: count, color: PERSON_COLORS[person] };
    });

    const weekday = insightEvents.filter((event) => {
      const day = new Date(`${event.date}T00:00:00Z`).getUTCDay();
      return day > 0 && day < 6;
    });
    const weekend = insightEvents.filter((event) => {
      const day = new Date(`${event.date}T00:00:00Z`).getUTCDay();
      return day === 0 || day === 6;
    });

    const weekdayWeekend = [
      { label: 'Weekday', value: weekday.reduce((sum, event) => sum + getEventHours(event), 0), color: '#60a5fa' },
      { label: 'Weekend', value: weekend.reduce((sum, event) => sum + getEventHours(event), 0), color: '#f97316' }
    ];

    return {
      hoursByPerson,
      hoursByDay,
      weekdayHours,
      monthRanking,
      topHeavyDays,
      workDayStreaks,
      dayOffStreaks,
      startHourBuckets,
      overtimeCounts,
      weekdayWeekend
    };
  }, [insightEvents, insightDays]);

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
          <h1>{view === 'calendar' ? formatMonthYear(viewMonth) : 'Schedule Insights'}</h1>
          <p className="subheading">{isLoadingEvents ? 'Loading Teamup events…' : 'Live Teamup data'}</p>
        </div>
        <div className="calendar-actions">
          <button type="button" className={view === 'calendar' ? 'tab-active' : ''} onClick={() => setView('calendar')}>Calendar</button>
          <button type="button" className={view === 'insights' ? 'tab-active' : ''} onClick={() => setView('insights')}>Insights</button>
          {view === 'calendar' && (
            <>
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>Prev</button>
              <button type="button" onClick={() => setViewMonth(DEFAULT_MONTH)}>Feb 2026</button>
              <button type="button" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>Next</button>
            </>
          )}
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

      {view === 'calendar' ? (
        <>
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
        </>
      ) : (
        <section className="insights-shell">
          <div className="insight-range">
            <label>
              Start
              <input type="date" value={insightRangeStart} onChange={(event) => setInsightRangeStart(event.target.value)} max={insightRangeEnd} />
            </label>
            <label>
              End
              <input type="date" value={insightRangeEnd} onChange={(event) => setInsightRangeEnd(event.target.value)} min={insightRangeStart} />
            </label>
          </div>

          <div className="insight-grid">
            <article className="insight-card"><h3>1) Hours Over Time</h3><LineChart data={insights.hoursByDay} /></article>
            <article className="insight-card"><h3>2) Hours by Doctor</h3><BarChart data={insights.hoursByPerson} /></article>
            <article className="insight-card"><h3>3) Weekday vs Weekend Hours</h3><BarChart data={insights.weekdayWeekend} /></article>
            <article className="insight-card"><h3>4) Most Hours per Month Ranking</h3><BarChart data={insights.monthRanking} /></article>
            <article className="insight-card"><h3>5) Consecutive Workday Max</h3><BarChart data={insights.workDayStreaks} /></article>
            <article className="insight-card"><h3>6) Consecutive Days Off Max</h3><BarChart data={insights.dayOffStreaks} /></article>
            <article className="insight-card"><h3>7) Start Time Distribution</h3><BarChart data={insights.startHourBuckets} /></article>
            <article className="insight-card"><h3>8) Hours by Day of Week</h3><BarChart data={insights.weekdayHours} /></article>
            <article className="insight-card"><h3>9) Overtime Days (&gt;8h)</h3><BarChart data={insights.overtimeCounts} /></article>
            <article className="insight-card"><h3>10) Highest Load Days</h3><BarChart data={insights.topHeavyDays} /></article>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
