import { useEffect, useMemo, useState } from 'react';
import { PdfViewer } from './components/PdfViewer';
import {
  WEEKDAY_LABELS,
  formatIsoDate,
  formatMonthYear,
  getCalendarGridDays,
  isSameDay,
  isSameMonth
} from './lib/date';
import { extractPagesText, loadPdf, parseSchedule, type ParsedSchedule } from './lib/pdfSchedule';

const PEOPLE = ['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5'];
const PDF_FILE = 'purdue-e-cc-schedule-2026-02-22-20-34-50.pdf';

function buildPublicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/([^:]\/)\/+/, '$1');
}

function App() {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [pdf, setPdf] = useState<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [jumpToPage, setJumpToPage] = useState<number | null>(null);

  const pdfUrl = useMemo(() => buildPublicUrl(PDF_FILE), []);
  const days = useMemo(() => getCalendarGridDays(viewMonth), [viewMonth]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const loadedPdf = await loadPdf(pdfUrl);
        if (cancelled) return;

        setPdf(loadedPdf);

        const pagesText = await extractPagesText(loadedPdf);
        if (cancelled) return;

        setSchedule(parseSchedule(pagesText));
      } catch (error) {
        if (!cancelled) {
          setLoadingError(error instanceof Error ? error.message : 'Failed to load PDF');
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  const goToPreviousMonth = () => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const handleSelectDate = (day: Date) => {
    setSelectedDate(day);

    const iso = formatIsoDate(day);
    const pageMatch = schedule?.dayToPages[iso]?.[0] ?? null;
    setJumpToPage(pageMatch);
  };

  const selectedIsoDate = selectedDate ? formatIsoDate(selectedDate) : null;
  const selectedEntries = selectedIsoDate ? schedule?.days[selectedIsoDate]?.entries ?? [] : [];

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

        {schedule?.range && (
          <p className="range-text">
            Parsed range: <strong>{schedule.range.start}</strong> to <strong>{schedule.range.end}</strong>
          </p>
        )}

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
            const iso = formatIsoDate(day);
            const hasEntries = Boolean(schedule?.days[iso]?.entries.length);

            return (
              <button
                key={iso}
                type="button"
                className={[
                  'day-cell',
                  inMonth ? '' : 'day-outside-month',
                  isToday ? 'day-today' : '',
                  isSelected ? 'day-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleSelectDate(day)}
                aria-label={`Select ${iso}`}
                aria-pressed={isSelected}
              >
                <span>{day.getDate()}</span>
                {hasEntries && <span className="entry-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <aside className="details-panel" aria-label="Selected day details">
          <h2>Selected: {selectedIsoDate ?? 'None'}</h2>
          <h3>Team placeholders</h3>
          <ul>
            {PEOPLE.map((person) => (
              <li key={person}>{person}</li>
            ))}
          </ul>

          <h3>Parsed entries</h3>
          {selectedEntries.length === 0 ? (
            <p>No parsed entries for this day yet.</p>
          ) : (
            <ol>
              {selectedEntries.map((entry, index) => (
                <li key={`${entry.raw}-${index}`}>
                  {entry.person && <strong>{entry.person}</strong>} {entry.shift ? `— ${entry.shift}` : ''}
                  <div className="entry-raw">{entry.raw}</div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </section>

      <PdfViewer pdf={pdf} jumpToPage={jumpToPage} />

      {loadingError && (
        <p role="alert" className="error-banner">
          {loadingError}
        </p>
      )}
    </main>
  );
}

export default App;
