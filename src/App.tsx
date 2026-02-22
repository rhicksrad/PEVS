import { useMemo, useState } from 'react';
import {
  WEEKDAY_LABELS,
  formatIsoDate,
  formatMonthYear,
  getCalendarGridDays,
  isSameDay,
  isSameMonth
} from './lib/date';

const PEOPLE = ['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5'];

function App() {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);

  const goToPreviousMonth = () => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const toggleSelectedDate = (day: Date) => {
    setSelectedDate((current) => (current && isSameDay(current, day) ? null : day));
  };

  return (
    <main className="app-shell">
      <section className="calendar-panel" aria-label="Shift calendar">
        <header className="calendar-header">
          <h1>{formatMonthYear(viewMonth)}</h1>
          <div className="calendar-actions">
            <button type="button" onClick={goToPreviousMonth} aria-label="Go to previous month">
              Prev
            </button>
            <button type="button" onClick={goToToday} aria-label="Go to current month">
              Today
            </button>
            <button type="button" onClick={goToNextMonth} aria-label="Go to next month">
              Next
            </button>
          </div>
        </header>

        <div className="weekday-row" role="presentation">
          {WEEKDAY_LABELS.map((weekday) => (
            <div key={weekday} className="weekday-cell">
              {weekday}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {days.map((day) => {
            const inMonth = isSameMonth(day, viewMonth);
            const isToday = isSameDay(day, today);
            const isSelected = selectedDate ? isSameDay(selectedDate, day) : false;

            return (
              <button
                key={formatIsoDate(day)}
                type="button"
                className={[
                  'day-cell',
                  inMonth ? '' : 'day-outside-month',
                  isToday ? 'day-today' : '',
                  isSelected ? 'day-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => toggleSelectedDate(day)}
                aria-label={`Select ${formatIsoDate(day)}`}
                aria-pressed={isSelected}
              >
                <span>{day.getDate()}</span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="sidebar" aria-label="People placeholders">
        <h2>Team</h2>
        <p className="selected-text">
          Selected: <strong>{selectedDate ? formatIsoDate(selectedDate) : 'None'}</strong>
        </p>
        <ul>
          {PEOPLE.map((person) => (
            <li key={person}>{person}</li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

export default App;
